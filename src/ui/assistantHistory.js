export const MAX_HISTORY = 20
export const BLOCKED_MASK = '[hidden]'
export const DOCK_BREAKPOINT = 900
export const DEFAULT_TERMINAL_SIZE = Object.freeze({ width: 380, height: 280 })

export function addToHistory(history, text, limit = MAX_HISTORY) {
  const current = Array.isArray(history) ? history : []
  if (text == null) return [...current]
  const str = String(text)
  if (str !== BLOCKED_MASK && str.trim() === '') return [...current]
  const next = [...current, str]
  if (next.length > limit) {
    return next.slice(next.length - limit)
  }
  return next
}

export function stepHistory(history, currentIndex, direction, draft = '') {
  const list = Array.isArray(history) ? history : []
  if (list.length === 0) {
    return { index: -1, value: draft }
  }

  if (direction === 'up') {
    if (currentIndex === -1) {
      const index = list.length - 1
      return { index, value: list[index] }
    }
    const index = Math.max(0, currentIndex - 1)
    return { index, value: list[index] }
  }

  if (direction === 'down') {
    if (currentIndex === -1) {
      return { index: -1, value: draft }
    }
    if (currentIndex >= list.length - 1) {
      return { index: -1, value: draft }
    }
    const index = currentIndex + 1
    return { index, value: list[index] }
  }

  return { index: currentIndex, value: currentIndex === -1 ? draft : list[currentIndex] ?? draft }
}

export function clampPosition(pos, size = DEFAULT_TERMINAL_SIZE, windowSize = {}) {
  const width = size?.width && size.width > 0 ? size.width : DEFAULT_TERMINAL_SIZE.width
  const height = size?.height && size.height > 0 ? size.height : DEFAULT_TERMINAL_SIZE.height
  const winW = Math.max(0, windowSize?.windowWidth ?? windowSize?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280))
  const winH = Math.max(0, windowSize?.windowHeight ?? windowSize?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800))

  const maxX = Math.max(0, winW - width)
  const maxY = Math.max(0, winH - height)

  const rawX = Number(pos?.x ?? 0)
  const rawY = Number(pos?.y ?? 0)

  const x = Math.round(Math.min(Math.max(0, Number.isFinite(rawX) ? rawX : 0), maxX))
  const y = Math.round(Math.min(Math.max(0, Number.isFinite(rawY) ? rawY : 0), maxY))

  return { x, y }
}

export function getDefaultPosition(size = DEFAULT_TERMINAL_SIZE, windowSize = {}) {
  const width = size?.width && size.width > 0 ? size.width : DEFAULT_TERMINAL_SIZE.width
  const height = size?.height && size.height > 0 ? size.height : DEFAULT_TERMINAL_SIZE.height
  const winW = windowSize?.windowWidth ?? windowSize?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280)
  const winH = windowSize?.windowHeight ?? windowSize?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800)
  const preferredX = winW - width - 16
  const preferredY = winH - height - 88
  return clampPosition({ x: preferredX, y: preferredY }, size, windowSize)
}

export function isDocked(windowWidth, breakpoint = DOCK_BREAKPOINT) {
  const width = typeof windowWidth === 'number' ? windowWidth : (typeof window !== 'undefined' ? window.innerWidth : 1280)
  return width < breakpoint
}

export function getBlockedHistoryEntry() {
  return BLOCKED_MASK
}

export function getBlockedCommandLine() {
  return BLOCKED_MASK
}

export function getBlockedSay(result) {
  if (result && typeof result.say === 'string' && result.say.length > 0) {
    return result.say
  }
  return 'That looks like a key. I never read keys.'
}

export function formatCommandLine(text, isBlocked) {
  return isBlocked ? BLOCKED_MASK : String(text ?? '')
}
