import { harnessByAdapter } from '../harnesses/index.js'
import { AGENT_ORDER } from '../model/pipeline.js'
import { FOLDER_SHAPE_ACCEPT, readFileList, readTreeVersion, rememberTreeVersion } from './tree.js'

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

function adapterHarness(adapterType) {
  const type = typeof adapterType === 'string' ? adapterType : ''
  return Object.hasOwn(harnessByAdapter, type) ? harnessByAdapter[type] : null
}

function adapterParser(adapterType) {
  const harness = adapterHarness(adapterType)
  return harness && harness.parserByAdapter !== false ? harness.key : null
}

export function parserFor(raw) {
  const direct = adapterParser(raw?.adapterType)
  if (direct) return direct
  const harness = adapterHarness(raw?.adapterType)
  if (!harness) return null
  const name = typeof raw?.name === 'string' ? raw.name.toLowerCase() : ''
  return name.includes(harness.key) ? harness.key : null
}

const SESSION_READER_SUFFIX = '-session'

function isSessionReaderKey(key) {
  return String(key ?? '').endsWith(SESSION_READER_SUFFIX)
}

export function diffRoster(previous, next) {
  const before = new Map()
  for (const agent of Array.isArray(previous) ? previous : []) {
    if (agent && typeof agent.key === 'string') before.set(agent.key, agent)
  }
  const after = new Map()
  for (const agent of Array.isArray(next) ? next : []) {
    if (agent && typeof agent.key === 'string') after.set(agent.key, agent)
  }
  const added = []
  const removed = []
  for (const [key, agent] of after) if (!before.has(key)) added.push(agent)
  for (const [key, agent] of before) if (!after.has(key)) removed.push(agent)
  const keptBefore = [...before.keys()].filter((key) => after.has(key))
  const keptAfter = [...after.keys()].filter((key) => before.has(key))
  const reordered = keptBefore.join('\n') !== keptAfter.join('\n')
  return { added, removed, reordered, changed: added.length > 0 || removed.length > 0 || reordered }
}

export function toAgents(rawAgents) {
  const taken = new Set()
  const agents = rawAgents.map((raw) => {
    const parser = parserFor(raw)
    const role = typeof raw?.role === 'string' && raw.role !== '' ? raw.role : null
    const sent = typeof raw?.key === 'string' && raw.key !== '' ? raw.key : null
    let key = sent ?? adapterParser(raw.adapterType) ?? slug(raw.name)
    if (taken.has(key)) {
      key = slug(raw.name)
      for (let n = 2; taken.has(key); n += 1) key = `${slug(raw.name)}-${n}`
    }
    taken.add(key)
    return {
      id: raw.id,
      key,
      name: raw.name,
      adapterType: raw.adapterType,
      role,
      parser,
      harness: typeof raw.harness === 'string' ? raw.harness : null,
      model: typeof raw.model === 'string' ? raw.model : null,
      subOrchestrator: raw.subOrchestrator === true,
      sessionReader: raw.sessionReader === true || isSessionReaderKey(key),
    }
  })
  const rank = (agent) => {
    const index = AGENT_ORDER.indexOf(agent.parser)
    return index === -1 ? AGENT_ORDER.length : index
  }
  return agents.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

async function getJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function loadTree(url, fetchImpl = fetch) {
  const raw = await getJson(fetchImpl, `${url}/api/tree`, { headers: { Accept: FOLDER_SHAPE_ACCEPT } })
  const list = readFileList(raw)
  if (list.error) throw new Error(list.error)
  const version = readTreeVersion(raw)
  rememberTreeVersion(url, version)
  return version === null ? list : { ...list, version }
}

export async function loadAgents(url, fetchImpl = fetch) {
  const raw = await getJson(fetchImpl, `${url}/api/agents`)
  return toAgents(Array.isArray(raw) ? raw : [])
}
