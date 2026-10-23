#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { killTree, treeSpawnOptions } from '../server/processTree.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const FIXTURE = join(REPO, 'public', 'fixtures', 'sandbox-tree.json')
const DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash'
const DEFAULT_MINUTES = 5
const PROMPT = [
  'Work only inside the current folder. Do these four steps in order and change nothing else.',
  '1. Read src/math.js with the read tool and note what it exports.',
  '2. Read src/strings.js with the read tool and note what it exports.',
  '3. Write docs/acp-note.md with exactly this line: ACP probe.',
  '4. Start exactly one subagent with the task tool. Give it this prompt: "Read test/strings.test.js with the read tool and reply with its first line." Wait for the subagent to finish.',
  'Do not use the shell. Do not edit any other file. Do not start a second subagent. When all four steps are done, reply with one short sentence.',
].join('\n')

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function inside(parent, child, platform = process.platform) {
  const clean = (text) => (platform === 'win32' ? text.toLowerCase() : text)
  const rel = relative(clean(resolve(parent)), clean(resolve(child)))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function parseProbeArgs(argv = []) {
  const options = {
    root: null,
    out: null,
    model: DEFAULT_MODEL,
    minutes: DEFAULT_MINUTES,
    opencode: null,
    keep: false,
    help: false,
  }
  const names = { '--root': 'root', '--out': 'out', '--model': 'model', '--minutes': 'minutes', '--opencode': 'opencode' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--keep') {
      options.keep = true
      continue
    }
    if (!Object.hasOwn(names, arg)) throw new Error(`Unknown option ${arg}. Use --root, --out, --model, --minutes, --opencode or --keep.`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.`)
    index += 1
    if (arg === '--minutes') {
      const minutes = Number(value)
      if (!Number.isInteger(minutes) || minutes < 1) throw new Error('--minutes needs a whole number of minutes, at least 1.')
      options.minutes = minutes
    } else {
      options[names[arg]] = value
    }
  }
  if (!options.model.trim()) throw new Error('--model needs a model id.')
  return options
}

export function probeCommand({ opencode = null, platform = process.platform } = {}) {
  if (opencode) return { command: opencode, args: ['acp'], options: {} }
  if (platform === 'win32') return { command: 'opencode acp', args: [], options: { shell: true } }
  return { command: 'opencode', args: ['acp'], options: {} }
}

function sandboxText(file) {
  if (file.endsWith('.json')) return '{"name":"acp-probe-sandbox","private":true,"type":"module"}\n'
  if (file.endsWith('.js')) return `export const note = ${JSON.stringify(file)}\n`
  return `# ${file}\n`
}

export function prepareSandbox(given = null, fixture = FIXTURE) {
  if (given) {
    const root = resolve(given)
    if (inside(REPO, root)) throw new Error('The probe must not run in this checkout. Give a fresh folder outside it.')
    if (existsSync(root)) {
      if (!statSync(root).isDirectory()) throw new Error(`${root} is not a folder.`)
      if (readdirSync(root).length > 0) throw new Error(`${root} is not empty. Give a fresh folder.`)
    } else {
      mkdirSync(root, { recursive: true })
    }
    return { root, owned: false }
  }
  const root = mkdtempSync(join(tmpdir(), 'machineroom-acp-'))
  return { root, owned: true }
}

export function fillSandbox(root, fixture = FIXTURE) {
  const tree = JSON.parse(readFileSync(fixture, 'utf8'))
  const files = []
  for (const file of tree.files ?? []) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, sandboxText(file))
    files.push(file)
  }
  return files
}

function modelOption(configOptions) {
  const list = Array.isArray(configOptions) ? configOptions : []
  return list.find((option) => option?.category === 'model') ?? list.find((option) => option?.id === 'model') ?? null
}

function modelValues(option) {
  const values = []
  for (const entry of option?.options ?? []) {
    if (Array.isArray(entry?.options)) values.push(...entry.options)
    else values.push(entry)
  }
  return values
}

function toolKey(sessionId, toolCallId) {
  return `${sessionId ?? ''}\u0000${toolCallId ?? ''}`
}

