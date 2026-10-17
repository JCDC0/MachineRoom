import { createParser } from './parsers/index.js'
import { shorten } from './parsers/common.js'

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

export function buildActivities(frames, { agents, tree }) {
  const ctx = makeContext(tree)
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const parsers = new Map()
  const seen = new Set()
  const out = []
  let order = 0

  function emit(activity, agent, runId) {
    out.push({ ...activity, agent: agent.key, runId, order: (order += 1) })
  }

  for (const frame of frames) {
    const payload = frame.payload
    const agent = byId.get(payload?.agentId)
    if (!agent) continue
    const runId = payload.runId ?? null
    const time = Date.parse(frame.createdAt)

    if (frame.type === 'heartbeat.run.queued') {
      emit({ time, type: 'run.queued' }, agent, runId)
    } else if (frame.type === 'heartbeat.run.status') {
      const key = `${runId}:${payload.status}`
      if (seen.has(key)) continue
      seen.add(key)
      if (payload.status === 'running') {
        emit({ time, type: 'run.start' }, agent, runId)
      } else if (RUN_END.has(payload.status)) {
        const parser = parsers.get(runId)
        if (parser) parser.flush(time).forEach((activity) => emit(activity, agent, runId))
        const ok = payload.status === 'succeeded'
        emit({ time, type: 'run.end', ok, error: ok ? null : shorten(payload.error ?? payload.errorCode ?? payload.status, 120) }, agent, runId)
      }
    } else if (frame.type === 'heartbeat.run.log' && payload.stream === 'stdout') {
      let parser = parsers.get(runId)
      if (!parser) {
        parser = createParser(agent, ctx)
        parsers.set(runId, parser)
      }
      parser.push(payload.chunk, Date.parse(payload.ts)).forEach((activity) => emit(activity, agent, runId))
    } else if (frame.type === 'heartbeat.run.event' && payload.level === 'error') {
      const key = `${runId}:error:${payload.seq}`
      if (seen.has(key)) continue
      seen.add(key)
      emit({ time, type: 'error', text: shorten(payload.message ?? 'error', 120) }, agent, runId)
    }
  }

  return out.sort((a, b) => a.time - b.time || a.order - b.order)
}
