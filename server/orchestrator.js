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
import { childEnvironment, replyText, runRecord, summarizeRun } from '../src/briefs/run.js'
import { MODELS } from './models.js'
import { killTree } from './processTree.js'
import { programPath } from './programPath.js'

export const ORCHESTRATOR_KEY = 'orchestrator'
export const ORCHESTRATOR_CHAT_LIMIT = 200
export const ORCHESTRATOR_TURN_LIMIT_MS = 60 * 60 * 1000
export const ORCHESTRATOR_ROOM_TURNS = 30
export const ORCHESTRATOR_ROOM_WINDOW_MS = 60 * 60 * 1000
export const ORCHESTRATOR_MESSAGE_LIMIT = 8000
export const DEFAULT_CONTEXT_WINDOW = 200000
export const AUTOCOMPACT_SHARE = 0.8
export const DEFAULT_AUTOCOMPACT_PERCENT = 80
export const COMPACT_PROMPT =
  'Write a summary of the work so far, the open runs and the next steps, in at most 40 lines. Reply with the summary only.'
export const COMPACTED_MESSAGE = 'The session was compacted. The next turn starts a new session with the summary.'
export const CONFIRM_MESSAGE_PROBLEM = 'Confirm the message first.'
export const CONFIRM_STOP_PROBLEM = 'Confirm the stop first.'
export const CONFIRM_AUTOCOMPACT_PROBLEM = 'Confirm the autocompact change first.'
export const CONFIRM_COMPACT_PROBLEM = 'Confirm the compact first.'
export const CONFIRM_MODEL_PROBLEM = 'Confirm the model change first.'
export const AUTOCOMPACT_PROBLEM = 'Say whether autocompact is on or off.'
export const AUTOCOMPACT_PERCENT_PROBLEM = 'Percent must be a whole number from 50 to 95.'
export const COMPACT_RUNNING_PROBLEM = 'A turn is already running.'
export const NO_SESSION_PROBLEM = 'The orchestrator has no session yet.'
export const COMPACT_KEEP_LIMIT = 2000
export const COMPACT_KEEP_PROBLEM = 'Write at most 2000 characters to keep.'
export const MODEL_PROBLEM = 'Choose a model listed for this harness.'
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

function fallbackPrompt(projectRoot, runsFolder) {
  return [
    `You are the orchestrator for the project at ${projectRoot}, talking to its owner through MachineRoom.`,
    "Read the project's agent guide before you plan, split the work into tasks for the lane runner, and check each branch before you merge it.",
    `Never push, never print a key, and keep your task files in ${runsFolder}.`,
  ].join(' ')
}

