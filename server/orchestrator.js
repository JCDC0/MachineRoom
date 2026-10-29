import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskKeys } from '../src/briefs/audit.js'
import { childEnvironment, mcpConfigForClaude, mcpConfigForOpencode, normalizeMcpServers, replyText, runRecord, summarizeRun } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { harnessUnavailableProblem, isHarnessAvailable, modelUnavailableProblem } from './agents-config.js'
import { readEndpoints } from './endpoints.js'
import { modelAllowed } from './harness-models.js'
import { DEFAULT_CONTEXT_WINDOW, MODELS, resolveContextWindow } from './models.js'
import { killTree } from './processTree.js'
import { programPath } from './programPath.js'

export const ORCHESTRATOR_KEY = 'orchestrator'
export const ORCHESTRATOR_CHAT_LIMIT = 200
export const ORCHESTRATOR_TURN_LIMIT_MS = 60 * 60 * 1000
export const ORCHESTRATOR_ROOM_TURNS = 30
export const ORCHESTRATOR_ROOM_WINDOW_MS = 60 * 60 * 1000
export const ORCHESTRATOR_MESSAGE_LIMIT = 8000
export { DEFAULT_CONTEXT_WINDOW } from './models.js'
export const AUTOCOMPACT_SHARE = 0.8
export const DEFAULT_AUTOCOMPACT_MODE = 'percent'
export const DEFAULT_AUTOCOMPACT_VALUE = 80
export const DEFAULT_AUTOCOMPACT_PERCENT = 80
export const COMPACT_RULES_LIMIT = 2000
export const CONFIRM_HARNESS_PROBLEM = 'Confirm the harness change first.'
export const DEFAULT_COMPACT_RULES =
  "keep the owner's goals and standing rules in the owner's words, the decisions made and why, each lane run started with its branch and result, the files changed, what is unfinished or blocked, and the next steps; leave out tool output, logs and work already merged and checked."
export const COMPACT_PROMPT =
  'Write a summary of the work so far, the open runs and the next steps, in at most 40 lines. Reply with the summary only.'
export const COMPACTED_MESSAGE = 'The session was compacted. The next turn starts a new session with the summary.'
export const CONFIRM_MESSAGE_PROBLEM = 'Confirm the message first.'
export const CONFIRM_STOP_PROBLEM = 'Confirm the stop first.'
export const CONFIRM_AUTOCOMPACT_PROBLEM = 'Confirm the autocompact change first.'
export const CONFIRM_COMPACT_PROBLEM = 'Confirm the compact first.'
export const CONFIRM_MODEL_PROBLEM = 'Confirm the model change first.'
export const AUTOCOMPACT_PROBLEM = 'Say whether autocompact is on or off.'
export const AUTOCOMPACT_MODE_PROBLEM = 'Mode must be percent or tokens.'
export const AUTOCOMPACT_PERCENT_PROBLEM = 'Percent must be a number above 0 and at most 100.'
export const AUTOCOMPACT_TOKENS_PROBLEM = 'Tokens must be a whole number from 1000 to 10000000.'
export const AUTOCOMPACT_RULES_PROBLEM = 'Compact rules must be at most 2000 characters.'
export const COMPACT_RUNNING_PROBLEM = 'A turn is already running.'
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
export const SESSION_CHANGE_PROBLEM = 'Choose a field to change: pinned, starred or title.'
export const SESSIONS_LIMIT = 50
export const SESSION_MESSAGES_LIMIT = 200
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const OPENCODE_EFFORT_LEVELS = ['low', 'medium', 'high', 'max']
export const NO_PROJECT_PROBLEM = 'The bridge has no project folder, so the orchestrator has nothing to work on.'
export const MESSAGE_PROBLEM = 'Write a message from 1 to 8000 characters.'
export const EMPTY_REPLY = 'The orchestrator ended its turn without a reply.'
export const STOPPED_REPLY = 'The orchestrator stopped.'
export const RESTART_MESSAGE = 'The room restarted during a turn. Send the message again if it still matters.'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const PROMPT_FILE = join(REPO_ROOT, 'docs', 'agents', 'ORCHESTRATOR-AGENT.md')
const PROMPT_LIMIT = 20000
const RECORD_COMMITS = 10
const TURN_LOG = /-chat-\d{8}-\d{6}-\d{3}\.log$/i
const DEFAULT_LANE = { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } }
const DEFAULT_OPENCODE_MODEL = 'opencode/deepseek-v4.1-flash-free'
const VARIABLE = /%([^%]+)%/g

