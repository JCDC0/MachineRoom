import { effortLevels, modelChoices } from './agentStrip.js'
import { idFromName, ladderSubs } from './ladderForm.js'
import { AGENT_NAME_MAX, cleanText } from './sidebar.js'

export const DIRECT_HARNESS = 'machineroom'
export const DIRECT_LABEL = 'Direct API'
export const MAX_SUBS = 5

const KINDS = new Set(['orchestrator', 'sub', 'lane'])
const DEFAULT_LABEL = { orchestrator: 'Orchestrator', sub: 'Sub orchestrator', lane: 'Code agent' }
const KEY_NAME = /^[A-Za-z0-9 _-]+$/
const OPENCODE_DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash'

export function labelProblem(value) {
  const text = cleanText(value)
  if (!text) return 'Write a label for the agent.'
  if (text.length > AGENT_NAME_MAX) return `Keep the label to ${AGENT_NAME_MAX} characters.`
  return ''
}

function childRows(value) {
  const list = Array.isArray(value) ? value : []
  const ids = []
  for (const entry of list) {
    const id = cleanText(entry, 80)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function treeNode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanText(raw.id, 80)
  if (!id) return null
  const kind = KINDS.has(raw.kind) ? raw.kind : 'lane'
  return {
    id,
    kind,
    label: cleanText(raw.label, AGENT_NAME_MAX) || DEFAULT_LABEL[kind],
    harness: cleanText(raw.harness, 40),
    model: cleanText(raw.model, 120),
    effort: cleanText(raw.effort, 20),
    parent: cleanText(raw.parent, 80),
    requested: childRows(raw.children),
    active: raw.active !== false,
    working: raw.working === true,
    custom: raw.custom === true,
  }
}

export function familyTree(answer) {
  const source = answer && typeof answer === 'object' ? answer : {}
  const nodes = []
  const byId = new Map()
  for (const raw of Array.isArray(source.nodes) ? source.nodes : []) {
    const node = treeNode(raw)
    if (!node || byId.has(node.id)) continue
    nodes.push(node)
    byId.set(node.id, node)
  }
  for (const node of nodes) {
    if (node.parent && (node.parent === node.id || !byId.has(node.parent))) node.parent = ''
  }
  for (const node of nodes) {
    const ids = []
    for (const child of node.requested) {
      if (child === node.id) continue
      const target = byId.get(child)
      if (!target || target.parent !== node.id || ids.includes(child)) continue
      ids.push(child)
    }
    for (const other of nodes) {
      if (other.parent === node.id && other.id !== node.id && !ids.includes(other.id)) ids.push(other.id)
    }
    node.children = ids
  }
  const roots = nodes.filter((node) => !node.parent)
  const ordered = [
    ...roots.filter((node) => node.kind === 'orchestrator'),
    ...roots.filter((node) => node.kind !== 'orchestrator'),
  ]
  const rows = []
  const seen = new Set()
  function walk(node, depth) {
    if (!node || seen.has(node.id) || depth > 64) return
    seen.add(node.id)
    const { requested, ...rest } = node
    rows.push({ ...rest, depth })
    for (const child of node.children) walk(byId.get(child), depth + 1)
  }
  for (const root of ordered) walk(root, 0)
  for (const node of nodes) if (!seen.has(node.id)) walk(node, 0)
  return {
    nodes,
    rows,
    root: ordered[0] ?? null,
    byId,
    keys: keyNames(source.keys),
    proposals: proposalRows(source.proposals),
  }
}

export function familyMeta(node) {
  const harness = cleanText(node?.harness, 40) || 'harness unknown'
  const model = cleanText(node?.model, 120) || 'no model'
  const effort = cleanText(node?.effort, 20) || 'default'
  return `${harness} · ${model} · ${effort}`
}

export function stateWord(node) {
  if (node?.working === true) return 'working'
  if (node?.active === false) return 'off'
  return 'idle'
}

export function rowStateWord(node, state = '') {
  const word = typeof state === 'string' ? state.trim().toLowerCase() : ''
  if (word === 'working' || node?.working === true) return 'working'
  if (word === 'paused') return 'paused'
  return 'waiting'
}

export function rowText(node, state = '', task = '') {
  if (!node || typeof node !== 'object') return ''
  if (node.kind === 'lane') return node.working === true ? cleanText(task, 40) : ''
  return rowStateWord(node, state)
}

export function proposalRows(value) {
  const rows = []
  const seen = new Set()
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = cleanText(raw.id, 80)
    if (!id || seen.has(id)) continue
    seen.add(id)
    rows.push({
      id,
      from: cleanText(raw.from, 80),
      parent: cleanText(raw.parent, 80),
      label: cleanText(raw.label, AGENT_NAME_MAX) || DEFAULT_LABEL.lane,
      harness: cleanText(raw.harness, 40),
      model: cleanText(raw.model, 120),
      effort: cleanText(raw.effort, 20),
      reason: cleanText(raw.reason, 200),
      createdAt: cleanText(raw.createdAt, 40),
    })
  }
  return rows
}

