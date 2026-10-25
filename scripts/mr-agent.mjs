#!/usr/bin/env node
import { exec } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SEARCH_OFF, fetchPage, readSearchChoice, searchWeb } from '../server/search.js'

const DEFAULT_URL = 'https://openrouter.ai/api/v1'
const FETCH_TIMEOUT_MS = 120000
const SHELL_TIMEOUT_MS = 120000
const SHELL_OUTPUT_LIMIT = 8000
const MAX_STEPS = 60
const SEARCH_MATCH_LIMIT = 200
const SEARCH_FILE_LIMIT = 2000000
const MISSING_KEY = 'Set MACHINEROOM_API_KEY or OPENROUTER_API_KEY.'

const SYSTEM_PROMPT =
  'You are MachineRoom, a coding agent. Work only inside the working folder. Use the tools to read, write, edit, list, search and run commands. When the work is done, reply with plain text and no tool call.'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a file, making its folders when needed.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace one exact string in a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the entries in a folder.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Find a regular expression in the files under a folder.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a command in the working folder.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return up to 8 results.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch an http or https page as plain text.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
]

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function sanitize(text, key) {
  const value = String(text ?? '')
  return key ? value.replaceAll(key, '[key]') : value
}

function parseArgs(argv) {
  const options = { model: '', cwd: process.cwd(), prompt: '' }
  const words = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--model' || arg === '--cwd') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value.`)
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node scripts/mr-agent.mjs --model ID [--cwd FOLDER] PROMPT\n')
      return null
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`)
    words.push(arg)
  }
  if (!String(options.model).trim()) throw new Error('--model needs a model id.')
  options.prompt = words.join(' ').trim()
  if (!options.prompt) throw new Error('The prompt is missing.')
  options.cwd = workingFolder(options.cwd)
  return options
}

function workingFolder(value) {
  const folder = resolve(String(value || '.'))
  let info
  try {
    info = statSync(folder)
  } catch {
    throw new Error(`The working folder ${folder} was not found.`)
  }
  if (!info.isDirectory()) throw new Error(`The working folder ${folder} is not a folder.`)
  return folder
}

function keyFrom(env) {
  for (const name of ['MACHINEROOM_API_KEY', 'OPENROUTER_API_KEY']) {
    const value = env?.[name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

function baseUrl(env) {
  const value = env?.MACHINEROOM_API_URL
  const url = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_URL
  return url.replace(/\/+$/, '')
}

function counted(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function usageOf(data) {
  const usage = data?.usage && typeof data.usage === 'object' && !Array.isArray(data.usage) ? data.usage : {}
  const input = counted(usage.input_tokens) ?? counted(usage.prompt_tokens) ?? 0
  const output = counted(usage.output_tokens) ?? counted(usage.completion_tokens) ?? 0
  const cost = counted(usage.cost) ?? counted(usage.total_cost_usd) ?? counted(usage.total_cost) ?? counted(data?.cost)
  return { input, output, cost }
}

function replyOf(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null
  const message = choice?.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('The API answer had no message.')
  return message
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const words = []
  for (const part of content) {
    if (typeof part === 'string') {
      words.push(part)
      continue
    }
    if (part?.type === 'text' && typeof part.text === 'string') words.push(part.text)
  }
  return words.join('\n')
}

function toolCallsOf(message, prefix) {
  const calls = []
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const fn = call?.function
    if (!fn || typeof fn.name !== 'string' || fn.name === '') continue
    calls.push({
      id: typeof call.id === 'string' && call.id !== '' ? call.id : `${prefix}_${calls.length}`,
      name: fn.name,
      arguments: fn.arguments,
    })
  }
  if (calls.length === 0 && typeof message.function_call?.name === 'string' && message.function_call.name !== '') {
    calls.push({ id: `${prefix}_0`, name: message.function_call.name, arguments: message.function_call.arguments })
  }
  return calls
}

function argumentsOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('The tool call arguments were not JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The tool call arguments were not an object.')
  return parsed
}

function pathFrom(args, fallback = '') {
  for (const key of ['path', 'file_path', 'file', 'folder']) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return fallback
}

function inside(cwd, raw) {
  const value = String(raw)
  const full = resolve(cwd, value)
  const seen = relative(cwd, full)
  if (seen !== '' && (seen.startsWith(`..${sep}`) || seen === '..' || isAbsolute(seen))) {
    throw new Error(`The path ${value} is outside the working folder.`)
  }
  return full
}

function streamInput(name, args) {
  if (name === 'read_file') return { file_path: pathFrom(args) }
  if (name === 'write_file') return { file_path: pathFrom(args), content: typeof args.content === 'string' ? args.content : '' }
  if (name === 'edit_file') {
    return {
      file_path: pathFrom(args),
      old_string: typeof args.old_string === 'string' ? args.old_string : '',
      new_string: typeof args.new_string === 'string' ? args.new_string : '',
    }
  }
  if (name === 'list_dir') return { path: pathFrom(args, '.') }
  if (name === 'search') {
    return {
      pattern: typeof args.pattern === 'string' ? args.pattern : '',
      path: pathFrom(args, '.'),
    }
  }
  if (name === 'run_shell') return { command: typeof args.command === 'string' ? args.command : '' }
  if (name === 'web_search') return { query: typeof args.query === 'string' ? args.query : '' }
  if (name === 'web_fetch') return { url: typeof args.url === 'string' ? args.url : '' }
  return args
}

const STREAM_NAMES = {
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_dir: 'LS',
  search: 'Grep',
  run_shell: 'Bash',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
}

function readTool(args, cwd) {
  const path = pathFrom(args)
  if (!path) throw new Error('read_file needs a path.')
  const full = inside(cwd, path)
  let info
  try {
    info = statSync(full)
  } catch {
    throw new Error(`The file ${path} was not found.`)
  }
  if (!info.isFile()) throw new Error(`The path ${path} is not a file.`)
  return { text: readFileSync(full, 'utf8'), isError: false }
}

function writeTool(args, cwd) {
  const path = pathFrom(args)
  if (!path) throw new Error('write_file needs a path.')
  if (typeof args.content !== 'string') throw new Error('write_file needs content as a string.')
  const full = inside(cwd, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, args.content, 'utf8')
  return { text: `Wrote ${relative(cwd, full) || basename(full)}.`, isError: false }
}

function editTool(args, cwd) {
  const path = pathFrom(args)
  if (!path) throw new Error('edit_file needs a path.')
  const oldText = typeof args.old_string === 'string' ? args.old_string : ''
  const newText = typeof args.new_string === 'string' ? args.new_string : ''
  if (oldText === '') throw new Error('edit_file needs old_string.')
  const full = inside(cwd, path)
  let text
  try {
    text = readFileSync(full, 'utf8')
  } catch {
    throw new Error(`The file ${path} was not found.`)
  }
  const first = text.indexOf(oldText)
  if (first === -1) throw new Error(`The old string was not found in ${path}.`)
  if (text.indexOf(oldText, first + oldText.length) !== -1) throw new Error(`The old string appears more than once in ${path}.`)
  writeFileSync(full, `${text.slice(0, first)}${newText}${text.slice(first + oldText.length)}`, 'utf8')
  return { text: `Edited ${relative(cwd, full) || basename(full)}.`, isError: false }
}

function listTool(args, cwd) {
  const path = pathFrom(args, '.')
  const full = inside(cwd, path)
  let info
  try {
    info = statSync(full)
  } catch {
    throw new Error(`The folder ${path} was not found.`)
  }
  if (!info.isDirectory()) throw new Error(`The path ${path} is not a folder.`)
  const entries = readdirSync(full, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  return { text: entries.length > 0 ? entries.join('\n') : '(empty folder)', isError: false }
}

function searchTool(args, cwd) {
  const pattern = typeof args.pattern === 'string' ? args.pattern : ''
  if (pattern === '') throw new Error('search needs a pattern.')
  let regex
  try {
    regex = new RegExp(pattern)
  } catch {
    throw new Error(`The pattern ${pattern} is not a regular expression.`)
  }
  const start = inside(cwd, pathFrom(args, '.'))
  const found = []
  const visit = (path) => {
    if (found.length >= SEARCH_MATCH_LIMIT) return
    let info
    try {
      info = statSync(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      const name = basename(path)
      if (name === '.git' || name === 'node_modules') return
      let entries
      try {
        entries = readdirSync(path, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        if (found.length >= SEARCH_MATCH_LIMIT) break
        visit(join(path, entry.name))
      }
      return
    }
    if (!info.isFile() || info.size > SEARCH_FILE_LIMIT) return
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return
    }
    if (text.includes('\0')) return
    const name = relative(cwd, path).split(sep).join('/')
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length && found.length < SEARCH_MATCH_LIMIT; index += 1) {
      if (regex.test(lines[index])) found.push(`${name}:${index + 1}: ${lines[index]}`)
    }
  }
  visit(start)
  return { text: found.length > 0 ? found.join('\n') : 'No matches.', isError: false }
}

function shellTool(args, cwd) {
  const command = typeof args.command === 'string' ? args.command : ''
  if (command.trim() === '') return Promise.resolve({ text: 'run_shell needs a command.', isError: true })
  const env = { ...process.env }
  delete env.MACHINEROOM_API_KEY
  delete env.OPENROUTER_API_KEY
  return new Promise((done) => {
    exec(
      command,
      { cwd, env, timeout: SHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.slice(0, SHELL_OUTPUT_LIMIT)
        if (error?.killed) {
          done({ text: output || `The command ran past ${SHELL_TIMEOUT_MS / 1000} seconds.`, isError: true })
          return
        }
        if (error) {
          done({ text: output || `The command failed: ${error.message}`, isError: true })
          return
        }
        done({ text: output || '(no output)', isError: false })
      },
    )
  })
}

function runsFolder() {
  const given = process.env.MACHINEROOM_RUNS
  if (typeof given === 'string' && given.trim() !== '') return resolve(given)
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs')
}

async function slotKey(folder, name) {
  const slot = String(name ?? '').trim()
  if (slot === '') return ''
  try {
    const family = await import('../server/family.js')
    if (typeof family.readKey === 'function') {
      const value = await family.readKey(folder, slot)
      if (typeof value === 'string' && value !== '') return value
    }
  } catch {}
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot)) {
    const value = process.env[slot]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

async function webSearchTool(args, web) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query === '') return { text: 'web_search needs a query.', isError: true }
  const choice = readSearchChoice(web.runsFolder)
  if (choice.provider === '') return { text: SEARCH_OFF, isError: false }
  const key = choice.keyName === '' ? '' : await slotKey(web.runsFolder, choice.keyName)
  const outcome = await searchWeb(query, { choice, key })
  return { text: outcome.text, isError: Boolean(outcome.error) }
}

async function webFetchTool(args) {
  const url = typeof args.url === 'string' ? args.url.trim() : ''
  if (url === '') return { text: 'web_fetch needs a URL.', isError: true }
  const page = await fetchPage(url)
  return { text: page.error || page.text || 'The page was empty.', isError: Boolean(page.error) }
}

async function runTool(name, args, cwd, web) {
  try {
    if (name === 'read_file') return readTool(args, cwd)
    if (name === 'write_file') return writeTool(args, cwd)
    if (name === 'edit_file') return editTool(args, cwd)
    if (name === 'list_dir') return listTool(args, cwd)
    if (name === 'search') return searchTool(args, cwd)
    if (name === 'run_shell') return await shellTool(args, cwd)
    if (name === 'web_search') return await webSearchTool(args, web)
    if (name === 'web_fetch') return await webFetchTool(args)
    return { text: `The tool ${name} is not known.`, isError: true }
  } catch (error) {
    return { text: String(error?.message ?? error), isError: true }
  }
}

async function post(url, key, payload) {
  let response
  try {
    response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`The API request failed: ${error?.message ?? String(error)}`)
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {}
    detail = sanitize(detail.slice(0, 500), key)
    throw new Error(`The API answered ${response.status}${detail ? `: ${detail}` : ''}.`)
  }
  try {
    return await response.json()
  } catch {
    throw new Error('The API answer was not JSON.')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return
  const key = keyFrom(process.env)
  if (!key) {
    process.stderr.write(`${MISSING_KEY}\n`)
    process.exitCode = 1
    return
  }
  const url = baseUrl(process.env)
  const web = { runsFolder: runsFolder() }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: options.prompt },
  ]
  let inputTokens = 0
  let outputTokens = 0
  let cost = null
  let lastText = ''
  let step = 0

  const finish = (isError, result) => {
    writeJson({
      type: 'result',
      subtype: isError ? 'error' : 'success',
      is_error: isError,
      result,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      ...(cost === null ? {} : { total_cost_usd: cost }),
    })
    if (isError) process.exitCode = 1
  }

  try {
    for (step = 0; step < MAX_STEPS; step += 1) {
      const data = await post(url, key, { model: options.model, messages, tools: TOOLS, tool_choice: 'auto' })
      const message = replyOf(data)
      const usage = usageOf(data)
      inputTokens += usage.input
      outputTokens += usage.output
      if (usage.cost !== null) cost = (cost ?? 0) + usage.cost
      const text = textOf(message.content).trim()
      if (text !== '') lastText = text
      const calls = toolCallsOf(message, `call_${step}`)
      const inputs = calls.map((call) => {
        try {
          return { args: argumentsOf(call.arguments), error: '' }
        } catch (error) {
          return { args: {}, error: String(error?.message ?? error) }
        }
      })
      const items = []
      if (text !== '') items.push({ type: 'text', text })
      calls.forEach((call, index) => {
        items.push({ type: 'tool_use', id: call.id, name: STREAM_NAMES[call.name] ?? call.name, input: streamInput(call.name, inputs[index].args) })
      })
      if (items.length > 0) writeJson({ type: 'assistant', message: { role: 'assistant', content: items } })
      if (calls.length === 0) {
        finish(false, lastText)
        return
      }
      messages.push({
        role: 'assistant',
        content: text === '' ? null : text,
        tool_calls: calls.map((call, index) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(inputs[index].args) },
        })),
      })
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index]
        const outcome = inputs[index].error !== ''
          ? { text: inputs[index].error, isError: true }
          : await runTool(call.name, inputs[index].args, options.cwd, web)
        messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
        writeJson({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: call.id, content: outcome.text, is_error: Boolean(outcome.isError) }],
          },
        })
      }
    }
    finish(true, lastText !== '' ? lastText : `Stopped after ${MAX_STEPS} steps.`)
  } catch (error) {
    finish(true, String(error?.message ?? error))
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exitCode = 1
})
