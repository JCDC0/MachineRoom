import * as THREE from 'three'
import { HUB_CENTER, PARK_LIFT, slotPoint } from './hub.js'
import { folderRoute } from './route.js'
import { isOrchestrator, shapeGeometry, shapesFor } from './shapes.js'
import { GREEN, RED, WHITE, YELLOW, lineMaterial, textSprite } from './sprites.js'

const STYLE = {
  idle: { color: WHITE, opacity: 0.35, spin: 0.15 },
  queued: { color: WHITE, opacity: 0.6, spin: 0.4 },
  working: { color: WHITE, opacity: 1, spin: 0.9 },
  error: { color: RED, opacity: 1, spin: 0.3 },
  done: { color: GREEN, opacity: 1, spin: 0.25 },
}
const TRAVEL_SPEED = 3400
const ARRIVE = 170
const AIM_HOLD = 4500
const DONE_GLOW_MS = 5000
const TAG_W = 512
const TAG_H = 64
const TAG_LIMIT = 34
const AGENT_FRONT = 220

const heading = new THREE.Vector3()
const chipNear = new THREE.Vector3()
const chipFar = new THREE.Vector3()
const traceEnd = new THREE.Vector3()

function makeTag() {
  const canvas = document.createElement('canvas')
  canvas.width = TAG_W
  canvas.height = TAG_H
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
  )
  sprite.scale.set(TAG_W * 0.8, TAG_H * 0.8, 1)
  sprite.position.set(0, 200, 0)
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

function lineBetween(material) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), material)
  line.frustumCulled = false
  return line
}

function setEnds(line, a, b) {
  const array = line.geometry.attributes.position.array
  array[0] = a.x
  array[1] = a.y
  array[2] = a.z
  array[3] = b.x
  array[4] = b.y
  array[5] = b.z
  line.geometry.attributes.position.needsUpdate = true
}

function flatRing(radius, opacity, y) {
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, radius, radius).getPoints(64)),
    lineMaterial(WHITE, opacity)
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = y
  return ring
}

