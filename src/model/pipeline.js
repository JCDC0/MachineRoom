import { maskProfilePaths } from '../briefs/run.js'
import { AGENT_ORDER, harnessByAdapter, harnessByKey } from '../harnesses/index.js'
import { indexFor } from './fileIndex.js'
import { cleanStartedBy } from './laneStarter.js'
import { createParser } from './parsers/index.js'
import { createLineReader, dirSetFor, parseJson, shorten } from './parsers/common.js'
import { LINE as HERMES_LINE } from './parsers/hermes.js'
import { recoverCall } from './parsers/opencode.js'
import { ancestors, normalise, relativeTo } from './paths.js'

export { AGENT_ORDER }

export function orderAgents(agents) {
  const rank = (agent) => {
    const index = AGENT_ORDER.indexOf(agent.key)
    return index === -1 ? AGENT_ORDER.length : index
  }
  return [...agents].sort((a, b) => rank(a) - rank(b))
}

export function makeContext(tree) {
  return { rootName: tree.rootName, rootPath: tree.rootPath, files: tree.files, dirs: tree.dirs }
}

const RUN_END = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const MESSAGE_KINDS = new Set(['order', 'report', 'dispatch', 'wake'])
const FILE_TOOLS = new Set(['read', 'write', 'edit'])
const CLAUDE_STREAM_FILES = new Set(['read', 'write', 'edit', 'multiedit', 'notebookedit'])
const CLAUDE_ACPX_FILE = /^(Read|Edit|MultiEdit|NotebookEdit|Write)\s+(.+)$/i
const AGY_PATH_FIELDS = {
  view_file: 'AbsolutePath',
  read_file: 'Path',
  write_to_file: 'TargetFile',
  write_file: 'Path',
  replace_file_content: 'TargetFile',
  multi_replace_file_content: 'TargetFile',
  edit_file: 'Path',
}
const OPENCODE_OUTPUT_PATH = /(?:Created file successfully|Edited|Wrote|Updated|Written)[:\s]+(\S+)/i
const ACP_PATH_KEYS = ['path', 'filePath', 'file_path', 'target', 'targetFile', 'source', 'destination']
const COPILOT_FILE_LINES = [
  /^\s*(?:Reading file|Viewing file|Reading|read)\s*[:(]?\s*(.+?)\s*\)?$/i,
  /^\s*(?:Writing file|Creating file|Writing|write)\s*[:(]?\s*(.+?)\s*\)?$/i,
  /^\s*(?:Editing file|Patching file|Editing|edit|patch)\s*[:(]?\s*(.+?)\s*\)?$/i,
]
const COPILOT_OTHER_LINES = [
  /^\s*(?:Executing shell command|Executing command|Running command|Executing|Running|shell|\$)\s*[:(]?\s*(.+?)\s*\)?$/i,
  /^\s*(?:Searching the web for|Searching web|Fetching URL|web_search|web_fetch)\s*[:(]?\s*(.+?)\s*\)?$/i,
]
const HERMES_FILE_VERBS = new Set(['read', 'write', 'patch'])

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parserKeyFor(agent) {
  const byName = Object.hasOwn(harnessByKey, agent.parser) ? harnessByKey[agent.parser] : null
  const byAdapter = Object.hasOwn(harnessByAdapter, agent.adapterType) ? harnessByAdapter[agent.adapterType] : null
  const descriptor = byName ?? (byAdapter?.parserByAdapter === false ? null : byAdapter)
  return descriptor?.key ?? null
}

function isAbsolutePath(rawPath) {
  const clean = normalise(rawPath).trim()
  return /^[A-Za-z]:\//.test(clean) || clean.startsWith('/')
}

function isInsideProject(rawPath, ctx, agent, treeWorktrees) {
  if (relativeTo(ctx.rootName, rawPath, ctx.rootPath) !== null) return true
  if (typeof agent?.worktree === 'string' && agent.worktree && relativeTo('', rawPath, agent.worktree) !== null) return true
  for (const worktree of treeWorktrees) {
    if (relativeTo('', rawPath, worktree) !== null) return true
  }
  return false
}

function parseArgsObject(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    const parsed = parseJson(raw)
    if (parsed && typeof parsed === 'object') return parsed
  }
  return {}
}

function extractAcpPaths(update) {
  const found = []
  for (const location of Array.isArray(update.locations) ? update.locations : []) {
    const path = typeof location === 'string' ? location : location?.path
    if (typeof path === 'string' && path.trim() !== '') found.push(path)
  }
  if (found.length > 0) return found
  const input = update.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {}
  for (const key of ACP_PATH_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') found.push(value)
  }
  return found
}