export function keyNames(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.keys) ? value.keys : []
  const names = []
  for (const entry of list) {
    const name = cleanText(typeof entry === 'string' ? entry : entry?.name, 40)
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

export function keyFormProblem(name, value) {
  const text = cleanText(name)
  if (!text) return 'Write a name for the key slot.'
  if (text.length > 40) return 'Keep the key name to 40 characters.'
  if (!KEY_NAME.test(text)) return 'Use letters, digits, spaces, dashes or underscores in the key name.'
  if (typeof value !== 'string' || value.length === 0) return 'Write the key.'
  if (value.length > 500) return 'Keep the key to 500 characters.'
  return ''
}

function modelRows(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    const id = cleanText(typeof entry === 'string' ? entry : entry?.id, 120)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = cleanText(typeof entry === 'string' ? '' : entry?.label, 120)
    rows.push({ id, label: label || id })
  }
  return rows
}

function effortRows(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    const text = cleanText(entry, 20).toLowerCase()
    if (!text || seen.has(text)) continue
    seen.add(text)
    rows.push(text)
  }
  return rows
}

export function harnessList(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.harnesses) ? value.harnesses : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const key = cleanText(entry.key, 40)
    if (!key || seen.has(key)) continue
    seen.add(key)
    rows.push({
      key,
      name: cleanText(entry.name, 60) || key,
      available: entry.available === true,
      models: modelRows(entry.models),
      efforts: effortRows(entry.efforts),
    })
  }
  return rows
}

export function harnessGroups(value) {
  const all = harnessList(value)
  return {
    all,
    available: all.filter((row) => row.available),
    unavailable: all.filter((row) => !row.available),
  }
}

export function findHarness(value, key) {
  const wanted = cleanText(key, 40)
  if (!wanted) return null
  return harnessList(value).find((row) => row.key === wanted) ?? null
}

function harnessKey(harness) {
  if (typeof harness === 'string') return cleanText(harness, 40)
  return cleanText(harness?.key, 40)
}

export function harnessModels(harness, models) {
  const key = harnessKey(harness)
  if (harness && typeof harness === 'object') {
    const own = Array.isArray(harness.models) ? harness.models : []
    if (own.length > 0 || !key || harness.fallback !== true) return own
    return modelChoices(models, key)
  }
  return key ? modelChoices(models, key) : []
}

export function harnessEfforts(harness) {
  const key = harnessKey(harness)
  if (harness && typeof harness === 'object') {
    const own = Array.isArray(harness.efforts) ? harness.efforts : []
    if (own.length > 0 || !key || harness.fallback !== true) return [...own]
    return effortLevels(key)
  }
  return effortLevels(key)
}

export function directHarness(harnesses = null, models = null) {
  const listed = harnessList(harnesses).find((row) => row.key === DIRECT_HARNESS) ?? null
  const directModels = listed && listed.models.length > 0 ? listed.models : modelChoices(models, DIRECT_HARNESS)
  const directEfforts = listed && listed.efforts.length > 0 ? listed.efforts : effortLevels(DIRECT_HARNESS)
  return {
    key: DIRECT_HARNESS,
    name: DIRECT_LABEL,
    available: true,
    models: directModels,
    efforts: [...directEfforts],
  }
}

