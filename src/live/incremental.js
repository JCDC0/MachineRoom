import { createParser } from '../model/parsers/index.js'
import { shorten } from '../model/parsers/common.js'
import { ancestors } from '../model/paths.js'
import { makeContext } from '../model/pipeline.js'

const RUN_END = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])

export function createIncrementalPipeline({ agents, tree }) {
  const ctx = makeContext({ ...tree, files: [...tree.files], dirs: [...tree.dirs] })
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const parsers = new Map()
  const seen = new Set()
  let order = 0

  function stamp(activities, agent, runId) {
    return activities.map((activity) => ({ ...activity, agent: agent.key, runId, order: (order += 1) }))
  }

  function learn(paths) {
    for (const path of paths) {
      if (ctx.files.includes(path)) continue
      ctx.files.push(path)
      for (const dir of ancestors(path)) if (!ctx.dirs.includes(dir)) ctx.dirs.push(dir)
    }
  }

  function push(frame) {
    const payload = frame.payload
    const agent = byId.get(payload?.agentId)
    if (!agent) return []
    const runId = payload.runId ?? null
    const time = Date.parse(frame.createdAt)

    if (frame.type === 'heartbeat.run.queued') {
      return stamp([{ time, type: 'run.queued' }], agent, runId)
    }
    if (frame.type === 'heartbeat.run.status') {
      const key = `${runId}:${payload.status}`
      if (seen.has(key)) return []
      seen.add(key)
      if (payload.status === 'running') return stamp([{ time, type: 'run.start' }], agent, runId)
      if (!RUN_END.has(payload.status)) return []
      const parser = parsers.get(runId)
      const tail = parser ? parser.flush(time) : []
      parsers.delete(runId)
      const ok = payload.status === 'succeeded'
      const error = ok ? null : shorten(payload.error ?? payload.errorCode ?? payload.status, 120)
      return stamp([...tail, { time, type: 'run.end', ok, error }], agent, runId)
    }
    if (frame.type === 'heartbeat.run.log' && payload.stream === 'stdout') {
      let parser = parsers.get(runId)
      if (!parser) {
        parser = createParser(agent, ctx)
        parsers.set(runId, parser)
      }
      return stamp(parser.push(payload.chunk, Date.parse(payload.ts)), agent, runId)
    }
    if (frame.type === 'heartbeat.run.event' && payload.level === 'error') {
      const key = `${runId}:error:${payload.seq}`
      if (seen.has(key)) return []
      seen.add(key)
      return stamp([{ time, type: 'error', text: shorten(payload.message ?? 'error', 120) }], agent, runId)
    }
    return []
  }

  return { push, learn, context: ctx }
}
