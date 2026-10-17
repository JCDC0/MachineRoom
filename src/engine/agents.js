import * as THREE from 'three'
import { folderRoute } from './route.js'
import { RED, WHITE, YELLOW, lineMaterial, textSprite } from './sprites.js'
import { STRING_LIFT, curvePoint } from './strings.js'
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
const TRAVEL_HEIGHT = 300
const WORK_HEIGHT = 230
const TRAVEL_SPEED = 3400
const ARRIVE = 170
const AIM_HOLD = 4500
const SPREAD = 110
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const TAG_W = 512
const TAG_H = 64
const TAG_LIMIT = 34

const lift = new THREE.Vector3()
const lower = new THREE.Vector3()
const heading = new THREE.Vector3()

function makeTag() {
  const canvas = document.createElement('canvas')
  canvas.width = TAG_W
  canvas.height = TAG_H
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
  )
  sprite.scale.set(TAG_W * 0.8, TAG_H * 0.8, 1)
  sprite.position.set(0, 215, 0)
  sprite.renderOrder = 9
  return { sprite, canvas, texture, text: '', color: '' }
}

function paintTag(tag, text, color) {
  const shown = text.length > TAG_LIMIT ? `${text.slice(0, TAG_LIMIT - 1)}~` : text
  const context = tag.canvas.getContext('2d')
  context.clearRect(0, 0, TAG_W, TAG_H)
  context.font = '28px "Space Mono", monospace'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const plate = Math.ceil(context.measureText(shown).width) + 24
  context.fillStyle = 'rgba(0,0,0,0.78)'
  context.fillRect((TAG_W - plate) / 2, 8, plate, TAG_H - 16)
  context.strokeStyle = color
  context.globalAlpha = 0.6
  context.strokeRect((TAG_W - plate) / 2, 8, plate, TAG_H - 16)
  context.globalAlpha = 1
  context.fillStyle = color
  context.fillText(shown, TAG_W / 2, TAG_H / 2 + 1)
  tag.texture.needsUpdate = true
  tag.text = text
  tag.color = color
}

