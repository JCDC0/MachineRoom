import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { visibleText } from '../model/paths.js'
import { OVERVIEW, viewBasis } from './camera.js'
import { HUB_CENTER } from './hub.js'

export const BOARD_WIDTH = 280
export const BOARD_HEIGHT = 460
export const BOARD_SCALE = 2.4
export const BOARD_Y = -700
const BASIS = viewBasis(OVERVIEW.yaw, OVERVIEW.pitch)
const BOARD_AT = new THREE.Vector3(
  HUB_CENTER.x + BASIS.up.x * BOARD_Y,
  HUB_CENTER.y + BASIS.up.y * BOARD_Y,
  HUB_CENTER.z + BASIS.up.z * BOARD_Y
)

export function boardBox(scale = BOARD_SCALE) {
  return { x: 0, y: BOARD_Y, hw: (BOARD_WIDTH / 2) * scale, hh: (BOARD_HEIGHT / 2) * scale }
}

function formatMoney(cents) {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  return `$${(value / 100).toFixed(2)}`
}

function formatTokens(count) {
  if (count == null || !Number.isFinite(count)) return '?'
  if (count < 1000) return String(Math.floor(count))
  return `${(count / 1000).toFixed(1)}k`
}

export function boardLines(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board) || !board.summary || !Array.isArray(board.rows)) {
    return {
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    }
  }

  const spendCents = typeof board.summary.spendCents === 'number' && Number.isFinite(board.summary.spendCents) ? board.summary.spendCents : 0
  const budgetCents = typeof board.summary.budgetCents === 'number' && Number.isFinite(board.summary.budgetCents) ? board.summary.budgetCents : 0
  const spendStr = formatMoney(spendCents)
  const budgetStr = formatMoney(budgetCents)

  let summaryText
  if (budgetCents === 0) {
    summaryText = `SPENT ${spendStr}, NO BUDGET`
  } else {
    let percent = board.summary.percent
    if (percent == null || !Number.isFinite(percent)) {
      percent = (spendCents / budgetCents) * 100
    }
    const percentStr = (Math.round(percent * 10) / 10).toFixed(1)
    summaryText = `SPENT ${spendStr} OF ${budgetStr} (${percentStr}%)`
  }

  const summary = {
    text: summaryText,
    over: Boolean(board.summary.over),
  }

  const rows = board.rows.map((row) => {
    const reported = Boolean(row?.reported)
    const name = row?.name != null ? visibleText(row.name) : ''
    const key = row?.key ?? null

    if (!reported) {
      return {
        key,
        name,
        cost: 'not reported',
        tokens: null,
        share: null,
        reported: false,
      }
    }

    const cost = formatMoney(row.costCents)
    const tokens = `${formatTokens(row.inputTokens)} in / ${formatTokens(row.outputTokens)} out`
    const share = typeof row.share === 'number' && Number.isFinite(row.share) ? row.share : null

    return {
      key,
      name,
      cost,
      tokens,
      share,
      reported: true,
    }
  })

  const quota = []
  if (Array.isArray(board.quota)) {
    for (const item of board.quota) {
      if (!item || typeof item !== 'object') continue
      if (item.error != null) {
        const provider = item.provider ? item.provider.toUpperCase() : ''
        const text = provider ? `${provider} ${item.error}` : String(item.error)
        quota.push({ text: visibleText(text), error: true })
      } else {
        const provider = item.provider ? item.provider.toUpperCase() : ''
        const label = item.label ? item.label.toUpperCase() : ''
        const pct = item.usedPercent != null && Number.isFinite(item.usedPercent) ? `${Math.round(item.usedPercent)}%` : ''
        const text = [provider, label, pct].filter(Boolean).join(' ')
        quota.push({ text: visibleText(text), error: false })
      }
    }
  }

  return {
    summary,
    rows,
    quota,
    empty: null,
  }
}

export function createCostBoard(cssScene, { onPick = () => {} } = {}) {
  const element = document.createElement('div')
  element.className = 'mr-board'

  const title = document.createElement('div')
  title.className = 'mr-board-title'
  title.textContent = 'COSTS'

  const summaryEl = document.createElement('div')
  summaryEl.className = 'mr-board-summary'

  const rowsContainer = document.createElement('div')
  rowsContainer.className = 'mr-board-rows'

  const quotaContainer = document.createElement('div')
  quotaContainer.className = 'mr-board-quotas'

  const emptyEl = document.createElement('div')
  emptyEl.className = 'mr-board-empty'
  emptyEl.textContent = 'Costs not available.'

  element.append(title, summaryEl, rowsContainer, quotaContainer, emptyEl)

  const object = new CSS3DObject(element)
  object.scale.setScalar(BOARD_SCALE)
  object.position.copy(BOARD_AT)
  cssScene.add(object)

  function update(board) {
    const lines = boardLines(board)
    if (lines.empty) {
      emptyEl.textContent = lines.empty
      emptyEl.style.display = ''
      summaryEl.style.display = 'none'
      rowsContainer.style.display = 'none'
      quotaContainer.style.display = 'none'
      return
    }

    emptyEl.style.display = 'none'
    summaryEl.style.display = ''
    rowsContainer.style.display = ''
    quotaContainer.style.display = ''

    summaryEl.textContent = lines.summary.text
    summaryEl.className = `mr-board-summary${lines.summary.over ? ' is-over' : ''}`

    rowsContainer.textContent = ''
    for (const row of lines.rows) {
      const rowEl = document.createElement('div')
      rowEl.className = `mr-board-row${row.reported ? '' : ' is-dim'}`
      if (row.key) rowEl.dataset.key = row.key

      const head = document.createElement('div')
      head.className = 'mr-board-row-head'

      const name = document.createElement('span')
      name.className = 'mr-board-name'
      name.textContent = row.name

      const cost = document.createElement('span')
      cost.className = 'mr-board-cost'
      cost.textContent = row.cost

      head.append(name, cost)
      rowEl.append(head)

      if (row.tokens) {
        const meta = document.createElement('div')
        meta.className = 'mr-board-row-meta'
        const tokens = document.createElement('span')
        tokens.className = 'mr-board-tokens'
        tokens.textContent = row.tokens
        meta.append(tokens)
        rowEl.append(meta)
      }

      if (row.reported && row.share != null) {
        const track = document.createElement('div')
        track.className = 'mr-board-bar-track'
        const bar = document.createElement('div')
        bar.className = 'mr-board-bar'
        bar.style.width = `${Math.min(100, Math.max(0, Math.round(row.share * 100)))}%`
        track.append(bar)
        rowEl.append(track)
      }

      if (row.key) {
        rowEl.addEventListener('click', (event) => {
          event?.stopPropagation?.()
          onPick(row.key)
        })
      }

      rowsContainer.append(rowEl)
    }

    quotaContainer.textContent = ''
    for (const item of lines.quota) {
      const quotaEl = document.createElement('div')
      quotaEl.className = `mr-board-quota${item.error ? ' is-error' : ''}`
      quotaEl.textContent = item.text
      quotaContainer.append(quotaEl)
    }
  }

  function setVisible(visible) {
    object.visible = Boolean(visible)
  }

  function box() {
    return boardBox(object.scale.x)
  }

  function sphere() {
    const b = box()
    return { x: object.position.x, y: object.position.y, z: object.position.z, r: Math.hypot(b.hw, b.hh) }
  }

  function dispose() {
    cssScene.remove(object)
    element.remove()
  }

  update(null)

  return {
    object,
    box,
    sphere,
    update,
    setVisible,
    dispose,
  }
}
