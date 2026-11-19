export const RAIL_STEP = 0.05

export function railShareFromPointer(clientY, rect) {
  const height = Number(rect?.height)
  if (!Number.isFinite(height) || height <= 0) return 0
  return Math.min(1, Math.max(0, 1 - (Number(clientY) - Number(rect.top)) / height))
}

export function railStep(share, key) {
  const now = Math.min(1, Math.max(0, Number(share) || 0))
  const by = { ArrowUp: RAIL_STEP, ArrowRight: RAIL_STEP, ArrowDown: -RAIL_STEP, ArrowLeft: -RAIL_STEP, PageUp: RAIL_STEP * 4, PageDown: -RAIL_STEP * 4 }
  if (key === 'Home') return 0
  if (key === 'End') return 1
  if (!Object.hasOwn(by, key)) return null
  return Math.min(1, Math.max(0, now + by[key]))
}

export function multiplierText(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '1.0x'
  return `${num < 10 ? num.toFixed(1) : Math.round(num)}x`
}
