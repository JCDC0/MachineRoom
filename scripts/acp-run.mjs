#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { killTree, treeSpawnOptions } from '../server/processTree.js'
import { mcpServersForAcp } from './mcp-bridge.mjs'

const DEFAULT_MINUTES = 100
const PROMPT_LIMIT = 4 * 1024 * 1024

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

export function parseAcpArgs(argv = []) {
  const options = {
    file: '',
    args: [],
    cwd: process.cwd(),
    prompt: null,
    model: '',
    effort: '',
    minutes: DEFAULT_MINUTES,
    seconds: null,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--arg') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--arg needs a value.')
      options.args.push(value)
      index += 1
      continue
    }
    if (!['--file', '--cwd', '--prompt', '--model', '--effort', '--minutes', '--seconds'].includes(arg)) {
      throw new Error(`Unknown option ${arg}. Use --file, --arg, --cwd, --prompt, --model, --effort, --minutes or --seconds.`)
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${arg} needs a value.`)
    index += 1
    if (arg === '--minutes') {
      const minutes = Number(value)
      if (!Number.isInteger(minutes) || minutes < 1) throw new Error('--minutes needs a whole number of minutes, one or more.')
      options.minutes = minutes
    } else if (arg === '--seconds') {
      const seconds = Number(value)
      if (!Number.isInteger(seconds) || seconds < 1) throw new Error('--seconds needs a whole number of seconds, one or more.')
      options.seconds = seconds
    } else {
      options[arg.slice(2)] = value
    }
  }
  if (!options.help && !options.file.trim()) throw new Error('--file needs the ACP agent program.')
  return options
}

export function acpRunCommand({ command, minutes = DEFAULT_MINUTES, seconds = null, model = '', effort = '', script = fileURLToPath(import.meta.url) } = {}) {
  if (!command || typeof command.file !== 'string' || command.file.trim() === '') throw new Error('There is no ACP agent command to run.')
  const args = [script, '--file', command.file]
  for (const arg of Array.isArray(command.args) ? command.args : []) args.push('--arg', String(arg))
  args.push('--cwd', command.cwd || process.cwd())
  if (Number.isInteger(seconds) && seconds > 0) args.push('--seconds', String(seconds))
  else args.push('--minutes', String(minutes))
  if (model) args.push('--model', String(model))
  if (effort) args.push('--effort', String(effort))
  return { file: process.execPath, args }
}

function readInput() {
  return new Promise((done, fail) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      text += chunk
      if (text.length > PROMPT_LIMIT) fail(new Error('The prompt is larger than 4 MB.'))
    })
    process.stdin.once('end', () => done(text))
    process.stdin.once('error', fail)
  })
}

function optionValues(option) {
  const values = []
  for (const entry of option?.options ?? []) {
    if (Array.isArray(entry?.options)) values.push(...entry.options)
    else values.push(entry)
  }
  return values
}

function configOption(options, category) {
  const list = Array.isArray(options) ? options : []
  return list.find((option) => option?.category === category) ?? (category === 'model' ? list.find((option) => option?.id === 'model') : null) ?? (category === 'effort' ? list.find((option) => option?.id === 'effort') : null) ?? null
}

export async function runAcp(options, { log = process.stdout, error = process.stderr, input = null } = {}) {
  const prompt = typeof options.prompt === 'string' ? options.prompt : input === null ? await readInput() : input
  if (!prompt.trim()) throw new Error('The ACP run needs a prompt.')
  const limitMs = options.seconds ? options.seconds * 1000 : options.minutes * 60000
  const deadline = Date.now() + limitMs
  const cwd = resolve(options.cwd || process.cwd())
  const child = spawn(options.file, options.args, {
    cwd,
    env: { ...process.env, PWD: cwd },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...treeSpawnOptions(),
  })
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  const toolCalls = new Map()
  let nextId = 0
  let closed = false
  let sessionId = null
  let configOptions = []
  let stopReason = null
  let usage = null
  let problem = null
  let spawnError = null

  child.stdin?.on('error', () => {})
  child.stderr?.pipe(error, { end: false })
  child.on('close', (code) => {
    closed = true
    for (const [id, settle] of pending) {
      pending.delete(id)
      settle({ closed: true, code })
    }
  })
  child.on('error', (failure) => {
    closed = true
    spawnError = failure
    for (const [id, settle] of pending) {
      pending.delete(id)
      settle({ error: { message: failure.message } })
    }
  })

  function write(value) {
    log.write(`${JSON.stringify(value)}\n`)
  }

  function send(message) {
    if (closed || !child.stdin?.writable) return
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (failure) {
      spawnError = spawnError ?? failure
    }
  }

  function respond(id, result) {
    send({ jsonrpc: '2.0', id, result })
  }

  function respondError(id, code, text) {
    send({ jsonrpc: '2.0', id, error: { code, message: text } })
  }

  function withDeadline(promise, when) {
    let timer
    const late = new Promise((done) => {
      timer = setTimeout(() => done({ timeout: true }), Math.max(0, when - Date.now()))
    })
    return Promise.race([promise, late]).finally(() => clearTimeout(timer))
  }

  function request(method, params, when = deadline) {
    const id = ++nextId
    const answer = new Promise((settle) => {
      pending.set(id, settle)
      send({ jsonrpc: '2.0', id, method, params })
    })
    return withDeadline(answer, when)
  }

  function answerRequest(message) {
    const params = message.params ?? {}
    if (message.method === 'session/request_permission') {
      const offered = Array.isArray(params.options) ? params.options : []
      const choice = offered.find((option) => option.kind === 'allow_always')
        ?? offered.find((option) => option.kind === 'allow_once')
        ?? offered.find((option) => String(option.kind ?? '').startsWith('allow'))
      respond(message.id, choice ? { outcome: { outcome: 'selected', optionId: choice.optionId } } : { outcome: { outcome: 'cancelled' } })
      return
    }
    respondError(message.id, -32601, `The ACP client answers only session/request_permission, not ${message.method}.`)
  }

  function noteToolCall(update, noteSessionId) {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (!id) return
    const key = `${noteSessionId ?? ''}\u0000${id}`
    const call = toolCalls.get(key) ?? { id, name: null, kind: null, status: null }
    for (const field of ['name', 'kind', 'status']) if (typeof update[field] === 'string') call[field] = update[field]
    toolCalls.set(key, call)
  }

  lines.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.method) {
      if (message.id !== undefined) {
        answerRequest(message)
        return
      }
      if (message.method === 'session/update' && message.params?.update) {
        const update = message.params.update
        write({ sessionId: message.params.sessionId ?? null, update })
        if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') noteToolCall(update, message.params.sessionId)
      }
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const settle = pending.get(message.id)
      pending.delete(message.id)
      settle(message)
    }
  })

  async function setOption(category, value) {
    if (!value) return
    const option = configOption(configOptions, category)
    if (!option) {
      if (category === 'model') throw new Error(`The agent offers no model choice, so the model ${value} cannot be set.`)
      error.write(`acp: the agent offers no ${category} choice, so ${value} is not set.\n`)
      return
    }
    if (option.currentValue === value) return
    const values = optionValues(option).map((entry) => entry?.value)
    if (!values.includes(value)) {
      if (category === 'model') throw new Error(`The model ${value} is not one of the models the agent offers.`)
      error.write(`acp: the agent does not offer the ${category} ${value}, so its current value is kept.\n`)
      return
    }
    const set = await request('session/set_config_option', { sessionId, configId: option.id, value })
    if (set.timeout) throw new Error(`The agent did not answer session/set_config_option for the ${category} before the time limit.`)
    if (set.closed) throw new Error(`The ACP agent stopped while setting the ${category} (exit code ${set.code === null ? 'none' : set.code}).`)
    if (set.error) throw new Error(set.error.message ?? `session/set_config_option failed for the ${category}.`)
    configOptions = Array.isArray(set.result?.configOptions) ? set.result.configOptions : configOptions
  }

  async function stop() {
    if (closed) return
    killTree(child)
    await Promise.race([once(child, 'close'), delay(3000)])
  }

  try {
    const initialized = await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'machine-room-acp', version: '0.1.305' },
    })
    if (initialized.timeout) throw new Error('The ACP agent did not answer initialize before the time limit.')
    if (initialized.closed) throw new Error(`The ACP agent stopped before initialize answered (exit code ${initialized.code === null ? 'none' : initialized.code}).`)
    if (initialized.error) throw new Error(initialized.error.message ?? 'initialize failed.')
    if (spawnError) throw spawnError
    if (initialized.result?.protocolVersion !== 1) throw new Error(`The ACP agent answered protocol version ${initialized.result?.protocolVersion}.`)

    const mcpServers = Array.isArray(options.mcpServers) ? options.mcpServers : mcpServersForAcp()
    const created = await request('session/new', { cwd, mcpServers })
    if (created.timeout) throw new Error('The ACP agent did not answer session/new before the time limit.')
    if (created.closed) throw new Error(`The ACP agent stopped before session/new answered (exit code ${created.code === null ? 'none' : created.code}).`)
    if (created.error) throw new Error(created.error.message ?? 'session/new failed.')
    sessionId = created.result?.sessionId ?? null
    if (!sessionId) throw new Error('session/new answered no session id.')
    configOptions = Array.isArray(created.result?.configOptions) ? created.result.configOptions : []
    write({ type: 'acp_session', sessionId })

    await setOption('model', options.model)
    await setOption('effort', options.effort)

    const prompted = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })
    if (prompted.timeout) {
      send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
      await delay(2000)
      problem = `The prompt did not finish within ${options.seconds ? `${options.seconds} seconds` : `${options.minutes} minutes`}.`
    } else if (prompted.closed) {
      problem = `The ACP agent stopped before the prompt finished (exit code ${prompted.code === null ? 'none' : prompted.code}).`
    } else if (prompted.error) {
      problem = prompted.error.message ?? 'session/prompt failed.'
    } else {
      stopReason = prompted.result?.stopReason ?? null
      usage = prompted.result?.usage ?? null
      if (stopReason !== 'end_turn') problem = `The ACP agent stopped with ${stopReason ?? 'no reason'}.`
    }
  } catch (failure) {
    problem = spawnError?.message ?? failure?.message ?? String(failure)
  } finally {
    write({ type: 'acp_result', sessionId, stopReason, usage, toolCalls: [...toolCalls.values()], error: problem })
    await stop()
    lines.close()
  }
  return { code: problem ? 1 : 0, sessionId, stopReason, usage, problem }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    const options = parseAcpArgs(process.argv.slice(2))
    if (options.help) {
      console.log('Usage: node scripts/acp-run.mjs --file PROGRAM [--arg VALUE] [--cwd FOLDER] [--prompt TEXT] [--model ID] [--effort LEVEL] [--minutes N | --seconds N]')
      console.log('')
      console.log('Starts an Agent Client Protocol agent, opens a session, sends the prompt from --prompt or standard input,')
      console.log('answers each permission request with the first allow option, and writes each session/update to stdout, one JSON object per line.')
      console.log('It writes an acp_session line after session/new and an acp_result line at the end.')
    } else {
      const result = await runAcp(options)
      process.exitCode = result.code
    }
  } catch (failure) {
    console.error(failure?.message ?? String(failure))
    process.exitCode = 1
  }
}
