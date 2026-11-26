import { SESSION_HARNESSES } from '../harnesses/index.js'

export const LANE_START_TOP_MS = 10 * 60 * 1000

const SESSION_KEYS = new Map(SESSION_HARNESSES.map((harness) => [harness.key, harness.sessionKey]))
const SESSION_TOP_KEYS = new Set(SESSION_KEYS.values())

export function cleanStartedBy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const harness = typeof value.harness === 'string' ? value.harness.trim() : ''
  const session = typeof value.session === 'string' ? value.session.trim() : ''
  if (!harness || !session) return null
  return { harness, session }
}

export function sessionKeyFor(startedBy) {
  const value = cleanStartedBy(startedBy)
  return value ? SESSION_KEYS.get(value.harness) ?? '' : ''
}

function sessionSawStart(session, startedBy) {
  const seen = session?.sessions
  if (!(seen instanceof Set) || seen.size === 0) return true
  return seen.has(startedBy.session)
}

export function isSessionTopKey(key) {
  return SESSION_TOP_KEYS.has(key)
}

export function topKeyFor({ chosenTop = '', laneTop = '', viewKeys = null } = {}) {
  const drawn = viewKeys instanceof Set ? viewKeys.has(chosenTop) : Array.isArray(viewKeys) && viewKeys.includes(chosenTop)
  if (drawn && isSessionTopKey(chosenTop)) return chosenTop
  return typeof laneTop === 'string' && laneTop !== '' ? laneTop : 'orchestrator'
}

function childStart(child) {
  if (Number.isFinite(child?.startedAt) && child.startedAt > 0) return child.startedAt
  return Number.isFinite(child?.endedAt) ? child.endedAt : 0
}

export function delegatingSessionTop({ agents, at, windowMs = LANE_START_TOP_MS } = {}) {
  if (!agents || typeof agents.get !== 'function' || typeof agents.values !== 'function') return ''
  const now = Number.isFinite(at) ? at : 0
  const span = Number.isFinite(windowMs) ? windowMs : LANE_START_TOP_MS
  let best = ''
  let bestOpen = false
  let bestAt = -Infinity
  for (const session of agents.values()) {
    const key = session?.key
    if (!isSessionTopKey(key) || session.parent) continue
    let open = false
    let when = -Infinity
    for (const child of agents.values()) {
      if (child?.parent !== key) continue
      const running = child.status === 'working' || child.status === 'queued'
      const endedAt = Number.isFinite(child.endedAt) ? child.endedAt : 0
      const fresh = endedAt > 0 && now >= endedAt && now - endedAt <= span
      if (!running && !fresh) continue
      if (running) open = true
      const started = childStart(child)
      if (started > when) when = started
    }
    if (when === -Infinity) continue
    if (best === '' || (open && !bestOpen) || (open === bestOpen && when > bestAt)) {
      best = key
      bestOpen = open
      bestAt = when
    }
  }
  return best
}

export function laneStarterTop({ agents, at, orchestratorKey = 'orchestrator', windowMs = LANE_START_TOP_MS } = {}) {
  if (!agents || typeof agents.get !== 'function') return ''
  const own = agents.get(orchestratorKey)
  if (own?.status === 'working' || own?.status === 'queued') return ''
  const now = Number.isFinite(at) ? at : 0
  let best = ''
  let bestOpen = false
  let bestAt = -Infinity
  for (const agent of agents.values()) {
    const startedBy = cleanStartedBy(agent?.startedBy)
    if (!startedBy) continue
    const sessionKey = sessionKeyFor(startedBy)
    if (!sessionKey || sessionKey === agent.key) continue
    const session = agents.get(sessionKey)
    if (!session || !sessionSawStart(session, startedBy)) continue
    const open = agent.status === 'working' || agent.status === 'queued'
    const endedAt = Number.isFinite(agent.endedAt) ? agent.endedAt : 0
    const beganAt = Number.isFinite(agent.startedAt) ? agent.startedAt : endedAt
    if (!open && !(endedAt > 0 && now >= endedAt && now - endedAt <= windowMs)) continue
    const when = open ? beganAt || endedAt : endedAt
    if (best === '' || (open && !bestOpen) || (open === bestOpen && when > bestAt)) {
      best = sessionKey
      bestOpen = open
      bestAt = when
    }
  }
  return best
}