export function childHarnesses(harnesses = null, models = null) {
  const groups = harnessGroups(harnesses)
  return [
    ...groups.available.filter((row) => row.key !== DIRECT_HARNESS),
    directHarness(harnesses, models),
  ]
}

export function childDraft(harnesses = null, models = null) {
  const offered = childHarnesses(harnesses, models)
  const first = offered.find((row) => row.key === 'opencode') ?? offered[0] ?? null
  const own = first?.key === 'opencode'
  const preferredModel = own && first.models.some((row) => row.id === OPENCODE_DEFAULT_MODEL)
  return {
    label: '',
    harness: first?.key ?? '',
    model: preferredModel ? OPENCODE_DEFAULT_MODEL : first?.models?.[0]?.id ?? '',
    effort: own && first.efforts.includes('max') ? 'max' : first?.efforts?.[0] ?? '',
    key: '',
  }
}

export function childFormProblem(draft, { harnesses = null, models = null } = {}) {
  const problem = labelProblem(draft?.label)
  if (problem) return problem
  const offered = childHarnesses(harnesses, models)
  const harness = offered.find((row) => row.key === cleanText(draft?.harness, 40))
  if (!harness) return 'Choose a harness.'
  if (!harness.available) return 'That harness is not on this computer.'
  const choices = harnessModels(harness, models)
  if (choices.length === 0) return 'This harness has no models.'
  const model = cleanText(draft?.model, 120)
  if (!choices.some((row) => row.id === model)) return 'Choose a model for this harness.'
  const efforts = harnessEfforts(harness)
  const effort = cleanText(draft?.effort, 20).toLowerCase()
  if (efforts.length > 0 && !efforts.includes(effort)) return 'Choose an effort for this harness.'
  if (efforts.length === 0 && effort) return 'This harness has no effort levels.'
  return ''
}

export function childConfirmText(draft, parent) {
  if (parent?.kind === 'lane') {
    const label = cleanText(parent.label, AGENT_NAME_MAX) || cleanText(parent.id, 80) || 'This agent'
    return `${label} becomes a sub orchestrator and leads the new agent.`
  }
  const label = cleanText(draft?.label, AGENT_NAME_MAX) || 'the new agent'
  const under = cleanText(parent?.label, AGENT_NAME_MAX) || 'the orchestrator'
  return `Create "${label}" under ${under}?`
}

export function childDetail(draft, harnesses = null, models = null) {
  const harness = childHarnesses(harnesses, models).find((row) => row.key === cleanText(draft?.harness, 40))
  const name = harness?.name || cleanText(draft?.harness, 40) || 'the harness'
  const model = cleanText(draft?.model, 120) || 'no model'
  const effort = cleanText(draft?.effort, 20) || 'default'
  return [name, model, effort].join(' · ')
}

