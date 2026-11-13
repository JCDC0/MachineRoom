import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskKeys } from '../src/briefs/audit.js'
import { isWindowsPath, printedRunsFolder } from './printed-path.js'
import { childEnvironment, mcpConfigForClaude, mcpConfigForOpencode, normalizeMcpServers, replyText, runRecord, summarizeRun } from '../src/briefs/run.js'
import { defaultMode, legacyMode, modesFor } from '../src/control/modes.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { agentDepthLine } from '../src/model/hierarchy.js'
import { readAgentDepth } from './agent-depth.js'
import { harnessUnavailableProblem, isHarnessAvailable, modelUnavailableProblem } from './agents-config.js'
import { readEndpoints } from './endpoints.js'
import { modelAllowed } from './harness-models.js'
import { DEFAULT_CONTEXT_WINDOW, MODELS, resolveContextWindow } from './models.js'
import { isLockHolderStale, killTree, listProcesses } from './processTree.js'
import { gitPath, programPath } from './programPath.js'
import { createRecordsCache, runsFolder as sharedRunsFolder } from './lanes-source.js'

export const ORCHESTRATOR_KEY = 'orchestrator'
export const ORCHESTRATOR_CHAT_LIMIT = 200
export const ORCHESTRATOR_TURN_LIMIT_MS = 60 * 60 * 1000
export const ORCHESTRATOR_ROOM_TURNS = 30
export const ORCHESTRATOR_ROOM_WINDOW_MS = 60 * 60 * 1000
export const ORCHESTRATOR_MERGE_WAIT_MS = 30 * 1000
export const ORCHESTRATOR_MESSAGE_LIMIT = 8000
export { DEFAULT_CONTEXT_WINDOW } from './models.js'
export const AUTOCOMPACT_SHARE = 0.8
export const DEFAULT_AUTOCOMPACT_MODE = 'percent'
const SPAWN_DEPTH_LINE = /Spawn subagents at most \d+ levels deep\. A subagent at depth \d+ spawns none\.\s*/g
export const DEFAULT_AUTOCOMPACT_VALUE = 80
export const DEFAULT_AUTOCOMPACT_PERCENT = 80
export const COMPACT_RULES_LIMIT = 2000
export const CONFIRM_HARNESS_PROBLEM = 'Confirm the harness change first.'
export const DEFAULT_COMPACT_RULES =
  "keep the owner's goals and standing rules in the owner's words, the decisions made and why, each lane run started with its branch and result, the files changed, what is unfinished or blocked, and the next steps; leave out tool output, logs and work already merged and checked."
export const COMPACT_PROMPT =
  'Write a summary of the work so far, the open runs and the next steps, in at most 40 lines. Reply with the summary only.'
export const COMPACTED_MESSAGE = 'The session was compacted. The next turn starts a new session with the summary.'
export const COMPACT_FAILED_MESSAGE = 'The compact failed. The session is still open.'
export const CONFIRM_MESSAGE_PROBLEM = 'Confirm the message first.'
export const CONFIRM_STOP_PROBLEM = 'Confirm the stop first.'
export const CONFIRM_AUTOCOMPACT_PROBLEM = 'Confirm the autocompact change first.'
export const CONFIRM_COMPACT_PROBLEM = 'Confirm the compact first.'
export const CONFIRM_MODEL_PROBLEM = 'Confirm the model change first.'
export const CONFIRM_MODE_PROBLEM = 'Confirm the mode change first.'
export const MODE_PROBLEM = 'Choose a permission mode listed for this harness.'
export const AUTOCOMPACT_PROBLEM = 'Say whether autocompact is on or off.'
export const AUTOCOMPACT_MODE_PROBLEM = 'Mode must be percent or tokens.'
export const AUTOCOMPACT_PERCENT_PROBLEM = 'Percent must be a number above 0 and at most 100.'
export const AUTOCOMPACT_TOKENS_PROBLEM = 'Tokens must be a whole number from 1000 to 10000000.'
export const AUTOCOMPACT_RULES_PROBLEM = 'Compact rules must be at most 2000 characters.'
export const COMPACT_RUNNING_PROBLEM = 'A turn is already running.'
export const APPROVAL_TIMEOUT_MS = 4 * 60 * 1000
export const APPROVAL_LIMIT = 20
export const APPROVAL_NO_ANSWER = 'The owner did not answer.'
export const APPROVAL_DENIED = 'The owner denied it.'
export const APPROVAL_SERVER = 'machineroom-approve'
export const APPROVAL_PROMPT_TOOL = 'mcp__machineroom-approve__approve'
export const NO_SESSION_PROBLEM = 'The orchestrator has no session yet.'
export const COMPACT_KEEP_LIMIT = 2000
export const COMPACT_KEEP_PROBLEM = 'Write at most 2000 characters to keep.'
export const MODEL_PROBLEM = 'Choose a model listed for this harness.'
export const CONFIRM_EFFORT_PROBLEM = 'Confirm the effort change first.'
export const CONFIRM_SESSION_PROBLEM = 'Confirm the session change first.'
export const EFFORT_PROBLEM = 'Choose an effort level listed for this harness.'
export const NO_SESSION_ID_PROBLEM = 'There is no session with that id.'
export const SESSION_TITLE_PROBLEM = 'Write a title from 1 to 80 characters.'
export const SESSION_PINNED_PROBLEM = 'Say whether pinned is true or false.'
export const SESSION_STARRED_PROBLEM = 'Say whether starred is true or false.'
export const SESSION_UNREAD_PROBLEM = 'Say whether unread is true or false.'
export const SESSION_ARCHIVED_PROBLEM = 'Say whether archived is true or false.'
export const SESSION_CHANGE_PROBLEM = 'Choose a field to change: pinned, starred, unread, archived or title.'
export const CURRENT_SESSION_PROBLEM = 'The current conversation cannot be archived or deleted.'
export const CURRENT_SESSION_KEY = 'current'
export const SESSION_PENDING_PROBLEM = 'Messages are waiting for a turn. Wait for them to run or stop the orchestrator first.'
export const BRANCH_INDEX_PROBLEM = 'Choose a message to branch from.'
export const SESSIONS_LIMIT = 50
export const SESSION_MESSAGES_LIMIT = 200
export const SESSIONS_FULL_PROBLEM = 'The saved list is full of pinned conversations. Unpin or delete one to save this conversation.'
export const TURN_STEP_LIMIT = 100
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const OPENCODE_EFFORT_LEVELS = ['low', 'medium', 'high', 'max']
export const NO_PROJECT_PROBLEM = 'The bridge has no project folder, so the orchestrator has nothing to work on.'
export const MESSAGE_PROBLEM = 'Write a message from 1 to 8000 characters.'
export const CHAT_SAVE_PROBLEM = 'The chat file could not be saved.'
export const EMPTY_REPLY = 'The orchestrator ended its turn without a reply.'
export const STOPPED_REPLY = 'The orchestrator stopped.'
export const NO_NEW_REPORT = 'No new report.'
export const NO_REPORT = 'NO_REPORT'
export const RESTART_MESSAGE = 'The room restarted during a turn. Send the message again if it still matters.'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const PROMPT_FILE = join(REPO_ROOT, 'docs', 'agents', 'ORCHESTRATOR-AGENT.md')
export const BRANCH_TRANSCRIPT_LIMIT = 20000
const PROMPT_LIMIT = BRANCH_TRANSCRIPT_LIMIT
export const BRANCH_TRANSCRIPT_INTRO = 'Earlier messages in this conversation, quoted:'
const GIT_OPERATION_FILES = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']
const GIT_OPERATION_TIMEOUT_MS = 10000
const RECORD_COMMITS = 10
const TURN_STDERR_LIMIT = 4 * 1024
const TURN_LOG = /-chat-\d{8}-\d{6}-\d{3}\.log$/i
const DEFAULT_LANE = { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } }
const DEFAULT_OPENCODE_MODEL = 'opencode/deepseek-v4.1-flash-free'
const VARIABLE = /%([^%]+)%/g

export const SLASH_COMMAND_LIMIT = 200
export const SLASH_DESCRIPTION_LIMIT = 200
const SLASH_HEAD_BYTES = 4096
const SLASH_WALK_LIMIT = 400
const SLASH_DEPTH_LIMIT = 6
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

export const ROOM_COMMANDS = [
  { name: 'compact', description: 'Summarize the conversation and keep the summary for the next turn.', source: 'room' },
  { name: 'clear', description: 'Start a new conversation.', source: 'room' },
  { name: 'help', description: 'Show the list of commands.', source: 'room' },
  { name: 'new', description: 'Start a new conversation.', source: 'room' },
  { name: 'stop', description: 'Stop the turn that is running.', source: 'room' },
]

