export const VALID_LANES = Object.freeze(['hermes', 'opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5', 'agy'])

export const OWNER_LABELS = Object.freeze({
  hermes: 'Hermes',
  opencode: 'OpenCode',
  agy: 'AGY',
  claude: 'Claude',
  owner: 'Owner',
})

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getFirstOwner(briefOrOwner) {
  if (!briefOrOwner) return ''
  if (typeof briefOrOwner === 'string') {
    return briefOrOwner.trim().toLowerCase()
  }
  if (Array.isArray(briefOrOwner)) {
    const first = briefOrOwner.find((item) => typeof item === 'string' && item.trim().length > 0)
    return first ? first.trim().toLowerCase() : ''
  }
  if (typeof briefOrOwner === 'object') {
    if (Array.isArray(briefOrOwner.owners) && briefOrOwner.owners.length > 0) {
      const first = briefOrOwner.owners.find((item) => typeof item === 'string' && item.trim().length > 0)
      if (first) return first.trim().toLowerCase()
    }
    if (typeof briefOrOwner.owner === 'string' && briefOrOwner.owner.trim().length > 0) {
      return briefOrOwner.owner.trim().toLowerCase()
    }
  }
  return ''
}

export function formatBriefTitle(brief) {
  if (!brief || typeof brief !== 'object') return ''
  const id = typeof brief.id === 'string' ? brief.id.trim() : ''
  const title = typeof brief.title === 'string' ? brief.title.trim() : ''
  if (id && title) return `${id} ${title}`
  return id || title
}

export function ownerToLane(briefOrOwner) {
  const first = getFirstOwner(briefOrOwner)
  if (!first) return null
  if (VALID_LANES.includes(first)) return first
  return null
}

export const laneForBrief = ownerToLane

function runningLaneNames(running) {
  const list = Array.isArray(running) ? running : []
  const names = []
  for (const item of list) {
    const name = typeof item === 'string' ? item : item && typeof item === 'object' ? item.lane : ''
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

function laneNames(lanes) {
  if (Array.isArray(lanes)) {
    return lanes
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => name.trim())
  }
  if (lanes && typeof lanes === 'object') return Object.keys(lanes)
  return [...VALID_LANES]
}

function harnessName(lane) {
  return String(lane).replace(/\d+$/, '')
}

export function runLaneFor(brief, running, lanes) {
  const owner = ownerToLane(brief)
  if (!owner) return null
  const busy = new Set(runningLaneNames(running))
  if (!busy.has(owner)) return owner
  const harness = harnessName(owner)
  const free = laneNames(lanes).find(
    (name) => name !== owner && harnessName(name) === harness && !busy.has(name)
  )
  return free || owner
}

export function chooseAssignee(briefOrOwner, agents) {
  let target = briefOrOwner
  let list = agents
  if (
    Array.isArray(briefOrOwner) &&
    !Array.isArray(agents) &&
    briefOrOwner.some((item) => item && typeof item === 'object' && 'id' in item)
  ) {
    list = briefOrOwner
    target = agents
  }
  if (!Array.isArray(list) || list.length === 0) return ''
  const owner = getFirstOwner(target)
  if (!owner) return ''

  const exact = list.find(
    (agent) => typeof agent?.name === 'string' && agent.name.trim().toLowerCase() === owner
  )
  if (exact?.id) return exact.id

  const wordPattern = new RegExp(`\\b${escapeRegExp(owner)}\\b`, 'i')
  const wordMatch = list.find(
    (agent) => typeof agent?.name === 'string' && wordPattern.test(agent.name.trim())
  )
  if (wordMatch?.id) return wordMatch.id

  return ''
}

export const pickAssignee = chooseAssignee

export function groupBriefsByOwner(briefs) {
  if (!Array.isArray(briefs) || briefs.length === 0) return []
  const groups = []
  const byOwner = new Map()

  for (const brief of briefs) {
    if (!brief || typeof brief !== 'object' || brief.done) continue
    const rawOwner = getFirstOwner(brief)
    const ownerKey = rawOwner || 'owner'
    let group = byOwner.get(ownerKey)
    if (!group) {
      const label = Object.hasOwn(OWNER_LABELS, ownerKey) ? OWNER_LABELS[ownerKey] : rawOwner ? rawOwner : 'Owner'
      group = { owner: ownerKey, label, briefs: [] }
      byOwner.set(ownerKey, group)
      groups.push(group)
    }
    group.briefs.push(brief)
  }

  return groups
}

export const groupBriefs = groupBriefsByOwner

export function briefTarget(briefs, id) {
  const wanted = typeof id === 'string' ? id.trim() : ''
  const list = Array.isArray(briefs) ? briefs : []
  const brief = wanted
    ? list.find((item) => item && typeof item === 'object' && item.id === wanted)
    : undefined
  if (brief) return { brief }
  return { problem: `Brief ${wanted} is not in the brief list.` }
}