export function createAgents(scene, roster) {
  const views = new Map()
  const pickables = []
  const shapes = shapesFor(roster)

  roster.forEach((agent, index) => {
    const group = new THREE.Group()
    const shape = new THREE.LineSegments(shapeGeometry(shapes[index]), lineMaterial(WHITE, 0.35))
    const orchestrator = isOrchestrator(agent)
    const rings = [flatRing(130, 0.2, -110)]
    if (orchestrator) rings.push(flatRing(158, 0.14, -110))
    const label = textSprite(agent.name.toUpperCase(), { scale: 1.5, color: 'rgba(255,255,255,.7)' })
    label.position.set(0, -150, 0)
    const picker = new THREE.Mesh(new THREE.SphereGeometry(170, 8, 8), new THREE.MeshBasicMaterial({ visible: false }))
    picker.userData.key = agent.key
    const tag = makeTag()
    group.add(shape, ...rings, label, picker, tag.sprite)

    const home = slotPoint(index, roster.length).add(new THREE.Vector3(0, PARK_LIFT, 0))
    group.position.copy(home)

    const link = lineBetween(lineMaterial(WHITE, 0.4))
    const trace = lineBetween(new THREE.LineDashedMaterial({ color: YELLOW, dashSize: 34, gapSize: 22, transparent: true, opacity: 0, depthWrite: false }))
    const tether = lineBetween(lineMaterial(WHITE, 0.3))
    tether.visible = false

    scene.add(group, link, trace, tether)
    pickables.push(picker)
    views.set(agent.key, {
      key: agent.key,
      index,
      orchestrator,
      shapeName: shapes[index],
      group,
      shape,
      rings,
      label,
      tag,
      link,
      trace,
      tether,
      home,
      goal: home.clone(),
      touch: home.clone(),
      at: null,
      dest: null,
      side: -1,
      chipSide: 1,
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

  function standoff(view, point, dir, world, out) {
    view.side = world.side(dir)
    return out.copy(point).addScaledVector(world.right, view.side * world.reach(dir)).addScaledVector(world.back, AGENT_FRONT)
  }

  function legPoint(view, leg, world, now, out) {
    if (leg.kind === 'folder') return standoff(view, world.center(leg.path), leg.path, world, out)
    if (view.aim && now < view.aim.until) {
      world.slot(view.aim.dir, view.aim.file, view.touch)
      return standoff(view, view.touch, view.aim.dir, world, out)
    }
    view.touch.copy(world.center(view.dest))
    return standoff(view, view.touch, view.dest, world, out)
  }

  function chase(view, entry, delta, now, world) {
    const dest = entry.target ?? ''
    if (view.dest !== dest) {
      view.dest = dest
      const route = folderRoute(view.at ?? '', dest)
      view.legs = [...route.slice(0, -1).map((path) => ({ kind: 'folder', path })), { kind: 'final' }]
      view.leg = 0
    }
    const leg = view.legs[Math.min(view.leg, view.legs.length - 1)]
    legPoint(view, leg, world, now, view.goal)
    const position = view.group.position
    if (leg.kind === 'final') {
      position.lerp(view.goal, 1 - Math.exp(-delta * 4))
      view.at = view.dest
      return true
    }
    const distance = position.distanceTo(view.goal)
    const step = TRAVEL_SPEED * delta
    if (distance <= Math.max(step, ARRIVE)) {
      view.at = leg.path
      view.leg += 1
      if (distance <= step) position.copy(view.goal)
    } else {
      heading.subVectors(view.goal, position).normalize()
      position.addScaledVector(heading, step)
    }
    return false
  }

  function traceTarget(view, world, out) {
    if (view.aim) return world.edge(view.aim.dir, view.aim.file, view.side, out)
    return world.edge(view.dest ?? '', null, view.side, out)
  }

  function update(state, delta, now, world, terminals) {
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
        view.side = -1
        view.goal.copy(view.home)
        view.group.position.lerp(view.goal, 1 - Math.exp(-delta * 2.6))
      }
      view.chipSide = -view.side

      const fresh = status === 'done' && now - view.doneAt < DONE_GLOW_MS
      const opacity = status === 'done' ? (fresh ? 1 : 0.6) : style.opacity
      view.shape.material.color.setHex(style.color)
      view.shape.material.opacity = opacity
      view.rings.forEach((ring, index) => {
        ring.material.color.setHex(style.color)
        ring.material.opacity = opacity * (index === 0 ? 0.55 : 0.4)
      })
      view.shape.rotation.y += delta * style.spin
      view.shape.rotation.x += delta * style.spin * 0.4

      const text = working ? entry.label : ''
      const color = status === 'error' ? '#ff2a2a' : '#e5ff00'
      if (text && (view.tag.text !== text || view.tag.color !== color)) paintTag(view.tag, text, color)
      view.tag.sprite.material.opacity += ((text ? 1 : 0) - view.tag.sprite.material.opacity) * Math.min(1, delta * 8)

      terminals.edgePoint(view.key, -view.chipSide, chipNear)
      setEnds(view.link, view.group.position, chipNear)
      view.link.material.color.setHex(style.color)
      view.link.material.opacity = working ? 0.6 : status === 'idle' ? 0.18 : 0.4

      const traceOn = arrived || fresh || (status === 'error' && view.dest !== null)
      const traceMaterial = view.trace.material
      traceMaterial.opacity += ((traceOn ? 0.95 : 0) - traceMaterial.opacity) * Math.min(1, delta * 6)
      view.trace.visible = traceMaterial.opacity > 0.02
      if (view.trace.visible) {
        terminals.edgePoint(view.key, view.chipSide, chipFar)
        if (traceOn) traceTarget(view, world, traceEnd)
        setEnds(view.trace, chipFar, traceEnd)
        view.trace.computeLineDistances()
        traceMaterial.color.setHex(status === 'error' ? RED : status === 'done' ? GREEN : YELLOW)
      }
      view.tether.visible = false
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

  function dispose() {
    for (const view of views.values()) {
      scene.remove(view.group, view.link, view.trace, view.tether)
      for (const root of [view.group, view.link, view.trace, view.tether]) {
        root.traverse((object) => {
          object.geometry?.dispose()
          object.material?.map?.dispose()
          object.material?.dispose()
        })
      }
    }
    views.clear()
    pickables.length = 0
  }

  return { views, pickables, update, snap, aimAt, dispose, hubCenter: HUB_CENTER }
}
