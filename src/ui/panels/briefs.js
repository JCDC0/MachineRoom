export const VALID_LANES = Object.freeze(['hermes', 'opencode', 'agy'])

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
      const label = OWNER_LABELS[ownerKey] ?? (rawOwner ? rawOwner : 'Owner')
      group = { owner: ownerKey, label, briefs: [] }
      byOwner.set(ownerKey, group)
      groups.push(group)
    }
    group.briefs.push(brief)
  }

  return groups
}

export const groupBriefs = groupBriefsByOwner
