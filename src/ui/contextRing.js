export const DEFAULT_CONTEXT_RULE = 80
export const CONTEXT_RED_SHARE = 0.95

const STATE_WORDS = {
  working: 'working',
  idle: 'waiting for you',
  paused: 'paused',
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function contextShare(tokens, window) {
  const used = numberOrNull(tokens)
  const size = numberOrNull(window)
  if (used === null || used < 0 || size === null || size <= 0) return null
  return Math.min(1, used / size)
}

export function contextTone(share, autocompactPercent = DEFAULT_CONTEXT_RULE) {
  if (share === null || typeof share !== 'number' || !Number.isFinite(share)) return 'white'
  if (share > CONTEXT_RED_SHARE) return 'red'
  const percent = numberOrNull(autocompactPercent)
  const rule = percent !== null && percent > 0 ? percent : DEFAULT_CONTEXT_RULE
  return share >= rule / 100 ? 'yellow' : 'white'
}

export function contextPercent(share) {
  if (share === null || typeof share !== 'number' || !Number.isFinite(share)) return null
  const clamped = Math.min(1, Math.max(0, share))
  return Math.round(clamped * 100)
}

export function contextLabel(tokens, window) {
  const share = contextShare(tokens, window)
  return share === null ? 'context not reported' : `${contextPercent(share)}%`
}

export function contextTitle(tokens, window) {
  if (contextShare(tokens, window) === null) return ''
  return `${tokens} of ${window} tokens`
}

export function orchestratorStateWord(state) {
  return typeof state === 'string' && Object.hasOwn(STATE_WORDS, state)
    ? STATE_WORDS[state]
    : STATE_WORDS.idle
}
