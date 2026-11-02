function pad(value) {
  return String(value).padStart(2, '0')
}

export function lensProject(name) {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!text) return '/'
  return text.startsWith('/') ? text : `/${text}`
}

export function lensClock(live, position, now = Date.now()) {
  if (live) {
    const date = new Date(now)
    if (!Number.isFinite(date.getTime())) return '00:00:00'
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  const value = Number(position)
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value / 1000)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function lensStatus(agents, log) {
  const roster = Array.isArray(agents) ? agents : []
  const shown = roster.filter((agent) => agent && (agent.depth ?? 0) === 0)
  const working = shown.filter((agent) => agent.status === 'working').length
  const total = shown.length
  const share = total > 0 ? working / total : 0
  const entries = Array.isArray(log) ? log : []
  const last = entries.length > 0 ? entries[entries.length - 1] : null
  const text = last && typeof last.text === 'string' ? last.text.trim() : ''
  const agent = last && typeof last.agent === 'string' ? last.agent.trim() : ''
  const activity = text ? (agent ? `${agent} ${text}` : text) : ''
  const tone = last && typeof last.tone === 'string' ? last.tone : 'normal'
  return { working, total, share, activity, tone }
}
