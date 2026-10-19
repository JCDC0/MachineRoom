export function resultWord(record) {
  if (record?.killed) return 'stopped'
  if (record?.exitCode === 0) return 'finished'
  return 'failed'
}

export const runResultWord = resultWord

export function formatCost(costUsd) {
  if (costUsd == null || typeof costUsd !== 'number' || !Number.isFinite(costUsd)) {
    return 'cost unknown'
  }
  if (costUsd === 0) return '$0.00'
  return `$${costUsd.toFixed(4)}`
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'minutes unknown'
  return `${minutes} min`
}

export function timeSinceStart(startedAt, now) {
  const value = typeof startedAt === 'object' && startedAt !== null ? startedAt.startedAt : startedAt
  if (!value) return 'time unknown'
  const target = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(target)) return 'time unknown'
  const current = now != null ? (typeof now === 'number' ? now : Date.parse(now)) : Date.now()
  const diffMs = current - target
  if (diffMs < 60000 || Number.isNaN(diffMs)) return 'just now'
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

export const timeSince = timeSinceStart

export function recordLine(record) {
  if (!record || typeof record !== 'object') return ''
  const lane = record.lane || 'unknown'
  const briefs = Array.isArray(record.briefs) && record.briefs.length > 0
    ? record.briefs.join(' ')
    : 'none'
  const result = resultWord(record)
  const cost = formatCost(record.costUsd)
  const minutes = Number.isFinite(record.minutes) ? `${record.minutes} min` : '0 min'
  const start = record.startedAt || 'time unknown'
  return `${lane} | ${briefs} | ${result} | ${cost} | ${minutes} | ${start}`
}

export const formatRecordLine = recordLine

export function runningLine(entry, now) {
  if (!entry || typeof entry !== 'object') return ''
  const lane = entry.lane || 'unknown'
  const briefs = Array.isArray(entry.briefs) && entry.briefs.length > 0
    ? entry.briefs.join(' ')
    : 'none'
  const ago = timeSinceStart(entry.startedAt, now)
  return `${lane} | ${briefs} | ${ago}`
}
