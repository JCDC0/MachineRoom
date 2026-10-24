const ID_MAX = 24
const RESERVED_ID = 'orchestrator'

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

export function subFromForm(form) {
  const value = form && typeof form === 'object' ? form : {}
  const name = String(value.name ?? '').trim()
  const typedId = String(value.id ?? '').trim()
  const id = typedId || idFromName(name)
  const harness = value.harness === 'claude' || value.harness === 'opencode' ? value.harness : 'claude'
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