export function commandDescription(text) {
  const head = String(text ?? '').replace(/\r\n?/g, '\n')
  const found = FRONTMATTER.exec(head)
  if (!found) return ''
  const lines = found[1].split('\n')
  let value = ''
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^description:\s*(.*)$/.exec(lines[index])
    if (!match) continue
    const first = match[1].trim()
    if (/^[>|][-+]?$/.test(first)) {
      const parts = []
      for (let next = index + 1; next < lines.length; next += 1) {
        const line = lines[next]
        if (line && !/^\s/.test(line)) break
        const part = line.trim()
        if (part) parts.push(part)
      }
      value = parts.join(' ')
    } else {
      value = first
    }
    break
  }
  const clean = value
    .replace(/^['"]+/, '')
    .replace(/['"]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.slice(0, SLASH_DESCRIPTION_LIMIT)
}

function readHeadText(file) {
  let handle = null
  try {
    handle = openSync(file, 'r')
    const buffer = Buffer.alloc(SLASH_HEAD_BYTES)
    const read = readSync(handle, buffer, 0, SLASH_HEAD_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (handle !== null) {
      try {
        closeSync(handle)
      } catch {}
    }
  }
}

function markdownFiles(folder, depth = 0, found = []) {
  if (depth > SLASH_DEPTH_LIMIT || found.length >= SLASH_WALK_LIMIT) return found
  let entries
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return found
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (found.length >= SLASH_WALK_LIMIT) break
    const path = join(folder, entry.name)
    if (entry.isDirectory()) markdownFiles(path, depth + 1, found)
    else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(path)
  }
  return found
}

function slashFolders(harness, projectRoot = '', home = '') {
  const project = typeof projectRoot === 'string' ? projectRoot.trim() : ''
  const user = typeof home === 'string' && home.trim() ? resolve(home) : homedir()
  const commands = []
  const skills = []
  if (harness === 'claude') {
    if (project) commands.push(join(project, '.claude', 'commands'))
    commands.push(join(user, '.claude', 'commands'))
    if (project) skills.push(join(project, '.claude', 'skills'))
    skills.push(join(user, '.claude', 'skills'))
    return { commands, skills }
  }
  if (project) {
    commands.push(join(project, '.opencode', 'command'))
    commands.push(join(project, '.opencode', 'commands'))
    skills.push(join(project, '.opencode', 'skills'))
    skills.push(join(project, '.claude', 'skills'))
    skills.push(join(project, '.agents', 'skills'))
  }
  commands.push(join(user, '.config', 'opencode', 'command'))
  commands.push(join(user, '.config', 'opencode', 'commands'))
  skills.push(join(user, '.config', 'opencode', 'skills'))
  skills.push(join(user, '.claude', 'skills'))
  skills.push(join(user, '.agents', 'skills'))
  return { commands, skills }
}

function commandName(file, folder) {
  const rel = relative(folder, file).replace(/\\/g, '/').replace(/\.md$/i, '')
  return rel.split('/').filter(Boolean).join(':').trim()
}

function skillName(file, folder) {
  const rel = relative(folder, file).replace(/\\/g, '/')
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  // A skill folder can hold other notes beside its SKILL.md, and only SKILL.md names the skill and carries its body.
  if (parts.length > 1) return parts.at(-1).toLowerCase() === 'skill.md' ? parts[0].trim() : ''
  return parts[0].replace(/\.md$/i, '').trim()
}

export function scanSlashCommands({ harness = 'claude', projectRoot = '', home = '', limit = SLASH_COMMAND_LIMIT } = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SLASH_COMMAND_LIMIT
  const seen = new Set(ROOM_COMMANDS.map((entry) => entry.name))
  const commands = []
  const folders = slashFolders(harness, projectRoot, home)
  function collect(list, source, nameOf) {
    for (const folder of list) {
      for (const file of markdownFiles(folder)) {
        if (commands.length >= Math.max(0, cap - ROOM_COMMANDS.length)) return
        const name = nameOf(file, folder)
        if (!name || seen.has(name)) continue
        seen.add(name)
        commands.push({ name, description: commandDescription(readHeadText(file)), source, file })
      }
    }
  }
  collect(folders.commands, 'command', commandName)
  collect(folders.skills, 'skill', skillName)
  commands.sort((left, right) => left.name.localeCompare(right.name))
  const room = ROOM_COMMANDS.map((entry) => ({ ...entry })).slice(0, cap)
  return [...room, ...commands].slice(0, cap)
}

function stripFrontmatter(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n')
  const found = /^---\n[\s\S]*?\n---\n?/.exec(source)
  return found ? source.slice(found[0].length) : source
}

export function expandSlashCommand(text, commands, readBody = readText) {
  const value = typeof text === 'string' ? text : ''
  const trimmed = value.trim()
  const match = /^\/([A-Za-z0-9][A-Za-z0-9:._-]*)(?:[ \t]+([\s\S]*))?$/.exec(trimmed)
  if (!match) return value
  const name = match[1]
  const args = (match[2] ?? '').trim()
  const list = Array.isArray(commands) ? commands : []
  const entry = list.find((item) => item && typeof item.name === 'string' && item.name === name)
  if (!entry || typeof entry.file !== 'string' || !entry.file) return value
  const body = stripFrontmatter(typeof readBody === 'function' ? readBody(entry.file) : '').trim()
  if (!body) return value
  const position = args ? args.split(/\s+/).slice(0, 9) : []
  let expanded = body.replace(/\$(ARGUMENTS|[1-9])/g, (whole, token) =>
    token === 'ARGUMENTS' ? args : (position[Number(token) - 1] ?? '')
  )
  if (!body.includes('$ARGUMENTS') && !/\$[1-9]/.test(body) && args) expanded = `${expanded}\n\nARGUMENTS: ${args}`
  return expanded
}

export function runsFolderDefault(env = process.env) {
  return sharedRunsFolder(env)
}

function iso(ms) {
  return new Date(ms).toISOString()
}

function stamp(ms) {
  const date = new Date(ms)
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`
}

function pathKey(value) {
  try {
    const resolved = resolve(String(value ?? ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export const LOG_TAIL_BYTES = 64 * 1024

export function readTail(file, maxBytes = LOG_TAIL_BYTES) {
  let stat
  try {
    stat = statSync(file)
  } catch {
    return ''
  }
  if (!stat.size) return ''
  const length = Math.min(stat.size, maxBytes)
  const position = Math.max(0, stat.size - length)
  let fd
  try {
    fd = openSync(file, 'r')
  } catch {
    return ''
  }
  try {
    const buffer = Buffer.alloc(length)
    const got = readSync(fd, buffer, 0, length, position)
    const text = buffer.toString('utf8', 0, got)
    if (position > 0) {
      const firstNewline = text.indexOf('\n')
      return firstNewline >= 0 ? text.slice(firstNewline + 1) : text
    }
    return text
  } catch {
    return ''
  } finally {
    try {
      closeSync(fd)
    } catch {}
  }
}

const PROFILE_LABELS = ['%TEMP%', '%LOCALAPPDATA%', '%APPDATA%', '%USERPROFILE%', '~']
const PATH_TOKEN = /(?:[A-Za-z]:[\\/][^\s"'`<>|]*|\\\\[^\s"'`<>|]+|(?<![\w:/])\/(?!\/)[^\s"'`<>|]+)/g
const PATH_TRAIL = /[.,;:!?]+$/

function profileEnv(env = process.env) {
  const copy = { ...env, XDG_STATE_HOME: '' }
  if (!copy.TEMP && !copy.TMP) {
    try {
      copy.TEMP = tmpdir()
    } catch {}
  }
  if (!copy.USERPROFILE && process.platform === 'win32') {
    try {
      copy.USERPROFILE = homedir()
    } catch {}
  }
  if (!copy.HOME && process.platform !== 'win32') {
    try {
      copy.HOME = homedir()
    } catch {}
  }
  return copy
}

function profilePrefixes(resolvedEnv) {
  const list = []
  const add = (name, label) => {
    const value = typeof resolvedEnv[name] === 'string' ? resolvedEnv[name].trim() : ''
    if (!value) return
    const body = value.length > 1 ? value.replace(/[\\/]+$/, '') : value
    if (!body || list.some((item) => item.body === body)) return
    list.push({ body, label, windows: isWindowsPath(body) })
  }
  add('TEMP', '%TEMP%')
  add('TMP', '%TEMP%')
  add('LOCALAPPDATA', '%LOCALAPPDATA%')
  add('APPDATA', '%APPDATA%')
  add('USERPROFILE', '%USERPROFILE%')
  add('HOME', '~')
  return list.sort((a, b) => b.body.length - a.body.length)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function maskProfilePrefixes(text, resolvedEnv) {
  let masked = text
  for (const { body, label, windows } of profilePrefixes(resolvedEnv)) {
    const pattern = new RegExp(`(?<![\\w:\\\\/.~-])${escapeRegExp(body)}(?=$|[\\\\/])`, windows ? 'gi' : 'g')
    masked = masked.replace(pattern, label)
  }
  return masked
}

function maskProfilePaths(text, env = process.env) {
  if (typeof text !== 'string' || text === '' || !/[\\/]/.test(text)) return text
  const resolvedEnv = profileEnv(env)
  return maskProfilePrefixes(text, resolvedEnv).replace(PATH_TOKEN, (token) => {
    const trail = token.match(PATH_TRAIL)?.[0] ?? ''
    const body = trail ? token.slice(0, -trail.length) : token
    let shown = ''
    try {
      shown = printedRunsFolder(body, resolvedEnv)
    } catch {
      return token
    }
    return PROFILE_LABELS.some((label) => shown === label || shown.startsWith(label)) ? `${shown}${trail}` : token
  })
}

function maskMessageText(text) {
  const safe = maskKeys(text)
  return { text: maskProfilePaths(safe.text), count: safe.count }
}

function cleanFailure(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const safe = maskMessageText(raw).text.trim()
  if (!safe) return null
  return safe.length > 300 ? safe.slice(0, 300) : safe
}

function lastStderrLine(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line) return line
  }
  return ''
}

function stoppedTurnText({ code, report, killed, failureMessage, stderrMessage }) {
  const reason = (!killed && report) || failureMessage || stderrMessage
  if (reason) return `The orchestrator stopped: ${reason}`
  return Number.isInteger(code) ? `The orchestrator stopped: exit ${code}.` : STOPPED_REPLY
}

export function turnStepOf(activity) {
  if (!activity || activity.type !== 'tool.start') return null
  const tool = typeof activity.tool === 'string' && activity.tool.trim() ? activity.tool.trim() : 'tool'
  const label = typeof activity.label === 'string' ? activity.label.trim() : ''
  const prefix = `${tool} `
  const stripped = label.startsWith('$ ') ? label.slice(2).trim() : label
  const target = stripped.toLowerCase().startsWith(prefix.toLowerCase()) ? stripped.slice(prefix.length).trim() : stripped
  return { tool, target }
}

export function turnStepsOf(descriptor, log, rootName = '') {
  if (!descriptor || typeof descriptor.createParser !== 'function') return []
  try {
    const parser = descriptor.createParser({ rootName: String(rootName ?? ''), files: [], dirs: [] })
    const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
    const steps = []
    for (const activity of activities) {
      const step = turnStepOf(activity)
      if (step) steps.push(step)
    }
    return steps.slice(-TURN_STEP_LIMIT)
  } catch {
    return []
  }
}

function cleanStep(item, mask = (text) => maskMessageText(text).text) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const tool = typeof item.tool === 'string' ? mask(item.tool.trim()).slice(0, 40) : ''
  const target = typeof item.target === 'string' ? mask(item.target.trim()).slice(0, 300) : ''
  if (!tool && !target) return null
  return { tool: tool || 'tool', target }
}

function cleanSteps(value, mask = (text) => maskMessageText(text).text) {
  const steps = []
  for (const item of Array.isArray(value) ? value : []) {
    const step = cleanStep(item, mask)
    if (step) steps.push(step)
  }
  return steps.slice(-TURN_STEP_LIMIT)
}

function cleanWork(value, mask = (text) => maskMessageText(text).text) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const steps = cleanSteps(value.steps, mask)
  const seconds = Number.isFinite(value.seconds) && value.seconds >= 0 ? Math.round(value.seconds) : 0
  if (steps.length === 0 && seconds === 0) return null
  return { steps, seconds }
}

function pauseSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {}
  }
}

export function projectHash(projectRoot) {
  const key = projectRoot ? pathKey(projectRoot) : ''
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

export function chatFileFor(projectRoot, runsFolder, id = ORCHESTRATOR_KEY) {
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const key = id === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : String(id)
  const name = key === ORCHESTRATOR_KEY ? `orchestrator-${projectHash(root)}.json` : `orchestrator-${projectHash(root)}-${key}.json`
  return join(folder, name)
}

export function chatLockFileFor(projectRoot, runsFolder) {
  return chatFileFor(projectRoot, runsFolder).replace(/\.json$/, '.lock')
}

function readHolder(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function roomLockProblem(holder) {
  return `Another room is already running on this project (process ${holder}). Wait for it to end.`
}

function isRoomHolderAlive(holder, path, { platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  if (!processAlive(holder)) return false
  if (platform !== 'win32') return true
  let mtime = null
  try {
    mtime = stat(path).mtimeMs
  } catch {
    mtime = null
  }
  return !isLockHolderStale(holder, mtime, { platform, list })
}

export function takeRoomLock(path, { platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  const holderAlive = (pid, file) => isRoomHolderAlive(pid, file, { platform, list, stat })
  const takeover = `${path}.takeover`
  const take = (file) => {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' })
      return true
    } catch (error) {
      if (error?.code === 'EEXIST') return false
      throw error
    }
  }
  const clearTakeover = () => {
    const holder = Number.parseInt(readHolder(takeover), 10)
    if (holderAlive(holder, takeover)) throw new Error(roomLockProblem(holder, path))
    rmSync(takeover, { force: true })
  }
  if (existsSync(takeover)) clearTakeover()
  if (take(path)) return path
  const holderText = readHolder(path)
  const holder = Number.parseInt(holderText, 10)
  if (holderAlive(holder, path)) throw new Error(roomLockProblem(holder, path))
  let mine = take(takeover)
  if (!mine) {
    clearTakeover()
    mine = take(takeover)
    if (!mine) throw new Error(roomLockProblem(Number.parseInt(readHolder(path), 10), path))
  }
  try {
    const current = readHolder(path)
    if (current !== holderText) throw new Error(roomLockProblem(Number.parseInt(current, 10) || holder, path))
    if (holderAlive(holder, path)) throw new Error(roomLockProblem(holder, path))
    rmSync(path, { force: true })
    if (!take(path)) throw new Error(roomLockProblem(Number.parseInt(readHolder(path), 10), path))
    return path
  } finally {
    rmSync(takeover, { force: true })
  }
}

function releaseRoomLock(path) {
  if (!path) return
  if (Number.parseInt(readHolder(path), 10) === process.pid) rmSync(path, { force: true })
}

function turnStartedAt(name) {
  const match = /-chat-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})\.log$/.exec(name)
  if (!match) return null
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10))
  const at = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], parts[6]).getTime()
  return Number.isFinite(at) ? at : null
}

function fallbackPrompt(projectRoot, scratchFolder) {
  return [
    `You are the orchestrator for the project at ${projectRoot}, talking to its owner through MachineRoom.`,
    "Read the project's agent guide before you plan, split the work into tasks for the lane runner, and check each branch before you merge it.",
    `Never push, never print a key, and keep your task files in ${scratchFolder}.`,
  ].join(' ')
}

function enabledMcpServersFor(runsFolder) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(runsFolder, 'mcp.json'), 'utf8'))
  } catch {
    return []
  }
  return normalizeMcpServers(parsed).filter((entry) => entry.enabled)
}