function runsFolderDefault() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs')
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

function cleanFailure(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const safe = maskKeys(raw).text.trim()
  if (!safe) return null
  return safe.length > 300 ? safe.slice(0, 300) : safe
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

function roomLockProblem(holder, path) {
  return `Another room is already running on this project (process ${holder}). Wait for it to end, or delete ${path} if no room is going.`
}

function takeRoomLock(path) {
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
    if (processAlive(holder)) throw new Error(roomLockProblem(holder, path))
    rmSync(takeover, { force: true })
  }
  if (existsSync(takeover)) clearTakeover()
  if (take(path)) return path
  const holderText = readHolder(path)
  const holder = Number.parseInt(holderText, 10)
  if (processAlive(holder)) throw new Error(roomLockProblem(holder, path))
  let mine = take(takeover)
  if (!mine) {
    clearTakeover()
    mine = take(takeover)
    if (!mine) throw new Error(roomLockProblem(Number.parseInt(readHolder(path), 10), path))
  }
  try {
    const current = readHolder(path)
    if (current !== holderText) throw new Error(roomLockProblem(Number.parseInt(current, 10) || holder, path))
    if (processAlive(holder)) throw new Error(roomLockProblem(holder, path))
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

export function contextTokensFromLog(harness, log) {
  let found = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (harness === 'opencode') {
      if (item?.type !== 'step_finish') continue
      const tokens = item?.part?.tokens
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) continue
      const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}
      const sum = tokenSum([tokens.input, cache.read, cache.write])
      if (sum !== null) found = sum
      continue
    }
    if (item?.type !== 'result' || item.parent_tool_use_id) continue
    const usage = item?.usage && typeof item.usage === 'object' ? item.usage : {}
    const sum = tokenSum([usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens])
    if (sum !== null) found = sum
  }
  return found
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

