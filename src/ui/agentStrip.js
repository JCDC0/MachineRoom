export const WIDE_LAYOUT_MIN = 900
export const AUTOCOMPACT_MIN = 50
export const AUTOCOMPACT_MAX = 95
export const DEFAULT_AUTOCOMPACT_PERCENT = 80
export const EFFORT_LEVELS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  opencode: ['low', 'medium', 'high', 'max'],
}

function clean(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value !== 'string') return ''
  return value.trim()
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function wideLayout(width) {
  const value = Number(width)
  return Number.isFinite(value) && value >= WIDE_LAYOUT_MIN
}

export function formatCount(value) {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (count === null || count < 0) return '?'
  if (count < 1000) return String(Math.floor(count))
  return `${(count / 1000).toFixed(1)}k`
}

export function contextLine(context) {
  const contextUse = context?.context
  if (!isObject(contextUse)) return ''
  const window = typeof contextUse.window === 'number' ? contextUse.window : null
  const tokens = typeof contextUse.tokens === 'number' ? contextUse.tokens : null
  if (window === null || window <= 0 || tokens === null || tokens < 0) {
    return 'Context size not reported'
  }
  return `Context size ${formatCount(tokens)} / ${formatCount(window)}`
}

export function harnessKey(value) {
  const text = clean(value).toLowerCase()
  if (!text || text === 'not reported') return ''
  return text.replace(/_(local|remote|adapter)$/, '').replace(/-local$/, '')
}

export function modelChoices(models, harness) {
  const list = Array.isArray(models)
    ? models
    : isObject(models) && Array.isArray(models.models)
      ? models.models
      : []
  const wanted = harnessKey(harness)
  const seen = new Set()
  const choices = []
  for (const row of list) {
    if (!isObject(row)) continue
    const id = clean(row.id)
    if (!id || seen.has(id)) continue
    if (wanted && harnessKey(row.harness) !== wanted) continue
    seen.add(id)
    choices.push({ id, label: clean(row.label) || id })
  }
  return choices
}

export function clampAutocompactPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_AUTOCOMPACT_PERCENT
  return Math.min(AUTOCOMPACT_MAX, Math.max(AUTOCOMPACT_MIN, Math.round(number)))
}

export function autocompactPercent(row) {
  const value = isObject(row) ? Number(row.autocompactPercent) : NaN
  if (!Number.isFinite(value)) return DEFAULT_AUTOCOMPACT_PERCENT
  return clampAutocompactPercent(value)
}

export function orchestratorId(key) {
  const text = clean(key)
  return text.toLowerCase().startsWith('sub-') ? text.slice(4) : text
}

export function effortLevels(harness) {
  const key = harnessKey(harness)
  if (!Object.hasOwn(EFFORT_LEVELS, key)) return []
  return [...EFFORT_LEVELS[key]]
}

export function effortLabel(value, harness) {
  const text = clean(value).toLowerCase()
  const levels = effortLevels(harness)
  return levels.includes(text) ? text : 'default'
}

export function orchestratorRows(value) {
  if (Array.isArray(value)) return value.filter(isObject)
  if (isObject(value) && Array.isArray(value.orchestrators)) return value.orchestrators.filter(isObject)
  if (isObject(value) && typeof value.id === 'string') return [value]
  return []
}

export function orchestratorEntry(value, key) {
  const wanted = orchestratorId(key).toLowerCase()
  if (!wanted) return null
  return (
    orchestratorRows(value).find((row) => {
      const id = clean(row.id).toLowerCase()
      const sub = clean(row.key).toLowerCase()
      return id === wanted || id === `sub-${wanted}` || sub === `sub-${wanted}`
    }) ?? null
  )
}

export function orchestratorEffort(value, key) {
  return clean(orchestratorEntry(value, key)?.effort).toLowerCase()
}