function insideGitFolder(projectRoot) {
  let current = projectRoot
  for (;;) {
    if (existsSync(join(current, '.git'))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function instructionFor(file, projectRoot, runsFolder, bridgeUrl, token = '', scratchFolder = '') {
  const text = readText(file).trim()
  const scratch = scratchFolder || runsFolder
  const source = text || fallbackPrompt(projectRoot, scratch)
  let resolved = source
    .replaceAll('{{PROJECT}}', projectRoot)
    .replaceAll('{{MACHINEROOM}}', REPO_ROOT)
    .replaceAll('{{RUNS}}', runsFolder)
    .replaceAll('{{SCRATCH}}', scratch)
    .replaceAll('{{BRIDGE}}', bridgeUrl)
  if (token) {
    if (resolved.includes('{{TOKEN}}')) {
      resolved = resolved.replaceAll('{{TOKEN}}', token)
    } else {
      resolved = `${resolved}\nSend the header X-MachineRoom-Orchestrator: ${token} on every bridge request.`
    }
  }
  return resolved
}

// A bare name is looked up on PATH, so Windows never runs a claude.exe that sits in the project folder.
function programFor(bin) {
  const text = String(bin).replace(VARIABLE, (whole, name) => {
    const value = process.env[name]
    return typeof value === 'string' && value !== '' ? value : whole
  })
  if (/[\/]/.test(text)) return text
  return programPath(text) ?? text
}

function opencodeSessionId(log) {
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof item?.sessionID === 'string' && item.sessionID.trim() !== '') return item.sessionID
  }
  return null
}

function tokenSum(values) {
  const known = values.filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  return known.length === 0 ? null : Math.round(known.reduce((sum, value) => sum + value, 0))
}

function claudeTokens(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null
  return tokenSum([
    usage.input_tokens ?? usage.inputTokens,
    usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
    usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
  ])
}

function assistantUsage(item) {
  if (item?.usage && typeof item.usage === 'object' && !Array.isArray(item.usage)) {
    return item.usage
  }
  if (item?.message?.usage && typeof item.message.usage === 'object' && !Array.isArray(item.message.usage)) {
    return item.message.usage
  }
  return null
}

export function contextTokensFromLog(harness, log) {
  if (harness === 'opencode') {
    let found = null
    for (const line of String(log ?? '').split(/\r?\n/)) {
      if (!line.trim()) continue
      let item
      try {
        item = JSON.parse(line)
      } catch {
        continue
      }
      if (item?.type !== 'step_finish') continue
      const tokens = item?.part?.tokens
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) continue
      const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}
      const sum = tokenSum([tokens.input, cache.read, cache.write])
      if (sum !== null) found = sum
    }
    return found
  }

  let lastAssistant = null
  let lastResultIterations = null
  let lastResultTotal = null

  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.parent_tool_use_id) continue
    if (item?.type === 'assistant') {
      const sum = claudeTokens(assistantUsage(item))
      if (sum !== null) lastAssistant = sum
      continue
    }
    if (item?.type === 'result') {
      const usage = item.usage && typeof item.usage === 'object' && !Array.isArray(item.usage) ? item.usage : null
      if (usage) {
        let iterSum = null
        if (Array.isArray(usage.iterations) && usage.iterations.length > 0) {
          for (let index = usage.iterations.length - 1; index >= 0; index -= 1) {
            const entry = usage.iterations[index]
            const iterUsage = entry?.usage && typeof entry.usage === 'object' ? entry.usage : entry
            const count = claudeTokens(iterUsage)
            if (count !== null) {
              iterSum = count
              break
            }
          }
        }
        if (iterSum !== null) lastResultIterations = iterSum
        const total = claudeTokens(usage)
        if (total !== null) lastResultTotal = total
      }
    }
  }

  return lastAssistant ?? lastResultIterations ?? lastResultTotal ?? null
}

export function compactPrompt(keep = '', rules = '') {
  const manual = typeof keep === 'string' ? keep.trim() : ''
  const ownerRules = typeof rules === 'string' ? rules.trim() : ''
  const text = manual || ownerRules || DEFAULT_COMPACT_RULES
  return `${COMPACT_PROMPT}\n\nKeep these in the summary:\n${text}`
}

function blockFor(message) {
  const from = String(message?.from ?? '')
  const label = from === 'owner' ? 'Owner' : from === 'room' ? 'Room' : from.startsWith('sub:') ? `Sub ${from.slice(4)}` : 'Orchestrator'
  return `${label}: ${message.text}`
}

function quoteBlock(message) {
  return blockFor(message)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

export function quotedTranscript(list, limit = BRANCH_TRANSCRIPT_LIMIT) {
  const items = Array.isArray(list) ? list : []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : BRANCH_TRANSCRIPT_LIMIT
  const header = `${BRANCH_TRANSCRIPT_INTRO}\n\n`
  const room = Math.max(0, cap - header.length)
  const blocks = []
  let size = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const block = quoteBlock(items[index])
    if (block.length > room) {
      if (blocks.length === 0 && room > 0) blocks.unshift(block.slice(-room))
      break
    }
    if (size + block.length + 2 > room) break
    blocks.unshift(block)
    size += block.length + 2
  }
  const text = `${header}${blocks.join('\n\n')}`
  return text.length > cap ? text.slice(text.length - cap) : text
}

function fitTurnText(messages) {
  if (messages.length === 1 && messages[0].from === 'owner') return { text: messages[0].text, used: [...messages] }
  const blocks = []
  const used = []
  let size = 0
  for (let index = 0; index < messages.length; index += 1) {
    const block = blockFor(messages[index])
    if (blocks.length > 0 && size + block.length + 2 > PROMPT_LIMIT) break
    blocks.push(block)
    used.push(messages[index])
    size += block.length + 2
  }
  return { text: blocks.join('\n\n'), used }
}

function recordLine(record) {
  const place =
    Array.isArray(record.briefs) && record.briefs.length > 0
      ? `briefs ${record.briefs.join(', ')}`
      : record.project
        ? `project ${record.project}`
        : 'briefs none'
  const exit = Number.isInteger(record.exitCode) ? `exit ${record.exitCode}` : 'exit none'
  const queue = typeof record.queue === 'string' && record.queue ? record.queue : ''
  const branch = typeof record.branch === 'string' && record.branch ? record.branch : queue || 'no branch'
  let commits = 'none'
  if (Array.isArray(record.commits) && record.commits.length > 0) {
    const shown = record.commits.slice(0, RECORD_COMMITS).join('; ')
    const rest = record.commits.length - RECORD_COMMITS
    commits = rest > 0 ? `${shown} (+${rest} more)` : shown
  }
  const cost =
    typeof record.costUsd === 'number' && Number.isFinite(record.costUsd)
      ? `${record.costUsd.toFixed(4)} USD`
      : 'not reported'
  const line = `lane ${record.lane || 'unknown'} | ${place} | ${exit} | branch ${branch} | commits ${commits} | cost ${cost}`
  if (!queue) return line
  return `${line}
This was task ${record.queueIndex ?? '?'} of a queue. The runner commits it on ${queue} only after the project's tests pass, a few seconds to minutes after this message; check git log on that branch before you review it.`
}

function enforceSessionLimit(list) {
  while (list.length > SESSIONS_LIMIT) {
    let oldestUnpinnedIndex = -1
    let oldestUnpinnedTime = Infinity
    for (let i = 0; i < list.length; i += 1) {
      if (!list[i].pinned) {
        const time = list[i].startedAt ? new Date(list[i].startedAt).getTime() : 0
        if (time < oldestUnpinnedTime) {
          oldestUnpinnedTime = time
          oldestUnpinnedIndex = i
        }
      }
    }
    if (oldestUnpinnedIndex !== -1) {
      list.splice(oldestUnpinnedIndex, 1)
    } else {
      let oldestIndex = 0
      let oldestTime = Infinity
      for (let i = 0; i < list.length; i += 1) {
        const time = list[i].startedAt ? new Date(list[i].startedAt).getTime() : 0
        if (time < oldestTime) {
          oldestTime = time
          oldestIndex = i
        }
      }
      list.splice(oldestIndex, 1)
    }
  }
}

const ARCHIVE_FULL = Symbol('archive-full')

function archiveFits(list, startedAt) {
  if (list.length < SESSIONS_LIMIT) return true
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return false
  return list.some((entry) => !entry.pinned && new Date(entry.startedAt).getTime() < start)
}