function legsFor(route) {
  const legs = []
  route.forEach((path, index) => {
    legs.push({ kind: 'folder', path })
    const next = route[index + 1]
    if (next !== undefined) {
      legs.push({ kind: 'curve', from: path, to: next, t: 1 / 3 })
      legs.push({ kind: 'curve', from: path, to: next, t: 2 / 3 })
    }
  })
  legs.push({ kind: 'final' })
  return legs
}

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
    const tag = makeTag()
    tag.sprite.position.y += (index % 3) * 62
    group.add(shape, ring, label, picker, tag.sprite)

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
      tag,
      tether,
      link,
      home,
      goal: home.clone(),
      touch: home.clone(),
      spread: new THREE.Vector3(Math.cos(index * GOLDEN) * SPREAD, 0, Math.sin(index * GOLDEN) * SPREAD),
      at: null,
      dest: null,
      legs: [],
      leg: 0,
      aim: null,
      doneAt: 0,
      style: 'idle',
    })
  })

  function setStatus(view, status, now) {
    if (view.style !== status && status === 'done') view.doneAt = now
    view.style = status
  }

  function aimAt(key, dir, file, now) {
    const view = views.get(key)
    if (view) view.aim = { dir, file, until: now + AIM_HOLD }
  }

  function legPoint(view, leg, world, now, out) {
    if (leg.kind === 'folder') {
      out.copy(world.center(leg.path))
      out.y += TRAVEL_HEIGHT
      return out
    }
    if (leg.kind === 'curve') {
      lift.copy(world.center(leg.from))
      lift.y += STRING_LIFT
      lower.copy(world.center(leg.to))
      lower.y += STRING_LIFT
      curvePoint(lift, lower, leg.t, out)
      out.y += TRAVEL_HEIGHT - STRING_LIFT
      return out
    }
    if (view.aim && now < view.aim.until) {
      world.slot(view.aim.dir, view.aim.file, out)
      view.touch.copy(out)
      out.y += WORK_HEIGHT
    } else {
      out.copy(world.center(view.dest))
      view.touch.copy(out)
      out.y += TRAVEL_HEIGHT
    }
    out.x += view.spread.x
    out.z += view.spread.z
    return out
  }

  function chase(view, entry, delta, now, world) {
    const dest = entry.target ?? ''
    if (view.dest !== dest) {
      view.dest = dest
      view.legs = legsFor(folderRoute(view.at ?? '', dest))
      view.leg = 0
    }
    const leg = view.legs[Math.min(view.leg, view.legs.length - 1)]
    legPoint(view, leg, world, now, view.goal)
    const position = view.group.position
    if (leg.kind === 'final') {
      position.lerp(view.goal, 1 - Math.exp(-delta * 4))
      return true
    }
    const distance = position.distanceTo(view.goal)
    const step = TRAVEL_SPEED * delta
    if (distance <= Math.max(step, ARRIVE)) {
      if (leg.kind === 'folder') view.at = leg.path
      view.leg += 1
      if (distance <= step) position.copy(view.goal)
    } else {
      heading.subVectors(view.goal, position).normalize()
      position.addScaledVector(heading, step)
    }
    return false
  }

  function update(state, delta, now, world, terminalPosition) {
    const time = now / 1000
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = entry?.status ?? 'idle'
      setStatus(view, status, now)
      const style = STYLE[status] ?? STYLE.idle

      const working = (status === 'working' || status === 'queued') && Boolean(entry?.label)
      let arrived = false
      if (working) {
        arrived = chase(view, entry, delta, now, world)
      } else {
        view.at = null
        view.dest = null
        view.aim = null
        view.goal.copy(view.home)
        view.group.position.lerp(view.goal, 1 - Math.exp(-delta * 2.6))
      }

      let opacity = style.opacity
      if (status === 'done') opacity = now - view.doneAt < 5000 ? 1 : 0.55
      view.shape.material.color.setHex(style.color)
      view.shape.material.opacity = opacity
      view.ring.material.color.setHex(style.color)
      view.ring.material.opacity = opacity * 0.6
      view.ring.scale.setScalar(working ? 1 + 0.14 * Math.sin(time * 5) : 1)
      view.shape.rotation.y += delta * style.spin
      view.shape.rotation.x += delta * style.spin * 0.45

      const text = working ? entry.label : ''
      const color = status === 'error' ? '#ff2a2a' : '#ffffff'
      if (text && (view.tag.text !== text || view.tag.color !== color)) paintTag(view.tag, text, color)
      view.tag.sprite.material.opacity += ((text ? 1 : 0) - view.tag.sprite.material.opacity) * Math.min(1, delta * 8)

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

      view.tether.visible = arrived
      if (arrived) {
        const array = view.tether.geometry.attributes.position.array
        array[0] = view.group.position.x
        array[1] = view.group.position.y - 60
        array[2] = view.group.position.z
        array[3] = view.touch.x
        array[4] = view.touch.y
        array[5] = view.touch.z
        view.tether.geometry.attributes.position.needsUpdate = true
        view.tether.material.color.setHex(WHITE)
        view.tether.material.opacity = 0.45
      }
    }
  }

  function snap(state, world) {
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const working = entry && (entry.status === 'working' || entry.status === 'queued') && entry.label
      view.aim = null
      if (working) {
        view.dest = entry.target ?? ''
        view.at = view.dest
        view.legs = [{ kind: 'final' }]
        view.leg = 0
        legPoint(view, view.legs[0], world, performance.now(), view.group.position)
      } else {
        view.at = null
        view.dest = null
        view.group.position.copy(view.home)
      }
    }
  }

  return { views, pickables, update, snap, aimAt }
}