function cleanLaneIds(value) {
  const ids = []
  for (const entry of Array.isArray(value) ? value : []) {
    const id = cleanText(entry, 80)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function freeSubId(label, currentSubs, laneKeys = [], fallback = '') {
  const taken = new Set()
  for (const sub of Array.isArray(currentSubs) ? currentSubs : []) {
    const id = cleanText(sub?.id, 80)
    if (id) taken.add(id)
  }
  for (const key of Array.isArray(laneKeys) ? laneKeys : []) {
    const value = cleanText(key, 80)
    if (value) taken.add(value)
  }
  const base = idFromName(label) || idFromName(fallback) || 'sub'
  let root = base.slice(0, 24).replace(/-+$/g, '') || 'sub'
  if (root === 'orchestrator') root = 'orchestrator-sub'
  let id = root
  let number = 2
  while (taken.has(id)) {
    const suffix = `-${number}`
    id = `${root.slice(0, 24 - suffix.length).replace(/-+$/g, '')}${suffix}`
    number += 1
  }
  return id
}

export function convertPlan(ladder, node, childKey = '', laneKeys = []) {
  const subs = ladderSubs(ladder)
  const id = cleanText(node?.id, 80)
  const label = cleanText(node?.label, AGENT_NAME_MAX) || id || 'Sub orchestrator'
  const child = cleanText(childKey, 80)
  const empty = { problem: '', ladder: { subs }, sub: null, inactive: [] }
  if (!id) return { ...empty, problem: 'The lane has no name.' }
  if (subs.length >= MAX_SUBS) {
    return { ...empty, problem: `There are at most ${MAX_SUBS} sub orchestrators.` }
  }
  const subId = freeSubId(label, subs, laneKeys, id)
  const sub = {
    id: subId,
    name: label,
    harness: cleanText(node?.harness, 40),
    model: cleanText(node?.model, 120),
    lanes: child ? [child] : [],
    scope: ['**'],
    restricted: true,
    setBy: 'owner',
  }
  return {
    problem: '',
    ladder: { subs: [...subs, sub] },
    sub,
    inactive: [id],
  }
}

export function groupSubPlan(ladder, draft, laneIds, laneKeys = []) {
  const currentSubs = ladderSubs(ladder)
  const unchanged = { problem: '', ladder: { subs: currentSubs }, sub: null }
  const label = labelProblem(draft?.label)
  if (label) return { ...unchanged, problem: label }
  const selected = cleanLaneIds(laneIds)
  if (selected.length === 0) return { ...unchanged, problem: 'Select at least one code agent.' }
  if (currentSubs.length >= MAX_SUBS) {
    return { ...unchanged, problem: `There are at most ${MAX_SUBS} sub orchestrators.` }
  }
  const claimed = new Set(selected)
  const subs = []
  for (const sub of currentSubs) {
    const before = Array.isArray(sub.lanes) ? sub.lanes : []
    const lanes = before.filter((lane) => !claimed.has(lane))
    if (before.length > 0 && lanes.length === 0) continue
    subs.push(lanes.length === before.length ? sub : { ...sub, lanes })
  }
  const sub = {
    id: freeSubId(draft.label, currentSubs, laneKeys),
    name: String(draft.label ?? '').trim(),
    harness: draft.harness || 'opencode',
    model: draft.model || '',
    lanes: selected,
    scope: ['**'],
    restricted: false,
    setBy: 'owner',
  }
  return { problem: '', ladder: { subs: [...subs, sub] }, sub }
}

export function removeSubPlan(ladder, subId) {
  const subs = ladderSubs(ladder)
  const id = cleanText(subId, 80)
  const index = subs.findIndex((sub) => cleanText(sub?.id, 80) === id)
  if (index === -1) return { problem: 'Choose a sub orchestrator to remove.', ladder, removed: null }
  const removed = subs[index]
  return {
    problem: '',
    ladder: { subs: subs.filter((_, at) => at !== index) },
    removed,
  }
}

export function assignSubLanesPlan(ladder, subId, laneIds) {
  const currentSubs = ladderSubs(ladder)
  const unchanged = { problem: '', ladder: { subs: currentSubs }, sub: null }
  const selected = cleanLaneIds(laneIds)
  if (selected.length === 0) return { ...unchanged, problem: 'Select at least one code agent.' }
  const id = cleanText(subId, 80)
  const index = currentSubs.findIndex((sub) => cleanText(sub?.id, 80) === id)
  if (index === -1) return { ...unchanged, problem: 'Choose a sub orchestrator.' }
  const claimed = new Set(selected)
  const subs = currentSubs.map((sub, at) => {
    if (at === index) return { ...sub, lanes: selected }
    const before = Array.isArray(sub.lanes) ? sub.lanes : []
    const lanes = before.filter((lane) => !claimed.has(lane))
    return lanes.length === before.length ? sub : { ...sub, lanes }
  })
  return { problem: '', ladder: { subs }, sub: subs[index] }
}

export const TEAM_ORCHESTRATORS_MAX = 4
export const TEAM_CODERS_MAX = 3

function teamLaneRows(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.lanes) ? value.lanes : []
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    if (!entry || (typeof entry !== 'object' && typeof entry !== 'string')) continue
    const key = cleanText(typeof entry === 'string' ? entry : entry.key, 80)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = cleanText(typeof entry === 'string' ? '' : entry.name, AGENT_NAME_MAX) || key
    rows.push({ key, name, active: typeof entry === 'string' || entry.active !== false })
  }
  return rows
}

