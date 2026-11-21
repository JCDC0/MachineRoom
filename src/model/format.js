export function formatCount(value) {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (count === null || count < 0) return '?'
  if (count < 1000) return String(Math.floor(count))
  const millions = count >= 999950
  return `${(count / (millions ? 1000000 : 1000)).toFixed(1).replace(/\.0$/, '')}${millions ? 'M' : 'k'}`
}
