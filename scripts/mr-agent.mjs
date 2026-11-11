#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { keyFromFile } from '../server/family.js'
import { killTree } from '../server/processTree.js'
import { gitPath, programPath } from '../server/programPath.js'
import { SEARCH_OFF, fetchPage, readSearchChoice, searchWeb } from '../server/search.js'
import { childEnvironment } from '../src/briefs/run.js'
import { callMcpTool, listAllMcpTools, mcpResultText, mcpRunsDir } from './mcp-bridge.mjs'

const DEFAULT_URL = 'https://openrouter.ai/api/v1'
const FETCH_TIMEOUT_MS = 120000
const SHELL_TIMEOUT_MS = 120000
const SHELL_TIMEOUT_MAX_S = 600
const SHELL_HEAD_LIMIT = 2000
const SHELL_TAIL_LIMIT = 6000
const DEFAULT_MAX_STEPS = 200
const MAX_TOKENS = 32000
const DEFAULT_CONTEXT_CHARS = 400000
const KEEP_TOOL_RESULTS = 6
const TOOL_RESULT_REMOVED = '[Output removed to save room. Run the tool again if it is needed.]'
const ASSISTANT_TEXT_REMOVED = '[Text removed to save room.]'
const TOOL_ARGUMENTS_REMOVED = '[Arguments removed to save room.]'
const NEWEST_READABLE_CHARS = 2000
const INSTRUCTIONS_LIMIT = 20000
const RETRY_LIMIT = 4
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 60000
const RETRY_STATUS = new Set([429, 500, 502, 503, 529])
const SEARCH_MATCH_LIMIT = 200
const SEARCH_LINE_LIMIT = 300
const SEARCH_FILE_LIMIT = 2000000
const GLOB_FILE_LIMIT = 500
const GIT_LIST_BUFFER = 64 * 1024 * 1024
const READ_LINE_LIMIT = 2000
const READ_LINE_WIDTH = 2000
const READ_BINARY_BYTES = 8192
const READ_SIZE_LIMIT = 50 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const READ_MORE = '[more lines. Read again with offset to see them.]'
const MISSING_KEY = 'Set MACHINEROOM_API_KEY or OPENROUTER_API_KEY.'
const MCP_TEXT_LIMIT = 20000
const MCP_EMPTY = 'No MCP servers are configured.'

function envNumber(env, name, fallback) {
  const value = Number(env?.[name])
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return String(platform)
}

function instructionDocs(cwd) {
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const full = join(cwd, name)
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (!info.isFile()) continue
    try {
      return { name, text: readFileSync(full, 'utf8').slice(0, INSTRUCTIONS_LIMIT) }
    } catch {}
  }
  return null
}

export function systemPrompt({ cwd, shell, platform = process.platform, date = new Date() } = {}) {
  const file = typeof shell?.file === 'string' && shell.file !== '' ? shell.file : '/bin/sh'
  const lines = [
    `You are MachineRoom, a coding agent. Work only inside the working folder ${cwd}.`,
    `The system is ${platformName(platform)}. run_shell runs commands with ${file}.`,
    `Today is ${date.toISOString().slice(0, 10)}.`,
    'Use the tools to read, write, edit, list, search and run commands.',
    "Read a file before you edit it. Keep changes small. Run the project's tests when you change code.",
    'When the work is done, reply with plain text and no tool call, ending with a short report of what you changed and what you could not check.',
  ]
  const docs = instructionDocs(cwd)
  if (docs) lines.push(`Project instructions from ${docs.name}:`, docs.text)
  return lines.join('\n')
}

const CORE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one file. Lines are numbered from 1. Reads 2000 lines at most.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number', description: 'The first line to read, 1-based.' },
          limit: { type: 'number', description: 'How many lines to read, 2000 at most.' },
        },
        required: ['path'],
      },
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
      description: 'Replace an exact string in a file. Set replace_all to replace every match.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' },
        },
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
      description: 'Find a regular expression in the files under a folder. Skips files git ignores.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          glob: { type: 'string', description: 'Only search files that match this glob, such as *.js.' },
          ignore_case: { type: 'boolean' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob_files',
      description: 'List the files that match a glob, such as *.js, sorted by name.',
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
      description: 'Run a command in the working folder. On Windows it uses Git Bash.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, timeout: { type: 'number', description: 'Seconds to wait, 600 at most.' } },
        required: ['command'],
      },
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

