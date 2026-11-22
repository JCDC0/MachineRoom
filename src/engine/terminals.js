import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { orchestratorNameLift } from './agents.js'
import { agentColors, cssColor, easeRate, paintAgentColor, still } from './sprites.js'

const VISIBLE_LINES = 7
const SCALE = 1.2
const TYPE_RATE = 0.075
const FOLLOW_RATE = 6
const AGENT_GAP = 120
const CARD_GAP = 40
const CONSOLE_ROWS = 5
const CONSOLE_HOLD_MS = 6000
const CONSOLE_TOOLS = new Set(['shell', 'other'])
export const CHIP_W = 98
export const OPEN_W = 320
export const CHIP_REACH = AGENT_GAP + CHIP_W * SCALE + CARD_GAP

const right = new THREE.Vector3()
const up = new THREE.Vector3()
const goal = new THREE.Vector3()

export function chipHalfWidth(open) {
  return ((open ? OPEN_W : CHIP_W) * SCALE) / 2
}

export function chipTitle(name, status, open) {
  if (!open) return ''
  const label = typeof name === 'string' ? name : ''
  return status ? `${label} // ${status}` : label
}

export function chipAriaLabel(name, status) {
  const label = typeof name === 'string' && name ? name : 'agent'
  const state = typeof status === 'string' && status ? status : 'idle'
  return `${label}, ${state}`
}

export const CHIP_SIDE_DEAD_BAND = 24

export function chipSideFromScreen(agentX, hubX, previous = 1, deadBand = CHIP_SIDE_DEAD_BAND) {
  const fallback = previous === -1 ? -1 : 1
  if (!Number.isFinite(agentX) || !Number.isFinite(hubX)) return fallback
  const band = Number.isFinite(deadBand) ? Math.max(0, deadBand) : CHIP_SIDE_DEAD_BAND
  const gap = agentX - hubX
  if (Math.abs(gap) <= band) return fallback
  return gap > 0 ? 1 : -1
}

export function consoleRows(lines, limit = CONSOLE_ROWS) {
  if (!Array.isArray(lines) || lines.length === 0) return []
  const count = Number.isFinite(limit) ? Math.floor(limit) : CONSOLE_ROWS
  if (count <= 0) return []
  return lines.slice(-count)
}

function labelFor(key, labels) {
  if (!labels) return null
  let value
  if (labels instanceof Map) value = labels.get(key)
  else if (typeof labels === 'object' && Object.hasOwn(labels, key)) value = labels[key]
  return typeof value === 'string' && value ? value : null
}

const WEB_ADDRESS = /https?:\/\/[^\s<>"'`]+/gi
const LOCAL_ADDRESS = /(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}/gi
const BARE_PORT = /:(\d{2,5})\b/g
const TRAILING_PUNCTUATION = /[.,;!?'"]+$/
const WEB_URL = /^https?:\/\//i
const LOCAL_URL = /^(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})$/i
const PORT_URL = /^:(\d{1,5})$/

function validPort(text) {
  const port = Number(text)
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function trimAddress(text) {
  let value = text.replace(TRAILING_PUNCTUATION, '')
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (value.endsWith(close)) {
      const opens = value.split(open).length - 1
      const closes = value.split(close).length - 1
      if (closes <= opens) break
      value = value.slice(0, -1)
    }
  }
  return value
}

function localPort(text) {
  return text.slice(text.lastIndexOf(':') + 1)
}

function insideWord(line, index) {
  return index > 0 && /[A-Za-z0-9_.-]/.test(line[index - 1])
}

export function addressIn(text) {
  const line = typeof text === 'string' ? text : ''
  if (line === '') return null
  let found = null
  WEB_ADDRESS.lastIndex = 0
  const web = WEB_ADDRESS.exec(line)
  if (web) found = { index: web.index, value: trimAddress(web[0]) }
  LOCAL_ADDRESS.lastIndex = 0
  let local = LOCAL_ADDRESS.exec(line)
  while (local && (!found || local.index < found.index)) {
    if (validPort(localPort(local[0])) && !insideWord(line, local.index)) {
      found = { index: local.index, value: local[0] }
      break
    }
    local = LOCAL_ADDRESS.exec(line)
  }
  BARE_PORT.lastIndex = 0
  let bare = BARE_PORT.exec(line)
  while (bare && (!found || bare.index < found.index)) {
    if (validPort(bare[1]) && !insideWord(line, bare.index)) {
      found = { index: bare.index, value: bare[0] }
      break
    }
    bare = BARE_PORT.exec(line)
  }
  return found ? found.value : null
}

export function addressUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || /\s/.test(text)) return null
  if (WEB_URL.test(text)) {
    try {
      const parsed = new URL(text)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : null
    } catch {
      return null
    }
  }
  const local = LOCAL_URL.exec(text)
  if (local && validPort(local[1])) return `http://${text}`
  const port = PORT_URL.exec(text)
  if (port && validPort(port[1])) return `http://localhost${text}`
  return null
}