function turnText(messages) {
  if (messages.length === 1 && messages[0].from === 'owner') return messages[0].text
  const blocks = []
  let size = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const block = blockFor(messages[index])
    if (blocks.length > 0 && size + block.length + 2 > PROMPT_LIMIT) break
    blocks.unshift(block)
    size += block.length + 2
  }
  return blocks.join('\n\n')
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
  harnesses = harnessByKey,
} = {}) {
  const token = typeof tokenOption === 'string' && tokenOption ? tokenOption : randomBytes(24).toString('base64url')
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
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
  const windowOption = Number.isFinite(contextWindowOption) && contextWindowOption > 0
    ? Math.round(contextWindowOption)
    : Number.isFinite(lane.cli.contextWindow) && lane.cli.contextWindow > 0
      ? Math.round(lane.cli.contextWindow)
      : 0
  const conversationFile = chatFileFor(root, folder, key)
  const scratchFolder = join(folder, `scratch-${key}`)
  const messages = []
  const pending = []
  const roomTurns = []
  let ladder = null
  let sessionId = null
  let tokenSent = false
  let state = 'idle'
  let running = null
  let stopped = false
  let contextTokens = null
  let contextWindow = resolveContextWindow(model, harness, windowOption)
  let autocompact = true
  let autocompactMode = DEFAULT_AUTOCOMPACT_MODE
  let autocompactValue = DEFAULT_AUTOCOMPACT_VALUE
  let compactRules = ''
  let effort = null
  let currentSessionId = null
  let currentTitle = null
  const sessions = []
  let summary = ''
  let pendingCompaction = null

  function notify() {
    try {
      onNotice({ topic: 'orchestrator' })
    } catch {}
  }

  function maskText(text) {
    const safe = maskKeys(text)
    if (safe.count > 0) {
      try {
        onMasked(safe.count)
      } catch {}
    }
    return safe.text
  }

  function persist() {
    try {
      mkdirSync(folder, { recursive: true })
      const waiting = pending.filter((message) => message.from === 'owner').map((message) => message.id)
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
        currentSessionId,
        currentTitle,
        summary,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          pinned: Boolean(s.pinned),
          starred: Boolean(s.starred),
          sessionId: s.sessionId ?? null,
          opencodeSessionId: s.opencodeSessionId ?? null,
          summary: s.summary ?? '',
          messages: (Array.isArray(s.messages) ? s.messages : []).slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m })),
        })),
        ...(ladder ? { ladder } : {}),
      }
      const temporary = `${conversationFile}.tmp`
      writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`)
      renameSync(temporary, conversationFile)
    } catch {}
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
      return
    }
    let saved
    try {
      saved = JSON.parse(text)
    } catch {
      quarantine()
      return
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      quarantine()
      return
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
      compactRules = saved.compactRules.slice(0, COMPACT_RULES_LIMIT)
    }
    if (typeof saved.contextTokens === 'number' && Number.isFinite(saved.contextTokens) && saved.contextTokens >= 0) {
      contextTokens = Math.round(saved.contextTokens)
    }
    contextWindow = resolveContextWindow(model, harness, windowOption)
    if (!MODELS.some((m) => m.id === model) && typeof saved.contextWindow === 'number' && Number.isFinite(saved.contextWindow) && saved.contextWindow > 0) {
      contextWindow = Math.round(saved.contextWindow)
    }
    if (typeof saved.summary === 'string' && saved.summary.trim() !== '') summary = saved.summary.trim()
    if (saved.effort === null || typeof saved.effort === 'string') {
      const allowed = harness === 'claude' ? CLAUDE_EFFORT_LEVELS : OPENCODE_EFFORT_LEVELS
      if (saved.effort === null || allowed.includes(saved.effort.trim())) {
        effort = saved.effort ? saved.effort.trim() : null
      }
    }
    if (typeof saved.currentSessionId === 'string' && saved.currentSessionId.trim() !== '') {
      currentSessionId = saved.currentSessionId.trim()
    }
    if (typeof saved.currentTitle === 'string' && saved.currentTitle.trim() !== '') {
      currentTitle = saved.currentTitle.trim()
    }
    if (Array.isArray(saved.sessions)) {
      for (const item of saved.sessions) {
        if (!item || typeof item !== 'object') continue
        if (typeof item.id !== 'string' || !item.id) continue
        const itemMessages = []
        if (Array.isArray(item.messages)) {
          for (const msg of item.messages) {
            if (!msg || typeof msg !== 'object') continue
            const from = typeof msg.from === 'string' ? msg.from : ''
            if (!['owner', 'orchestrator', 'room'].includes(from) && !from.startsWith('sub:')) continue
            if (typeof msg.text !== 'string' || msg.text.trim() === '') continue
            itemMessages.push({
              id: typeof msg.id === 'string' && msg.id ? msg.id : randomUUID(),
              from,
              text: maskText(msg.text),
              at: typeof msg.at === 'string' && msg.at ? msg.at : iso(now()),
            })
          }
        }
        sessions.push({
          id: item.id,
          title: typeof item.title === 'string' ? item.title.slice(0, 80) : '',
          startedAt: typeof item.startedAt === 'string' ? item.startedAt : iso(now()),
          endedAt: typeof item.endedAt === 'string' ? item.endedAt : iso(now()),
          pinned: Boolean(item.pinned),
          starred: Boolean(item.starred),
          sessionId: typeof item.sessionId === 'string' ? item.sessionId : null,
          opencodeSessionId: typeof item.opencodeSessionId === 'string' ? item.opencodeSessionId : null,
          summary: typeof item.summary === 'string' ? item.summary : '',
          messages: itemMessages.slice(-SESSION_MESSAGES_LIMIT),
        })
      }
      enforceSessionLimit(sessions)
    }
    const list = Array.isArray(saved.messages) ? saved.messages : []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const from = typeof item.from === 'string' ? item.from : ''
      if (!['owner', 'orchestrator', 'room'].includes(from) && !from.startsWith('sub:')) continue
      if (typeof item.text !== 'string' || item.text.trim() === '') continue
      messages.push({
        id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
        from,
        text: maskText(item.text),
        at: typeof item.at === 'string' && item.at ? item.at : iso(now()),
      })
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
      const message = messages.find((item) => item.id === id && item.from === 'owner')
      if (message && !pending.includes(message)) pending.push(message)
    }
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

  function records() {
    const list = []
    for (const line of readText(join(folder, 'runs.jsonl')).split(/\r?\n/)) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record && typeof record === 'object') list.push(record)
    }
    return list
  }

  function recordFor(runName) {
    if (!runName) return null
    const wanted = pathKey(join(folder, `${runName}.log`))
    let found = null
    for (const record of records()) {
      if (typeof record.log !== 'string' || !record.log) continue
      if (pathKey(record.log) === wanted) found = record
    }
    return found
  }

  function roomTurnAllowed() {
    const cutoff = now() - ORCHESTRATOR_ROOM_WINDOW_MS
    while (roomTurns.length > 0 && roomTurns[0] <= cutoff) roomTurns.shift()
    return roomTurns.length < ORCHESTRATOR_ROOM_TURNS
  }

  function maybeStartTurn() {
    if (stopped || running || state === 'paused') return
    if (pendingCompaction) {
      startTurn()
      return
    }
    if (pending.length === 0) return
    const ordered = pending.some((message) => message.from === 'owner' || (key !== ORCHESTRATOR_KEY && message.from === ORCHESTRATOR_KEY))
    if (!ordered) {
      if (!givenWork()) return
      if (!roomTurnAllowed()) return
    }
    startTurn()
  }

  function givenWork() {
    if (sessionId) return true
    return messages.some((message) => message.from === 'owner' || (key !== ORCHESTRATOR_KEY && message.from === ORCHESTRATOR_KEY))
  }

  function startTurn(options = null) {
    const manualCompacting = Boolean(options?.compacting)
    const keepText = manualCompacting ? (options.keep || '') : (pendingCompaction?.keep || '')
    const compaction = manualCompacting || Boolean(pendingCompaction)
    pendingCompaction = null
    const turnMessages = compaction ? [] : pending.splice(0, pending.length)
    const hasOwner = turnMessages.some((message) => message.from === 'owner')
    if (!hasOwner) roomTurns.push(now())
    const first = !sessionId
    if (first && harness === 'claude') sessionId = randomUUID()
    const carried = first && summary ? summary : ''
    if (carried && (harness === 'claude' || harness === 'opencode')) summary = ''
    const startedAt = now()
    const logName = `${logPrefix}-chat-${stamp(startedAt)}`
    const logPath = join(folder, `${logName}.log`)
    const metaPath = join(folder, `${logName}.meta.json`)
    const enabledServers = enabledMcpServersFor(folder)
    const needsMcp = enabledServers.length > 0 && (harness === 'claude' || harness === 'opencode')
    const mcpConfigPath = needsMcp ? join(folder, `${logName}.mcp.json`) : ''
    let mcpEnv = null
    const turn = { startedAt, logPath, metaPath, mcpConfigPath, killed: false, done: false, child: null, timer: null, compacting: compaction }
    running = turn
    setState('working')
    try {
      mkdirSync(folder, { recursive: true })
      mkdirSync(scratchFolder, { recursive: true })
      writeFileSync(metaPath, `${JSON.stringify({ project: root, sessionId })}\n`)
      if (needsMcp) {
        if (harness === 'claude') {
          writeFileSync(mcpConfigPath, `${JSON.stringify(mcpConfigForClaude(enabledServers), null, 2)}\n`, { mode: 0o600 })
        } else if (harness === 'opencode') {
          writeFileSync(mcpConfigPath, `${JSON.stringify(mcpConfigForOpencode(enabledServers), null, 2)}\n`, { mode: 0o600 })
          mcpEnv = { OPENCODE_CONFIG: mcpConfigPath }
        }
      }
    } catch {
      if (mcpConfigPath) {
        try {
          rmSync(mcpConfigPath, { force: true })
        } catch {}
      }
      running = null
      addMessage('orchestrator', STOPPED_REPLY)
      setState('idle')
      return
    }
    const message = compaction ? compactPrompt(keepText, compactRules) : turnText(turnMessages)
    const baseInstruction = instructionFor(
      promptFile,
      root,
      folder,
      String((typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl) ?? ''),
      token,
      scratchFolder
    )
    const instruction = extraInstructions ? `${baseInstruction}\n\n${extraInstructions}` : baseInstruction
    let program = binFor(harness)
    let args
    if (harness === 'opencode') {
      const modelArg = effort ? `${model}#${effort}` : model
      args = ['run', '--format', 'json', '--model', modelArg, '--auto', '--title', logName]
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
        '--dangerously-skip-permissions',
        first ? '--session-id' : '--resume',
        sessionId,
        '--append-system-prompt',
        instruction,
      ]
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
      stream.end(() => completeTurn(turn, code, error))
    }
    let child
    try {
      child = spawnChild(spawnChild === spawn ? programFor(program) : program, args, {
        cwd: root,
        shell: false,
        env: childEnvironment(process.env, root, { harness, extra: mcpEnv }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish(null, error)
      return
    }
    turn.child = child
    child.stdout?.pipe(stream, { end: false })
    child.stderr?.on('data', () => {})
    child.once('error', (error) => finish(null, error))
    child.once('close', (code) => finish(code, null))
  }

  function completeTurn(turn, code, error) {
    if (turn.done) return
    turn.done = true
    if (turn.timer) clearTimeout(turn.timer)
    if (turn.mcpConfigPath) {
      try {
        rmSync(turn.mcpConfigPath, { force: true })
      } catch {}
    }
    const logText = readText(turn.logPath)
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
    const failed = turn.killed || Boolean(error) || !Number.isInteger(code) || code !== 0
    const text = failed
      ? Number.isInteger(code)
        ? report && !turn.killed
          ? `The orchestrator stopped: ${report}`
          : failureMessage
            ? `The orchestrator stopped: ${failureMessage}`
            : `The orchestrator stopped: exit ${code}.`
        : failureMessage
          ? `The orchestrator stopped: ${failureMessage}`
          : STOPPED_REPLY
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
    addMessage('orchestrator', text)
    if (!turn.compacting && typeof onReply === 'function') {
      try {
        onReply(text)
      } catch {}
    }
    if (turn.compacting) {
      summary = failed ? '' : String(report ?? '').trim()
      sessionId = null
      contextTokens = null
      if (!stopped) setState(state === 'paused' ? 'paused' : 'idle')
      addMessage('room', COMPACTED_MESSAGE)
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
      messages: messages.map((message) => ({ ...message })),
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
    return { status: 202, body: { id: message.id } }
  }

  function deliver(from, text) {
    if (stopped) return null
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) return null
    const message = addMessage(from, value)
    pending.push(message)
    maybeStartTurn()
    return message
  }

  function stop(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_STOP_PROBLEM } }
    if (!root) return { status: 409, body: { error: NO_PROJECT_PROBLEM } }
    if (running && !running.done) {
      running.killed = true
      killTree(running.child)
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

    if (body.rules !== undefined && body.rules !== null) {
      if (typeof body.rules !== 'string' || body.rules.length > COMPACT_RULES_LIMIT) {
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
      compactRules = body.rules === null ? '' : body.rules
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
    const nextModel = typeof body?.model === 'string' ? body.model.trim() : ''
    if (!nextModel) return { status: 400, body: { error: MODEL_PROBLEM } }
    const allowed = modelAllowed(harness, nextModel, folder)
    if (!allowed) return { status: 400, body: { error: MODEL_PROBLEM } }
    model = nextModel
    contextWindow = resolveContextWindow(model, harness, windowOption)
    persist()
    notify()
    return { status: 200, body: { id: key, model } }
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
    harness = nextHarness
    model = nextModel
    sessionId = null
    for (const s of sessions) {
      s.sessionId = null
      s.opencodeSessionId = null
    }
    contextWindow = resolveContextWindow(model, harness, windowOption)
    persist()
    notify()
    return { status: 200, body: answer() }
  }

  function setEffort(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_EFFORT_PROBLEM } }
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
    const hasOwner = messages.some((m) => m.from === 'owner')
    if (!hasOwner) return null
    const firstOwner = messages.find((m) => m.from === 'owner')
    const defaultTitle = firstOwner.text.trim().slice(0, 60)
    const title = currentTitle || defaultTitle
    if (currentSessionId) {
      const existing = sessions.find((s) => s.id === currentSessionId)
      if (existing) {
        existing.title = title
        existing.endedAt = messages.at(-1)?.at ?? iso(now())
        existing.sessionId = harness === 'claude' ? sessionId : null
        existing.opencodeSessionId = harness === 'opencode' ? sessionId : null
        existing.summary = summary || ''
        existing.messages = messages.slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m }))
        return existing
      }
    }
    const archived = {
      id: randomUUID(),
      title,
      startedAt: messages[0]?.at ?? iso(now()),
      endedAt: messages.at(-1)?.at ?? iso(now()),
      pinned: false,
      starred: false,
      sessionId: harness === 'claude' ? sessionId : null,
      opencodeSessionId: harness === 'opencode' ? sessionId : null,
      summary: summary || '',
      messages: messages.slice(-SESSION_MESSAGES_LIMIT).map((m) => ({ ...m })),
    }
    sessions.unshift(archived)
    enforceSessionLimit(sessions)
    return archived
  }

  function newSession(body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    archiveCurrentSession()
    currentSessionId = null
    currentTitle = null
    messages.length = 0
    pending.length = 0
    sessionId = null
    summary = ''
    contextTokens = null
    persist()
    notify()
    return { status: 200, body: { ok: true } }
  }

  function openSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    if (running && !running.done) return { status: 409, body: { error: COMPACT_RUNNING_PROBLEM } }
    const target = sessions.find((s) => s.id === sid)
    if (!target) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    archiveCurrentSession()
    currentSessionId = target.id
    currentTitle = target.title
    messages.length = 0
    pending.length = 0
    for (const m of target.messages) {
      messages.push({ ...m })
    }
    sessionId = harness === 'opencode'
      ? (target.opencodeSessionId || target.sessionId || null)
      : (target.sessionId || target.opencodeSessionId || null)
    summary = target.summary || ''
    contextTokens = null
    persist()
    notify()
    return { status: 200, body: { ok: true, id: target.id } }
  }

  function updateSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    const session = sessions.find((s) => s.id === sid)
    if (!session) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    if (body.pinned === undefined && body.starred === undefined && body.title === undefined) {
      return { status: 400, body: { error: SESSION_CHANGE_PROBLEM } }
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 80) {
        return { status: 400, body: { error: SESSION_TITLE_PROBLEM } }
      }
      session.title = body.title.trim()
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
    persist()
    notify()
    return { status: 200, body: { id: session.id, title: session.title, pinned: session.pinned, starred: session.starred } }
  }

  function deleteSession(sid, body) {
    if (body?.confirmed !== true) return { status: 400, body: { error: CONFIRM_SESSION_PROBLEM } }
    const index = sessions.findIndex((s) => s.id === sid)
    if (index === -1) return { status: 404, body: { error: NO_SESSION_ID_PROBLEM } }
    sessions.splice(index, 1)
    if (currentSessionId === sid) {
      currentSessionId = null
      currentTitle = null
    }
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
      count: Array.isArray(s.messages) ? s.messages.length : 0,
    }))
  }

  function currentSessionInfo() {
    const firstOwner = messages.find((m) => m.from === 'owner')
    const title = currentTitle || (firstOwner ? firstOwner.text.trim().slice(0, 60) : null)
    return {
      title,
      startedAt: messages[0]?.at ?? null,
      count: messages.length,
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

  function onFrame(frame) {
    if (stopped) return
    if (frame?.type !== 'heartbeat.run.status') return
    const status = frame.payload?.status
    if (status !== 'succeeded' && status !== 'failed') return
    const runId = typeof frame.payload?.runId === 'string' ? frame.payload.runId : ''
    const runName = runId.startsWith('run-') ? runId.slice(4) : ''
    const record = recordFor(runName)
    if (record && typeof record.log === 'string' && TURN_LOG.test(basename(record.log))) return
    const laneKey = record?.lane ?? String(frame.payload?.agentId ?? '').replace(/^agent-/, '')
    if (!laneKey || laneKey === ORCHESTRATOR_KEY) return
    if (!record && laneKey.startsWith('sub-')) return
    const startedBy = typeof record?.startedBy === 'string' && record.startedBy ? record.startedBy : ORCHESTRATOR_KEY
    if (startedBy !== key) return
    if (!givenWork() || state === 'paused') return
    try {
      onMessage({ from: laneKey, to: key, kind: 'wake' })
    } catch {}
    const logName = runName || (typeof record?.log === 'string' ? basename(record.log).replace(/\.log$/i, '') : 'run')
    const first = `Run ${logName} on lane ${laneKey} ended: ${status}.`
    let text = record ? `${first}\n${recordLine(record)}` : first
    if (status === 'failed') {
      const logFile = typeof record?.log === 'string' && record.log ? resolve(folder, record.log) : (logName ? join(folder, `${logName}.log`) : '')
      const logContent = logFile ? readText(logFile) : ''
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
    const message = addMessage('room', text)
    pending.push(message)
    maybeStartTurn()
  }

  function close() {
    stopped = true
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
  restore()
  persist()
  maybeStartTurn()

  return {
    answer,
    send,
    deliver,
    stop,
    setAutocompact,
    compact,
    setModel,
    setEffort,
    setHarness,
    listSessions,
    currentSessionInfo,
    getSession,
    newSession,
    openSession,
    updateSession,
    deleteSession,
    getLadder,
    setLadder,
    onFrame,
    close,
    token,
  }
}
