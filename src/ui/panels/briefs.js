import { harnessByKey } from '../../harnesses/index.js'

function laneHarness(lane) {
  const name = String(lane ?? '').trim().toLowerCase()
  if (!name) return null
  if (Object.hasOwn(harnessByKey, name)) return harnessByKey[name]
  const match = /^(.*?)(\d+)$/.exec(name)
  if (!match) return null
  return Object.hasOwn(harnessByKey, match[1]) ? harnessByKey[match[1]] : null
}

function agentHarness(agent) {
  const key = typeof agent?.key === 'string' ? agent.key.trim() : ''
  if (!key || key === 'orchestrator' || key.startsWith('sub-') || key.endsWith('-session')) return null
  const harness = typeof agent?.harness === 'string' ? agent.harness.trim().toLowerCase() : ''
  return harness && Object.hasOwn(harnessByKey, harness) ? harness : null
}

function laneRecord(agent) {
  const key = typeof agent?.key === 'string' ? agent.key.trim() : ''
  if (!key) return null
  const harness = agentHarness(agent) ?? laneHarness(key)?.key ?? null
  return harness ? { key, harness } : null
}

function laneRecords(lanes) {
  if (Array.isArray(lanes)) {
    if (lanes.some((item) => item && typeof item === 'object')) {
      return lanes.map(laneRecord).filter(Boolean)
    }
    return lanes
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => laneRecord({ key: name }))
      .filter(Boolean)
  }
  if (lanes && typeof lanes === 'object') {
    if (Array.isArray(lanes.agents)) return lanes.agents.map(laneRecord).filter(Boolean)
    return Object.keys(lanes).map((key) => laneRecord({ key })).filter(Boolean)
  }
  return []
}

export function validLanes(agents) {
  if (!Array.isArray(agents)) return []
  const names = []
  const seen = new Set()
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object') continue
    const record = laneRecord(agent)
    if (!record || seen.has(record.key)) continue
    seen.add(record.key)
    names.push(record.key)
  }
  return names
}

export const OWNER_LABELS = Object.freeze({
  hermes: 'Hermes',
  opencode: 'OpenCode',
  agy: 'AGY',
  claude: 'Claude',
  owner: 'Owner',
})

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

export function ownerToLane(briefOrOwner, lanes) {
  const first = getFirstOwner(briefOrOwner)
  if (!first) return null
  const records = laneRecords(lanes)
  const exact = records.find((record) => record.key.toLowerCase() === first)
  if (exact) return exact.key
  const byHarness = records.find((record) => record.harness === first)
  return byHarness ? byHarness.key : null
}

function runningLaneNames(running) {
  const list = Array.isArray(running) ? running : []
  const names = []
  for (const item of list) {
    const name = typeof item === 'string' ? item : item && typeof item === 'object' ? item.lane : ''
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

function harnessName(lane) {
  return String(lane).replace(/\d+$/, '')
}

export function runLaneFor(brief, running, lanes) {
  const owner = ownerToLane(brief, lanes)
  if (!owner) return null
  const busy = new Set(runningLaneNames(running))
  if (!busy.has(owner)) return owner
  const records = laneRecords(lanes)
  const ownerHarness = records.find((record) => record.key === owner)?.harness ?? harnessName(owner)
  const free = records.find(
    (record) => record.key !== owner && record.harness === ownerHarness && !busy.has(record.key)
  )
  return free ? free.key : owner
}

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

export function briefTarget(briefs, id) {
  const wanted = typeof id === 'string' ? id.trim() : ''
  const list = Array.isArray(briefs) ? briefs : []
  const brief = wanted
    ? list.find((item) => item && typeof item === 'object' && item.id === wanted)
    : undefined
  if (brief) return { brief }
  return { problem: `Brief ${wanted} is not in the brief list.` }
}
