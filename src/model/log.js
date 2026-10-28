import { shorten } from './parsers/common.js'

const LIMIT = 50
const TEXT_LIMIT = 140
export const LIVE_LOG_LIMIT = 200

export function appendLiveLog(previous, added, limit = LIVE_LOG_LIMIT) {
  if (added.length === 0) return previous
  return [...previous, ...added].slice(-limit)
}

export function createLogger(agents) {
  const names = new Map(agents.map((agent) => [agent.key, agent.name]))
  const labels = new Map()

  return function entryFor(activity) {
    const agent = names.get(activity.agent) ?? activity.agent
    const call = `${activity.runId}:${activity.id}`
    switch (activity.type) {
      case 'run.queued':
        return { agent, text: 'queued', tone: 'dim' }
      case 'run.start':
        return { agent, text: `run ${String(activity.runId).slice(0, 4)} started`, tone: 'dim' }
      case 'tool.start':
        labels.set(call, activity.label)
        return { agent, text: shorten(activity.label, TEXT_LIMIT), tone: 'normal' }
      case 'tool.end': {
        const label = labels.get(call)
        labels.delete(call)
        return activity.ok ? null : { agent, text: shorten(`failed ${label ?? 'tool call'}`, TEXT_LIMIT), tone: 'error' }
      }
      case 'error':
        return { agent, text: shorten(activity.text, TEXT_LIMIT), tone: 'error' }
      case 'agent.message':
        return { agent, text: `${activity.agent} > ${activity.to}: ${activity.kind}`, tone: 'dim' }
      case 'run.end':
        return activity.ok
          ? { agent, text: 'finished', tone: 'done' }
          : { agent, text: shorten(`failed ${activity.error ?? ''}`.trim(), TEXT_LIMIT), tone: 'error' }
      default:
        return null
    }
  }
}

export function buildTimeline(activities, stamps, agents) {
  const entryFor = createLogger(agents)
  const entries = []
  const markers = []
  activities.forEach((activity, index) => {
    const at = stamps[index]
    const entry = entryFor(activity)
    if (entry) entries.push({ ...entry, at, time: at })
    if (activity.type === 'run.start') markers.push({ at, tone: 'start' })
    else if (activity.type === 'run.end') markers.push({ at, tone: activity.ok ? 'done' : 'error' })
  })
  return { entries, markers }
}

export function entriesUpTo(entries, position, limit = LIMIT) {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (entries[middle].at <= position) low = middle + 1
    else high = middle
  }
  return entries.slice(Math.max(0, low - limit), low)
}
