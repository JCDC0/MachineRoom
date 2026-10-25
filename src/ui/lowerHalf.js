export const REPLAY_LINE =
  'This is a recorded run. Connect to your project to talk to the orchestrator.'

export const OVERVIEW_ENTRIES = [
  { id: 'settings', title: 'Settings' },
  { id: 'agent', title: 'Agent' },
  { id: 'costs', title: 'Costs' },
  { id: 'log', title: 'Log' },
]

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

export function overviewEntries() {
  return OVERVIEW_ENTRIES.map(({ id, title }) => ({ id, title }))
}

export function drawerEntry(id) {
  const entry = OVERVIEW_ENTRIES.find((item) => item.id === id)
  return entry ? { id: entry.id, title: entry.title } : null
}
