import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'

const VISIBLE_LINES = 7
const SCALE = 1.2
const TYPE_RATE = 0.075
const FOLLOW_RATE = 6
const AGENT_GAP = 120
const CARD_GAP = 40
export const CHIP_W = 180
export const OPEN_W = 320
export const CHIP_REACH = AGENT_GAP + CHIP_W * SCALE + CARD_GAP

const right = new THREE.Vector3()
const up = new THREE.Vector3()
const goal = new THREE.Vector3()

export function chipHalfWidth(open) {
  return ((open ? OPEN_W : CHIP_W) * SCALE) / 2
}

export function createTerminals(cssScene, roster) {
  const terminals = new Map()

  roster.forEach((agent) => {
    const element = document.createElement('div')
    element.className = 'mr-term is-idle'
    element.dataset.agent = agent.key
    const title = document.createElement('div')
    title.className = 'mr-term-title'
    const body = document.createElement('div')
    body.className = 'mr-term-body'
    element.append(title, body)

    const object = new CSS3DObject(element)
    object.scale.setScalar(SCALE)
    cssScene.add(object)

    terminals.set(agent.key, {
      key: agent.key,
      name: agent.name,
      element,
      title,
      body,
      object,
      open: false,
      placed: false,
      version: -1,
      typedAt: 0,
      lastLine: null,
      rows: [],
    })
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

  function update(state, now, camera, focusKey, anchorOf, delta, sideOf = () => 1) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const rate = 1 - Math.exp(-delta * FOLLOW_RATE)
    for (const term of terminals.values()) {
      const anchor = anchorOf(term.key)
      if (anchor) {
        goal.copy(anchor).addScaledVector(right, sideOf(term.key) * (AGENT_GAP + chipHalfWidth(term.open)))
        if (term.open) goal.addScaledVector(up, -40)
        if (term.placed) term.object.position.lerp(goal, rate)
        else term.object.position.copy(goal)
        term.placed = true
      }
      term.object.quaternion.copy(camera.quaternion)

      const entry = state.agents.get(term.key)
      if (!entry) continue
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
      const title = term.open ? `${term.name} // ${entry.status}` : term.name
      if (term.title.textContent !== title) term.title.textContent = title
    }
  }

  function edgePoint(key, side, out) {
    const term = terminals.get(key)
    return out.copy(term.object.position).addScaledVector(right, side * chipHalfWidth(term.open))
  }

  function dispose() {
    for (const term of terminals.values()) {
      cssScene.remove(term.object)
      term.element.remove()
    }
    terminals.clear()
  }

  return {
    terminals,
    update,
    setOpen,
    toggle: (key) => setOpen(key, !terminals.get(key)?.open),
    openAll: (open) => terminals.forEach((term) => setOpen(term.key, open)),
    isOpen: (key) => Boolean(terminals.get(key)?.open),
    openKeys: () => [...terminals.values()].filter((term) => term.open).map((term) => term.key),
    positionOf: (key) => terminals.get(key).object.position,
    edgePoint,
    dispose,
  }
}