export function createTerminals(cssScene, roster, { onPick = null } = {}) {
  const terminals = new Map()
  const notes = new Map()
  const subKeys = new Set()
  let currentLabels = null

  function addTerminal(key, name, color = null) {
    const element = document.createElement('div')
    element.className = 'mr-term is-idle'
    element.dataset.agent = key
    if (onPick) element.addEventListener('click', () => onPick(key))
    const title = document.createElement('div')
    title.className = 'mr-term-title'
    const body = document.createElement('div')
    body.className = 'mr-term-body'
    element.append(title, body)

    const object = new CSS3DObject(element)
    object.scale.setScalar(SCALE)
    object.visible = false
    cssScene.add(object)

    const term = {
      key,
      name,
      element,
      title,
      body,
      object,
      consoleVersion: -1,
      consoleData: null,
      open: false,
      side: 1,
      placed: false,
      visible: true,
      version: -1,
      ariaLabel: '',
      typedAt: 0,
      lastLine: null,
      rows: [],
      fade: '',
      agentColor: null,
    }
    terminals.set(key, term)
    setAgentColor(term, color)
    return term
  }

  function setAgentColor(term, color) {
    if (color === term.agentColorNumber) return false
    const value = cssColor(color)
    if (!value || term.agentColor === value) return false
    term.agentColorNumber = color
    term.agentColor = value
    return paintAgentColor(term.element, value)
  }

  function ensure(key, name, color = null) {
    if (String(key).startsWith('sub-')) subKeys.add(key)
    const term = terminals.get(key)
    if (term) {
      if (name && term.name !== name) term.name = name
      setAgentColor(term, color)
      return term
    }
    return addTerminal(key, name ?? key, color)
  }

  function setVisible(key, visible) {
    const term = terminals.get(key)
    if (!term || term.visible === visible) return
    term.visible = visible
    term.object.visible = visible && term.open
    if (!visible) term.open = false
  }

  function setFade(key, alpha) {
    const term = terminals.get(key)
    if (!term) return
    const value = alpha >= 0.999 ? '' : String(Math.max(0, alpha))
    if (term.fade === value) return
    term.fade = value
    term.element.style.opacity = value
  }

  function note(activity, at = performance.now()) {
    if (!activity || typeof activity.agent !== 'string') return
    const key = activity.agent
    if (activity.type === 'tool.start') {
      if (CONSOLE_TOOLS.has(activity.tool)) notes.set(key, { id: activity.id, tool: activity.tool, endAt: 0 })
      else notes.delete(key)
      return
    }
    if (activity.type === 'tool.end') {
      const open = notes.get(key)
      if (open && open.id === activity.id) open.endAt = at
      else notes.delete(key)
      return
    }
    notes.delete(key)
  }

  function clearNotes() {
    notes.clear()
    for (const term of terminals.values()) {
      term.consoleVersion = -1
      term.consoleData = null
    }
  }

  function consoleFor(key, entry, now = performance.now()) {
    const term = terminals.get(key)
    if (!term || !term.visible || !entry) return null
    const held = notes.get(key)
    if (!held) return null
    if (held.endAt > 0 && now - held.endAt >= CONSOLE_HOLD_MS) return null
    const version = typeof entry.version === 'number' ? entry.version : null
    if (version === null || term.consoleVersion !== version || !term.consoleData) {
      const rows = consoleRows(entry.lines)
      let address = null
      for (let index = rows.length - 1; index >= 0 && address === null; index -= 1) {
        address = addressIn(rows[index]?.text)
      }
      term.consoleVersion = version ?? -1
      term.consoleData = { rows, address, url: addressUrl(address), version }
    }
    return term.consoleData
  }

  function pick(key) {
    if (onPick) onPick(key)
  }

  const colors = agentColors(roster)
  roster.forEach((agent, index) => {
    if (agent?.subOrchestrator === true || String(agent?.key ?? '').startsWith('sub-')) subKeys.add(agent.key)
    addTerminal(agent.key, agent.name, colors[index])
  })

  function render(term, entry, now) {
    term.version = entry.version
    const lines = entry.lines.slice(-VISIBLE_LINES)
    while (term.rows.length < lines.length) {
      const row = document.createElement('div')
      row.className = 'mr-line'
      term.body.append(row)
      term.rows.push(row)
    }
    while (term.rows.length > lines.length) term.rows.pop().remove()
    lines.forEach((line, index) => {
      const row = term.rows[index]
      row.className = `mr-line is-${line.tone}`
      row.textContent = line.text
    })
    term.lastLine = lines[lines.length - 1] ?? null
    term.typedAt = now
  }

  function setOpen(key, open) {
    const term = terminals.get(key)
    if (term) term.open = open
  }

  function setLabels(labels) {
    currentLabels = labels instanceof Map || (labels && typeof labels === 'object') ? labels : null
  }

  function update(state, now, camera, focusKey, anchorOf, delta, sideOf = () => 1, colourOf = null) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const rate = easeRate(delta, FOLLOW_RATE, still())
    const nameLift = orchestratorNameLift(subKeys.size)
    for (const term of terminals.values()) {
      const anchor = anchorOf(term.key)
      if (anchor) {
        term.side = sideOf(term.key) < 0 ? -1 : 1
        goal.copy(anchor).addScaledVector(right, term.side * (AGENT_GAP + chipHalfWidth(term.open)))
        if (term.key === 'orchestrator') goal.addScaledVector(up, nameLift)
        if (term.open) goal.addScaledVector(up, -40)
        if (term.placed) term.object.position.lerp(goal, rate)
        else term.object.position.copy(goal)
        term.placed = true
      }
      term.object.quaternion.copy(camera.quaternion)

      const entry = state.agents.get(term.key)
      if (!entry) {
        setVisible(term.key, false)
        continue
      }
      if (colourOf) setAgentColor(term, colourOf(term.key))
      if (entry.parent) {
        const parentLabel = labelFor(entry.parent, currentLabels)
        const parentName = parentLabel ?? state.agents.get(entry.parent)?.name ?? entry.parent
        const name = `${parentName} > ${entry.name}`
        if (term.name !== name) term.name = name
      } else {
        const name = currentLabels ? labelFor(entry.key, currentLabels) ?? entry.key : entry.name ?? term.key
        if (term.name !== name) term.name = name
      }
      if (entry.version !== term.version) render(term, entry, now)
      if (term.open) {
        const last = term.rows[term.rows.length - 1]
        if (last && term.lastLine) {
          const typed = Math.min(term.lastLine.text.length, Math.floor((now - term.typedAt) * TYPE_RATE))
          if (last.textContent.length !== typed) last.textContent = term.lastLine.text.slice(0, typed)
        }
      }
      const className = `mr-term is-${entry.status}${term.open ? ' is-open' : ''}${focusKey && focusKey !== term.key ? ' is-muted' : ''}`
      if (term.element.className !== className) term.element.className = className
      term.object.visible = term.visible && term.open
      const title = chipTitle(term.name, entry.status, term.open)
      if (term.title.textContent !== title) term.title.textContent = title
      const aria = chipAriaLabel(term.name, entry.status)
      if (term.ariaLabel !== aria) {
        term.ariaLabel = aria
        term.element.setAttribute('aria-label', aria)
      }
    }
  }

  function edgePoint(key, side, out) {
    const term = terminals.get(key)
    const edge = term.side === -1 || term.side === 1 ? -term.side : side
    return out.copy(term.object.position).addScaledVector(right, edge * chipHalfWidth(term.open))
  }

  function remove(key) {
    const term = terminals.get(key)
    if (!term) return
    notes.delete(key)
    subKeys.delete(key)
    cssScene.remove(term.object)
    term.element.remove()
    terminals.delete(key)
  }

  function dispose() {
    for (const term of terminals.values()) {
      cssScene.remove(term.object)
      term.element.remove()
    }
    notes.clear()
    terminals.clear()
  }

  return {
    terminals,
    update,
    ensure,
    note,
    clearNotes,
    consoleFor,
    pick,
    setOpen,
    setLabels,
    setVisible,
    setFade,
    toggle: (key) => setOpen(key, !terminals.get(key)?.open),
    openAll: (open) => terminals.forEach((term) => setOpen(term.key, open)),
    isOpen: (key) => Boolean(terminals.get(key)?.open),
    openKeys: () => [...terminals.values()].filter((term) => term.open).map((term) => term.key),
    positionOf: (key) => terminals.get(key)?.object.position ?? new THREE.Vector3(),
    edgePoint,
    remove,
    dispose,
  }
}