export function createOrchestrator({
  id = ORCHESTRATOR_KEY,
  name = '',
  harness: harnessOption = '',
  model: modelOption = '',
  bin: binOption = '',
  parent = '',
  projectRoot = '',
  runsFolder = runsFolderDefault(),
  lanes = {},
  spawn: spawnChild = spawn,
  gitSpawn: spawnGit = spawn,
  now = Date.now,
  onNotice = () => {},
  promptFile = PROMPT_FILE,
  bridgeUrl = () => '',
  extraInstructions = '',
  onReply = null,
  onMasked = () => {},
  onMessage = () => {},
  outsideFiles = null,
  onOutsideScope = null,
  contextWindow: contextWindowOption = 0,
  token: tokenOption = '',
  home = '',
  harnesses = harnessByKey,
  hasSub = null,
  rename = renameSync,
  siblings: siblingsOption = [],
  recordsCache: recordsCacheOption = null,
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS,
  mergeWaitMs = ORCHESTRATOR_MERGE_WAIT_MS,
  gitTimeoutMs = GIT_OPERATION_TIMEOUT_MS,
} = {}) {
  const token = typeof tokenOption === 'string' && tokenOption ? tokenOption : randomBytes(24).toString('base64url')
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const recordsCache = recordsCacheOption ?? createRecordsCache(join(folder, 'runs.jsonl'), folder)
  const key = String(id) === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : String(id)
  const logPrefix = key === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : `sub-${key}`
  const lockFile = key === ORCHESTRATOR_KEY ? chatLockFileFor(root, folder) : null
  const laneEntry = lanes && Object.hasOwn(lanes, ORCHESTRATOR_KEY) ? lanes[ORCHESTRATOR_KEY] : null
  const lane = laneEntry?.cli ? laneEntry : DEFAULT_LANE
  let harness = harnessOption || String(lane.cli.harness ?? 'claude')
  let model = modelOption ? String(modelOption) : String(lane.cli.model ?? (harness === 'opencode' ? DEFAULT_OPENCODE_MODEL : 'opus'))
  function binFor(name) {
    if (binOption) return String(binOption)
    if (lane.cli.harness === name && lane.cli.bin) return String(lane.cli.bin)
    for (const entry of Object.values(lanes ?? {})) {
      if (entry?.cli?.harness === name && entry.cli.bin) return String(entry.cli.bin)
    }
    return name
  }
  function laneDetails() {
    const endpoints = readEndpoints(folder)
    const endpointName = typeof lane.cli?.endpoint === 'string' ? lane.cli.endpoint.trim() : ''
    const match = endpointName ? endpoints.find((entry) => entry.name === endpointName) : null
    return match || endpoints
  }
  const windowOption = Number.isFinite(contextWindowOption) && contextWindowOption > 0
    ? Math.round(contextWindowOption)
    : key === ORCHESTRATOR_KEY && Number.isFinite(lane.cli.contextWindow) && lane.cli.contextWindow > 0
      ? Math.round(lane.cli.contextWindow)
      : 0
  const conversationFile = chatFileFor(root, folder, key)
  const scratchFolder = join(folder, `scratch-${key}`)
  const messages = []
  const pending = []
  const roomTurns = []
  let roomTimer = null
  let ladder = null
  let sessionId = null
  let ownsRun = false
  let tokenSent = false
  let state = 'idle'
  let running = null
  let stopped = false
  let contextTokens = null
  let contextWindow = resolveContextWindow(model, harness, windowOption, laneDetails())
  let autocompact = true
  let autocompactMode = DEFAULT_AUTOCOMPACT_MODE
  let autocompactValue = DEFAULT_AUTOCOMPACT_VALUE
  let compactRules = ''
  let effort = null
  let mode = null
  let currentConversationId = randomUUID()
  let currentSessionId = null
  let currentTitle = null
  let currentPinned = false
  let currentStarred = false
  let currentUnread = false
  const sessions = []
  let summary = ''
  let branchTranscript = ''
  let pendingCompaction = null
  let persistError = null
  let siblings = Array.isArray(siblingsOption) ? [...siblingsOption] : []
  const completedRuns = new Map()
  const approvals = new Map()

  function subExists(id) {
    if (!id || id === ORCHESTRATOR_KEY) return false
    if (typeof hasSub === 'function' && hasSub(id)) return true
    if (ladder && Array.isArray(ladder.subs)) {
      return ladder.subs.some((s) => s?.id === id)
    }
    return false
  }

  function notify() {
    try {
      onNotice({ topic: 'orchestrator' })
    } catch {}
  }

  function maskText(text) {
    const safe = maskMessageText(text)
    if (safe.count > 0) {
      try {
        onMasked(safe.count)
      } catch {}
    }
    return safe.text
  }

  function subIdOf(value) {
    if (value.startsWith('sub-') || value.startsWith('sub:')) return value.slice(4)
    return ''
  }

  function knownAgentParty(value, records = laneRecords()) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id) return ''
    if (id === ORCHESTRATOR_KEY || id === 'owner') return id
    const subId = subIdOf(id)
    if (subId) return subExists(subId) ? id : ''
    if (records && typeof records === 'object' && Object.hasOwn(records, id)) return id
    return subExists(id) ? id : ''
  }

  function laneRecords() {
    const list = typeof lanes === 'function' ? lanes() : lanes
    return list && typeof list === 'object' ? list : {}
  }

  function knownSender(value) {
    const from = typeof value === 'string' ? value.trim() : ''
    if (!from) return ''
    if (from === 'owner' || from === 'room' || from === ORCHESTRATOR_KEY || from === 'agent') return from
    const subId = subIdOf(from)
    if (subId) return subExists(subId) ? from : ''
    return Object.hasOwn(laneRecords(), from) ? from : ''
  }

  function restoredAgent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const from = maskText(typeof value.from === 'string' ? value.from.trim() : '')
    const to = maskText(typeof value.to === 'string' ? value.to.trim() : '')
    const kind = maskText(typeof value.kind === 'string' ? value.kind.trim() : '')
    if (!from || !to || !kind) return null
    if (!knownAgentParty(from) || !knownAgentParty(to)) return null
    return {
      from: from.slice(0, 80),
      to: to.slice(0, 80),
      kind: kind.slice(0, 40),
      text: typeof value.text === 'string' ? maskText(value.text.trim()).slice(0, ORCHESTRATOR_MESSAGE_LIMIT) : '',
      fromName: typeof value.fromName === 'string' ? maskText(value.fromName.trim()).slice(0, 80) : '',
      toName: typeof value.toName === 'string' ? maskText(value.toName.trim()).slice(0, 80) : '',
    }
  }

  function restoredMessage(item) {
    if (!item || typeof item !== 'object') return null
    const from = knownSender(item.from)
    if (!from) return null
    if (typeof item.text !== 'string' || item.text.trim() === '') return null
    const work = cleanWork(item.work, maskText)
    const message = {
      id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
      from,
      text: maskText(item.text),
      at: typeof item.at === 'string' && item.at ? item.at : iso(now()),
      ...(work ? { work } : {}),
    }
    if (from === 'agent') {
      const agent = restoredAgent(item.agent)
      if (!agent) return null
      message.agent = agent
    }
    return message
  }

  function persist() {
    let failure = null
    try {
      mkdirSync(folder, { recursive: true })
      const waiting = pending
        .filter((message) => message.from === 'owner' || message.from === 'room' || message.from === ORCHESTRATOR_KEY || (typeof message.from === 'string' && message.from.startsWith('sub:')))
        .map((message) => message.id)
      const saved = {
        project: root,
        harness,
        sessionId,
        state,
        model,
        messages,
        pending: waiting,
        roomTurns,
        contextTokens,
        contextWindow,
        autocompact,
        autocompactMode,
        autocompactValue,
        compactRules,
        autocompactPercent: autocompactMode === 'percent' ? autocompactValue : Math.round((autocompactValue / contextWindow) * 100),
        effort,
        ...(mode ? { mode } : {}),
        currentConversationId,
        currentSessionId,
        currentTitle,
        currentPinned,
        currentStarred,
        currentUnread,
        summary,
        ...(branchTranscript ? { branchTranscript } : {}),
        completedRuns: [...completedRuns.entries()].slice(-200).map(([runId, value]) => [runId, { status: value.status, messageId: value.messageId ?? null }]),
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          pinned: Boolean(s.pinned),
          starred: Boolean(s.starred),
          unread: Boolean(s.unread),
          archived: Boolean(s.archived),
          sessionId: s.sessionId ?? null,
          opencodeSessionId: s.opencodeSessionId ?? null,
          summary: s.summary ?? '',
          branchTranscript: typeof s.branchTranscript === 'string'
            ? s.branchTranscript.slice(0, BRANCH_TRANSCRIPT_LIMIT)
            : '',
          messages: (Array.isArray(s.messages) ? s.messages : []).slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m })),
        })),
        ...(ladder ? { ladder } : {}),
      }
      const temporary = `${conversationFile}.tmp`
      let renamed = false
      try {
        writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`)
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            rename(temporary, conversationFile)
            renamed = true
            break
          } catch (error) {
            failure = error
            if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') break
            if (attempt < 4) pauseSync(25)
          }
        }
      } catch (error) {
        failure = error
      } finally {
        if (!renamed) {
          try {
            rmSync(temporary, { force: true })
          } catch {}
        }
      }
      if (renamed) failure = null
    } catch (error) {
      failure = error
    }
    persistError = failure ? CHAT_SAVE_PROBLEM : null
  }

  function quarantine() {
    try {
      renameSync(conversationFile, `${conversationFile}.bad`)
    } catch {}
  }

  function newestTurnLog() {
    let names
    try {
      names = readdirSync(folder).filter((name) => name.startsWith(`${logPrefix}-chat-`) && TURN_LOG.test(name))
    } catch {
      return null
    }
    if (names.length === 0) return null
    names.sort()
    return join(folder, names[names.length - 1])
  }

  function recordStoppedTurn() {
    const log = newestTurnLog()
    if (!log) return
    if (recordFor(basename(log).replace(/\.log$/i, ''))) return
    let endedAt = now()
    try {
      endedAt = statSync(log).mtimeMs
    } catch {}
    const startedAt = turnStartedAt(basename(log)) ?? endedAt
    const minutes = Math.max(0, Math.round(((endedAt - startedAt) / 60000) * 10) / 10)
    const record = runRecord({ lane: logPrefix, model, startedAt, minutes, exitCode: null, killed: true, log })
    try {
      appendFileSync(join(folder, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
    } catch {}
  }

  function restore() {
    let text
    try {
      text = readFileSync(conversationFile, 'utf8')
    } catch {
      return false
    }
    let saved
    try {
      saved = JSON.parse(text)
    } catch {
      quarantine()
      return false
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      quarantine()
      return false
    }
    if (typeof saved.sessionId === 'string' && saved.sessionId.trim() !== '') sessionId = saved.sessionId
    if (typeof saved.harness === 'string' && saved.harness.trim() !== '') harness = saved.harness.trim()
    if (typeof saved.model === 'string' && saved.model.trim() !== '') model = saved.model.trim()
    if (saved.state === 'working') state = 'idle'
    if (saved.state === 'paused') state = 'paused'
    if (saved.ladder && typeof saved.ladder === 'object' && !Array.isArray(saved.ladder)) ladder = saved.ladder
    if (typeof saved.autocompact === 'boolean') autocompact = saved.autocompact
    if (saved.autocompactMode === 'percent' || saved.autocompactMode === 'tokens') {
      autocompactMode = saved.autocompactMode
      if (typeof saved.autocompactValue === 'number' && Number.isFinite(saved.autocompactValue)) {
        if (autocompactMode === 'percent' && saved.autocompactValue > 0 && saved.autocompactValue <= 100) {
          autocompactValue = saved.autocompactValue
        } else if (
          autocompactMode === 'tokens' &&
          Number.isInteger(saved.autocompactValue) &&
          saved.autocompactValue >= 1000 &&
          saved.autocompactValue <= 10000000
        ) {
          autocompactValue = saved.autocompactValue
        }
      }
    } else if (
      typeof saved.autocompactPercent === 'number' &&
      Number.isFinite(saved.autocompactPercent) &&
      saved.autocompactPercent > 0 &&
      saved.autocompactPercent <= 100
    ) {
      autocompactMode = 'percent'
      autocompactValue = saved.autocompactPercent
    }
    if (typeof saved.compactRules === 'string') {
      compactRules = maskText(saved.compactRules).slice(0, COMPACT_RULES_LIMIT)
    }
    if (typeof saved.contextTokens === 'number' && Number.isFinite(saved.contextTokens) && saved.contextTokens >= 0) {
      contextTokens = Math.round(saved.contextTokens)
    }
    contextWindow = resolveContextWindow(model, harness, windowOption, laneDetails())
    if (typeof saved.summary === 'string' && saved.summary.trim() !== '') summary = maskText(saved.summary).trim()
    if (typeof saved.branchTranscript === 'string' && saved.branchTranscript.trim() !== '') {
      branchTranscript = maskText(saved.branchTranscript).slice(0, BRANCH_TRANSCRIPT_LIMIT)
    }
    if (saved.effort === null || typeof saved.effort === 'string') {
      const allowed = harness === 'claude' ? CLAUDE_EFFORT_LEVELS : OPENCODE_EFFORT_LEVELS
      if (saved.effort === null || allowed.includes(saved.effort.trim())) {
        effort = saved.effort ? saved.effort.trim() : null
      }
    }
    if (typeof saved.mode === 'string' && modesFor(harness).some((entry) => entry.id === saved.mode.trim())) {
      mode = saved.mode.trim()
    }
    if (typeof saved.currentConversationId === 'string' && saved.currentConversationId.trim() !== '') {
      currentConversationId = saved.currentConversationId.trim()
    }
    if (typeof saved.currentSessionId === 'string' && saved.currentSessionId.trim() !== '') {
      currentSessionId = saved.currentSessionId.trim()
    }
    if (typeof saved.currentTitle === 'string' && saved.currentTitle.trim() !== '') {
      currentTitle = maskText(saved.currentTitle).trim()
    }
    currentPinned = saved.currentPinned === true
    currentStarred = saved.currentStarred === true
    currentUnread = saved.currentUnread === true
    if (Array.isArray(saved.sessions)) {
      for (const item of saved.sessions) {
        if (!item || typeof item !== 'object') continue
        if (typeof item.id !== 'string' || !item.id) continue
        const itemMessages = []
        if (Array.isArray(item.messages)) {
          for (const msg of item.messages) {
            const message = restoredMessage(msg)
            if (message) itemMessages.push(message)
          }
        }
        sessions.push({
          id: item.id,
          title: typeof item.title === 'string' ? maskText(item.title).slice(0, 80) : '',
          startedAt: typeof item.startedAt === 'string' ? item.startedAt : iso(now()),
          endedAt: typeof item.endedAt === 'string' ? item.endedAt : iso(now()),
          pinned: Boolean(item.pinned),
          starred: Boolean(item.starred),
          unread: Boolean(item.unread),
          archived: Boolean(item.archived),
          sessionId: typeof item.sessionId === 'string' ? item.sessionId : null,
          opencodeSessionId: typeof item.opencodeSessionId === 'string' ? item.opencodeSessionId : null,
          summary: typeof item.summary === 'string' ? maskText(item.summary) : '',
          branchTranscript: typeof item.branchTranscript === 'string'
            ? maskText(item.branchTranscript).slice(0, BRANCH_TRANSCRIPT_LIMIT)
            : '',
          messages: itemMessages.slice(-SESSION_MESSAGES_LIMIT),
        })
      }
      enforceSessionLimit(sessions)
    }
    const currentRecord = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : null
    if (currentRecord) {
      currentPinned = Boolean(currentRecord.pinned)
      currentStarred = Boolean(currentRecord.starred)
      currentUnread = Boolean(currentRecord.unread)
      if (!currentTitle) currentTitle = currentRecord.title
    }
    const list = Array.isArray(saved.messages) ? saved.messages : []
    for (const item of list) {
      const message = restoredMessage(item)
      if (message) messages.push(message)
    }
    while (messages.length > ORCHESTRATOR_CHAT_LIMIT) messages.shift()
    const cutoff = now() - ORCHESTRATOR_ROOM_WINDOW_MS
    const times = Array.isArray(saved.roomTurns) ? saved.roomTurns : []
    for (const at of times) {
      if (typeof at === 'number' && Number.isFinite(at) && at > cutoff) roomTurns.push(at)
    }
    roomTurns.sort((left, right) => left - right)
    if (saved.state === 'working') {
      messages.push({ id: randomUUID(), from: 'room', text: maskText(RESTART_MESSAGE), at: iso(now()) })
      while (messages.length > ORCHESTRATOR_CHAT_LIMIT) messages.shift()
      recordStoppedTurn()
    }
    const waitingIds = Array.isArray(saved.pending) ? saved.pending : []
    for (const id of waitingIds) {
      const message = messages.find(
        (item) => item.id === id && (item.from === 'owner' || item.from === 'room' || item.from === ORCHESTRATOR_KEY || (typeof item.from === 'string' && item.from.startsWith('sub:')))
      )
      if (message && !pending.includes(message)) pending.push(message)
    }
    const finished = Array.isArray(saved.completedRuns) ? saved.completedRuns : []
    for (const entry of finished) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [runId, value] = entry
      if (typeof runId !== 'string' || !runId || !value || typeof value !== 'object') continue
      if (value.status !== 'succeeded' && value.status !== 'failed') continue
      completedRuns.set(runId, {
        status: value.status,
        messageId: typeof value.messageId === 'string' && value.messageId ? value.messageId : null,
      })
    }
    while (completedRuns.size > 200) completedRuns.delete(completedRuns.keys().next().value)
    return true
  }

  function setState(next) {
    if (state === next) return
    state = next
    persist()
    notify()
  }

  function addMessage(from, text) {
    const message = { id: randomUUID(), from, text: maskText(text), at: iso(now()) }
    messages.push(message)
    while (messages.length > ORCHESTRATOR_CHAT_LIMIT) messages.shift()
    persist()
    notify()
    return message
  }

  const directLaneTasks = new Set()

  function markDirectLaneTask(laneKey) {
    if (laneKey) directLaneTasks.add(laneKey)
  }

  function recordAgentMessage({ from, to, kind, text = '', lanes: lanesInput } = {}) {
    if (stopped) return null
    const allLanes = lanesInput || (typeof lanes === 'function' ? lanes() : lanes) || {}
    const safeFrom = knownAgentParty(from, allLanes)
    const safeTo = knownAgentParty(to, allLanes)
    if (!safeFrom || !safeTo) return null
    const resolveName = (k) => {
      if (!k) return ''
      if (k === 'orchestrator' || k === ORCHESTRATOR_KEY) {
        return allLanes?.[ORCHESTRATOR_KEY]?.name || 'Orchestrator'
      }
      if (typeof k === 'string' && k.startsWith('sub-')) {
        const subId = k.slice(4)
        return allLanes?.[k]?.name || allLanes?.[subId]?.name || `Sub ${subId}`
      }
      return allLanes?.[k]?.name || k
    }
    const fromName = maskText(String(resolveName(safeFrom) ?? ''))
    const toName = maskText(String(resolveName(safeTo) ?? ''))
    const safeKind = maskText(String(kind ?? ''))
    const prefix = `${fromName} to ${toName}, ${safeKind}`
    const trimmed = typeof text === 'string' ? text.trim() : ''
    const safeText = maskText(trimmed)
    const lineText = safeText ? `${prefix}: ${safeText}` : prefix
    const message = {
      id: randomUUID(),
      from: 'agent',
      agent: { from: safeFrom, to: safeTo, kind: safeKind, text: safeText, fromName, toName },
      text: lineText,
      at: iso(now()),
    }
    messages.push(message)
    while (messages.length > ORCHESTRATOR_CHAT_LIMIT) messages.shift()
    persist()
    notify()
    return message
  }

  function recordFor(runName) {
    if (!runName) return null
    const wanted = pathKey(join(folder, `${runName}.log`))
    const map = recordsCache.read()
    return map.get(wanted) ?? null
  }

  function roomTurnAllowed() {
    const cutoff = now() - ORCHESTRATOR_ROOM_WINDOW_MS
    while (roomTurns.length > 0 && roomTurns[0] <= cutoff) roomTurns.shift()
    return roomTurns.length < ORCHESTRATOR_ROOM_TURNS
  }

  function scheduleRoomTurn(waitMs = null) {
    if (roomTimer) return
    let wait = waitMs
    if (wait === null) {
      if (roomTurns.length === 0) return
      wait = Math.max(0, roomTurns[0] + ORCHESTRATOR_ROOM_WINDOW_MS - now()) + 10
    }
    roomTimer = setTimeout(() => {
      roomTimer = null
      maybeStartTurn()
    }, wait)
    roomTimer.unref?.()
  }

  let mergeCheck = null
  let mergeCheckChild = null
  let cancelMergeCheck = null

  function gitOperationInProgress() {
    if (!root || !insideGitFolder(root)) return Promise.resolve(false)
    if (mergeCheck) return mergeCheck
    let cancel = () => {}
    const check = new Promise((resolve) => {
      let settled = false
      let timer = null
      const output = []
      const finish = (value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(value)
      }
      cancel = () => finish(false)
      cancelMergeCheck = cancel
      let child
      try {
        child = spawnGit(
          gitPath(),
          ['rev-parse', ...GIT_OPERATION_FILES.flatMap((name) => ['--git-path', name])],
          {
            cwd: root,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          }
        )
      } catch {
        finish(false)
        return
      }
      mergeCheckChild = child
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {}
        finish(false)
      }, gitTimeoutMs)
      child.stdout?.setEncoding?.('utf8')
      child.stdout?.on('data', (chunk) => output.push(String(chunk)))
      child.once('error', () => {
        if (mergeCheckChild === child) mergeCheckChild = null
        finish(false)
      })
      child.once('close', (code) => {
        if (mergeCheckChild === child) mergeCheckChild = null
        if (code !== 0) {
          finish(false)
          return
        }
        const found = String(output.join(''))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .some((line) => existsSync(isAbsolute(line) ? line : join(root, line)))
        finish(found)
      })
    })
    mergeCheck = check
    const clear = () => {
      if (mergeCheck === check) mergeCheck = null
      if (cancelMergeCheck === cancel) cancelMergeCheck = null
    }
    check.then(clear, clear)
    return check
  }

  function finishMaybeStartTurn(inProgress) {
    if (stopped || running || state === 'paused') return
    if (pending.length === 0) return
    if (inProgress) {
      scheduleRoomTurn(mergeWaitMs)
      return
    }
    if (!roomTurnAllowed()) {
      scheduleRoomTurn()
      return
    }
    startTurn()
  }

  function maybeStartTurn() {
    if (stopped || running || state === 'paused') return
    if (pendingCompaction) {
      startTurn()
      return
    }
    if (pending.length === 0) return
    const ordered = pending.some((message) => message.from === 'owner' || (key !== ORCHESTRATOR_KEY && message.from === ORCHESTRATOR_KEY))
    if (ordered) {
      startTurn()
      return
    }
    if (!givenWork()) return
    if (!root || !insideGitFolder(root)) {
      finishMaybeStartTurn(false)
      return
    }
    gitOperationInProgress().then(finishMaybeStartTurn, () => finishMaybeStartTurn(false))
  }

  function givenWork() {
    if (sessionId || ownsRun) return true
    return messages.some((message) => message.from === 'owner' || (key !== ORCHESTRATOR_KEY && message.from === ORCHESTRATOR_KEY))
  }

  function approvalList() {
    return [...approvals.values()].map((entry) => ({
      approvalId: entry.approvalId,
      tool: entry.tool,
      input: entry.input,
      at: entry.at,
    }))
  }

  function finishApproval(entry, answer) {
    if (!approvals.has(entry.approvalId)) return false
    approvals.delete(entry.approvalId)
    if (entry.timer) clearTimeout(entry.timer)
    entry.resolve(answer)
    if (!stopped) notify()
    return true
  }

  function requestApproval({ tool, input } = {}) {
    if (stopped) return Promise.resolve({ allow: false, message: APPROVAL_NO_ANSWER })
    if (approvals.size >= APPROVAL_LIMIT) return null
    const approvalId = randomUUID()
    let resolve
    const waiting = new Promise((done) => {
      resolve = done
    })
    const entry = { approvalId, tool, input, at: iso(now()), resolve, timer: null }
    entry.timer = setTimeout(() => {
      finishApproval(entry, { allow: false, message: APPROVAL_NO_ANSWER })
    }, approvalTimeoutMs)
    entry.timer.unref?.()
    approvals.set(approvalId, entry)
    notify()
    return waiting
  }

  function answerApproval({ approvalId, allow } = {}) {
    const entry = approvals.get(approvalId)
    if (!entry) return null
    const answered = allow === true ? { allow: true } : { allow: false, message: APPROVAL_DENIED }
    finishApproval(entry, answered)
    return { ok: true, approvalId, allow: answered.allow }
  }

  function denyApprovals(message = APPROVAL_NO_ANSWER) {
    for (const entry of [...approvals.values()]) {
      finishApproval(entry, { allow: false, message })
    }
  }

  function slashCommands() {
    return scanSlashCommands({ harness, projectRoot: root, home })
  }

  function commandList() {
    return slashCommands().map((entry) => ({
      name: entry.name,
      description: entry.description,
      source: entry.source,
    }))
  }

  function expandOwners(queued) {
    const slashed = queued.some(
      (message) => message?.from === 'owner' && typeof message.text === 'string' && message.text.trim().startsWith('/')
    )
    if (!slashed) return queued
    const list = slashCommands()
    if (list.length === 0) return queued
    return queued.map((message) => {
      if (!message || message.from !== 'owner' || typeof message.text !== 'string') return message
      const expanded = expandSlashCommand(message.text, list)
      return expanded === message.text ? message : { ...message, text: expanded }
    })
  }

  function stepParserFor(name) {
    const descriptor = (harnesses && harnesses[name]) || harnessByKey[name]
    if (!descriptor || typeof descriptor.createParser !== 'function') return null
    try {
      return descriptor.createParser({ rootName: basename(String(root ?? '')), files: [], dirs: [] })
    } catch {
      return null
    }
  }

  function turnSeconds(turn) {
    return Math.max(0, Math.round((now() - turn.startedAt) / 1000))
  }

  function collectSteps(turn, chunk) {
    if (!turn.parser) return
    let activities = []
    try {
      activities = turn.parser.push(String(chunk), now())
    } catch {
      return
    }
    let changed = false
    for (const activity of activities) {
      const step = cleanStep(turnStepOf(activity), maskText)
      if (!step) continue
      turn.steps.push(step)
      while (turn.steps.length > TURN_STEP_LIMIT) turn.steps.shift()
      changed = true
    }
    if (changed) notify()
  }

  function settleWork(turn) {
    if (!turn.anchorId || turn.compacting) return
    const anchor = messages.find((message) => message.id === turn.anchorId)
    if (!anchor) return
    anchor.work = { steps: cleanSteps(turn.steps, maskText), seconds: turnSeconds(turn) }
  }

  function shownMessages() {
    const list = messages.map((message) => ({ ...message }))
    const turn = running && !running.done && !running.compacting ? running : null
    if (turn?.anchorId) {
      const anchor = list.find((message) => message.id === turn.anchorId)
      if (anchor) {
        anchor.work = {
          state: 'working',
          steps: cleanSteps(turn.steps, maskText),
          seconds: turnSeconds(turn),
        }
      }
    }
    return list
  }

  function failedToStart(turn) {
    if (turn.started) return
    if (!turn.provisionalSessionId) return
    sessionId = null
    persist()
  }

  function startTurn(options = null) {
    if (roomTimer) {
      clearTimeout(roomTimer)
      roomTimer = null
    }
    const manualCompacting = Boolean(options?.compacting)
    const keepText = manualCompacting ? (options.keep || '') : (pendingCompaction?.keep || '')
    const compaction = manualCompacting || Boolean(pendingCompaction)
    pendingCompaction = null
    const queued = compaction ? [] : pending.splice(0, pending.length)
    const fit = compaction ? { text: '', used: [] } : fitTurnText(expandOwners(queued))
    const turnMessages = fit.used
    if (!compaction && turnMessages.length < queued.length) {
      pending.unshift(...queued.slice(turnMessages.length))
      persist()
    }
    const hasOwner = turnMessages.some((message) => message.from === 'owner')
    if (!hasOwner) roomTurns.push(now())
    const first = !sessionId
    if (first && harness === 'claude') sessionId = randomUUID()
    const carried = first ? branchTranscript || summary : ''
    const carriedBranch =
      (harness === 'claude' || harness === 'opencode') && carried !== '' && branchTranscript !== ''
    if (carried && (harness === 'claude' || harness === 'opencode')) {
      summary = ''
    }
    const startedAt = now()
    const logName = `${logPrefix}-chat-${stamp(startedAt)}`
    const logPath = join(folder, `${logName}.log`)
    const metaPath = join(folder, `${logName}.meta.json`)
    const enabledServers = enabledMcpServersFor(folder)
    const turnMode = mode ?? legacyMode(harness)
    const bridgeAddress = String((typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl) ?? '')
    const ask = turnMode === 'ask' && harness === 'claude'
    const needsMcp = (enabledServers.length > 0 || ask) && (harness === 'claude' || harness === 'opencode')
    const needsOpencodeConfig = harness === 'opencode' && (needsMcp || turnMode === 'edits' || turnMode === 'plan')
    const mcpConfigPath = needsMcp || needsOpencodeConfig ? join(folder, `${logName}.mcp.json`) : ''
    let mcpEnv = null
    const turn = { startedAt, logPath, metaPath, mcpConfigPath, killed: false, done: false, started: false, provisionalSessionId: first ? sessionId : null, child: null, timer: null, compacting: compaction, stderr: '', anchorId: turnMessages[0]?.id ?? '', steps: [], parser: null }
    turn.parser = compaction ? null : stepParserFor(harness)
    running = turn
    setState('working')
    try {
      mkdirSync(folder, { recursive: true })
      mkdirSync(scratchFolder, { recursive: true })
      writeFileSync(metaPath, `${JSON.stringify({ project: root, sessionId })}\n`)
      if (mcpConfigPath) {
        if (harness === 'claude') {
          const config = mcpConfigForClaude(enabledServers)
          if (ask) {
            config.mcpServers[APPROVAL_SERVER] = {
              command: process.execPath,
              args: [join(REPO_ROOT, 'scripts', 'mr-approve.mjs')],
              env: {
                MACHINEROOM_BRIDGE: bridgeAddress,
                MACHINEROOM_ORCHESTRATOR_ID: key,
                MACHINEROOM_ORCHESTRATOR_TOKEN: token,
              },
            }
          }
          writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
        } else if (harness === 'opencode') {
          const config = needsMcp ? mcpConfigForOpencode(enabledServers) : {}
          if (turnMode === 'edits') config.permission = { bash: 'deny' }
          else if (turnMode === 'plan') config.permission = { edit: 'deny', bash: 'deny' }
          writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
          mcpEnv = { OPENCODE_CONFIG: mcpConfigPath }
        }
      }
    } catch {
      if (mcpConfigPath) {
        try {
          rmSync(mcpConfigPath, { force: true })
        } catch {}
      }
      failedToStart(turn)
      running = null
      addMessage('orchestrator', STOPPED_REPLY)
      setState('idle')
      return
    }
    const message = compaction ? compactPrompt(keepText, compactRules) : fit.text
    const baseInstruction = instructionFor(
      promptFile,
      root,
      folder,
      bridgeAddress,
      token,
      scratchFolder
    )
    const extra = typeof extraInstructions === 'function' ? extraInstructions() : extraInstructions
    const joined = extra ? `${baseInstruction}\n\n${extra}` : baseInstruction
    const depthLine = agentDepthLine(readAgentDepth(folder).limit)
    const instruction = `${joined.replace(SPAWN_DEPTH_LINE, '').replace(/\n{3,}/g, '\n\n').trimEnd()}\n\n${depthLine}`
    let program = binFor(harness)
    let args
    if (harness === 'opencode') {
      const modelArg = effort ? `${model}#${effort}` : model
      args = ['run', '--standalone', '--format', 'json', '--model', modelArg, '--auto']
      if (turnMode === 'plan') args.push('--agent', 'plan')
      args.push('--title', logName)
      if (!first) args.push('--session', sessionId)
      const restarted = `The room restarted, so your bridge token is new. Send the header X-MachineRoom-Orchestrator: ${token} on every bridge request from now on.`
      const body = first ? `${instruction}\n\n${message}` : tokenSent ? message : `${restarted}\n\n${message}`
      tokenSent = true
      args.push(carried ? `${carried}\n\n${body}` : body)
    } else if (harness === 'claude') {
      args = [
        '-p',
        carried ? `${carried}\n\n${message}` : message,
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        model,
      ]
      if (turnMode === 'plan') args.push('--permission-mode', 'plan')
      else if (turnMode === 'edits') args.push('--permission-mode', 'acceptEdits')
      else if (turnMode === 'auto') args.push('--permission-mode', 'auto')
      else if (turnMode === 'ask') args.push('--permission-mode', 'manual', '--permission-prompt-tool', APPROVAL_PROMPT_TOOL)
      else args.push('--dangerously-skip-permissions')
      args.push(first ? '--session-id' : '--resume', sessionId, '--append-system-prompt', instruction)
      if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath)
      if (effort) args.push('--effort', effort)
    } else {
      const descriptor = (harnesses && harnesses[harness]) || harnessByKey[harness]
      if (!descriptor || typeof descriptor.command !== 'function') {
        running = null
        addMessage('orchestrator', STOPPED_REPLY)
        setState('idle')
        return
      }
      let harnessCli = null
      for (const entry of Object.values(lanes ?? {})) {
        if (entry?.cli?.harness === harness) {
          harnessCli = entry.cli
          break
        }
      }
      const cli = {
        ...harnessCli,
        harness,
        model,
        bin: binFor(harness),
      }
      const firstNewIndex = turnMessages.length > 0 ? messages.findIndex((m) => m.id === turnMessages[0].id) : messages.length
      const prior = messages.slice(0, firstNewIndex === -1 ? messages.length : firstNewIndex).slice(-20)
      const history = prior.map(blockFor).join('\n\n')
      const promptParts = [instruction]
      if (summary) promptParts.push(summary)
      if (history) promptParts.push(history)
      promptParts.push(message)
      const freshPrompt = promptParts.join('\n\n')
      const cmd = descriptor.command({
        cli,
        prompt: freshPrompt,
        env: process.env,
        folder: root,
        cwd: root,
        title: logName,
        mcpConfig: mcpConfigPath,
        mode: turnMode,
        bridgeUrl: bridgeAddress,
        orchestratorId: key,
        token,
      })
      program = cmd.file
      args = cmd.args
      if (cmd?.env && typeof cmd.env === 'object') {
        mcpEnv = { ...(mcpEnv || {}), ...cmd.env }
      }
    }
    const stream = createWriteStream(logPath)
    stream.on('error', () => {})
    turn.timer = setTimeout(() => {
      turn.killed = true
      killTree(turn.child)
    }, ORCHESTRATOR_TURN_LIMIT_MS)
    turn.timer.unref?.()
    let ending = false
    const finish = (code, error) => {
      if (ending) return
      ending = true
      turn.exited = true
      stream.end(() => completeTurn(turn, code, error))
    }
    let child
    try {
      child = spawnChild(spawnChild === spawn ? programFor(program) : program, args, {
        cwd: root,
        shell: false,
        env: childEnvironment(process.env, root, {
          harness,
          model,
          endpoints: readEndpoints(folder),
          extra: { MACHINEROOM_RUNS: folder, ...(mcpEnv || {}) },
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      failedToStart(turn)
      finish(null, error)
      return
    }
    turn.child = child
    const markStarted = () => {
      if (turn.started) return
      turn.started = true
      if (carriedBranch) {
        branchTranscript = ''
        persist()
      }
    }
    child.once('spawn', markStarted)
    child.stdout?.pipe(stream, { end: false })
    child.stdout?.once('data', markStarted)
    child.stdout?.on('data', (chunk) => collectSteps(turn, chunk))
    let stderrTail = Buffer.alloc(0)
    child.stderr?.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      const tail = Buffer.concat([stderrTail, bytes])
      stderrTail = Buffer.from(tail.subarray(-TURN_STDERR_LIMIT))
      turn.stderr = stderrTail.toString('utf8')
    })
    child.once('error', (error) => {
      failedToStart(turn)
      finish(null, error)
    })
    child.once('close', (code) => finish(code, null))
  }

  function completeTurn(turn, code, error) {
    if (turn.done) return
    turn.done = true
    denyApprovals(APPROVAL_NO_ANSWER)
    if (turn.timer) clearTimeout(turn.timer)
    if (turn.mcpConfigPath) {
      try {
        rmSync(turn.mcpConfigPath, { force: true })
      } catch {}
    }
    const logText = readTail(turn.logPath)
    let runStats
    let report
    const descriptor = (harnesses && harnesses[harness]) || harnessByKey[harness]
    if (harness === 'opencode' || harness === 'claude') {
      runStats = summarizeRun({ harness, log: logText, worktree: root })
      report = replyText(harness, logText)
      if (harness === 'opencode') {
        const savedSessionId = opencodeSessionId(logText)
        if (savedSessionId) {
          sessionId = savedSessionId
          try {
            writeFileSync(turn.metaPath, `${JSON.stringify({ project: root, sessionId })}\n`)
          } catch {}
        }
      }
    } else {
      if (descriptor) {
        try {
          runStats = summarizeRun({ harness, log: logText, worktree: root })
        } catch {
          const parser = descriptor.createParser?.({ rootName: basename(String(root ?? '')), files: [], dirs: [] })
          const activities = parser ? [...parser.push(String(logText ?? ''), 0), ...parser.flush(0)] : []
          const rep = descriptor.report ? descriptor.report(logText) : []
          const use = descriptor.usage ? descriptor.usage(logText) : {}
          runStats = {
            costUsd: use?.costUsd ?? null,
            inputTokens: use?.inputTokens ?? null,
            outputTokens: use?.outputTokens ?? null,
          }
        }
        report = descriptor.reply ? descriptor.reply(logText).trim() : (descriptor.report ? descriptor.report(logText).join('\n') : '')
      } else {
        runStats = summarizeRun({ harness, log: logText, worktree: root })
        report = replyText(harness, logText)
      }
    }
    const seen = contextTokensFromLog(harness, logText)
    if (seen !== null) {
      contextTokens = seen
    } else if (typeof runStats?.inputTokens === 'number' && runStats.inputTokens > 0) {
      contextTokens = runStats.inputTokens
    }
    const failureRaw = descriptor?.failure ? descriptor.failure(logText) : null
    const failureMessage = cleanFailure(failureRaw)
    const stderrMessage = report ? null : cleanFailure(lastStderrLine(turn.stderr))
    if (code === 0 && !error && report) {
      turn.killed = false
    }
    const failed = turn.killed || Boolean(error) || !Number.isInteger(code) || code !== 0
    const noReport = !failed && typeof report === 'string' && report.trim() === NO_REPORT
    const text = failed
      ? stoppedTurnText({ code, report, killed: turn.killed, failureMessage, stderrMessage })
      : noReport
        ? NO_NEW_REPORT
        : report || EMPTY_REPLY
    const record = runRecord({
      lane: logPrefix,
      model,
      startedAt: turn.startedAt,
      minutes: Math.round(((now() - turn.startedAt) / 60000) * 10) / 10,
      exitCode: code,
      killed: turn.killed,
      costUsd: runStats.costUsd,
      inputTokens: runStats.inputTokens,
      outputTokens: runStats.outputTokens,
      log: turn.logPath,
    })
    try {
      appendFileSync(join(folder, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
    } catch {}
    if (running === turn) running = null
    if (stopped) return
    settleWork(turn)
    addMessage('orchestrator', text)
    if (!turn.compacting && typeof onReply === 'function') {
      try {
        onReply(noReport ? NO_REPORT : text)
      } catch {}
    }
    if (turn.compacting) {
      if (failed) {
        if (!stopped) setState(state === 'paused' ? 'paused' : 'idle')
        addMessage('room', COMPACT_FAILED_MESSAGE)
      } else {
        summary = maskText(String(report ?? '')).trim()
        sessionId = null
        contextTokens = null
        if (!stopped) setState(state === 'paused' ? 'paused' : 'idle')
        addMessage('room', COMPACTED_MESSAGE)
      }
      if (!stopped) maybeStartTurn()
      return
    }
    const contextPastRule =
      contextTokens !== null &&
      (autocompactMode === 'tokens'
        ? contextTokens >= autocompactValue
        : contextWindow > 0 && (contextTokens / contextWindow) * 100 >= autocompactValue)
    if (autocompact && sessionId && contextPastRule) {
      pendingCompaction = { keep: '' }
    }
    if (!stopped) {
      setState(state === 'paused' ? 'paused' : 'idle')
      maybeStartTurn()
    }
  }

  function answer() {
    return {
      id: key,
      name: name || (key === ORCHESTRATOR_KEY ? 'Orchestrator' : key),
      parent: parent || null,
      harness,
      state,
      model,
      project: root,
      contextTokens,
      contextWindow,
      autocompact,
      autocompactMode,
      autocompactValue,
      compactRules,
      defaultCompactRules: DEFAULT_COMPACT_RULES,
      autocompactPercent: autocompactMode === 'percent' ? autocompactValue : Math.round((autocompactValue / contextWindow) * 100),
      effort: effort ?? null,
      mode: mode ?? legacyMode(harness),
      modes: modesFor(harness),
      approvals: approvalList(),
      saveError: persistError,
      messages: shownMessages(),
    }
  }

  function send(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_MESSAGE_PROBLEM } }
    if (!root) return { status: 409, body: { error: NO_PROJECT_PROBLEM } }
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text.length < 1 || text.length > ORCHESTRATOR_MESSAGE_LIMIT) {
      return { status: 400, body: { error: MESSAGE_PROBLEM } }
    }
    if (state === 'paused') setState('idle')
    const message = addMessage('owner', text)
    pending.push(message)
    maybeStartTurn()
    // The message is queued and its turn starts, so a failure here would invite a second send.
    return { status: 202, body: persistError ? { id: message.id, saveError: persistError } : { id: message.id } }
  }

  function deliver(from, text) {
    if (stopped) return null
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) return null
    if (state === 'paused' && (from === 'owner' || (key !== ORCHESTRATOR_KEY && from === ORCHESTRATOR_KEY))) {
      setState('idle')
    }
    const message = addMessage(from, value)
    pending.push(message)
    maybeStartTurn()
    return message
  }

  function stop(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_STOP_PROBLEM } }
    if (!root) return { status: 409, body: { error: NO_PROJECT_PROBLEM } }
    denyApprovals(APPROVAL_NO_ANSWER)
    if (running && !running.done) {
      if (!running.exited) {
        running.killed = true
        killTree(running.child)
      }
    }
    setState('paused')
    return { status: 200, body: { ok: true } }
  }

  function setAutocompact(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_AUTOCOMPACT_PROBLEM } }
    if (
      body.on === undefined &&
      body.mode === undefined &&
      body.value === undefined &&
      body.rules === undefined &&
      body.percent === undefined
    ) {
      return { status: 400, body: { error: AUTOCOMPACT_PROBLEM } }
    }
    if (body.on !== undefined && typeof body.on !== 'boolean') {
      return { status: 400, body: { error: AUTOCOMPACT_PROBLEM } }
    }
    if (body.mode !== undefined && body.mode !== 'percent' && body.mode !== 'tokens') {
      return { status: 400, body: { error: AUTOCOMPACT_MODE_PROBLEM } }
    }
    const targetMode = body.mode !== undefined ? body.mode : (body.percent !== undefined ? 'percent' : autocompactMode)

    if (body.percent !== undefined) {
      if (typeof body.percent !== 'number' || !Number.isFinite(body.percent) || body.percent <= 0 || body.percent > 100) {
        return { status: 400, body: { error: AUTOCOMPACT_PERCENT_PROBLEM } }
      }
    }

    if (body.value !== undefined) {
      if (targetMode === 'percent') {
        if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value <= 0 || body.value > 100) {
          return { status: 400, body: { error: AUTOCOMPACT_PERCENT_PROBLEM } }
        }
      } else if (targetMode === 'tokens') {
        if (typeof body.value !== 'number' || !Number.isInteger(body.value) || body.value < 1000 || body.value > 10000000) {
          return { status: 400, body: { error: AUTOCOMPACT_TOKENS_PROBLEM } }
        }
      }
    } else if (body.mode !== undefined && body.percent === undefined) {
      if (body.mode === 'percent') {
        if (typeof autocompactValue !== 'number' || !Number.isFinite(autocompactValue) || autocompactValue <= 0 || autocompactValue > 100) {
          return { status: 400, body: { error: AUTOCOMPACT_PERCENT_PROBLEM } }
        }
      } else if (body.mode === 'tokens') {
        if (typeof autocompactValue !== 'number' || !Number.isInteger(autocompactValue) || autocompactValue < 1000 || autocompactValue > 10000000) {
          return { status: 400, body: { error: AUTOCOMPACT_TOKENS_PROBLEM } }
        }
      }
    }

    let nextRules
    if (body.rules !== undefined && body.rules !== null) {
      if (typeof body.rules !== 'string') {
        return { status: 400, body: { error: AUTOCOMPACT_RULES_PROBLEM } }
      }
      nextRules = maskText(body.rules)
      if (nextRules.length > COMPACT_RULES_LIMIT) {
        return { status: 400, body: { error: AUTOCOMPACT_RULES_PROBLEM } }
      }
    }

    if (typeof body.on === 'boolean') autocompact = body.on
    if (body.mode !== undefined) autocompactMode = body.mode
    if (body.value !== undefined) autocompactValue = body.value
    if (body.percent !== undefined) {
      autocompactMode = 'percent'
      autocompactValue = body.percent
    }
    if (body.rules !== undefined) {
      compactRules = body.rules === null ? '' : nextRules
    }
    persist()
    notify()
    return {
      status: 200,
      body: {
        id: key,
        autocompact,
        autocompactMode,
        autocompactValue,
        compactRules,
        autocompactPercent: autocompactMode === 'percent' ? autocompactValue : Math.round((autocompactValue / contextWindow) * 100),
      },
    }
  }

  function compact(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_COMPACT_PROBLEM } }
    if (!root) return { status: 409, body: { error: NO_PROJECT_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    if (!sessionId) return { status: 400, body: { error: NO_SESSION_PROBLEM } }
    let keep = ''
    if (body?.keep !== undefined && body?.keep !== null) {
      if (typeof body.keep !== 'string' || body.keep.trim().length > COMPACT_KEEP_LIMIT) {
        return { status: 400, body: { error: COMPACT_KEEP_PROBLEM } }
      }
      keep = body.keep.trim()
    }
    if (state === 'paused') setState('idle')
    startTurn({ compacting: true, keep })
    return { status: 200, body: { ok: true } }
  }

  function setModel(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_MODEL_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    const nextModel = typeof body?.model === 'string' ? body.model.trim() : ''
    if (!nextModel) return { status: 400, body: { error: MODEL_PROBLEM } }
    const allowed = modelAllowed(harness, nextModel, folder)
    if (!allowed) return { status: 400, body: { error: MODEL_PROBLEM } }
    model = nextModel
    contextWindow = resolveContextWindow(model, harness, windowOption, laneDetails())
    persist()
    notify()
    return { status: 200, body: { id: key, model } }
  }

  function setMode(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_MODE_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    const nextMode = typeof body?.mode === 'string' ? body.mode.trim() : ''
    if (!modesFor(harness).some((entry) => entry.id === nextMode)) {
      return { status: 400, body: { error: MODE_PROBLEM } }
    }
    mode = nextMode
    persist()
    notify()
    return { status: 200, body: answer() }
  }

  function setHarness(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_HARNESS_PROBLEM } }
    const nextHarness = typeof body?.harness === 'string' ? body.harness.trim() : ''
    if (!nextHarness || !isHarnessAvailable(nextHarness, { lanes, endpoints: readEndpoints(folder) })) {
      return { status: 400, body: { error: harnessUnavailableProblem(nextHarness || 'unknown') } }
    }
    const nextModel = typeof body?.model === 'string' ? body.model.trim() : ''
    const allowed = modelAllowed(nextHarness, nextModel, folder)
    if (!nextModel || !allowed) {
      return { status: 400, body: { error: modelUnavailableProblem(nextModel, nextHarness) } }
    }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    const keptMode = mode ?? legacyMode(harness)
    harness = nextHarness
    model = nextModel
    sessionId = null
    for (const s of sessions) {
      s.sessionId = null
      s.opencodeSessionId = null
    }
    contextWindow = resolveContextWindow(model, harness, windowOption, laneDetails())
    mode = modesFor(harness).some((entry) => entry.id === keptMode) ? keptMode : defaultMode(harness)
    persist()
    notify()
    return { status: 200, body: answer() }
  }

  function setEffort(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_EFFORT_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    const allowed = harness === 'claude' ? CLAUDE_EFFORT_LEVELS : OPENCODE_EFFORT_LEVELS
    if (body.effort === null) {
      effort = null
    } else if (typeof body.effort === 'string' && allowed.includes(body.effort.trim())) {
      effort = body.effort.trim()
    } else {
      return { status: 400, body: { error: EFFORT_PROBLEM } }
    }
    persist()
    notify()
    return { status: 200, body: { id: key, effort } }
  }

  function archiveCurrentSession() {
    function resetCurrentFlags() {
      currentPinned = false
      currentStarred = false
      currentUnread = false
    }
    if (messages.length === 0) {
      resetCurrentFlags()
      return null
    }
    const firstOwner = messages.find((m) => m.from === 'owner')
    const defaultTitle = (firstOwner ?? messages[0]).text.trim().slice(0, 60)
    const title = currentTitle || defaultTitle
    if (currentSessionId) {
      const existing = sessions.find((s) => s.id === currentSessionId)
      if (existing) {
        existing.title = title
        existing.endedAt = messages.at(-1)?.at ?? iso(now())
        existing.sessionId = harness === 'claude' ? sessionId : null
        existing.opencodeSessionId = harness === 'opencode' ? sessionId : null
        existing.pinned = currentPinned
        existing.starred = currentStarred
        existing.unread = currentUnread
        existing.archived = false
        existing.summary = summary || ''
        existing.branchTranscript = branchTranscript.slice(0, BRANCH_TRANSCRIPT_LIMIT)
        existing.messages = messages.slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m }))
        resetCurrentFlags()
        return existing
      }
    }
    const archived = {
      id: randomUUID(),
      title,
      startedAt: messages[0]?.at ?? iso(now()),
      endedAt: messages.at(-1)?.at ?? iso(now()),
      pinned: currentPinned,
      starred: currentStarred,
      unread: currentUnread,
      archived: false,
      sessionId: harness === 'claude' ? sessionId : null,
      opencodeSessionId: harness === 'opencode' ? sessionId : null,
      summary: summary || '',
      branchTranscript: branchTranscript.slice(0, BRANCH_TRANSCRIPT_LIMIT),
      messages: messages.slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m })),
    }
    if (!archiveFits(sessions, archived.startedAt)) return ARCHIVE_FULL
    sessions.unshift(archived)
    enforceSessionLimit(sessions)
    resetCurrentFlags()
    return archived
  }

  function branchSession(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    if (pending.length > 0) return { status: 409, body: { error: SESSION_PENDING_PROBLEM } }
    const index = body?.index
    if (!Number.isInteger(index) || index < 1 || index > messages.length) {
      return { status: 400, body: { error: BRANCH_INDEX_PROBLEM } }
    }
    const kept = messages.slice(0, index).map((message) => ({ ...message }))
    const firstOwner = messages.find((message) => message.from === 'owner')
    const baseTitle = currentTitle || (firstOwner ? firstOwner.text.trim().slice(0, 60) : 'Conversation')
    const suffix = ' (branch)'
    const title = `${baseTitle.slice(0, Math.max(0, 80 - suffix.length))}${suffix}`
    if (archiveCurrentSession() === ARCHIVE_FULL) {
      return { status: 409, body: { error: SESSIONS_FULL_PROBLEM } }
    }
    branchTranscript = harness === 'claude' || harness === 'opencode' ? quotedTranscript(kept) : ''
    currentConversationId = randomUUID()
    currentSessionId = null
    currentTitle = title
    messages.length = 0
    messages.push(...kept)
    pending.length = 0
    sessionId = null
    summary = ''
    contextTokens = null
    persist()
    notify()
    return { status: 200, body: { ok: true, title, count: kept.length } }
  }

  function newSession(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    if (pending.length > 0) return { status: 409, body: { error: SESSION_PENDING_PROBLEM } }
    if (archiveCurrentSession() === ARCHIVE_FULL) {
      return { status: 409, body: { error: SESSIONS_FULL_PROBLEM } }
    }
    currentConversationId = randomUUID()
    currentSessionId = null
    currentTitle = null
    messages.length = 0
    pending.length = 0
    sessionId = null
    summary = ''
    branchTranscript = ''
    contextTokens = null
    persist()
    notify()
    return { status: 200, body: { ok: true } }
  }

  function openSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    if (pending.length > 0) return { status: 409, body: { error: SESSION_PENDING_PROBLEM } }
    const target = sessions.find((s) => s.id === sid)
    if (!target) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    if (archiveCurrentSession() === ARCHIVE_FULL) {
      return { status: 409, body: { error: SESSIONS_FULL_PROBLEM } }
    }
    currentConversationId = randomUUID()
    currentSessionId = target.id
    currentTitle = target.title
    currentPinned = target.pinned === true
    currentStarred = target.starred === true
    currentUnread = false
    target.unread = false
    target.archived = false
    messages.length = 0
    pending.length = 0
    for (const m of target.messages) {
      messages.push({ ...m })
    }
    sessionId = harness === 'opencode'
      ? (target.opencodeSessionId || target.sessionId || null)
      : (target.sessionId || target.opencodeSessionId || null)
    summary = target.summary || ''
    branchTranscript = typeof target.branchTranscript === 'string'
      ? target.branchTranscript.slice(0, BRANCH_TRANSCRIPT_LIMIT)
      : ''
    contextTokens = null
    persist()
    notify()
    return { status: 200, body: { ok: true, id: target.id } }
  }

  function updateCurrentSession(body) {
    if (
      body.pinned === undefined &&
      body.starred === undefined &&
      body.unread === undefined &&
      body.archived === undefined &&
      body.title === undefined
    ) {
      return { status: 400, body: { error: SESSION_CHANGE_PROBLEM } }
    }
    if (body.archived === true) return { status: 409, body: { error: CURRENT_SESSION_PROBLEM } }
    if (body.archived !== undefined && typeof body.archived !== 'boolean') {
      return { status: 400, body: { error: SESSION_ARCHIVED_PROBLEM } }
    }
    const record = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : null
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 80) {
        return { status: 400, body: { error: SESSION_TITLE_PROBLEM } }
      }
      const title = maskText(body.title).trim().slice(0, 80)
      currentTitle = title
      if (record) record.title = title
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') return { status: 400, body: { error: SESSION_PINNED_PROBLEM } }
      currentPinned = body.pinned
      if (record) record.pinned = body.pinned
    }
    if (body.starred !== undefined) {
      if (typeof body.starred !== 'boolean') return { status: 400, body: { error: SESSION_STARRED_PROBLEM } }
      currentStarred = body.starred
      if (record) record.starred = body.starred
    }
    if (body.unread !== undefined) {
      if (typeof body.unread !== 'boolean') return { status: 400, body: { error: SESSION_UNREAD_PROBLEM } }
      currentUnread = body.unread
      if (record) record.unread = body.unread
    }
    if (body.archived === false && record) record.archived = false
    persist()
    notify()
    return {
      status: 200,
      body: {
        id: CURRENT_SESSION_KEY,
        title: currentTitle || record?.title || '',
        pinned: currentPinned,
        starred: currentStarred,
        unread: currentUnread,
        archived: false,
      },
    }
  }

  function updateSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (sid === CURRENT_SESSION_KEY) return updateCurrentSession(body)
    const session = sessions.find((s) => s.id === sid)
    if (!session) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    if (body.archived === true && currentSessionId === sid) {
      return { status: 409, body: { error: CURRENT_SESSION_PROBLEM } }
    }
    if (
      body.pinned === undefined &&
      body.starred === undefined &&
      body.unread === undefined &&
      body.archived === undefined &&
      body.title === undefined
    ) {
      return { status: 400, body: { error: SESSION_CHANGE_PROBLEM } }
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 80) {
        return { status: 400, body: { error: SESSION_TITLE_PROBLEM } }
      }
      session.title = maskText(body.title).trim().slice(0, 80)
      if (currentSessionId === sid) currentTitle = session.title
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') return { status: 400, body: { error: SESSION_PINNED_PROBLEM } }
      session.pinned = body.pinned
    }
    if (body.starred !== undefined) {
      if (typeof body.starred !== 'boolean') return { status: 400, body: { error: SESSION_STARRED_PROBLEM } }
      session.starred = body.starred
    }
    if (body.unread !== undefined) {
      if (typeof body.unread !== 'boolean') return { status: 400, body: { error: SESSION_UNREAD_PROBLEM } }
      session.unread = body.unread
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return { status: 400, body: { error: SESSION_ARCHIVED_PROBLEM } }
      session.archived = body.archived
    }
    if (currentSessionId === sid) {
      currentTitle = session.title
      currentPinned = Boolean(session.pinned)
      currentStarred = Boolean(session.starred)
      currentUnread = Boolean(session.unread)
    }
    persist()
    notify()
    return {
      status: 200,
      body: {
        id: session.id,
        title: session.title,
        pinned: session.pinned,
        starred: session.starred,
        unread: Boolean(session.unread),
        archived: Boolean(session.archived),
      },
    }
  }

  function deleteSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (sid === CURRENT_SESSION_KEY) return { status: 409, body: { error: CURRENT_SESSION_PROBLEM } }
    const index = sessions.findIndex((s) => s.id === sid)
    if (index === -1) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    if (currentSessionId === sid) return { status: 409, body: { error: CURRENT_SESSION_PROBLEM } }
    sessions.splice(index, 1)
    persist()
    notify()
    return { status: 200, body: { ok: true } }
  }

  function getSession(sid) {
    const session = sessions.find((s) => s.id === sid)
    if (!session) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    return {
      status: 200,
      body: {
        id: session.id,
        title: session.title,
        messages: session.messages.map((m) => ({ ...m })),
      },
    }
  }

  function listSessions() {
    const sorted = [...sessions].sort((a, b) => {
      const aPinned = Boolean(a.pinned)
      const bPinned = Boolean(b.pinned)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return bTime - aTime
    })
    return sorted.map((s) => ({
      id: s.id,
      title: s.title,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      pinned: Boolean(s.pinned),
      starred: Boolean(s.starred),
      unread: Boolean(s.unread),
      archived: Boolean(s.archived),
      count: Array.isArray(s.messages) ? s.messages.length : 0,
    }))
  }

  function currentSessionInfo() {
    const firstOwner = messages.find((m) => m.from === 'owner')
    const title = currentTitle || (firstOwner ? firstOwner.text.trim().slice(0, 60) : null)
    const record = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : null
    return {
      id: CURRENT_SESSION_KEY,
      sessionId: currentConversationId,
      title,
      startedAt: messages[0]?.at ?? null,
      count: messages.length,
      pinned: record ? Boolean(record.pinned) : currentPinned,
      starred: record ? Boolean(record.starred) : currentStarred,
      unread: record ? Boolean(record.unread) : currentUnread,
    }
  }

  function getLadder() {
    return ladder
  }

  function setLadder(value) {
    ladder = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    persist()
    notify()
  }

  function getSiblings() {
    return [...siblings]
  }

  function setSiblings(list) {
    siblings = Array.isArray(list) ? [...list] : []
  }

  function onFrame(frame, preloadedRecord) {
    if (stopped) return
    if (frame?.type !== 'heartbeat.run.status') return
    const status = frame.payload?.status
    if (status !== 'succeeded' && status !== 'failed') return
    const runId = typeof frame.payload?.runId === 'string' ? frame.payload.runId : ''
    const runName = runId.startsWith('run-') ? runId.slice(4) : ''
    const record = preloadedRecord !== undefined ? preloadedRecord : recordFor(runName)
    if (record && typeof record.log === 'string' && TURN_LOG.test(basename(record.log))) return
    const laneKey = record?.lane ?? String(frame.payload?.agentId ?? '').replace(/^agent-/, '')
    if (!laneKey || laneKey === ORCHESTRATOR_KEY) return
    if (laneKey.endsWith('-session')) return
    if (!record && (!runName || laneKey.startsWith('sub-'))) return
    const recordedStarter = typeof record?.startedBy === 'string' && record.startedBy ? record.startedBy : ''
    const startedBy = recordedStarter || ORCHESTRATOR_KEY
    const isSub = key !== ORCHESTRATOR_KEY
    if (isSub) {
      if (startedBy !== key) return
    } else {
      if (startedBy !== key && (!recordedStarter || subExists(recordedStarter))) return
    }
    const named = recordedStarter ? (recordedStarter === key || (key === ORCHESTRATOR_KEY && !subExists(recordedStarter))) : false
    if (!named && !givenWork()) return
    if (named) ownsRun = true
    const logName = runName || (typeof record?.log === 'string' ? basename(record.log).replace(/\.log$/i, '') : 'run')
    const starterNote =
      recordedStarter && recordedStarter !== key && !subExists(recordedStarter)
        ? ` (started by removed sub ${recordedStarter})`
        : ''
    const first = `Run ${logName} on lane ${laneKey} ended: ${status}.${starterNote}`
    let text = record ? `${first}\n${recordLine(record)}` : first
    if (status === 'failed') {
      const candidate = typeof record?.log === 'string' && record.log ? resolve(folder, record.log) : (logName ? resolve(folder, `${logName}.log`) : '')
      const rel = candidate ? relative(folder, candidate) : ''
      const inside = Boolean(candidate && rel && !rel.startsWith('..') && !isAbsolute(rel))
      const logFile = inside ? candidate : ''
      const logContent = logFile ? readTail(logFile) : ''
      if (logContent) {
        const laneEntry = lanes && Object.hasOwn(lanes, laneKey) ? lanes[laneKey] : null
        const laneHarnessKey = laneEntry?.cli?.harness || laneEntry?.harness || laneKey
        const descriptor = (harnesses && (harnesses[laneHarnessKey] || harnesses[laneKey])) || harnessByKey[laneHarnessKey] || harnessByKey[laneKey]
        let failureRaw = descriptor?.failure ? descriptor.failure(logContent) : null
        if (!failureRaw) {
          for (const h of Object.values(harnesses ?? harnessByKey)) {
            if (typeof h?.failure === 'function') {
              const found = h.failure(logContent)
              if (found) {
                failureRaw = found
                break
              }
            }
          }
        }
        const failureMessage = cleanFailure(failureRaw)
        if (failureMessage) text = `${text}\nError: ${failureMessage}`
      }
    }
    const outside = typeof outsideFiles === 'function' ? outsideFiles(record, laneKey) : []
    if (Array.isArray(outside) && outside.length > 0) {
      text = `Outside the scope, do not merge:\n${outside.map((file) => `- ${file}`).join('\n')}\n\n${text}`
      if (typeof onOutsideScope === 'function') {
        try {
          onOutsideScope(text)
        } catch {}
      }
    }
    const prevRun = runId ? completedRuns.get(runId) : null
    if (prevRun) {
      if (prevRun.status === status) return
      const pendingIndex = pending.findIndex((item) => item.id === prevRun.messageId)
      if (pendingIndex !== -1) {
        pending.splice(pendingIndex, 1)
      }
    }
    try {
      onMessage({ from: laneKey, to: key, kind: 'wake', text })
    } catch {}
    if (directLaneTasks.has(laneKey)) {
      directLaneTasks.delete(laneKey)
      let laneReply = ''
      const replyCandidate = typeof record?.log === 'string' && record.log ? resolve(folder, record.log) : (logName ? resolve(folder, `${logName}.log`) : '')
      const replyRel = replyCandidate ? relative(folder, replyCandidate) : ''
      const replyInside = Boolean(replyCandidate && replyRel && !replyRel.startsWith('..') && !isAbsolute(replyRel))
      const replyFile = replyInside ? replyCandidate : ''
      const replyContent = replyFile ? readTail(replyFile) : ''
      if (replyContent) {
        const laneEntry = lanes && Object.hasOwn(lanes, laneKey) ? lanes[laneKey] : null
        const laneHarnessKey = laneEntry?.cli?.harness || laneEntry?.harness || laneKey
        const descriptor = (harnesses && (harnesses[laneHarnessKey] || harnesses[laneKey])) || harnessByKey[laneHarnessKey] || harnessByKey[laneKey]
        laneReply = descriptor?.reply ? descriptor.reply(replyContent).trim() : ''
        if (!laneReply) {
          try {
            laneReply = replyText(laneHarnessKey, replyContent)
          } catch {}
        }
      }
      if (!laneReply) laneReply = text
      addMessage(laneKey, laneReply)
    }
    const message = addMessage('room', text)
    pending.push(message)
    if (runId) {
      completedRuns.set(runId, { status, messageId: message.id })
      while (completedRuns.size > 200) completedRuns.delete(completedRuns.keys().next().value)
      persist()
    }
    maybeStartTurn()
  }

  function close(options = {}) {
    stopped = true
    denyApprovals(APPROVAL_NO_ANSWER)
    if (options?.removed === true) state = 'idle'
    if (roomTimer) {
      clearTimeout(roomTimer)
      roomTimer = null
    }
    if (cancelMergeCheck) {
      cancelMergeCheck()
      cancelMergeCheck = null
    }
    if (mergeCheckChild) {
      try {
        mergeCheckChild.kill()
      } catch {}
      mergeCheckChild = null
    }
    const turn = running
    if (turn) {
      turn.killed = true
      if (turn.timer) clearTimeout(turn.timer)
      killTree(turn.child)
    }
    persist()
    releaseRoomLock(lockFile)
    notify()
  }

  try {
    mkdirSync(folder, { recursive: true })
  } catch {}
  if (lockFile) takeRoomLock(lockFile)
  if (!restore()) mode = defaultMode(harness)
  persist()
  maybeStartTurn()

  return {
    answer,
    send,
    deliver,
    stop,
    commands: commandList,
    setAutocompact,
    compact,
    setModel,
    setEffort,
    setHarness,
    setMode,
    requestApproval,
    answerApproval,
    listSessions,
    currentSessionInfo,
    getSession,
    newSession,
    branchSession,
    openSession,
    updateSession,
    deleteSession,
    getLadder,
    setLadder,
    getSiblings,
    setSiblings,
    onFrame,
    close,
    token,
    addMessage,
    recordAgentMessage,
    markDirectLaneTask,
    addLaneReply: (lane, replyText) => addMessage(lane, replyText),
  }
}