function instructionFor(file, projectRoot, runsFolder, bridgeUrl, token = '') {
  const text = readText(file).trim()
  const source = text || fallbackPrompt(projectRoot, runsFolder)
  let resolved = source
    .replaceAll('{{PROJECT}}', projectRoot)
    .replaceAll('{{MACHINEROOM}}', REPO_ROOT)
    .replaceAll('{{RUNS}}', runsFolder)
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

export function compactPrompt(keep = '') {
  const text = typeof keep === 'string' ? keep.trim() : ''
  if (!text) return COMPACT_PROMPT
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
  outsideFiles = null,
  onOutsideScope = null,
  contextWindow: contextWindowOption = 0,
  token: tokenOption = '',
} = {}) {
  const token = typeof tokenOption === 'string' && tokenOption ? tokenOption : randomBytes(24).toString('base64url')
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const key = String(id) === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : String(id)
  const logPrefix = key === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : `sub-${key}`
  const lockFile = key === ORCHESTRATOR_KEY ? chatLockFileFor(root, folder) : null
  const laneEntry = lanes && Object.hasOwn(lanes, ORCHESTRATOR_KEY) ? lanes[ORCHESTRATOR_KEY] : null
  const lane = laneEntry?.cli ? laneEntry : DEFAULT_LANE
  const harness =
    harnessOption === 'opencode' || harnessOption === 'claude'
      ? harnessOption
      : String(lane.cli.harness ?? 'claude') === 'opencode'
        ? 'opencode'
        : 'claude'
  let model = modelOption ? String(modelOption) : String(lane.cli.model ?? (harness === 'opencode' ? DEFAULT_OPENCODE_MODEL : 'opus'))
  const bin = binOption ? String(binOption) : String(lane.cli.bin ?? (harness === 'opencode' ? 'opencode' : 'claude'))
  const windowOption = Number.isFinite(contextWindowOption) && contextWindowOption > 0
    ? Math.round(contextWindowOption)
    : Number.isFinite(lane.cli.contextWindow) && lane.cli.contextWindow > 0
      ? Math.round(lane.cli.contextWindow)
      : 0
  const conversationFile = chatFileFor(root, folder, key)
  const messages = []
  const pending = []
  const roomTurns = []
  let ladder = null
  let sessionId = null
  let state = 'idle'
  let running = null
  let stopped = false
  let contextTokens = null
  let contextWindow = windowOption || DEFAULT_CONTEXT_WINDOW
  let autocompact = true
  let autocompactPercent = DEFAULT_AUTOCOMPACT_PERCENT
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
        sessionId,
        state,
        model,
        messages,
        pending: waiting,
        roomTurns,
        contextTokens,
        contextWindow,
        autocompact,
        autocompactPercent,
        summary,
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
    if (typeof saved.model === 'string' && saved.model.trim() !== '') model = saved.model.trim()
    if (saved.state === 'working') state = 'idle'
    if (saved.state === 'paused') state = 'paused'
    if (saved.ladder && typeof saved.ladder === 'object' && !Array.isArray(saved.ladder)) ladder = saved.ladder
    if (typeof saved.autocompact === 'boolean') autocompact = saved.autocompact
    if (
      typeof saved.autocompactPercent === 'number' &&
      Number.isInteger(saved.autocompactPercent) &&
      saved.autocompactPercent >= 50 &&
      saved.autocompactPercent <= 95
    ) {
      autocompactPercent = saved.autocompactPercent
    }
    if (typeof saved.contextTokens === 'number' && Number.isFinite(saved.contextTokens) && saved.contextTokens >= 0) {
      contextTokens = Math.round(saved.contextTokens)
    }
    if (!windowOption && typeof saved.contextWindow === 'number' && Number.isFinite(saved.contextWindow) && saved.contextWindow > 0) {
      contextWindow = Math.round(saved.contextWindow)
    }
    if (typeof saved.summary === 'string' && saved.summary.trim() !== '') summary = saved.summary.trim()
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
    const hasOwner = pending.some((message) => message.from === 'owner')
    if (!hasOwner) {
      if (!sessionId) return
      if (!roomTurnAllowed()) return
    }
    startTurn()
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
    if (carried) summary = ''
    const startedAt = now()
    const logName = `${logPrefix}-chat-${stamp(startedAt)}`
    const logPath = join(folder, `${logName}.log`)
    const metaPath = join(folder, `${logName}.meta.json`)
    const turn = { startedAt, logPath, metaPath, killed: false, done: false, child: null, timer: null, compacting: compaction }
    running = turn
    setState('working')
    try {
      mkdirSync(folder, { recursive: true })
      writeFileSync(metaPath, `${JSON.stringify({ project: root, sessionId })}\n`)
    } catch {
      running = null
      addMessage('orchestrator', STOPPED_REPLY)
      setState('idle')
      return
    }
    const message = compaction ? compactPrompt(keepText) : turnText(turnMessages)
    const baseInstruction = instructionFor(
      promptFile,
      root,
      folder,
      String((typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl) ?? ''),
      token
    )
    const instruction = extraInstructions ? `${baseInstruction}\n\n${extraInstructions}` : baseInstruction
    let args
    if (harness === 'opencode') {
      args = ['run', '--format', 'json', '--model', model, '--auto', '--title', logName]
      if (!first) args.push('--session', sessionId)
      const body = first ? `${instruction}\n\n${message}` : message
      args.push(carried ? `${carried}\n\n${body}` : body)
    } else {
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
      child = spawnChild(spawnChild === spawn ? programFor(bin) : bin, args, {
        cwd: root,
        shell: false,
        env: childEnvironment(process.env, root),
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
    const logText = readText(turn.logPath)
    const runStats = summarizeRun({ harness, log: logText })
    const report = replyText(harness, logText)
    if (harness === 'opencode') {
      const savedSessionId = opencodeSessionId(logText)
      if (savedSessionId) {
        sessionId = savedSessionId
        try {
          writeFileSync(turn.metaPath, `${JSON.stringify({ project: root, sessionId })}\n`)
        } catch {}
      }
    }
    const seen = contextTokensFromLog(harness, logText)
    if (seen !== null) contextTokens = seen
    const failed = turn.killed || Boolean(error) || !Number.isInteger(code) || code !== 0
    const text = failed
      ? Number.isInteger(code)
        ? report && !turn.killed
          ? `The orchestrator stopped: ${report}`
          : `The orchestrator stopped: exit ${code}.`
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
    if (autocompact && sessionId && contextTokens !== null && contextTokens / contextWindow >= autocompactPercent / 100) {
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
      autocompactPercent,
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
    if (body.on === undefined && body.percent === undefined) {
      return { status: 400, body: { error: AUTOCOMPACT_PROBLEM } }
    }
    if (body.on !== undefined && typeof body.on !== 'boolean') {
      return { status: 400, body: { error: AUTOCOMPACT_PROBLEM } }
    }
    if (body.percent !== undefined) {
      if (typeof body.percent !== 'number' || !Number.isInteger(body.percent) || body.percent < 50 || body.percent > 95) {
        return { status: 400, body: { error: AUTOCOMPACT_PERCENT_PROBLEM } }
      }
    }
    if (typeof body.on === 'boolean') autocompact = body.on
    if (body.percent !== undefined) autocompactPercent = body.percent
    persist()
    notify()
    return { status: 200, body: { id: key, autocompact, autocompactPercent } }
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
    const allowed = MODELS.some((item) => item.id === nextModel && item.harness === harness)
    if (!allowed) return { status: 400, body: { error: MODEL_PROBLEM } }
    model = nextModel
    persist()
    notify()
    return { status: 200, body: { id: key, model } }
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
    if (!sessionId || state === 'paused') return
    const logName = runName || (typeof record?.log === 'string' ? basename(record.log).replace(/\.log$/i, '') : 'run')
    const first = `Run ${logName} on lane ${laneKey} ended: ${status}.`
    let text = record ? `${first}\n${recordLine(record)}` : first
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

  return { answer, send, deliver, stop, setAutocompact, compact, setModel, getLadder, setLadder, onFrame, close, token }
}
