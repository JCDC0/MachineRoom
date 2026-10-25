export const PERCENT_MAX = 100
export const TOKENS_MIN = 1000
export const TOKENS_MAX = 10000000
export const RULES_LIMIT = 2000
export const DEFAULT_AUTOCOMPACT_PERCENT = 80
export const DEFAULT_CONTEXT_WINDOW = 200000
export const DEFAULT_COMPACT_RULES =
  "Keep the owner's goals and standing rules in the owner's words, the decisions made and why, each lane run started with its branch and result, the files changed, what is unfinished or blocked, and the next steps. Leave out tool output, logs and work already merged and checked."

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function autocompactMode(mode) {
  return mode === 'tokens' ? 'tokens' : 'percent'
}

export function contextWindowOf(value) {
  const number = isObject(value) ? parseNumber(value.contextWindow) : parseNumber(value)
  if (number === null || number <= 0) return DEFAULT_CONTEXT_WINDOW
  return Math.round(number)
}

export function defaultCompactRulesFor(value) {
  const row = isObject(value) ? value : {}
  const named = row.defaultCompactRules ?? row.DEFAULT_COMPACT_RULES
  if (typeof named === 'string' && named.trim() !== '') return named.trim()
  return DEFAULT_COMPACT_RULES
}

export function autocompactId(value) {
  const row = isObject(value) ? value : {}
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  return id || 'orchestrator'
}

export function autocompactState(value) {
  const row = isObject(value) ? value : {}
  const window = contextWindowOf(row)
  const mode = autocompactMode(row.autocompactMode)
  const saved = parseNumber(row.autocompactValue)
  const percent = parseNumber(row.autocompactPercent)
  let amount
  if (saved !== null) amount = saved
  else if (mode === 'tokens') {
    amount = convertAutocompactValue(
      percent ?? DEFAULT_AUTOCOMPACT_PERCENT,
      'percent',
      'tokens',
      window
    )
  } else {
    amount = percent ?? DEFAULT_AUTOCOMPACT_PERCENT
  }
  return {
    id: autocompactId(row),
    on: typeof row.autocompact === 'boolean' ? row.autocompact : true,
    mode,
    value: amount,
    rules: clampRules(row.compactRules),
    window,
    defaultCompactRules: defaultCompactRulesFor(row),
  }
}

export function convertAutocompactValue(value, from, to, window = DEFAULT_CONTEXT_WINDOW) {
  const number = parseNumber(value)
  if (number === null) return value
  if (from === to) return number
  const size = contextWindowOf(window)
  if (from === 'percent' && to === 'tokens') return Math.round((number / 100) * size)
  if (from === 'tokens' && to === 'percent') return Math.round((number / size) * 10000) / 100
  return number
}

export function compactsAtTokens(mode, value, window = DEFAULT_CONTEXT_WINDOW) {
  const number = parseNumber(value)
  if (number === null) return null
  const size = contextWindowOf(window)
  if (autocompactMode(mode) === 'tokens') return Math.round(number)
  return Math.round((number / 100) * size)
}

export function compactsAtLine(mode, value, window = DEFAULT_CONTEXT_WINDOW) {
  const tokens = compactsAtTokens(mode, value, window)
  if (tokens === null) return ''
  return `Compacts at ${tokens} of ${contextWindowOf(window)} tokens`
}

export function valueProblem(mode, value) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '')
  const tokens = autocompactMode(mode) === 'tokens'
  if (text === '') return tokens ? 'Enter a token count.' : 'Enter a percent.'
  const number = parseNumber(text)
  if (number === null) return tokens ? 'Enter a token count.' : 'Enter a percent.'
  if (tokens) {
    if (!Number.isInteger(number) || number < TOKENS_MIN || number > TOKENS_MAX) {
      return 'Tokens must be a whole number from 1000 to 10000000.'
    }
    return ''
  }
  if (number <= 0 || number > PERCENT_MAX) return 'Percent must be above 0 and at most 100.'
  return ''
}

export function clampRules(value) {
  return typeof value === 'string' ? value.slice(0, RULES_LIMIT) : ''
}

export function autocompactRequest({ id, on, mode, value, rules } = {}) {
  const nextMode = autocompactMode(mode)
  const number = parseNumber(value)
  const amount = number === null ? 0 : nextMode === 'tokens' ? Math.round(number) : number
  return {
    id: autocompactId({ id }),
    on: on !== false,
    mode: nextMode,
    value: amount,
    rules: clampRules(rules).trim(),
    confirmed: true,
  }
}
