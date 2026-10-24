export function formatCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return '$0.00'
  const rounded = Math.round(Number(cents))
  const sign = rounded < 0 ? '-' : ''
  const absolute = Math.abs(rounded)
  return `${sign}$${(absolute / 100).toFixed(2)}`
}

export function percentOf(used, total) {
  if (total == null || Number(total) <= 0 || Number.isNaN(Number(total))) return 0
  if (used == null || Number.isNaN(Number(used))) return 0
  const ratio = (Number(used) / Number(total)) * 100
  return Math.min(100, Math.max(0, Math.round(ratio)))
}

export function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function listOf(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object') : []
}

export function textOf(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : ''
}

export function meterTone(percent) {
  return percent >= 90 ? 'full' : 'normal'
}

export function timeAgo(iso, now) {
  if (!iso) return 'just now'
  const target = typeof iso === 'number' ? iso : Date.parse(iso)
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

const STATUS_LABELS = {
  in_progress: 'in progress',
  in_review: 'in review',
  blocked: 'blocked',
  todo: 'to do',
  backlog: 'backlog',
  done: 'done',
  cancelled: 'cancelled',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  revision_requested: 'revision requested',
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  error: 'failed',
  pending_approval: 'pending approval',
}

export function statusLabel(status) {
  if (!status) return ''
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : String(status).replace(/_/g, ' ')
}