const MCP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'mcp_list_tools',
      description: 'List the tools the configured MCP servers offer.',
      parameters: { type: 'object', properties: { server: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call_tool',
      description: 'Call a tool on a configured MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string' },
          tool: { type: 'string' },
          arguments: { type: 'object' },
        },
        required: ['server', 'tool'],
      },
    },
  },
]

const TOOLS = [...CORE_TOOLS, ...MCP_TOOLS]

const PLAN_TOOL_NAMES = new Set(['read_file', 'list_dir', 'search', 'glob_files', 'web_search', 'web_fetch', 'mcp_list_tools'])
const EDIT_TOOL_NAMES = new Set([...PLAN_TOOL_NAMES, 'write_file', 'edit_file'])
const AUTO_SHELL_PROBLEM = 'Auto mode does not run this command.'
const AUTO_FORBIDDEN = [
  /\brm\b[^\n;&|]*\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/i,
  /\bRemove-Item\b[^\n;&|]*-Recurse\b/i,
  /\bdel(?:ete)?\s+[^\n;&|]*\/s\b/i,
  /\brmdir\s+[^\n;&|]*\/s\b/i,
  /\brd\s+[^\n;&|]*\/s\b/i,
  /\berase\s+[^\n;&|]*\/s\b/i,
  /\bgit\b[^\n;&|]*\bpush\b/i,
  /\bgit\b[^\n;&|]*\breset\b[^\n;&|]*--hard\b/i,
  /\bgit\b[^\n;&|]*\bclean\b/i,
  /\bgit\b[^\n;&|]*\bcheckout\b[^\n;&|]*--/i,
  /\bgit\b[^\n;&|]*\bbranch\b[^\n;&|]*-[dD]\b/i,
  /(?:^|[;&|]\s*|["'`]|(?:-c|\/[ck])\s+)(?:\S*[\\/])?format(?:\.com)?\b/i,
  /(?:^|[;&|]\s*|["'`]|(?:-c|\/[ck])\s+)(?:\S*[\\/])?shutdown(?:\.exe)?\b/i,
  /(?:^|[;&|]\s*|["'`]|(?:-c|\/[ck])\s+)(?:\S*[\\/])?mkfs(?:\.\w+)?\b/i,
]

function permissionModeFrom(env) {
  const value = String(env?.MACHINEROOM_PERMISSION_MODE ?? '').trim().toLowerCase()
  return ['plan', 'edits', 'ask', 'auto', 'bypass'].includes(value) ? value : ''
}

const PERMISSION_MODE = permissionModeFrom(process.env)

function toolsForMode(mode) {
  if (mode === 'plan') return TOOLS.filter((tool) => PLAN_TOOL_NAMES.has(tool.function.name))
  if (mode === 'edits') return TOOLS.filter((tool) => EDIT_TOOL_NAMES.has(tool.function.name))
  return TOOLS
}

const MODE_TOOLS = toolsForMode(PERMISSION_MODE)
const MODE_TOOL_NAMES = new Set(MODE_TOOLS.map((tool) => tool.function.name))
const MODE_REFUSES_TOOLS = MODE_TOOLS.length < TOOLS.length

function autoShellProblem(command) {
  if (PERMISSION_MODE !== 'auto') return ''
  return AUTO_FORBIDDEN.some((pattern) => pattern.test(command)) ? AUTO_SHELL_PROBLEM : ''
}

const APPROVAL_TOOLS = new Set(['write_file', 'edit_file', 'run_shell', 'mcp_call_tool'])
const APPROVAL_WAIT_MS = 4.5 * 60 * 1000
const APPROVAL_DENIED = 'The owner did not allow it.'

function approvalSettings() {
  const bridge = String(process.env.MACHINEROOM_BRIDGE ?? '').trim().replace(/\/+$/, '')
  const id = String(process.env.MACHINEROOM_ORCHESTRATOR_ID ?? '').trim() || 'orchestrator'
  const token = String(process.env.MACHINEROOM_ORCHESTRATOR_TOKEN ?? '').trim()
  return { bridge, id, token }
}

async function askApproval(tool, input) {
  if (PERMISSION_MODE !== 'ask') return null
  const { bridge, id, token } = approvalSettings()
  if (!bridge || !token) return { text: 'The approval bridge is not configured.', isError: true }
  let response
  try {
    response = await fetch(`${bridge}/api/orchestrator/approvals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-MachineRoom-Orchestrator': token,
      },
      body: JSON.stringify({ id, tool, input }),
      signal: AbortSignal.timeout(APPROVAL_WAIT_MS),
    })
  } catch (error) {
    return { text: `The approval request failed: ${String(error?.message ?? error)}`, isError: true }
  }
  let answer = null
  try {
    answer = await response.json()
  } catch {
    answer = null
  }
  if (!response.ok) {
    const problem = typeof answer?.error === 'string' && answer.error.trim() ? answer.error : 'The approval request failed.'
    return { text: problem, isError: true }
  }
  if (answer?.allow === true) return null
  const message = typeof answer?.message === 'string' && answer.message.trim() ? answer.message : APPROVAL_DENIED
  return { text: message, isError: true }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function sanitize(text, key) {
  const value = String(text ?? '')
  return key ? value.replaceAll(key, '[key]') : value
}

function parseArgs(argv) {
  const options = { model: '', cwd: process.cwd(), endpoint: '', prompt: '', reasoning: '' }
  const words = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--model' || arg === '--cwd' || arg === '--endpoint' || arg === '--reasoning') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value.`)
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node scripts/mr-agent.mjs --model ID [--endpoint NAME] [--cwd FOLDER] [--reasoning EFFORT] PROMPT\n')
      return null
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`)
    words.push(arg)
  }
  if (!String(options.model).trim()) throw new Error('--model needs a model id.')
  options.prompt = words.join(' ').trim()
  if (!options.prompt) throw new Error('The prompt is missing.')
  options.endpoint = String(options.endpoint).trim()
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

function runsFolderFrom(env) {
  const given = env?.MACHINEROOM_RUNS
  if (typeof given === 'string' && given.trim() !== '') return resolve(given.trim())
  return join(env?.TEMP || tmpdir(), 'machineroom-runs')
}

function readEndpoint(runsFolder, name) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(runsFolder, 'endpoints.json'), 'utf8'))
  } catch {
    return null
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.endpoints) ? parsed.endpoints : []
  return list.find((entry) => entry && entry.name === name) ?? null
}

async function keyForSlot(runsFolder, name) {
  return keyFromFile(runsFolder, name)
}

function modelForEndpoint(endpoint, model) {
  const prefix = `${endpoint.name}/`
  return model.startsWith(prefix) ? model.slice(prefix.length) : model
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

function leavesRoot(root, path) {
  const seen = relative(root, path)
  return seen !== '' && (seen.startsWith(`..${sep}`) || seen === '..' || isAbsolute(seen))
}

function realPathOrParent(path) {
  let probe = path
  for (;;) {
    try {
      return realpathSync.native(probe)
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return probe
      probe = parent
    }
  }
}

function realInside(cwd, path) {
  let root
  try {
    root = realpathSync.native(cwd)
  } catch {
    root = cwd
  }
  return !leavesRoot(root, realPathOrParent(path))
}

function inside(cwd, raw) {
  const value = String(raw)
  const full = resolve(cwd, value)
  if (leavesRoot(cwd, full) || !realInside(cwd, full)) {
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
  if (name === 'glob_files') {
    return {
      pattern: typeof args.pattern === 'string' ? args.pattern : '',
      path: pathFrom(args, '.'),
    }
  }
  if (name === 'run_shell') return { command: typeof args.command === 'string' ? args.command : '' }
  if (name === 'web_search') return { query: typeof args.query === 'string' ? args.query : '' }
  if (name === 'web_fetch') return { url: typeof args.url === 'string' ? args.url : '' }
  if (name === 'mcp_list_tools') {
    const server = typeof args.server === 'string' ? args.server.trim() : ''
    return server === '' ? {} : { server }
  }
  if (name === 'mcp_call_tool') {
    const inner = args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments : {}
    const input = {
      server: typeof args.server === 'string' ? args.server : '',
      tool: typeof args.tool === 'string' ? args.tool : '',
      arguments: inner,
    }
    if (typeof inner.path === 'string' && inner.path !== '') input.path = inner.path
    else if (typeof inner.file === 'string' && inner.file !== '') input.path = inner.file
    return input
  }
  return args
}

const STREAM_NAMES = {
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_dir: 'LS',
  search: 'Grep',
  glob_files: 'Glob',
  run_shell: 'Bash',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
}

function lineCount(text) {
  const value = String(text ?? '')
  if (value === '') return 0
  const lines = value.split('\n')
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

function countText(lines) {
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`
}

function readWindow(full, offset, limit) {
  const handle = openSync(full, 'r')
  const decoder = new StringDecoder('utf8')
  const chunk = Buffer.alloc(READ_CHUNK_BYTES)
  const lines = []
  let position = 0
  let number = 1
  let carry = ''
  let done = false
  let more = false
  try {
    while (!done) {
      const got = readSync(handle, chunk, 0, chunk.length, position)
      if (got === 0) {
        carry += decoder.end()
        break
      }
      position += got
      const text = carry + decoder.write(chunk.subarray(0, got))
      const parts = text.split('\n')
      carry = parts.pop()
      if (carry.length > READ_LINE_WIDTH + 1) carry = carry.slice(0, READ_LINE_WIDTH + 1)
      for (let index = 0; index < parts.length; index += 1) {
        if (number >= offset && lines.length < limit) {
          const raw = parts[index]
          lines.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        }
        number += 1
        if (lines.length >= limit) {
          more = index < parts.length - 1 || carry !== ''
          if (!more) {
            const probe = Buffer.alloc(1)
            more = readSync(handle, probe, 0, 1, position) > 0
          }
          done = true
          break
        }
      }
    }
    const total = number - 1 + (carry === '' ? 0 : 1)
    if (!done && carry !== '' && number >= offset && lines.length < limit) {
      lines.push(carry.endsWith('\r') ? carry.slice(0, -1) : carry)
    }
    return { lines, total, more }
  } finally {
    closeSync(handle)
  }
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
  const askedOffset = Math.trunc(Number(args.offset))
  const offset = Number.isFinite(askedOffset) && askedOffset > 1 ? askedOffset : 1
  const askedLimit = Math.trunc(Number(args.limit))
  const hasLimit = Number.isFinite(askedLimit) && askedLimit > 0
  const limit = hasLimit ? Math.min(askedLimit, READ_LINE_LIMIT) : READ_LINE_LIMIT
  if (info.size > READ_SIZE_LIMIT && !hasLimit) {
    throw new Error(`The file ${path} is over 50 MB, so read it with offset and limit.`)
  }
  const probe = Buffer.alloc(Math.min(READ_BINARY_BYTES, info.size))
  let read = 0
  if (probe.length > 0) {
    const handle = openSync(full, 'r')
    try {
      while (read < probe.length) {
        const got = readSync(handle, probe, read, probe.length - read, read)
        if (got === 0) break
        read += got
      }
    } finally {
      closeSync(handle)
    }
  }
  if (probe.subarray(0, read).includes(0)) return { text: `The file ${path} is binary, so it was not read.`, isError: false }
  let window
  try {
    window = readWindow(full, offset, limit)
  } catch {
    throw new Error(`The file ${path} could not be read.`)
  }
  if (window.lines.length === 0 && offset > window.total) {
    return { text: `The file ${path} has ${countText(window.total)}.`, isError: false }
  }
  const numbered = window.lines.map((line, index) => {
    const cut = line.length > READ_LINE_WIDTH ? line.slice(0, READ_LINE_WIDTH) : line
    return `${offset + index}\t${cut}`
  })
  const body = numbered.join('\n')
  const answer = window.more ? `${body}\n${READ_MORE}` : body
  return { text: answer === '' ? '(empty file)' : answer, isError: false }
}

function writeTool(args, cwd) {
  const path = pathFrom(args)
  if (!path) throw new Error('write_file needs a path.')
  if (typeof args.content !== 'string') throw new Error('write_file needs content as a string.')
  const full = inside(cwd, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, args.content, 'utf8')
  return {
    text: `Wrote ${relative(cwd, full) || basename(full)}. ${countText(lineCount(args.content))}.`,
    isError: false,
  }
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
  const replaceAll = args.replace_all === true
  if (!replaceAll && text.indexOf(oldText, first + oldText.length) !== -1) {
    throw new Error(`The old string appears more than once in ${path}. Set replace_all to replace every match.`)
  }
  const next = replaceAll
    ? text.split(oldText).join(newText)
    : `${text.slice(0, first)}${newText}${text.slice(first + oldText.length)}`
  writeFileSync(full, next, 'utf8')
  return {
    text: `Edited ${relative(cwd, full) || basename(full)}. ${countText(lineCount(next))}.`,
    isError: false,
  }
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

function gitFileList(cwd, start) {
  if (!existsSync(join(cwd, '.git'))) return null
  const base = relative(cwd, start).split(sep).join('/') || '.'
  let listed
  try {
    listed = execFileSync(gitPath(), ['-C', cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', base], {
      encoding: 'utf8',
      maxBuffer: GIT_LIST_BUFFER,
      timeout: 30000,
      windowsHide: true,
    })
  } catch {
    return null
  }
  return listed
    .split('\0')
    .filter(Boolean)
    .map((name) => name.replace(/\\/g, '/'))
}

function walkFiles(start, cwd) {
  const files = []
  const visited = new Set()
  const visit = (path) => {
    let info
    try {
      info = lstatSync(path)
    } catch {
      return
    }
    if (info.isSymbolicLink()) {
      if (!realInside(cwd, path)) return
      try {
        info = statSync(path)
      } catch {
        return
      }
    }
    if (info.isDirectory()) {
      const name = basename(path)
      if (name === '.git' || name === 'node_modules') return
      let real
      try {
        real = realpathSync.native(path)
      } catch {
        return
      }
      if (visited.has(real)) return
      visited.add(real)
      let entries
      try {
        entries = readdirSync(path, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) visit(join(path, entry.name))
      return
    }
    if (!info.isFile()) return
    files.push(relative(cwd, path).split(sep).join('/'))
  }
  visit(start)
  return files
}

function filesUnder(cwd, start) {
  let info
  try {
    info = statSync(start)
  } catch {
    return []
  }
  if (info.isFile()) return [relative(cwd, start).split(sep).join('/')]
  if (!info.isDirectory()) return []
  const listed = gitFileList(cwd, start)
  if (listed === null) return walkFiles(start, cwd)
  return listed
}

function globPattern(glob) {
  const source = String(glob ?? '').trim()
  if (source === '') return null
  let body = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '*') {
      if (source[index + 1] === '*') {
        index += 1
        if (source[index + 1] === '/') {
          index += 1
          body += '(?:.*/)?'
        } else {
          body += '.*'
        }
      } else {
        body += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      body += '[^/]'
      continue
    }
    body += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char
  }
  const regex = new RegExp(`^${body}$`)
  return source.includes('/') ? (name) => regex.test(name) : (name) => regex.test(basename(name))
}

function searchTool(args, cwd) {
  const pattern = typeof args.pattern === 'string' ? args.pattern : ''
  if (pattern === '') throw new Error('search needs a pattern.')
  let regex
  try {
    regex = new RegExp(pattern, args.ignore_case === true ? 'i' : '')
  } catch {
    throw new Error(`The pattern ${pattern} is not a regular expression.`)
  }
  const start = inside(cwd, pathFrom(args, '.'))
  const matchGlob = globPattern(typeof args.glob === 'string' ? args.glob : '')
  const found = []
  for (const name of filesUnder(cwd, start)) {
    if (found.length >= SEARCH_MATCH_LIMIT) break
    if (matchGlob && !matchGlob(name)) continue
    const full = join(cwd, name)
    if (!realInside(cwd, full)) continue
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (!info.isFile() || info.size > SEARCH_FILE_LIMIT) continue
    let text
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length && found.length < SEARCH_MATCH_LIMIT; index += 1) {
      if (!regex.test(lines[index])) continue
      const line = `${name}:${index + 1}: ${lines[index]}`
      found.push(line.length > SEARCH_LINE_LIMIT ? line.slice(0, SEARCH_LINE_LIMIT) : line)
    }
  }
  return { text: found.length > 0 ? found.join('\n') : 'No matches.', isError: false }
}

function globFilesTool(args, cwd) {
  const matchGlob = globPattern(typeof args.pattern === 'string' ? args.pattern : '')
  if (!matchGlob) throw new Error('glob_files needs a pattern.')
  const start = inside(cwd, pathFrom(args, '.'))
  const names = filesUnder(cwd, start)
    .filter((name) => realInside(cwd, join(cwd, name)) && matchGlob(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, GLOB_FILE_LIMIT)
  return { text: names.length > 0 ? names.join('\n') : 'No files.', isError: false }
}

function shellTimeoutMs(args) {
  const seconds = Number(args?.timeout)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, SHELL_TIMEOUT_MAX_S) * 1000
  const envMs = Number(process.env.MR_AGENT_SHELL_TIMEOUT_MS)
  if (Number.isFinite(envMs) && envMs > 0) return envMs
  return SHELL_TIMEOUT_MS
}

function underFolder(file, folder) {
  if (typeof folder !== 'string' || folder.trim() === '') return false
  const root = win32.resolve(folder).toLowerCase().replace(/[\\/]+$/, '')
  const target = win32.resolve(file).toLowerCase()
  return target === root || target.startsWith(`${root}\\`)
}

export function shellFor(command, {
  platform = process.platform,
  git = gitPath,
  onPath = programPath,
  exists = existsSync,
  systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR || '',
} = {}) {
  if (platform !== 'win32') return { file: '/bin/sh', args: ['-c', command] }
  let bash = ''
  try {
    const gitExe = git()
    if (gitExe) {
      const beside = win32.resolve(win32.dirname(gitExe), '..', 'bin', 'bash.exe')
      if (exists(beside) && !underFolder(beside, systemRoot)) bash = beside
    }
  } catch {}
  if (bash === '') {
    try {
      const found = onPath('bash')
      if (found && exists(found) && !underFolder(found, systemRoot)) bash = found
    } catch {}
  }
  if (bash !== '') return { file: bash, args: ['-c', command] }
  return { file: 'powershell.exe', args: ['-NoProfile', '-Command', command] }
}

function shellOutput() {
  let head = ''
  let tail = ''
  let total = 0
  return {
    add(text) {
      total += text.length
      head += text
      if (head.length > SHELL_HEAD_LIMIT) {
        tail += head.slice(SHELL_HEAD_LIMIT)
        head = head.slice(0, SHELL_HEAD_LIMIT)
        if (tail.length > SHELL_TAIL_LIMIT) tail = tail.slice(-SHELL_TAIL_LIMIT)
      }
    },
    text() {
      const cut = total - head.length - tail.length
      return cut > 0 ? `${head}\n[${cut} characters cut]\n${tail}` : `${head}${tail}`
    },
  }
}

function shellTool(args, cwd) {
  const timeoutMs = shellTimeoutMs(args)
  const command = typeof args.command === 'string' ? args.command : ''
  if (command.trim() === '') return Promise.resolve({ text: 'run_shell needs a command.', isError: true })
  if (autoShellProblem(command)) return Promise.resolve({ text: AUTO_SHELL_PROBLEM, isError: true })
  const env = childEnvironment(process.env, cwd)
  const shell = shellFor(command)
  return new Promise((done) => {
    let timedOut = false
    let finished = false
    const output = shellOutput()
    // exec drops detached, and killTree needs its own process group to reach the shell's children on Linux.
    const child = spawn(shell.file, shell.args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    for (const name of ['stdout', 'stderr']) {
      child[name].setEncoding('utf8')
      child[name].on('data', (text) => output.add(text))
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    function finish(failure) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const text = output.text()
      if (timedOut) done({ text: text || `The command ran past ${timeoutMs / 1000} seconds.`, isError: true })
      else if (failure) done({ text: text === '' ? failure : `${text}\n${failure}`, isError: true })
      else done({ text: text === '' ? '(no output)' : text, isError: false })
    }
    child.on('error', (error) => finish(error.message))
    child.on('close', (code, signal) => finish(code === 0 ? '' : `exit ${code ?? signal}`))
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

function mcpServerOf(args) {
  return typeof args?.server === 'string' ? args.server.trim() : ''
}

async function mcpListTool(args) {
  const server = mcpServerOf(args)
  const outcome = await listAllMcpTools(mcpRunsDir(), { server })
  const lines = outcome.tools.map((tool) => {
    const description = String(tool.description ?? '').replace(/\s+/g, ' ').trim()
    const shown = description.length > 100 ? `${description.slice(0, 99)}~` : description
    return `${tool.server}: ${tool.name}${shown === '' ? '' : ` - ${shown}`}`
  })
  for (const failure of outcome.errors) lines.push(`${failure.server}: ${failure.error}`)
  if (lines.length === 0) {
    return { text: server === '' ? MCP_EMPTY : `The MCP server ${server} offers no tools.`, isError: false }
  }
  return { text: lines.join('\n'), isError: outcome.tools.length === 0 && outcome.errors.length > 0 }
}

async function mcpCallTool(args) {
  const server = mcpServerOf(args)
  const tool = typeof args?.tool === 'string' ? args.tool.trim() : ''
  if (server === '') return { text: 'mcp_call_tool needs a server name.', isError: true }
  if (tool === '') return { text: 'mcp_call_tool needs a tool name.', isError: true }
  const toolArgs = args?.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments : {}
  const outcome = await callMcpTool(mcpRunsDir(), { server, tool, arguments: toolArgs })
  if (!outcome.ok) return { text: outcome.problem, isError: true }
  const text = mcpResultText(outcome.result)
  const capped = text.length > MCP_TEXT_LIMIT ? `${text.slice(0, MCP_TEXT_LIMIT)}\n[result cut at ${MCP_TEXT_LIMIT} characters]` : text
  return { text: capped === '' ? '(no result)' : capped, isError: outcome.result?.isError === true }
}

async function runTool(name, args, cwd, web) {
  try {
    if (MODE_REFUSES_TOOLS && !MODE_TOOL_NAMES.has(name)) {
      return { text: `The ${name} tool is not allowed in ${PERMISSION_MODE} mode.`, isError: true }
    }
    if (APPROVAL_TOOLS.has(name)) {
      const denied = await askApproval(name, args)
      if (denied) return denied
    }
    if (name === 'read_file') return readTool(args, cwd)
    if (name === 'write_file') return writeTool(args, cwd)
    if (name === 'edit_file') return editTool(args, cwd)
    if (name === 'list_dir') return listTool(args, cwd)
    if (name === 'search') return searchTool(args, cwd)
    if (name === 'glob_files') return globFilesTool(args, cwd)
    if (name === 'run_shell') return await shellTool(args, cwd)
    if (name === 'web_search') return await webSearchTool(args, web)
    if (name === 'web_fetch') return await webFetchTool(args)
    if (name === 'mcp_list_tools') return await mcpListTool(args)
    if (name === 'mcp_call_tool') return await mcpCallTool(args)
    return { text: `The tool ${name} is not known.`, isError: true }
  } catch (error) {
    return { text: String(error?.message ?? error), isError: true }
  }
}

function retryBaseMs() {
  const value = Number(process.env.MR_AGENT_RETRY_BASE_MS)
  return Number.isFinite(value) && value >= 0 ? value : RETRY_BASE_MS
}

function retryDelayMs(attempt, response) {
  const header = response?.headers?.get?.('retry-after')
  let delay = null
  if (typeof header === 'string' && header.trim() !== '') {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) delay = seconds * 1000
    else {
      const when = Date.parse(header)
      if (Number.isFinite(when)) delay = Math.max(0, when - Date.now())
    }
  }
  if (delay === null) delay = retryBaseMs() * 2 ** attempt
  return Math.min(delay, RETRY_MAX_MS)
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function post(url, key, payload) {
  const headers = { 'content-type': 'application/json' }
  if (key) headers.authorization = `Bearer ${key}`
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    let response
    try {
      response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (error) {
      const failure = new Error(`The API request failed: ${sanitize(error?.message ?? String(error), key)}`)
      if (attempt === RETRY_LIMIT) throw failure
      await sleep(retryDelayMs(attempt, null))
      continue
    }
    if (!response.ok) {
      let detail = ''
      try {
        detail = await response.text()
      } catch {}
      detail = sanitize(detail.slice(0, 500), key)
      const failure = new Error(`The API answered ${response.status}${detail ? `: ${detail}` : ''}.`)
      if (!RETRY_STATUS.has(response.status) || attempt === RETRY_LIMIT) throw failure
      await sleep(retryDelayMs(attempt, response))
      continue
    }
    try {
      return await response.json()
    } catch {
      throw new Error('The API answer was not JSON.')
    }
  }
  throw new Error('The API request failed.')
}

function contextLimit(env) {
  return envNumber(env, 'MR_AGENT_CONTEXT_CHARS', DEFAULT_CONTEXT_CHARS)
}

function maxSteps(env) {
  return envNumber(env, 'MR_AGENT_MAX_STEPS', DEFAULT_MAX_STEPS)
}

function messageChars(messages) {
  return JSON.stringify(messages).length
}

function shortArguments(text) {
  let path = ''
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.path === 'string') path = parsed.path
  } catch {}
  return JSON.stringify(path === ''
    ? { note: TOOL_ARGUMENTS_REMOVED }
    : { path, note: TOOL_ARGUMENTS_REMOVED })
}

function trimAssistant(message) {
  const content = typeof message.content === 'string' && message.content !== ''
    ? ASSISTANT_TEXT_REMOVED
    : message.content
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call) => {
        const name = call?.function?.name
        if (name !== 'write_file' && name !== 'edit_file') return call
        return { ...call, function: { ...call.function, arguments: shortArguments(call.function.arguments) } }
      })
    : message.tool_calls
  const trimmed = { ...message, content }
  if (toolCalls !== undefined) trimmed.tool_calls = toolCalls
  return JSON.stringify(trimmed).length < JSON.stringify(message).length ? trimmed : message
}

function boundMessages(messages, limit) {
  if (messageChars(messages) <= limit) return
  const toolIndexes = []
  messages.forEach((message, index) => {
    if (message?.role === 'tool') toolIndexes.push(index)
  })
  const editable = toolIndexes.slice(0, Math.max(0, toolIndexes.length - KEEP_TOOL_RESULTS))
  for (const index of editable) {
    if (messageChars(messages) <= limit) break
    messages[index] = { ...messages[index], content: TOOL_RESULT_REMOVED }
  }
  if (messageChars(messages) <= limit) return
  const newestStart = Math.max(2, messages.length - KEEP_TOOL_RESULTS)
  for (let index = 2; index < newestStart; index += 1) {
    if (messageChars(messages) <= limit) return
    if (messages[index]?.role === 'assistant') messages[index] = trimAssistant(messages[index])
  }
  if (messageChars(messages) <= limit) return
  const newest = []
  for (let index = newestStart; index < messages.length; index += 1) {
    if (index >= 2) newest.push(index)
  }
  newest.sort((left, right) => JSON.stringify(messages[right]).length - JSON.stringify(messages[left]).length)
  for (const index of newest) {
    if (messageChars(messages) <= limit) return
    const message = messages[index]
    if (message?.role === 'assistant') {
      messages[index] = trimAssistant(message)
      continue
    }
    if (message?.role !== 'tool' && message?.role !== 'user') continue
    const content = String(message.content ?? '')
    messages[index] = { ...message, content: content.slice(0, NEWEST_READABLE_CHARS) }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) return
  let key = ''
  let url = ''
  if (options.endpoint === '' && options.model.includes('/')) {
    const named = readEndpoint(runsFolderFrom(process.env), options.model.split('/')[0])
    if (named) options.endpoint = named.name
  }
  if (options.endpoint !== '') {
    const runsFolder = runsFolderFrom(process.env)
    const endpoint = readEndpoint(runsFolder, options.endpoint)
    if (!endpoint) {
      process.stderr.write(`The endpoint ${options.endpoint} was not found.\n`)
      process.exitCode = 1
      return
    }
    url = String(endpoint.baseUrl ?? '').replace(/\/+$/, '')
    if (typeof endpoint.keyName === 'string' && endpoint.keyName.trim() !== '') {
      key = await keyForSlot(runsFolder, endpoint.keyName)
      if (key.trim() === '') {
        process.stderr.write(`The key slot ${endpoint.keyName} has no key.\n`)
        process.exitCode = 1
        return
      }
    }
    options.model = modelForEndpoint(endpoint, options.model)
  } else {
    key = keyFrom(process.env)
    if (!key) {
      process.stderr.write(`${MISSING_KEY}\n`)
      process.exitCode = 1
      return
    }
    url = baseUrl(process.env)
  }
  const web = { runsFolder: runsFolder() }
  const shell = shellFor('')
  const messages = [
    { role: 'system', content: systemPrompt({ cwd: options.cwd, shell }) },
    { role: 'user', content: options.prompt },
  ]
  const limit = contextLimit(process.env)
  const stepLimit = maxSteps(process.env)
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
    for (step = 0; step < stepLimit; step += 1) {
      boundMessages(messages, limit)
      const payload = {
        model: options.model,
        messages,
        tools: toolsForMode(PERMISSION_MODE),
        tool_choice: 'auto',
        max_tokens: MAX_TOKENS,
      }
      if (options.reasoning !== '') payload.reasoning = { effort: options.reasoning }
      const data = await post(url, key, payload)
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
      if (items.length > 0) {
        writeJson({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: items,
            usage: { input_tokens: usage.input, output_tokens: usage.output },
          },
        })
      }
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
    finish(true, lastText !== '' ? lastText : `Stopped after ${stepLimit} steps.`)
  } catch (error) {
    finish(true, String(error?.message ?? error))
  }
}

const startedFile = process.argv[1] ? resolve(process.argv[1]) : ''
const currentFile = fileURLToPath(import.meta.url)
const isMain = startedFile !== '' && (process.platform === 'win32'
  ? startedFile.toLowerCase() === currentFile.toLowerCase()
  : startedFile === currentFile)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exitCode = 1
  })
}
