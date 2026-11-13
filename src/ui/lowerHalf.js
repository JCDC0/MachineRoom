export const REPLAY_LINE =
  'This is a recorded run. Connect to your project to talk to the orchestrator.'

export const REPLAY_LIVE_LINE =
  'This is a replay. Switch to Live to talk to the orchestrator.'

export function replayFoot({ connected = false } = {}) {
  if (connected) return { line: REPLAY_LIVE_LINE, connect: false }
  return { line: REPLAY_LINE, connect: true }
}

function cleanTitle(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function baseName(path) {
  const parts = String(path ?? '')
    .split(/[\\/]+/)
    .filter(Boolean)
  if (parts.length === 0) return ''
  const last = parts[parts.length - 1]
  return /^[A-Za-z]:$/.test(last) ? '' : last
}

export function lowerBreadcrumb(project, title) {
  const name = baseName(project).toUpperCase() || 'PROJECT'
  return `${name} / ${cleanTitle(title) || 'New conversation'}`
}

export function currentSessionTitle(answer) {
  const current = answer && typeof answer === 'object' ? answer.current : null
  return current && typeof current === 'object' ? cleanTitle(current.title) : ''
}