export function teamLanePool(lanes, ladder) {
  const claimed = new Set()
  for (const sub of ladderSubs(ladder)) {
    for (const lane of Array.isArray(sub.lanes) ? sub.lanes : []) {
      const key = cleanText(lane, 80)
      if (key) claimed.add(key)
    }
  }
  const rows = teamLaneRows(lanes).filter((row) => !claimed.has(row.key))
  return [...rows.filter((row) => row.active), ...rows.filter((row) => !row.active)]
}

export function teamDraft(harnesses = null, models = null) {
  if (harnessList(harnesses).length === 0) {
    return { orchestrators: 1, coders: 1, harness: '', model: '' }
  }
  const base = childDraft(harnesses, models)
  return {
    orchestrators: 1,
    coders: 1,
    harness: base.harness,
    model: base.model,
  }
}

export function teamHarnesses(harnesses = null, models = null) {
  const offered = childHarnesses(harnesses, models)
  return [
    ...offered.filter((row) => row.key === 'opencode'),
    ...offered.filter((row) => row.key !== 'opencode'),
  ]
}

export function teamPlan({
  lanes = null,
  ladder = null,
  orchestrators = 1,
  coders = 1,
  harness = '',
  model = '',
} = {}) {
  const existing = ladderSubs(ladder)
  const unchanged = { problem: '', subs: [...existing], teams: [], needed: 0, available: 0, missing: 0 }
  const count = Number(orchestrators)
  if (!Number.isInteger(count) || count < 1 || count > TEAM_ORCHESTRATORS_MAX) {
    return { ...unchanged, problem: `Choose 1 to ${TEAM_ORCHESTRATORS_MAX} orchestrators.` }
  }
  const each = Number(coders)
  if (!Number.isInteger(each) || each < 1 || each > TEAM_CODERS_MAX) {
    return { ...unchanged, problem: `Choose 1 to ${TEAM_CODERS_MAX} coders for each orchestrator.` }
  }
  if (existing.length + count > MAX_SUBS) {
    return { ...unchanged, problem: `There are at most ${MAX_SUBS} sub orchestrators.` }
  }
  const pool = teamLanePool(lanes, ladder)
  const needed = count * each
  const available = pool.length
  const missing = Math.max(0, needed - available)
  const takenNames = new Set()
  for (const sub of existing) {
    const name = cleanText(sub.name, AGENT_NAME_MAX)
    if (name) takenNames.add(name)
  }
  const laneKeys = pool.map((row) => row.key)
  const subs = [...existing]
  const teams = []
  let number = 1
  for (let index = 0; index < count; index += 1) {
    while (takenNames.has(`Team ${number}`)) number += 1
    const name = `Team ${number}`
    takenNames.add(name)
    const id = freeSubId(name, subs, laneKeys)
    const laneRows = pool.slice(index * each, index * each + each)
    const sub = {
      id,
      name,
      harness: cleanText(harness, 40) || 'opencode',
      model: cleanText(model, 120),
      lanes: laneRows.map((row) => row.key),
      scope: ['**'],
      restricted: false,
      setBy: 'owner',
    }
    subs.push(sub)
    teams.push({
      id,
      name,
      lanes: [...sub.lanes],
      laneNames: laneRows.map((row) => row.name),
    })
    number += 1
  }
  const problem =
    missing > 0 ? `Turn on ${missing} more ${missing === 1 ? 'lane' : 'lanes'} first.` : ''
  return { problem, subs, teams, needed, available, missing }
}
