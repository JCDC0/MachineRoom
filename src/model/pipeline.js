import { AGENT_ORDER } from '../harnesses/index.js'
import { indexFor } from './fileIndex.js'
import { cleanStartedBy } from './laneStarter.js'
import { createParser } from './parsers/index.js'
import { dirSetFor, shorten } from './parsers/common.js'
import { ancestors } from './paths.js'

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

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}
export const SEEN_LIMIT = 20000
export const ENDED_LIMIT = 1000
export const RUN_IDLE_MS = 30 * 60000

export function createPipeline({ agents, tree }) {
  const ctx = makeContext({ ...tree, files: [...tree.files], dirs: [...(tree.dirs ?? [])] })
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const parsers = new Map()
  const lastRunTime = new Map()
  const seen = new Set()
  const ended = new Set()
  let order = 0
  let lastTime = 0
  let feedTime = 0

  function sweep(time) {
    if (!Number.isFinite(time)) return
    if (time > feedTime) feedTime = time
    const from = feedTime - RUN_IDLE_MS
    for (const [runId, last] of lastRunTime) {
      if (last >= from) continue
      lastRunTime.delete(runId)
      parsers.delete(runId)
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
        if (entry) {
          entry.parser.flush(time).forEach((activity) => emit(activity))
          parsers.delete(runId)
        }
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
      if (!entry) {
        entry = { parser: createParser(agent, { ...ctx, agentKey: agent.key }), agent, runId }
        parsers.set(runId, entry)
      }
      const chunkTime = Date.parse(payload.ts ?? frame.createdAt)
      lastRunTime.set(runId, chunkTime)
      entry.parser.push(payload.chunk, chunkTime).forEach((activity) => emit(activity))
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
      entry.parser.flush(time).forEach((activity) => {
        out.push({ ...activity, agent: activity.agent ?? entry.agent.key, runId, order: (order += 1) })
      })
    }
    parsers.clear()
    return finalise(out)
  }

  function reset() {
    seen.clear()
    ended.clear()
    parsers.clear()
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
