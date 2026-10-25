import { agentList } from './agentList.js'

export const STRIP_LOG_LIMIT = 3
export const WIDE_LAYOUT_MIN = 900
export const AUTOCOMPACT_MIN = 50
export const AUTOCOMPACT_MAX = 95
export const DEFAULT_AUTOCOMPACT_PERCENT = 80

const TONES = new Set(['normal', 'dim', 'error', 'done'])
const STATUS_TONES = {
  working: 'working',
  running: 'working',
  queued: 'queued',
  failed: 'error',
  error: 'error',
  finished: 'done',
  done: 'done',
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

export function statusTone(status) {
  const word = clean(status).toLowerCase()
  return Object.hasOwn(STATUS_TONES, word) ? STATUS_TONES[word] : 'idle'
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

export function laneLine(context) {
  if (!context || typeof context !== 'object') return ''
  const tokens = clean(context.tokens)
  const cost = clean(context.cost)
  const tokenText = tokens && tokens !== 'not reported' ? `Tokens ${tokens}` : 'Tokens not reported'
  const costText = cost && cost !== 'not reported' ? `${cost} this month` : 'cost not reported this month'
  return `${tokenText}, ${costText}`
}

export function stripLogLines(log, limit = STRIP_LOG_LIMIT) {
  if (!Array.isArray(log)) return []
  const wanted = Number.isInteger(limit) && limit > 0 ? limit : STRIP_LOG_LIMIT
  const lines = []
  for (const item of log) {
    let text = ''
    let tone = 'normal'
    if (typeof item === 'string') {
      text = clean(item)
    } else if (isObject(item)) {
      text = clean(item.text ?? item.line ?? item.message)
      tone = TONES.has(item.tone) ? item.tone : 'normal'
    }
    if (!text) continue
    lines.push({ text: `> ${text}`, tone })
  }
  return lines.slice(-wanted)
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

export function agentChoices(agents) {
  const list = agentList(agents, true).top
  const seen = new Set()
  const choices = []
  for (const agent of list) {
    const key = clean(agent?.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    choices.push({
      key,
      name: clean(agent?.name) || key,
      status: clean(agent?.status) || 'idle',
    })
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
