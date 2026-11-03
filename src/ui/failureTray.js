export const FAILURE_TRAY_LIMIT = 5
export const FAILURE_TRAY_KEEP = 50

export function emptyFailureTray() {
  return { rows: [], calls: {}, seq: 0 }
}

function timeOf(activity, now) {
  return Number.isFinite(activity?.time) ? activity.time : now
}

function callKey(run, id) {
  return `${run}:${id}`
}

function putRow(rows, row) {
  return [...rows.filter((entry) => entry.id !== row.id), row]
}

function newest(rows) {
  return [...rows].sort((left, right) => {
    if (right.at !== left.at) return right.at - left.at
    return right.seq - left.seq
  })
}

function forgetCalls(calls, run) {
  const prefix = `${run}:`
  for (const key of Object.keys(calls)) {
    if (key.startsWith(prefix)) delete calls[key]
  }
}

export function addFailureActivities(tray, activities, now = Date.now()) {
  const base = tray && Array.isArray(tray.rows) ? tray : emptyFailureTray()
  const calls = { ...(base.calls ?? {}) }
  let rows = base.rows
  let seq = Number.isFinite(base.seq) ? base.seq : 0
  let changed = false

  for (const activity of Array.isArray(activities) ? activities : []) {
    if (!activity || typeof activity !== 'object') continue
    const run = activity.runId == null ? '' : String(activity.runId)
    if (activity.type === 'tool.start') {
      const id = activity.id == null ? '' : String(activity.id)
      if (!id) continue
      calls[callKey(run, id)] = typeof activity.label === 'string' ? activity.label : ''
      changed = true
      continue
    }
    if (activity.type === 'tool.end' && activity.ok === false) {
      const id = activity.id == null ? '' : String(activity.id)
      const label = calls[callKey(run, id)] || 'tool call'
      seq += 1
      rows = putRow(rows, {
        id: `tool:${run}:${id}`,
        kind: 'tool',
        agent: String(activity.agent ?? ''),
        text: label,
        at: timeOf(activity, now),
        seq,
      })
      changed = true
      continue
    }
    if (activity.type !== 'run.end') continue
    const agent = String(activity.agent ?? '')
    if (activity.ok) {
      const kept = rows.filter((row) => row.agent !== agent)
      if (kept.length !== rows.length) {
        rows = kept
        changed = true
      }
    } else {
      seq += 1
      rows = putRow(rows, {
        id: `run:${run}`,
        kind: 'run',
        agent,
        text: typeof activity.error === 'string' && activity.error ? activity.error : 'failed',
        at: timeOf(activity, now),
        seq,
      })
      changed = true
    }
    forgetCalls(calls, run)
  }

  if (!changed) return base
  return { rows: newest(rows).slice(0, FAILURE_TRAY_KEEP), calls, seq }
}

export function failureRows(tray, limit = FAILURE_TRAY_LIMIT) {
  const rows = newest(Array.isArray(tray?.rows) ? tray.rows : [])
  const size = Number.isInteger(limit) && limit >= 0 ? limit : FAILURE_TRAY_LIMIT
  return {
    rows: rows.slice(0, size),
    more: Math.max(0, rows.length - size),
    total: rows.length,
  }
}

export function failureAge(at, now = Date.now()) {
  const target = typeof at === 'number' ? at : Date.parse(at)
  const current = typeof now === 'number' ? now : Date.parse(now)
  if (!Number.isFinite(target) || !Number.isFinite(current)) return 'just now'
  const diff = current - target
  if (diff < 60000) return 'just now'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}
