import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'

const VISIBLE_LINES = 7
const SCALE = 2.6
const TYPE_RATE = 0.075
const WALL_SPACING = 880
const WALL_HEIGHT = 1250
const WALL_DEPTH = 100

export function createTerminals(cssScene, roster) {
  const terminals = new Map()

  roster.forEach((agent, index) => {
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
    object.position.set((index - (roster.length - 1) / 2) * WALL_SPACING, WALL_HEIGHT, WALL_DEPTH)
    cssScene.add(object)

    terminals.set(agent.key, {
      key: agent.key,
      name: agent.name,
      element,
      title,
      body,
      object,
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

  function update(state, now, camera, focusKey) {
    for (const term of terminals.values()) {
      const entry = state.agents.get(term.key)
      if (!entry) continue
      if (entry.version !== term.version) render(term, entry, now)

      const last = term.rows[term.rows.length - 1]
      if (last && term.lastLine) {
        const shown = Math.min(term.lastLine.text.length, Math.floor((now - term.typedAt) * TYPE_RATE))
        if (last.textContent.length !== shown) last.textContent = term.lastLine.text.slice(0, shown)
      }

      term.element.className = `mr-term is-${entry.status}${focusKey && focusKey !== term.key ? ' is-muted' : ''}`
      term.title.textContent = `> ${term.name} // ${entry.status}`
      term.object.quaternion.copy(camera.quaternion)
    }
  }

  function positionOf(key) {
    return terminals.get(key).object.position
  }

  function dispose() {
    for (const term of terminals.values()) {
      cssScene.remove(term.object)
      term.element.remove()
    }
    terminals.clear()
  }

  return { terminals, update, positionOf, dispose }
}

export const TERMINAL_DROP = new THREE.Vector3(0, -230, 0)
