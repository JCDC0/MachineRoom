import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { childEnvironment, claudeReport, runRecord } from '../src/briefs/run.js'
import { killTree } from './processTree.js'
import { programPath } from './programPath.js'

export const ORCHESTRATOR_KEY = 'orchestrator'
export const ORCHESTRATOR_CHAT_LIMIT = 200
export const ORCHESTRATOR_TURN_LIMIT_MS = 60 * 60 * 1000
export const ORCHESTRATOR_ROOM_TURNS = 30
export const ORCHESTRATOR_ROOM_WINDOW_MS = 60 * 60 * 1000
export const ORCHESTRATOR_MESSAGE_LIMIT = 8000
export const CONFIRM_MESSAGE_PROBLEM = 'Confirm the message first.'
export const CONFIRM_STOP_PROBLEM = 'Confirm the stop first.'
export const NO_PROJECT_PROBLEM = 'The bridge has no project folder, so the orchestrator has nothing to work on.'
export const MESSAGE_PROBLEM = 'Write a message from 1 to 8000 characters.'
export const EMPTY_REPLY = 'The orchestrator ended its turn without a reply.'
export const STOPPED_REPLY = 'The orchestrator stopped.'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const PROMPT_FILE = join(REPO_ROOT, 'docs', 'agents', 'ORCHESTRATOR-AGENT.md')
const PROMPT_LIMIT = 20000
const RECORD_COMMITS = 10
const DEFAULT_LANE = { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } }

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

function projectHash(projectRoot) {
  const key = projectRoot ? pathKey(projectRoot) : ''
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

function fallbackPrompt(projectRoot, runsFolder) {
  return [
    `You are the orchestrator for the project at ${projectRoot}, talking to its owner through MachineRoom.`,
    "Read the project's agent guide before you plan, split the work into tasks for the lane runner, and check each branch before you merge it.",
    `Never push, never print a key, and keep your task files in ${runsFolder}.`,
  ].join(' ')
}

function instructionFor(file, projectRoot, runsFolder, bridgeUrl) {
  const text = readText(file).trim()
  const source = text || fallbackPrompt(projectRoot, runsFolder)
  return source
    .replaceAll('{{PROJECT}}', projectRoot)
    .replaceAll('{{MACHINEROOM}}', REPO_ROOT)
    .replaceAll('{{RUNS}}', runsFolder)
    .replaceAll('{{BRIDGE}}', bridgeUrl)
}

// A bare name is looked up on PATH, so Windows never runs a claude.exe that sits in the project folder.
function programFor(bin) {
  if (/[\/]/.test(bin)) return bin
  return programPath(bin) ?? bin
}

function costOf(log) {
  let cost = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'result' || item.parent_tool_use_id) continue
    if (typeof item.total_cost_usd === 'number' && Number.isFinite(item.total_cost_usd)) cost = item.total_cost_usd
  }
  return cost
}