export async function runProbe(options, { log = console.log } = {}) {
  const { root, owned } = prepareSandbox(options.root)
  const files = fillSandbox(root)
  const out = options.out ? resolve(options.out) : join(tmpdir(), 'machineroom-acp', `acp-${stamp()}.jsonl`)
  mkdirSync(dirname(out), { recursive: true })
  const recording = createWriteStream(out)
  const command = probeCommand({ opencode: options.opencode })
  const child = spawn(command.command, command.args, {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...treeSpawnOptions(),
    ...command.options,
  })
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  const sessions = new Set()
  const children = new Map()
  const toolCalls = new Map()
  const permissions = []
  const updates = new Map()
  let nextId = 0
  let spawnError = null
  let closed = false
  let settled = false
  let failSpawn
  const spawnFailure = new Promise((_, fail) => {
    failSpawn = fail
  })
  spawnFailure.catch(() => {})

  child.on('close', (code) => {
    closed = true
    if (!settled) failSpawn(new Error(`opencode acp stopped before the probe finished (exit code ${code === null ? 'none' : code}).`))
  })
  child.on('error', (error) => {
    spawnError = error
    failSpawn(error)
  })
  child.stdin.on('error', () => {})
  child.stderr.resume()

  function record(dir, message) {
    recording.write(`${JSON.stringify({ at: Date.now(), dir, message })}\n`)
  }

  function send(message) {
    record('out', message)
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      spawnError = spawnError ?? error
    }
  }

  function respond(id, result) {
    send({ jsonrpc: '2.0', id, result })
  }

  function respondError(id, code, text) {
    send({ jsonrpc: '2.0', id, error: { code, message: text } })
  }

  function request(method, params) {
    const id = ++nextId
    return new Promise((settle) => {
      pending.set(id, settle)
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  function noteSession(sessionId) {
    if (typeof sessionId === 'string' && sessionId) sessions.add(sessionId)
  }

  function observe(update, sessionId) {
    const type = update?.sessionUpdate
    if (!type) return
    updates.set(type, (updates.get(type) ?? 0) + 1)
    const child = update?._meta?.['opencode/child-session']
    if (child?.id) {
      children.set(child.id, {
        id: child.id,
        parentId: child.parentID ?? null,
        depth: child.depth ?? null,
        title: child.title ?? null,
      })
    }
    if (type !== 'tool_call' && type !== 'tool_call_update') return
    const id = update.toolCallId
    if (!id) return
    const key = toolKey(sessionId, id)
    const call = toolCalls.get(key) ?? { id, sessionId: sessionId ?? null, name: null, title: null, kind: null, status: null, locations: [] }
    for (const field of ['name', 'title', 'kind', 'status']) {
      if (update[field] !== undefined && update[field] !== null) call[field] = update[field]
    }
    if (Array.isArray(update.locations)) call.locations = update.locations
    if (update.rawInput !== undefined) call.input = update.rawInput
    toolCalls.set(key, call)
  }

  function answerRequest(message) {
    const params = message.params ?? {}
    noteSession(params.sessionId)
    if (message.method === 'session/request_permission') {
      const offered = Array.isArray(params.options) ? params.options : []
      const choice =
        offered.find((option) => option.kind === 'allow_always') ??
        offered.find((option) => option.kind === 'allow_once') ??
        offered.find((option) => String(option.kind ?? '').startsWith('allow'))
      permissions.push({
        sessionId: params.sessionId ?? null,
        toolCallId: params.toolCall?.toolCallId ?? null,
        title: params.toolCall?.title ?? null,
        options: offered.map((option) => ({ id: option.optionId ?? null, name: option.name ?? null, kind: option.kind ?? null })),
      })
      respond(message.id, choice ? { outcome: { outcome: 'selected', optionId: choice.optionId } } : { outcome: { outcome: 'cancelled' } })
      return
    }
    respondError(message.id, -32601, `The probe answers only session/request_permission, not ${message.method}.`)
  }

  lines.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      record('in', { unparsed: text.slice(0, 1000) })
      return
    }
    record('in', message)
    if (message.method) {
      noteSession(message.params?.sessionId)
      if (message.id !== undefined) {
        answerRequest(message)
        return
      }
      if (message.method === 'session/update') observe(message.params?.update, message.params?.sessionId)
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const settle = pending.get(message.id)
      pending.delete(message.id)
      settle(message)
    }
  })

  async function withDeadline(promise, deadline) {
    let timer
    const late = new Promise((done) => {
      timer = setTimeout(() => done({ timeout: true }), Math.max(0, deadline - Date.now()))
    })
    try {
      return await Promise.race([promise, late])
    } finally {
      clearTimeout(timer)
    }
  }

  async function stop() {
    if (closed || child.exitCode !== null) return
    killTree(child)
    await Promise.race([once(child, 'close'), delay(5000)])
  }

  const deadline = Date.now() + options.minutes * 60000
  let problem = null
  let stopReason = null
  let sessionId = null
  let agentInfo = null
  let configOptions = []
  let modelChanged = false
  try {
    const initialized = await withDeadline(
      Promise.race([
        request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'machine-room-acp-probe', version: '0.1.233' },
        }),
        spawnFailure,
      ]),
      deadline
    )
    if (initialized.timeout) throw new Error('opencode acp did not answer initialize before the time limit.')
    if (initialized.error) throw new Error(initialized.error.message ?? 'initialize failed.')
    if (spawnError) throw spawnError
    if (initialized.result?.protocolVersion !== 1) throw new Error(`opencode acp answered protocol version ${initialized.result?.protocolVersion}.`)
    agentInfo = initialized.result?.agentInfo ?? null

    const created = await withDeadline(request('session/new', { cwd: root, mcpServers: [] }), deadline)
    if (created.timeout) throw new Error('opencode acp did not answer session/new before the time limit.')
    if (created.error) throw new Error(created.error.message ?? 'session/new failed.')
    sessionId = created.result?.sessionId ?? null
    if (!sessionId) throw new Error('session/new answered no session id.')
    noteSession(sessionId)
    configOptions = created.result?.configOptions ?? []
    const option = modelOption(configOptions)
    if (!option) throw new Error('opencode acp offers no model config option, so the probe cannot pick a model.')
    if (option.currentValue !== options.model) {
      const values = modelValues(option).map((value) => value?.value)
      if (!values.includes(options.model)) throw new Error(`${options.model} is not one of the models opencode acp offers.`)
      const set = await withDeadline(
        request('session/set_config_option', { sessionId, configId: option.id, value: options.model }),
        deadline
      )
      if (set.timeout) throw new Error('opencode acp did not answer session/set_config_option before the time limit.')
      if (set.error) throw new Error(set.error.message ?? 'session/set_config_option failed.')
      configOptions = set.result?.configOptions ?? configOptions
      const changed = modelOption(configOptions)
      if (changed?.currentValue !== options.model) throw new Error(`opencode acp did not take the model ${options.model}.`)
      modelChanged = true
    }

    const prompted = await withDeadline(
      request('session/prompt', { sessionId, prompt: [{ type: 'text', text: PROMPT }] }),
      deadline
    )
    if (prompted.timeout) {
      send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
      await delay(2000)
      problem = `The prompt did not finish within ${options.minutes} minutes.`
    } else if (prompted.error) {
      problem = prompted.error.message ?? 'session/prompt failed.'
    } else {
      stopReason = prompted.result?.stopReason ?? null
    }
    await delay(300)
  } catch (error) {
    problem = error?.message ?? String(error)
  } finally {
    settled = true
    await stop()
    lines.close()
    await new Promise((done) => recording.end(done))
    if (owned && !options.keep) rmSync(root, { recursive: true, force: true })
  }

  const summary = {
    opencode: agentInfo,
    root,
    files: files.length,
    recording: out,
    sessionId,
    sessions: [...sessions],
    children: [...children.values()],
    configOptions: configOptions.map((option) => ({ id: option.id, category: option.category ?? null, currentValue: option.currentValue })),
    model: options.model,
    modelChanged,
    stopReason,
    permissions,
    updates: Object.fromEntries([...updates.entries()].sort()),
    toolCalls: [...toolCalls.values()],
    problem,
    spawnError: spawnError ? spawnError.message : null,
  }
  log(`opencode acp probe`)
  log(`agent: ${agentInfo?.name ?? 'unknown'} ${agentInfo?.version ?? ''}`.trim())
  log(`root: ${root} (${files.length} files from the sandbox fixture)`)
  log(`recording: ${out}`)
  log(`model: ${options.model}${modelChanged ? ' (set through session/set_config_option)' : ' (already current)'}`)
  log(`config: ${summary.configOptions.map((option) => `${option.id}=${option.currentValue}`).join(', ') || 'none'}`)
  log(`sessions seen: ${summary.sessions.length}${sessionId ? ` (parent ${sessionId})` : ''}`)
  log(`child sessions in _meta: ${summary.children.length}`)
  for (const child of summary.children) log(`  ${child.title ?? 'child'} under ${child.parentId ?? '?'} at depth ${child.depth ?? '?'} (${child.id})`)
  log(`stop reason: ${stopReason ?? 'none'}`)
  log(`permission requests: ${permissions.length}`)
  log(`tool calls: ${summary.toolCalls.length}`)
  for (const call of summary.toolCalls) {
    const where = call.locations.map((location) => location.path).join(', ')
    log(`  ${call.kind ?? 'unknown'} ${call.name ?? ''} ${call.title ?? ''}${where ? ` [${where}]` : ''}`)
  }
  for (const [type, count] of [...updates.entries()].sort()) log(`  update ${type}: ${count}`)
  if (problem) log(`problem: ${problem}`)
  return { code: problem ? 1 : 0, summary }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try {
    const options = parseProbeArgs(process.argv.slice(2))
    if (options.help) {
      console.log('Usage: node scripts/acp-probe.mjs [--root FOLDER] [--out FILE] [--model ID] [--minutes N] [--opencode PATH] [--keep]')
      console.log('')
      console.log('Starts opencode acp in a fresh sandbox built from public/fixtures/sandbox-tree.json.')
      console.log('It asks for two reads, one write and one subagent, allows each permission request,')
      console.log('and writes every JSON-RPC message to a JSON lines file.')
      console.log('The default model is the lanes\' model. The default time limit is 5 minutes.')
    } else {
      const result = await runProbe(options)
      process.exitCode = result.code
    }
  } catch (error) {
    console.error(error?.message ?? String(error))
    process.exitCode = 1
  }
}
