export const LANE_START_TOP_MS = 10 * 60 * 1000

const SESSION_KEYS = { claude: 'claude-session', opencode: 'opencode-session' }

export function cleanStartedBy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const harness = typeof value.harness === 'string' ? value.harness.trim() : ''
  const session = typeof value.session === 'string' ? value.session.trim() : ''
  if (!harness || !session) return null
  return { harness, session }
}

export function sessionKeyFor(startedBy) {
  const value = cleanStartedBy(startedBy)
  return value ? SESSION_KEYS[value.harness] ?? '' : ''
}

function sessionSawStart(session, startedBy) {
  const seen = session?.sessions
  if (!(seen instanceof Set) || seen.size === 0) return true
  return seen.has(startedBy.session)
}

export function laneStarterTop({ agents, at, orchestratorKey = 'orchestrator', windowMs = LANE_START_TOP_MS } = {}) {
  if (!agents || typeof agents.get !== 'function') return ''
  const own = agents.get(orchestratorKey)
  if (!own) return ''
  if (own.status === 'working' || own.status === 'queued') return ''
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
