import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'

const VISIBLE_LINES = 7
const SCALE = 2
const TYPE_RATE = 0.075
const SIDE = 540
const RISE = 230
const FOLLOW_RATE = 6

export const TERMINAL_ATTACH = new THREE.Vector3(-320, -150, 0)

const right = new THREE.Vector3()
const up = new THREE.Vector3()
const goal = new THREE.Vector3()

export function createTerminals(cssScene, roster) {
  const terminals = new Map()

  roster.forEach((agent) => {
    const element = document.createElement('div')
    element.className = 'mr-term is-idle'
    element.dataset.agent = agent.key
    element.style.display = 'none'
    const title = document.createElement('div')
    title.className = 'mr-term-title'
    const body = document.createElement('div')
    body.className = 'mr-term-body'
    element.append(title, body)

    const object = new CSS3DObject(element)
    object.scale.setScalar(SCALE)
    object.visible = false
    cssScene.add(object)

    terminals.set(agent.key, {
      key: agent.key,
      name: agent.name,
      element,
      title,
      body,
      object,
      shown: false,
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

  function setShown(key, shown) {
    const term = terminals.get(key)
    if (!term || term.shown === shown) return
    term.shown = shown
    term.object.visible = shown
    term.element.style.display = shown ? '' : 'none'
  }

  function update(state, now, camera, focusKey, anchorOf, delta) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const rate = 1 - Math.exp(-delta * FOLLOW_RATE)
    for (const term of terminals.values()) {
      const anchor = anchorOf(term.key)
      if (anchor) {
        goal.copy(anchor).addScaledVector(right, SIDE).addScaledVector(up, RISE)
        if (term.placed) term.object.position.lerp(goal, rate)
        else term.object.position.copy(goal)
        term.placed = true
      }
      term.object.quaternion.copy(camera.quaternion)

      const entry = state.agents.get(term.key)
      if (!entry) continue
      if (entry.version !== term.version) render(term, entry, now)
      if (!term.shown) continue

      const last = term.rows[term.rows.length - 1]
      if (last && term.lastLine) {
        const typed = Math.min(term.lastLine.text.length, Math.floor((now - term.typedAt) * TYPE_RATE))
        if (last.textContent.length !== typed) last.textContent = term.lastLine.text.slice(0, typed)
      }
      term.element.className = `mr-term is-${entry.status}${focusKey && focusKey !== term.key ? ' is-muted' : ''}`
      term.title.textContent = `> ${term.name} // ${entry.status}`
    }
  }

  function attachPoint(key, out) {
    const term = terminals.get(key)
    out.copy(TERMINAL_ATTACH).multiplyScalar(SCALE / 2).applyQuaternion(term.object.quaternion).add(term.object.position)
    return out
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
    setShown,
    toggle: (key) => setShown(key, !terminals.get(key)?.shown),
    showAll: (shown) => terminals.forEach((term) => setShown(term.key, shown)),
    isShown: (key) => Boolean(terminals.get(key)?.shown),
    shownKeys: () => [...terminals.values()].filter((term) => term.shown).map((term) => term.key),
    positionOf: (key) => terminals.get(key).object.position,
    attachPoint,
    dispose,
  }
}
