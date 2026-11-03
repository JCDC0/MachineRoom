export const COSTS_ENTRY_SELECTOR = '.hud-overview-entry.is-costs'
export const COSTS_DRAWER_SELECTOR = '.hud-lower-right'

function cents(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function money(centsValue) {
  return `$${(cents(centsValue) / 100).toFixed(2)}`
}

export function spendTotals(board) {
  const rows = Array.isArray(board?.rows) ? board.rows : []
  const reported = rows.filter((row) => row && row.reported === true)
  const todayCents = reported.reduce((total, row) => total + cents(row.todayCents), 0)
  const monthCents = reported.reduce((total, row) => total + cents(row.costCents), 0)
  return { todayCents, monthCents, reported: reported.length > 0 }
}

export function spendText(board) {
  const totals = spendTotals(board)
  if (!totals.reported) return null
  return `${money(totals.todayCents)} today · ${money(totals.monthCents)} mo`
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function openCostsDrawer(doc = typeof document === 'undefined' ? null : document) {
  const find = doc && typeof doc.querySelector === 'function' ? (selector) => doc.querySelector(selector) : null
  if (!find) return false
  const entry = find(COSTS_ENTRY_SELECTOR)
  if (!entry || typeof entry.click !== 'function') return false
  entry.click()
  const drawer = find(COSTS_DRAWER_SELECTOR)
  if (drawer && typeof drawer.scrollIntoView === 'function') {
    drawer.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
  }
  return true
}