function blockFor(message) {
  const label = message.from === 'owner' ? 'Owner' : message.from === 'room' ? 'Room' : 'Orchestrator'
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

function reportText(log) {
  return claudeReport(log).join('\n').trim()
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
  projectRoot = '',
  runsFolder = runsFolderDefault(),
  lanes = {},
  spawn: spawnChild = spawn,
  now = Date.now,
  onNotice = () => {},
  promptFile = PROMPT_FILE,
  bridgeUrl = () => '',
} = {}) {
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const laneEntry = lanes && Object.hasOwn(lanes, ORCHESTRATOR_KEY) ? lanes[ORCHESTRATOR_KEY] : null
  const lane = laneEntry?.cli ? laneEntry : DEFAULT_LANE
  const model = String(lane.cli.model ?? 'opus')
  const bin = String(lane.cli.bin ?? 'claude')
  const conversationFile = join(folder, `orchestrator-${projectHash(root)}.json`)
  const messages = []
  const pending = []
  const roomTurns = []
  let sessionId = null
  let state = 'idle'
  let running = null
  let stopped = false

  function notify() {
    try {
      onNotice({ topic: 'orchestrator' })
    } catch {}
  }

  function persist() {
    try {
      mkdirSync(folder, { recursive: true })
      writeFileSync(conversationFile, `${JSON.stringify({ project: root, sessionId, state, messages }, null, 2)}\n`)
    } catch {}
  }

  function restore() {
    let saved
    try {
      saved = JSON.parse(readFileSync(conversationFile, 'utf8'))
    } catch {
      return
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
    if (typeof saved.sessionId === 'string' && saved.sessionId.trim() !== '') sessionId = saved.sessionId
    if (saved.state === 'paused') state = 'paused'
    const list = Array.isArray(saved.messages) ? saved.messages : []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (!['owner', 'orchestrator', 'room'].includes(item.from)) continue
      if (typeof item.text !== 'string' || item.text.trim() === '') continue
      messages.push({
        id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
        from: item.from,
        text: item.text,
        at: typeof item.at === 'string' && item.at ? item.at : iso(now()),
      })
    }
    while (messages.length > ORCHESTRATOR_CHAT_LIMIT) messages.shift()
  }

  function setState(next) {
    if (state === next) return
    state = next
    persist()
    notify()
  }

  function addMessage(from, text) {
    const message = { id: randomUUID(), from, text, at: iso(now()) }
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
    if (stopped || running || state === 'paused' || pending.length === 0) return
    const hasOwner = pending.some((message) => message.from === 'owner')
    if (!hasOwner) {
      if (!sessionId) return
      if (!roomTurnAllowed()) return
    }
    startTurn()
  }

  function startTurn() {
    const turnMessages = pending.splice(0, pending.length)
    const hasOwner = turnMessages.some((message) => message.from === 'owner')
    if (!hasOwner) roomTurns.push(now())
    const first = !sessionId
    if (first) sessionId = randomUUID()
    const startedAt = now()
    const name = `${ORCHESTRATOR_KEY}-chat-${stamp(startedAt)}`
    const logPath = join(folder, `${name}.log`)
    const metaPath = join(folder, `${name}.meta.json`)
    const turn = { startedAt, logPath, killed: false, done: false, child: null, timer: null }
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
    const args = [
      '-p',
      turnText(turnMessages),
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--dangerously-skip-permissions',
      first ? '--session-id' : '--resume',
      sessionId,
      '--append-system-prompt',
      instructionFor(promptFile, root, folder, String((typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl) ?? '')),
    ]
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
    const report = reportText(logText)
    const failed = turn.killed || Boolean(error) || !Number.isInteger(code) || code !== 0
    const text = failed
      ? Number.isInteger(code)
        ? report && !turn.killed
          ? `The orchestrator stopped: ${report}`
          : `The orchestrator stopped: exit ${code}.`
        : STOPPED_REPLY
      : report || EMPTY_REPLY
    addMessage('orchestrator', text)
    const record = runRecord({
      lane: ORCHESTRATOR_KEY,
      model,
      startedAt: turn.startedAt,
      minutes: Math.round(((now() - turn.startedAt) / 60000) * 10) / 10,
      exitCode: code,
      killed: turn.killed,
      costUsd: costOf(logText),
      log: turn.logPath,
    })
    try {
      appendFileSync(join(folder, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
    } catch {}
    if (running === turn) running = null
    if (!stopped) {
      setState(state === 'paused' ? 'paused' : 'idle')
      maybeStartTurn()
    }
  }

  function answer() {
    return {
      state,
      model,
      project: root,
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

  function onFrame(frame) {
    if (stopped) return
    if (frame?.type !== 'heartbeat.run.status') return
    const status = frame.payload?.status
    if (status !== 'succeeded' && status !== 'failed') return
    const runId = typeof frame.payload?.runId === 'string' ? frame.payload.runId : ''
    const runName = runId.startsWith('run-') ? runId.slice(4) : ''
    const record = recordFor(runName)
    const laneKey = record?.lane ?? String(frame.payload?.agentId ?? '').replace(/^agent-/, '')
    if (!laneKey || laneKey === ORCHESTRATOR_KEY) return
    if (!sessionId || state === 'paused') return
    const logName = runName || (typeof record?.log === 'string' ? basename(record.log).replace(/\.log$/i, '') : 'run')
    const first = `Run ${logName} on lane ${laneKey} ended: ${status}.`
    const message = addMessage('room', record ? `${first}\n${recordLine(record)}` : first)
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
  }

  restore()
  try {
    mkdirSync(folder, { recursive: true })
  } catch {}
  persist()

  return { answer, send, stop, onFrame, close }
}
