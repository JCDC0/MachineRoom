import * as THREE from 'three'
import { RED, WHITE, YELLOW, lineMaterial, textSprite } from './sprites.js'
import { TERMINAL_DROP } from './terminals.js'

const SHAPES = {
  claude: () => new THREE.IcosahedronGeometry(78, 0),
  hermes: () => new THREE.OctahedronGeometry(92, 0),
  opencode: () => new THREE.DodecahedronGeometry(76, 0),
  agy: () => new THREE.TetrahedronGeometry(100, 0),
}
const STYLE = {
  idle: { color: WHITE, opacity: 0.3, spin: 0.15 },
  queued: { color: WHITE, opacity: 0.6, spin: 0.4 },
  working: { color: WHITE, opacity: 1, spin: 1 },
  error: { color: RED, opacity: 1, spin: 0.3 },
  done: { color: YELLOW, opacity: 1, spin: 0.25 },
}
const HOME_RADIUS = 640
const HOME_HEIGHT = 280
const HOVER_HEIGHT = 340

export function createAgents(scene, roster) {
  const views = new Map()
  const pickables = []

  roster.forEach((agent, index) => {
    const group = new THREE.Group()
    const geometry = (SHAPES[agent.shape] ?? SHAPES.claude)()
    const shape = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial(WHITE, 0.3))
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 135, 135).getPoints(64)),
      lineMaterial(WHITE, 0.2)
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = -60
    const label = textSprite(agent.name.toUpperCase(), { scale: 2.3, color: 'rgba(255,255,255,.8)' })
    label.position.set(0, -170, 0)
    const picker = new THREE.Mesh(new THREE.SphereGeometry(180, 8, 8), new THREE.MeshBasicMaterial({ visible: false }))
    picker.userData.key = agent.key
    group.add(shape, ring, label, picker)

    const angle = Math.PI / 2 + (index / roster.length) * Math.PI * 2
    const home = new THREE.Vector3(Math.cos(angle) * HOME_RADIUS, HOME_HEIGHT, Math.sin(angle) * HOME_RADIUS)
    group.position.copy(home)

    const tether = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      lineMaterial(WHITE, 0.5)
    )
    tether.frustumCulled = false
    tether.visible = false

    const link = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      lineMaterial(WHITE, 0.18)
    )
    link.frustumCulled = false

    scene.add(group, tether, link)
    pickables.push(picker)
    views.set(agent.key, {
      key: agent.key,
      index,
      group,
      shape,
      ring,
      label,
      tether,
      link,
      home,
      goal: home.clone(),
      doneAt: 0,
      style: 'idle',
    })
  })

  function hoverGoal(view, anchor, out) {
    const outward = new THREE.Vector3(anchor.x, 0, anchor.z)
    const length = outward.length() || 1
    outward.divideScalar(length)
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x)
    const offset = (view.index - (views.size - 1) / 2) * 170
    out.copy(anchor).addScaledVector(tangent, offset)
    out.y = HOVER_HEIGHT
    return out
  }

  function setStatus(view, status, now) {
    if (view.style !== status && status === 'done') view.doneAt = now
    view.style = status
  }

  function update(state, delta, now, anchorFor, terminalPosition) {
    const time = now / 1000
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = entry?.status ?? 'idle'
      setStatus(view, status, now)
      const style = STYLE[status] ?? STYLE.idle

      const working = status === 'working' || status === 'queued'
      if (working && entry.target !== undefined && entry.label) {
        hoverGoal(view, anchorFor(entry.target), view.goal)
      } else {
        view.goal.copy(view.home)
      }
      view.group.position.lerp(view.goal, 1 - Math.exp(-delta * 2.6))

      let opacity = style.opacity
      if (status === 'done') opacity = now - view.doneAt < 5000 ? 1 : 0.55
      view.shape.material.color.setHex(style.color)
      view.shape.material.opacity = opacity
      view.ring.material.color.setHex(style.color)
      view.ring.material.opacity = opacity * 0.6
      view.ring.scale.setScalar(working ? 1 + 0.14 * Math.sin(time * 5) : 1)
      view.shape.rotation.y += delta * style.spin
      view.shape.rotation.x += delta * style.spin * 0.45

      const end = terminalPosition(view.key)
      const linkArray = view.link.geometry.attributes.position.array
      linkArray[0] = view.group.position.x
      linkArray[1] = view.group.position.y + 50
      linkArray[2] = view.group.position.z
      linkArray[3] = end.x + TERMINAL_DROP.x
      linkArray[4] = end.y + TERMINAL_DROP.y
      linkArray[5] = end.z + TERMINAL_DROP.z
      view.link.geometry.attributes.position.needsUpdate = true
      view.link.material.color.setHex(style.color)
      view.link.material.opacity = working ? 0.5 : status === 'idle' ? 0.14 : 0.35

      const showTether = working && entry.label
      view.tether.visible = Boolean(showTether)
      if (showTether) {
        const anchor = anchorFor(entry.target)
        const array = view.tether.geometry.attributes.position.array
        array[0] = view.group.position.x
        array[1] = view.group.position.y - 60
        array[2] = view.group.position.z
        array[3] = anchor.x
        array[4] = 0
        array[5] = anchor.z
        view.tether.geometry.attributes.position.needsUpdate = true
        view.tether.material.color.setHex(WHITE)
        view.tether.material.opacity = 0.45
      }
    }
  }

  function snap(state, anchorFor) {
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const working = entry && (entry.status === 'working' || entry.status === 'queued') && entry.label
      if (working) hoverGoal(view, anchorFor(entry.target), view.group.position)
      else view.group.position.copy(view.home)
    }
  }

  return { views, pickables, update, snap }
}
