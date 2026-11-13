export const LANE_RUN_LIMIT = 10
export const LANE_READ_GAP_MS = 2000
export const PROMPT_LINES = 3
export const PROMPT_CHARS = 360

export function liveRunLane(run, lanes = []) {
  const direct = typeof run?.lane === 'string' ? run.lane.trim() : ''
  if (direct) return direct
  const name = String(run?.runId ?? run?.issueId ?? '').replace(/^run-/, '')
  if (!name) return ''
  const keys = (Array.isArray(lanes) ? lanes : [])
    .map((lane) => (typeof lane?.key === 'string' ? lane.key.trim() : ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
  return keys.find((key) => name.startsWith(`${key}-`)) ?? ''
}

function runTime(run) {
  const startedAt = typeof run?.startedAt === 'string' ? run.startedAt.trim() : ''
  const time = Date.parse(startedAt)
  return { startedAt, time: Number.isFinite(time) ? time : 0 }
}

export function runOptions(runs, lane, { liveRuns = [], lanes = [] } = {}) {
  const wanted = typeof lane === 'string' ? lane.trim() : ''
  if (!wanted) return []
  const found = new Map()
  function add(run, running) {
    if (!run || typeof run !== 'object') return
    if (typeof run.lane === 'string' && run.lane.trim() !== '' && run.lane.trim() !== wanted) return
    const { startedAt, time } = runTime(run)
    if (!startedAt) return
    const kept = found.get(startedAt)
    if (kept) {
      if (running && kept.running !== true) found.set(startedAt, { ...kept, ...run, running: true })
      return
    }
    found.set(startedAt, { ...run, lane: wanted, startedAt, time, running })
  }
  if (Array.isArray(runs)) {
    for (const run of runs) add(run, run?.running === true)
  } else if (runs && typeof runs === 'object') {
    for (const run of Array.isArray(runs.running) ? runs.running : []) add(run, true)
    for (const run of Array.isArray(runs.recent) ? runs.recent : []) add(run, false)
  }
  for (const run of Array.isArray(liveRuns) ? liveRuns : []) {
    if (liveRunLane(run, lanes) !== wanted) continue
    add({ ...run, lane: wanted }, true)
  }
  return [...found.values()].sort((left, right) => right.time - left.time).slice(0, LANE_RUN_LIMIT)
}

export function readDue(lastReadAt, now, gap = LANE_READ_GAP_MS) {
  if (!Number.isFinite(lastReadAt)) return true
  return now - lastReadAt >= gap
}

export function foldToolCalls(entries) {
  const rows = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.role === 'tool') {
      const last = rows.at(-1)
      if (last && last.kind === 'tools') {
        last.entries.push(entry)
        last.count += 1
      } else {
        rows.push({ kind: 'tools', count: 1, entries: [entry] })
      }
      continue
    }
    rows.push({ kind: 'entry', entry })
  }
  return rows
}

export function foldPrompt(text, maxLines = PROMPT_LINES, maxChars = PROMPT_CHARS) {
  const value = typeof text === 'string' ? text : ''
  const lines = value.split(/\r?\n/)
  if (lines.length > maxLines) return { text: lines.slice(0, maxLines).join('\n'), folded: true }
  if (value.length > maxChars) return { text: value.slice(0, maxChars).trimEnd(), folded: true }
  return { text: value, folded: false }
}

export function runClock(startedAt) {
  const value = typeof startedAt === 'string' ? startedAt : ''
  const match = /T(\d\d:\d\d:\d\d)/.exec(value)
  return match ? match[1] : value
}

export function runOutcome(run, conversation = null) {
  if (!run) return ''
  if (run.running === true || conversation?.running === true) return 'running'
  if (run.killed === true) return 'stopped'
  if (Number.isInteger(run.exitCode)) return run.exitCode === 0 ? 'finished' : 'failed'
  if (typeof run.note === 'string' && run.note.trim() !== '') return run.note.trim()
  return 'ended'
}

export function toolText(entry) {
  const text = typeof entry?.text === 'string' ? entry.text.trim() : ''
  if (text) return text
  return typeof entry?.tool === 'string' ? entry.tool.trim() : ''
}
