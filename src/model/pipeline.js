import { createParser } from './parsers/index.js'
import { shorten } from './parsers/common.js'
import { ancestors } from './paths.js'

export const AGENT_ORDER = ['claude', 'hermes', 'opencode', 'agy']

export function orderAgents(agents) {
  const rank = (agent) => {
    const index = AGENT_ORDER.indexOf(agent.key)
    return index === -1 ? AGENT_ORDER.length : index
  }
  return [...agents].sort((a, b) => rank(a) - rank(b))
}

export function makeContext(tree) {
  return { rootName: tree.rootName, files: tree.files, dirs: tree.dirs }
}

const RUN_END = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])

export function createPipeline({ agents, tree }) {
  const ctx = makeContext({ ...tree, files: [...tree.files], dirs: [...(tree.dirs ?? [])] })
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const parsers = new Map()
  const lastRunTime = new Map()
  const seen = new Set()
  let order = 0
  let lastTime = 0

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
      const frameKey = `frame:${frame.id}`
      if (seen.has(frameKey)) return []
      seen.add(frameKey)
    }

    const payload = frame.payload
    const agent = byId.get(payload?.agentId)
    if (!agent) return []
    const runId = payload.runId ?? null
    const time = Date.parse(frame.createdAt)
    const out = []

    function emit(activity) {
      out.push({ ...activity, agent: agent.key, runId, order: (order += 1) })
    }

    if (frame.type === 'heartbeat.run.queued') {
      lastRunTime.set(runId, time)
      emit({ time, type: 'run.queued' })
    } else if (frame.type === 'heartbeat.run.status') {
      const key = `${runId}:${payload.status}`
      if (seen.has(key)) return []
      seen.add(key)
      lastRunTime.set(runId, time)
      if (payload.status === 'running') {
        emit({ time, type: 'run.start' })
      } else if (RUN_END.has(payload.status)) {
        const entry = parsers.get(runId)
        if (entry) {
          entry.parser.flush(time).forEach((activity) => emit(activity))
          parsers.delete(runId)
        }
        const ok = payload.status === 'succeeded'
        emit({ time, type: 'run.end', ok, error: ok ? null : shorten(payload.error ?? payload.errorCode ?? payload.status, 120) })
      }
    } else if (frame.type === 'heartbeat.run.log' && payload.stream === 'stdout') {
      if (payload.seq !== undefined && payload.seq !== null) {
        const seqKey = `${runId}:log:${payload.seq}`
        if (seen.has(seqKey)) return []
        seen.add(seqKey)
      }
      let entry = parsers.get(runId)
      if (!entry) {
        entry = { parser: createParser(agent, ctx), agent, runId }
        parsers.set(runId, entry)
      }
      const chunkTime = Date.parse(payload.ts ?? frame.createdAt)
      lastRunTime.set(runId, chunkTime)
      entry.parser.push(payload.chunk, chunkTime).forEach((activity) => emit(activity))
    } else if (frame.type === 'heartbeat.run.event' && payload.level === 'error') {
      const key = `${runId}:error:${payload.seq}`
      if (seen.has(key)) return []
      seen.add(key)
      lastRunTime.set(runId, time)
      emit({ time, type: 'error', text: shorten(payload.message ?? 'error', 120) })
    }

    return finalise(out)
  }

  function flush() {
    const out = []
    for (const [runId, entry] of parsers) {
      const time = lastRunTime.get(runId) ?? lastTime
      entry.parser.flush(time).forEach((activity) => {
        out.push({ ...activity, agent: entry.agent.key, runId, order: (order += 1) })
      })
    }
    parsers.clear()
    return finalise(out)
  }

  function learn(paths) {
    for (const path of paths) {
      if (ctx.files.includes(path)) continue
      ctx.files.push(path)
      for (const dir of ancestors(path)) if (!ctx.dirs.includes(dir)) ctx.dirs.push(dir)
    }
  }

  return { push, flush, learn, context: ctx }
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