function createPathTracker(parserKey) {
  const paths = new Map()
  let counter = 0

  function remember(id, candidate) {
    if (!id) return
    const list = Array.isArray(candidate) ? candidate : [candidate]
    const clean = list.filter((item) => typeof item === 'string' && item.trim() !== '')
    if (clean.length > 0) paths.set(id, clean)
  }

  function handleClaude(line) {
    const json = parseJson(line)
    if (!json || typeof json !== 'object') return
    if (json.type === 'acpx.tool_call' && json.toolCallId) {
      const match = CLAUDE_ACPX_FILE.exec(json.name ?? '')
      if (match && match[2] !== 'File') remember(json.toolCallId, match[2])
      return
    }
    if (json.type !== 'assistant' || !Array.isArray(json.message?.content)) return
    for (const item of json.message.content) {
      if (!item || typeof item !== 'object' || item.type !== 'tool_use' || typeof item.id !== 'string' || !item.id) continue
      const lower = String(item.name ?? '').toLowerCase()
      if (!CLAUDE_STREAM_FILES.has(lower)) continue
      const input = item.input && typeof item.input === 'object' && !Array.isArray(item.input) ? item.input : {}
      remember(item.id, input.file_path ?? input.notebook_path)
    }
  }

  function handleAgy(line) {
    const json = parseJson(line)
    const step = json?.event === 'step_update' ? json.step_update : null
    if (!step || (step.step_type !== 'tool' && step.step_type !== 'subagent')) return
    const field = Object.hasOwn(AGY_PATH_FIELDS, step.tool_name) ? AGY_PATH_FIELDS[step.tool_name] : null
    if (!field) return
    remember(`${step.conversation_id}:${step.step_index}`, step.tool_info?.parameters?.[field])
  }

  function handleAcp(line) {
    const item = parseJson(line)
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const params = item.method === 'session/update' && item.params && typeof item.params === 'object' ? item.params : item
    const update = params.update && typeof params.update === 'object' ? params.update : typeof params.sessionUpdate === 'string' ? params : null
    if (!update || (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update')) return
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (id) remember(id, extractAcpPaths(update))
  }

  function handleOpencode(line) {
    const json = parseJson(line)
    if (!json) {
      const recovered = recoverCall(line)
      if (!recovered) return
      const callId = recovered.id ?? `opencode-${(counter += 1)}`
      remember(callId, recovered.input?.path)
      return
    }
    if (json.type !== 'tool_use') return
    const part = json.part ?? {}
    const state = part.state ?? {}
    const input = state.input ?? {}
    const callId = part.id ?? `opencode-${(counter += 1)}`
    remember(callId, input.path ?? input.filePath ?? OPENCODE_OUTPUT_PATH.exec(String(state.output ?? ''))?.[1])
  }

  function handleCodex(line) {
    const json = parseJson(line)
    const item = json?.item
    if (!item || typeof item !== 'object') return
    if (json.type !== 'item.started' && json.type !== 'item.completed') return
    if (item.type === 'command_execution' || item.type === 'web_search') {
      if (item.id === undefined || item.id === null) counter += 1
      return
    }
    if (item.type !== 'file_change') return
    const id = String(item.id ?? `file-${(counter += 1)}`)
    const changes = Array.isArray(item.changes) ? item.changes : []
    const raw = changes.length > 0 ? changes.map((change) => change?.path ?? change?.file) : [item.path || item.file]
    remember(id, raw)
  }

  function handleCopilot(line) {
    const json = parseJson(line)
    if (json && typeof json === 'object') {
      const type = String(json.type ?? '')
      const isTool =
        type === 'tool.execution_start' ||
        type === 'tool_call' ||
        type === 'tool_use' ||
        type === 'tool' ||
        type === 'tool.execution_complete' ||
        type === 'tool_result' ||
        type === 'tool_end'
      if (!isTool) return
      const id = String(json.toolCallId ?? json.id ?? `copilot-${(counter += 1)}`)
      const name = String(json.toolName ?? json.name ?? json.tool ?? '').toLowerCase()
      if (/shell|terminal|bash|command|web_search|web_fetch|websearch|webfetch|web/.test(name)) return
      if (/read|view|write|create|edit|patch|update/.test(name)) {
        const args = parseArgsObject(json.parameters ?? json.arguments ?? json.input)
        remember(id, args.path ?? args.file ?? args.file_path)
      }
      return
    }
    for (const pattern of COPILOT_FILE_LINES) {
      const match = pattern.exec(line)
      if (!match) continue
      remember(`copilot-${(counter += 1)}`, match[1].trim())
      return
    }
    for (const pattern of COPILOT_OTHER_LINES) {
      if (pattern.test(line)) {
        counter += 1
        return
      }
    }
  }

  function handleHermes(line) {
    const found = HERMES_LINE.exec(line)
    if (!found) return
    const id = `hermes-${(counter += 1)}`
    if (HERMES_FILE_VERBS.has(found[1])) remember(id, found[2])
  }

  const handlers = {
    claude: handleClaude,
    machineroom: handleClaude,
    agy: handleAgy,
    acp: handleAcp,
    opencode: handleOpencode,
    codex: handleCodex,
    copilot: handleCopilot,
    hermes: handleHermes,
  }
  const handleLine = handlers[parserKey] ?? (() => {})
  const reader = createLineReader((line) => handleLine(line))

  return {
    push(chunk) {
      reader.push(chunk, 0)
    },
    flush() {
      reader.flush(0)
    },
    take(id) {
      if (!id || !paths.has(id)) return []
      const list = paths.get(id)
      paths.delete(id)
      return list
    },
    drop(id) {
      if (id) paths.delete(id)
    },
  }
}

export const SEEN_LIMIT = 20000
export const ENDED_LIMIT = 1000
export const RUN_IDLE_MS = 30 * 60000

export function createPipeline({ agents, tree }) {
  const ctx = makeContext({ ...tree, files: [...tree.files], dirs: [...(tree.dirs ?? [])] })
  const treeWorktrees = Array.isArray(tree.worktrees) ? tree.worktrees.filter((item) => typeof item === 'string' && item !== '') : []
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const parsers = new Map()
  const trackers = new Map()
  const lastRunTime = new Map()
  const seen = new Set()
  const ended = new Set()
  let order = 0
  let lastTime = 0
  let feedTime = 0

  function annotate(activity, tracker, agent) {
    if (!activity) return activity
    if (activity.type === 'tool.end') {
      tracker?.drop(activity.id)
      return activity
    }
    if (activity.type !== 'tool.start' || !FILE_TOOLS.has(activity.tool)) return activity
    const rawPaths = tracker ? tracker.take(activity.id) : []
    if (Array.isArray(activity.touches) && activity.touches.length > 0) return activity
    const outsideRaw = rawPaths.find((raw) => isAbsolutePath(raw) && !isInsideProject(raw, ctx, agent, treeWorktrees))
    if (!outsideRaw) return activity
    return { ...activity, outside: true, outsidePath: maskProfilePaths(outsideRaw) }
  }

  function sweep(time) {
    if (!Number.isFinite(time)) return
    if (time > feedTime) feedTime = time
    const from = feedTime - RUN_IDLE_MS
    for (const [runId, last] of lastRunTime) {
      if (last >= from) continue
      lastRunTime.delete(runId)
      parsers.delete(runId)
      trackers.delete(runId)
    }
  }

  function once(key) {
    if (seen.has(key)) return false
    seen.add(key)
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value)
    return true
  }

  function finalise(items) {
    for (const item of items) if (!Number.isFinite(item.time)) item.time = lastTime
    items.sort((a, b) => a.time - b.time || a.order - b.order)
    for (const item of items) {
      if (item.time < lastTime) item.time = lastTime
      lastTime = item.time
    }
    return items
  }

  function push(frame) {
    if (!frame || typeof frame !== 'object') return []
    if (frame.id !== undefined && frame.id !== null) {
      if (!once(`frame:${frame.id}`)) return []
    }
    sweep(Date.parse(frame.createdAt))

    const payload = frame.payload
    if (frame.type === 'orchestrator.message') {
      const from = typeof payload?.from === 'string' ? payload.from.trim() : ''
      const to = typeof payload?.to === 'string' ? payload.to.trim() : ''
      const kind = typeof payload?.kind === 'string' ? payload.kind.trim() : ''
      if (!from || !to || !MESSAGE_KINDS.has(kind)) return []
      const parsed = typeof payload.ts === 'string' ? Date.parse(payload.ts) : payload.ts
      const ts = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : Date.parse(frame.createdAt)
      return finalise([{ time: ts, type: 'agent.message', agent: from, runId: null, to, kind, order: (order += 1) }])
    }
    const agent = byId.get(payload?.agentId)
    if (!agent) return []
    const runId = payload.runId ?? null
    const time = Date.parse(frame.createdAt)
    const out = []

    function emit(activity) {
      out.push({ ...activity, agent: activity.agent ?? agent.key, runId, order: (order += 1) })
    }

    if (frame.type === 'heartbeat.run.queued') {
      lastRunTime.set(runId, time)
      const startedBy = cleanStartedBy(payload.startedBy)
      const session = textOf(payload.session)
      emit({ time, type: 'run.queued', ...(startedBy ? { startedBy } : {}), ...(session ? { session } : {}) })
    } else if (frame.type === 'heartbeat.run.status') {
      if (payload.status === 'running' && ended.has(runId)) {
        // The lane source reopens a run it ended for quiet when its log grows again.
        ended.delete(runId)
        seen.delete(`${runId}:running`)
        for (const status of RUN_END) seen.delete(`${runId}:${status}`)
      }
      if (!once(`${runId}:${payload.status}`)) return []
      lastRunTime.set(runId, time)
      if (payload.status === 'running') {
        const startedBy = cleanStartedBy(payload.startedBy)
        const session = textOf(payload.session)
        emit({ time, type: 'run.start', ...(startedBy ? { startedBy } : {}), ...(session ? { session } : {}) })
      } else if (RUN_END.has(payload.status)) {
        const entry = parsers.get(runId)
        const tracker = trackers.get(runId)
        if (entry) {
          tracker?.flush()
          entry.parser.flush(time).forEach((activity) => emit(annotate(activity, tracker, entry.agent)))
          parsers.delete(runId)
        }
        trackers.delete(runId)
        lastRunTime.delete(runId)
        ended.add(runId)
        if (ended.size > ENDED_LIMIT) ended.delete(ended.values().next().value)
        const ok = payload.status === 'succeeded'
        emit({ time, type: 'run.end', ok, error: ok ? null : shorten(payload.error ?? payload.errorCode ?? payload.status, 120) })
      }
    } else if (frame.type === 'heartbeat.run.log' && payload.stream === 'stdout') {
      if (payload.seq !== undefined && payload.seq !== null) {
        if (!once(`${runId}:log:${payload.seq}`)) return []
      }
      if (ended.has(runId)) return []
      let entry = parsers.get(runId)
      let tracker = trackers.get(runId)
      if (!entry) {
        entry = { parser: createParser(agent, { ...ctx, agentKey: agent.key }), agent, runId }
        tracker = createPathTracker(parserKeyFor(agent))
        parsers.set(runId, entry)
        trackers.set(runId, tracker)
      }
      const chunkTime = Date.parse(payload.ts ?? frame.createdAt)
      lastRunTime.set(runId, chunkTime)
      tracker?.push(payload.chunk)
      entry.parser.push(payload.chunk, chunkTime).forEach((activity) => emit(annotate(activity, tracker, agent)))
    } else if (frame.type === 'heartbeat.run.event' && payload.level === 'error') {
      if (!once(`${runId}:error:${payload.seq}`)) return []
      if (lastRunTime.has(runId)) lastRunTime.set(runId, time)
      emit({ time, type: 'error', text: shorten(payload.message ?? 'error', 120) })
    }

    return finalise(out)
  }

  function flush() {
    const out = []
    for (const [runId, entry] of parsers) {
      const time = lastRunTime.get(runId) ?? lastTime
      const tracker = trackers.get(runId)
      tracker?.flush()
      entry.parser.flush(time).forEach((activity) => {
        const noted = annotate(activity, tracker, entry.agent)
        out.push({ ...noted, agent: noted.agent ?? entry.agent.key, runId, order: (order += 1) })
      })
    }
    parsers.clear()
    trackers.clear()
    return finalise(out)
  }

  function reset() {
    seen.clear()
    ended.clear()
    parsers.clear()
    trackers.clear()
    lastRunTime.clear()
  }

  function learn(paths) {
    for (const path of paths) {
      if (indexFor(ctx.files).has(path)) continue
      ctx.files.push(path)
      for (const dir of ancestors(path)) {
        if (indexFor(ctx.dirs).has(dir)) continue
        ctx.dirs.push(dir)
      }
    }
  }

  function warm() {
    indexFor(ctx.files)
    indexFor(ctx.dirs)
    dirSetFor(ctx.dirs)
  }

  return { push, flush, reset, learn, warm, context: ctx, remembered: () => ({ keys: seen.size, runs: lastRunTime.size, parsers: parsers.size }) }
}

export function buildActivities(frames, { agents, tree }) {
  const pipeline = createPipeline({ agents, tree })
  const out = []
  for (const frame of frames) {
    out.push(...pipeline.push(frame))
  }
  out.push(...pipeline.flush())
  return out
}
