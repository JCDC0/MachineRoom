import { cleanText, projectName } from './sidebar.js'

export const SETUP_QUESTION = 'How many agents should work on this project?'
export const SETUP_START = 'Start fresh'
export const SETUP_LATER = 'Later'
export const SETUP_DEFAULT_COUNT = 2

let postponed = false

export function setupFromAnswer(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null
  const lanes = Array.isArray(answer.lanes)
    ? answer.lanes.filter(
        (lane) =>
          lane &&
          typeof lane.key === 'string' &&
          lane.key.trim() !== '' &&
          lane.hidden !== true
      )
    : []
  const declared = Number(answer.max)
  const hasMax =
    answer.max !== undefined &&
    answer.max !== null &&
    Number.isFinite(declared) &&
    declared >= 0
  const max = Math.min(hasMax ? Math.floor(declared) : lanes.length, lanes.length)
  return {
    lanes,
    max,
    chosen: answer.chosen === true,
  }
}

export function setupNeeded(answer) {
  const info = setupFromAnswer(answer)
  if (!info) return false
  return info.chosen === false && info.lanes.length > 0 && info.max > 0
}

export function clampAgentCount(value, max) {
  const top = Number.isFinite(Number(max)) ? Math.max(0, Math.floor(Number(max))) : 0
  if (top < 1) return 0
  const raw = Number(value)
  const count = Number.isFinite(raw) ? Math.floor(raw) : SETUP_DEFAULT_COUNT
  return Math.min(Math.max(count, 1), top)
}

export function initialAgentCount(max) {
  return clampAgentCount(SETUP_DEFAULT_COUNT, max)
}

export function pickedLanes(lanes, count) {
  const list = Array.isArray(lanes) ? lanes : []
  if (!(Number(count) > 0)) return []
  const take = clampAgentCount(count, list.length)
  if (take < 1) return []
  return list.slice(0, take)
}

export function laneKeys(lanes) {
  const list = Array.isArray(lanes) ? lanes : []
  const keys = []
  for (const lane of list) {
    if (!lane || typeof lane.key !== 'string') continue
    const key = lane.key.trim()
    if (key) keys.push(key)
  }
  return keys
}

export function setupSavePayload(lanes, count) {
  return {
    lanes: laneKeys(pickedLanes(lanes, count)),
    confirmed: true,
  }
}

export function setupCountLabel(count) {
  const value = Number(count) === 1 ? 1 : Math.max(0, Math.floor(Number(count)) || 0)
  return `${value} ${value === 1 ? 'agent' : 'agents'}`
}

export function setupStartLabel(count) {
  return `${SETUP_START} with ${setupCountLabel(count)}`
}

export function setupTeams(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.teams) ? answer.teams : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = cleanText(entry.name, 40)
    if (!name || seen.has(name)) continue
    seen.add(name)
    rows.push({ name })
  }
  return rows
}

export function setupProjects(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.recent) ? answer.recent : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const path = cleanText(entry.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    rows.push({ path, name: projectName(entry) })
  }
  return rows
}

export function setupPostponed() {
  return postponed
}

export function postponeSetup() {
  postponed = true
  return true
}

export function resetSetupPostponed() {
  postponed = false
}
