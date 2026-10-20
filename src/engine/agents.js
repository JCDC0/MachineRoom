import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
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
const AGENT_FRONT = 220

const heading = new THREE.Vector3()
const chipNear = new THREE.Vector3()
const chipFar = new THREE.Vector3()
const traceEnd = new THREE.Vector3()
const calloutPos = new THREE.Vector3()
const camUp = new THREE.Vector3()
const rotMatrix = new THREE.Matrix4()

function makeCallout(agentName) {
  const element = document.createElement('div')
  element.className = 'mr-callout is-idle'
  element.style.display = 'none'

  const title = document.createElement('div')
  title.className = 'mr-callout-title'
  title.textContent = agentName.toUpperCase()

  const cmd = document.createElement('div')
  cmd.className = 'mr-callout-cmd'

  element.append(title, cmd)

  const object = new CSS3DObject(element)
  object.scale.setScalar(1.0)
  return { element, title, cmd, object, added: false }
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
    group.add(shape, ...rings, label, picker)

    const home = slotPoint(index, roster.length).add(new THREE.Vector3(0, PARK_LIFT, 0))
    group.position.copy(home)

    const link = lineBetween(lineMaterial(WHITE, 0.4))
    const trace = lineBetween(new THREE.LineDashedMaterial({ color: YELLOW, dashSize: 34, gapSize: 22, transparent: true, opacity: 0, depthWrite: false }))
    const tether = lineBetween(lineMaterial(WHITE, 0.3))
    tether.visible = false

    const callout = makeCallout(agent.name)
    const calloutLine = lineBetween(lineMaterial(YELLOW, 0.6))
    calloutLine.visible = false

    scene.add(group, link, trace, tether, calloutLine)
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
      callout,
      calloutLine,
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
    const firstTerm = terminals?.terminals?.values()?.next()?.value
    const parentScene = firstTerm?.object?.parent
    if (parentScene) {
      for (const view of views.values()) {
        if (view.callout && !view.callout.added) {
          parentScene.add(view.callout.object)
          view.callout.added = true
        }
      }
    }

    if (world.back && world.right) {
      camUp.crossVectors(world.back, world.right).normalize()
      rotMatrix.makeBasis(world.right, camUp, world.back)
    }

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

      const lastLine = entry?.lines?.[entry.lines.length - 1]
      const lastFailed = status === 'error' || lastLine?.tone === 'error' || Boolean(entry?.error)
      let calloutTone = null
      let calloutText = ''
      if (lastFailed && (working || status === 'error' || entry?.label)) {
        calloutTone = 'error'
        calloutText = entry?.label || entry?.error || 'FAILED'
      } else if (working) {
        calloutTone = 'working'
        calloutText = entry.label
      } else if (fresh) {
        calloutTone = 'done'
        calloutText = entry?.label && entry.label !== 'done' ? entry.label : 'FINISHED'
      }

      if (calloutTone) {
        view.callout.element.style.display = ''
        const calloutClass = `mr-callout is-${calloutTone}`
        if (view.callout.element.className !== calloutClass) {
          view.callout.element.className = calloutClass
        }
        if (view.callout.cmd.textContent !== calloutText) {
          view.callout.cmd.textContent = calloutText
        }

        const calloutSide = -view.chipSide
        calloutPos.copy(view.group.position)
        calloutPos.addScaledVector(world.right, calloutSide * 140)
        calloutPos.addScaledVector(camUp, 180)
        view.callout.object.position.copy(calloutPos)
        view.callout.object.quaternion.setFromRotationMatrix(rotMatrix)

        setEnds(view.calloutLine, view.group.position, calloutPos)
        const lineColor = calloutTone === 'error' ? RED : calloutTone === 'done' ? GREEN : YELLOW
        view.calloutLine.material.color.setHex(lineColor)
        view.calloutLine.visible = true
      } else {
        view.callout.element.style.display = 'none'
        view.calloutLine.visible = false
      }

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
      if (view.callout?.object?.parent) {
        view.callout.object.parent.remove(view.callout.object)
      }
      view.callout?.element?.remove()
      scene.remove(view.calloutLine)
      view.calloutLine.geometry.dispose()
      view.calloutLine.material.dispose()
    }
  }

  return { views, pickables, update, snap, aimAt, hubCenter: HUB_CENTER, dispose }
}
