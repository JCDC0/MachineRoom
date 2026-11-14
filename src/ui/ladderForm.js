const ID_MAX = 24
const RESERVED_ID = 'orchestrator'

import { harnessByKey } from '../harnesses/index.js'

function harnessKeyOf(entry) {
  if (typeof entry === 'string') return entry.trim()
  return String(entry?.key ?? entry?.harness ?? '').trim()
}

function keepHarness(value, allowed = null) {
  const key = String(value ?? '').trim()
  if (!key) return 'claude'
  if (Array.isArray(allowed)) {
    const keys = new Set(allowed.map((entry) => harnessKeyOf(entry)).filter(Boolean))
    return keys.has(key) ? key : 'claude'
  }
  return Object.hasOwn(harnessByKey, key) ? key : 'claude'
}

export function orchestratorHarnesses(orchestrators, harnesses = null) {
  const list = Array.isArray(orchestrators)
    ? orchestrators
    : Array.isArray(orchestrators?.orchestrators)
      ? orchestrators.orchestrators
      : []
  const raw = Array.isArray(orchestrators?.harnesses)
    ? orchestrators.harnesses
    : list.find((entry) => entry && Array.isArray(entry.harnesses))?.harnesses ?? null
  if (!raw) return null
  const known = Array.isArray(harnesses)
    ? harnesses
    : Array.isArray(harnesses?.harnesses)
      ? harnesses.harnesses
      : []
  const byKey = new Map()
  for (const item of known) {
    const key = harnessKeyOf(item)
    if (key && !byKey.has(key)) byKey.set(key, item)
  }
  const offered = []
  const seen = new Set()
  for (const entry of raw) {
    const key = harnessKeyOf(entry)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const base = byKey.get(key)
    const models =
      Array.isArray(entry?.models) && entry.models.length > 0
        ? entry.models
        : Array.isArray(base?.models)
          ? base.models
          : []
    const efforts = Array.isArray(entry?.efforts)
      ? entry.efforts
      : Array.isArray(base?.efforts)
        ? base.efforts
        : []
    const fallbackLabel = key === 'machineroom' ? 'Direct API' : (harnessByKey[key]?.name ?? key)
    const name =
      key === 'machineroom'
        ? 'Direct API'
        : String(entry?.name ?? '').trim() || String(base?.name ?? '').trim() || fallbackLabel
    offered.push({
      key,
      name,
      available: true,
      models,
      efforts,
    })
  }
  return offered
}

export function ladderSubs(ladder) {
  if (!ladder || !Array.isArray(ladder.subs)) return []
  return ladder.subs.filter((sub) => sub && typeof sub === 'object' && !Array.isArray(sub))
}

export function idFromName(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return ''
  let id = slug.slice(0, ID_MAX).replace(/-+$/g, '')
  if (id === RESERVED_ID) id = 'orchestrator-sub'
  return id
}

export function scopeLines(value) {
  const lines = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/)
  const clean = []
  for (const line of lines) {
    const text = String(line ?? '').trim()
    if (text && !clean.includes(text)) clean.push(text)
  }
  return clean
}

export function freeLanes(lanes, ladder, { except } = {}) {
  const claimed = new Set()
  for (const sub of ladderSubs(ladder)) {
    if (except && sub.id === except) continue
    if (!Array.isArray(sub.lanes)) continue
    for (const lane of sub.lanes) {
      if (typeof lane === 'string' && lane) claimed.add(lane)
    }
  }
  const free = []
  for (const lane of Array.isArray(lanes) ? lanes : []) {
    const key = typeof lane === 'string' ? lane.trim() : ''
    if (key && !claimed.has(key) && !free.includes(key)) free.push(key)
  }
  return free
}

export function subFromForm(form, allowed = null) {
  const value = form && typeof form === 'object' ? form : {}
  const name = String(value.name ?? '').trim()
  const typedId = String(value.id ?? '').trim()
  const id = typedId || idFromName(name)
  const harness = keepHarness(value.harness, allowed)
  const lanes = []
  for (const lane of Array.isArray(value.lanes) ? value.lanes : []) {
    const key = String(lane ?? '').trim()
    if (key && !lanes.includes(key)) lanes.push(key)
  }
  return {
    id,
    name: name || id,
    harness,
    model: String(value.model ?? '').trim(),
    lanes,
    scope: scopeLines(value.scope),
    restricted: value.restricted !== false,
    setBy: 'owner',
  }
}

export function addSub(ladder, sub) {
  return { subs: [...ladderSubs(ladder), sub] }
}

export function changeSub(ladder, sub) {
  const subs = ladderSubs(ladder).slice()
  const index = subs.findIndex((entry) => entry.id === sub.id)
  if (index === -1) subs.push(sub)
  else subs[index] = sub
  return { subs }
}

export function removeSub(ladder, id) {
  return { subs: ladderSubs(ladder).filter((sub) => sub.id !== id) }
}

export function ladderFromOrchestrators(list) {
  const subs = []
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) continue
    if (entry.id === RESERVED_ID) continue
    subs.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      harness: typeof entry.harness === 'string' ? entry.harness : '',
      model: typeof entry.model === 'string' ? entry.model : '',
      lanes: Array.isArray(entry.lanes) ? entry.lanes.filter((lane) => typeof lane === 'string' && lane) : [],
      scope: Array.isArray(entry.scope) ? entry.scope.filter((line) => typeof line === 'string' && line) : [],
      restricted: entry.restricted !== false,
      setBy: entry.setBy === 'orchestrator' ? 'orchestrator' : 'owner',
    })
  }
  return { subs }
}
