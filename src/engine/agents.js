import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { dirname } from '../model/paths.js'
import { HUB_CENTER, ORCHESTRATOR_HOME, PARK_LIFT, slotPoint } from './hub.js'
import { isOrchestrator, nextSpareShape, shapeGeometry, shapesFor } from './shapes.js'
import { GREEN, RED, WHITE, YELLOW, easeRate, lineMaterial, still, textSprite } from './sprites.js'

const STYLE = {
  idle: { color: WHITE, opacity: 0.35, spin: 0.15 },
  queued: { color: WHITE, opacity: 0.6, spin: 0.4 },
  working: { color: WHITE, opacity: 1, spin: 0.9 },
  error: { color: RED, opacity: 1, spin: 0.3 },
  done: { color: GREEN, opacity: 1, spin: 0.25 },
}
const AIM_HOLD = 4500
const DONE_GLOW_MS = 5000
const CHILD_FADE_MS = 1500
const STRIP_RISE = 190
const STRIP_RUN = 120
const STRIP_WIDTH = 9
const STRIP_OPACITY = 0.9
export const CHILD_SCALE = 0.6
export const CHILD_TURN = Math.PI / 5
export const CHILD_GAP = 120

export function nameLabel(name) {
  if (typeof name !== 'string') return ''
  const label = name.toUpperCase()
  return label.length > 32 ? `${label.slice(0, 31)}~` : label
}

export function childPlace(parentPlace, index = 0) {
  const x = Number(parentPlace?.x) || 0
  const y = Number(parentPlace?.y) || 0
  const z = Number(parentPlace?.z) || 0
  const slot = Math.max(0, Math.floor(Number(index) || 0))
  const side = slot % 2 === 0 ? 1 : -1
  const rank = Math.floor(slot / 2) + 1
  const turn = side * rank * CHILD_TURN
  const radius = Math.hypot(x, z)
  if (radius < 1) {
    return { x: x + Math.cos(turn) * CHILD_GAP * rank, y, z: z + Math.sin(turn) * CHILD_GAP * rank }
  }
  const angle = Math.atan2(z, x) + turn
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius }
}

export function stripPoints(from, to, { rise = STRIP_RISE, run = STRIP_RUN, side = 1, right = null } = {}) {
  const start = { x: from.x, y: from.y, z: from.z }
  const end = { x: to.x, y: to.y, z: to.z }
  let ux
  let uz
  if (right) {
    const flat = Math.hypot(right.x, right.z) || 1
    ux = (-right.x / flat) * side
    uz = (-right.z / flat) * side
  } else {
    const dx = end.x - start.x
    const dz = end.z - start.z
    const flat = Math.hypot(dx, dz)
    ux = flat > 1e-9 ? dx / flat : 1
    uz = flat > 1e-9 ? dz / flat : 0
  }
  return [
    start,
    { x: start.x, y: start.y + rise, z: start.z },
    { x: end.x - ux * run, y: end.y, z: end.z - uz * run },
    end,
  ]
}

const chipNear = new THREE.Vector3()
const traceEnd = new THREE.Vector3()
const stripStart = new THREE.Vector3()
const calloutPos = new THREE.Vector3()
const camUp = new THREE.Vector3()
const rotMatrix = new THREE.Matrix4()

function makeCallout(agentName) {
  const element = document.createElement('div')
  element.className = 'mr-callout'

  const title = document.createElement('div')
  title.className = 'mr-callout-title'
  title.textContent = agentName.toUpperCase()

  const task = document.createElement('div')
  task.className = 'mr-callout-task'

  const cmd = document.createElement('div')
  cmd.className = 'mr-callout-cmd'

  element.append(title, task, cmd)

  const object = new CSS3DObject(element)
  object.visible = false
  return { element, title, task, cmd, object }
}

function lineBetween(material) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), material)
  line.frustumCulled = false
  return line
}

function bandLine(material) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3))
  const line = new THREE.Line(geometry, material)
  line.frustumCulled = false
  line.visible = false
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

function setPoints(line, points) {
  const array = line.geometry.attributes.position.array
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    array[index * 3] = point.x
    array[index * 3 + 1] = point.y
    array[index * 3 + 2] = point.z
  }
  line.geometry.attributes.position.needsUpdate = true
}

function bandEdges(points, right, up, width) {
  const half = width / 2
  const front = []
  const back = []
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const dz = next.z - previous.z
    const tx = dx * right.x + dy * right.y + dz * right.z
    const ty = dx * up.x + dy * up.y + dz * up.z
    const length = Math.hypot(tx, ty) || 1
    const nx = -ty / length
    const ny = tx / length
    const offsetX = right.x * nx * half + up.x * ny * half
    const offsetY = right.y * nx * half + up.y * ny * half
    const offsetZ = right.z * nx * half + up.z * ny * half
    const point = points[index]
    front.push({ x: point.x + offsetX, y: point.y + offsetY, z: point.z + offsetZ })
    back.push({ x: point.x - offsetX, y: point.y - offsetY, z: point.z - offsetZ })
  }
  return { front, back }
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

export function createAgents(scene, roster, cssScene = null) {
  const views = new Map()
  const pickables = []
  const shapes = shapesFor(roster)
  const parked = roster.filter((agent) => !isOrchestrator(agent))
  const rosterKeys = new Set(roster.map((agent) => agent.key))
  const usedShapes = new Set(shapes)
  const retired = new Map()
  let parkedIndex = 0

  function addView(agent, { index, shapeName, home, scale = 1, parentKey = null }) {
    const group = new THREE.Group()
    const shape = new THREE.LineSegments(shapeGeometry(shapeName), lineMaterial(WHITE, 0.35))
    const orchestrator = parentKey === null && isOrchestrator(agent)
    const rings = [flatRing(130, 0.2, -110)]
    if (orchestrator) rings.push(flatRing(158, 0.14, -110))
    const label = textSprite(nameLabel(agent.name), { scale: 1.5, color: 'rgba(255,255,255,.7)' })
    label.position.set(0, -150, 0)
    const picker = new THREE.Mesh(new THREE.SphereGeometry(170, 8, 8), new THREE.MeshBasicMaterial({ visible: false }))
    picker.userData.key = agent.key
    group.add(shape, ...rings, label, picker)
    group.position.copy(home)
    group.scale.setScalar(scale)

    const link = lineBetween(lineMaterial(WHITE, 0.4))
    const stripMaterialA = lineMaterial(YELLOW, 0)
    const stripMaterialB = lineMaterial(YELLOW, 0)
    const stripA = bandLine(stripMaterialA)
    const stripB = bandLine(stripMaterialB)
    const parentLink = parentKey ? lineBetween(lineMaterial(WHITE, 0.3)) : null

    const callout = makeCallout(agent.name)
    const calloutLine = lineBetween(lineMaterial(YELLOW, 0.6))
    calloutLine.visible = false

    scene.add(group, link, stripA, stripB, calloutLine)
    if (parentLink) scene.add(parentLink)
    cssScene?.add(callout.object)
    pickables.push(picker)
    const view = {
      key: agent.key,
      name: agent.name,
      index: orchestrator ? -1 : index,
      orchestrator,
      parentKey,
      shapeName,
      group,
      shape,
      rings,
      label,
      picker,
      callout,
      calloutLine,
      link,
      parentLink,
      scale,
      fadeStart: 0,
      stripA,
      stripB,
      stripMaterialA,
      stripMaterialB,
      stripOpacity: 0,
      stripColor: YELLOW,
      home,
      touch: home.clone(),
      aim: null,
      pointer: null,
      side: -1,
      chipSide: 1,
      doneAt: 0,
      style: 'idle',
    }
    views.set(agent.key, view)
    return view
  }

  function removeView(view) {
    view.callout.object.removeFromParent()
    view.callout.element.remove()
    scene.remove(view.group, view.link, view.stripA, view.stripB, view.calloutLine)
    if (view.parentLink) scene.remove(view.parentLink)
    for (const root of [view.group, view.link, view.stripA, view.stripB, view.calloutLine, view.parentLink]) {
      if (!root) continue
      root.traverse((object) => {
        object.geometry?.dispose()
        object.material?.map?.dispose()
        object.material?.dispose()
      })
    }
    const at = pickables.indexOf(view.picker)
    if (at !== -1) pickables.splice(at, 1)
    views.delete(view.key)
  }

  function childIndex(state, entry) {
    let index = 0
    for (const other of state.agents.values()) {
      if (other === entry) return index
      if (other.parent === entry.parent) index += 1
    }
    return index
  }

  function childEndIsFresh(entry, state) {
    const endedAt = entry.endedAt ?? 0
    return endedAt > 0 && (state.latest ?? 0) - endedAt <= CHILD_FADE_MS
  }

  function syncViews(state) {
    for (const view of [...views.values()]) {
      if (rosterKeys.has(view.key)) continue
      if (!state.agents.has(view.key)) removeView(view)
    }
    for (const entry of state.agents.values()) {
      if (!entry.parent || rosterKeys.has(entry.key) || views.has(entry.key)) continue
      const parentView = views.get(entry.parent)
      if (!parentView) continue
      if (retired.get(entry.key) === entry) continue
      if (entry.status !== 'working' && entry.status !== 'queued' && !childEndIsFresh(entry, state)) continue
      const shapeName = nextSpareShape([...usedShapes])
      usedShapes.add(shapeName)
      const place = childPlace(parentView.home, childIndex(state, entry))
      addView(entry, {
        index: -1,
        shapeName,
        home: new THREE.Vector3(place.x, place.y, place.z),
        scale: parentView.scale * CHILD_SCALE,
        parentKey: entry.parent,
      })
    }
  }

  roster.forEach((agent, rosterIndex) => {
    const orchestrator = isOrchestrator(agent)
    const index = orchestrator ? -1 : parkedIndex
    if (!orchestrator) parkedIndex += 1
    const home = orchestrator
      ? ORCHESTRATOR_HOME.clone()
      : slotPoint(index, parked.length).add(new THREE.Vector3(0, PARK_LIFT, 0))
    addView(agent, { index, shapeName: shapes[rosterIndex], home })
  })

  function setStatus(view, status, now) {
    if (view.style !== status) {
      if (status === 'queued') view.pointer = null
      if (status === 'working' && view.style !== 'queued') view.pointer = null
      if (status === 'done' || status === 'error') view.doneAt = now
      if (view.parentKey) {
        if (status === 'working' || status === 'queued') view.fadeStart = 0
        else if (status === 'done' || status === 'error') view.fadeStart = now
      }
    }
    view.style = status
  }

  let currentTasks = null

  function setTasks(tasksMap) {
    currentTasks = tasksMap instanceof Map ? tasksMap : null
  }

  function aimAt(key, dir, file, now) {
    const view = views.get(key)
    if (!view) return
    view.aim = { dir, file, until: now + AIM_HOLD }
    view.pointer = { dir, file }
  }

  function focusPointer(state, entry) {
    const path = entry?.focus?.[0]
    if (path === undefined) return null
    if (state.files.has(path)) return { dir: dirname(path), file: path }
    return { dir: path, file: null }
  }

  function update(state, delta, now, world, terminals) {
    if (world.back && world.right) {
      camUp.crossVectors(world.back, world.right).normalize()
      rotMatrix.makeBasis(world.right, camUp, world.back)
    }
    const isStill = still()
    const ended = []
    syncViews(state)

    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = entry?.status ?? 'idle'
      setStatus(view, status, now)
      const style = STYLE[status] ?? STYLE.idle
      const fade = view.parentKey ? (view.fadeStart > 0 ? (isStill ? 0 : Math.max(0, 1 - (now - view.fadeStart) / CHILD_FADE_MS)) : 1) : 1

      if (view.parentKey) {
        const parentName = state.agents.get(view.parentKey)?.name ?? view.parentKey
        terminals.ensure?.(view.key, `${parentName} > ${entry?.name ?? view.name}`)
        terminals.setVisible?.(view.key, true)
        terminals.setFade?.(view.key, fade)
        if (fade <= 0) ended.push({ view, entry })
      }

      const working = (status === 'working' || status === 'queued') && Boolean(entry?.label)
      if (!view.group.position.equals(view.home)) {
        if (isStill) view.group.position.copy(view.home)
        else view.group.position.lerp(view.home, easeRate(delta, 4, false))
      }
      const parentChipSide = view.parentKey ? views.get(view.parentKey)?.chipSide : null
      view.chipSide = parentChipSide ? -parentChipSide : view.home.x < 0 ? -1 : 1

      const fresh = status === 'done' && now - view.doneAt < DONE_GLOW_MS
      const opacity = status === 'done' ? (fresh ? 1 : 0.6) : style.opacity
      view.shape.material.color.setHex(style.color)
      view.shape.material.opacity = opacity * fade
      view.label.material.opacity = fade
      const ringColor = status === 'working' || status === 'queued' ? YELLOW : style.color
      view.rings.forEach((ring, index) => {
        ring.material.color.setHex(ringColor)
        ring.material.opacity = opacity * fade * (index === 0 ? 0.55 : 0.4)
      })
      if (!isStill) {
        view.shape.rotation.y += delta * style.spin
        view.shape.rotation.x += delta * style.spin * 0.4
      }
      if ((status === 'working' || status === 'queued') && !isStill) {
        view.shape.scale.setScalar(1 + 0.05 * (0.5 + 0.5 * Math.sin(now * 0.0022)))
      } else {
        view.shape.scale.setScalar(1)
      }

      const lastLine = entry?.lines?.[entry.lines.length - 1]
      const failedFresh = status === 'error' && now - view.doneAt < DONE_GLOW_MS
      let calloutTone = null
      let calloutText = ''
      if (working) {
        calloutTone = lastLine?.tone === 'error' ? 'error' : 'working'
        calloutText = entry.label
      } else if (failedFresh) {
        calloutTone = 'error'
        calloutText = entry?.error || 'FAILED'
      } else if (fresh) {
        calloutTone = 'done'
        calloutText = 'FINISHED'
      }

      if (calloutTone && fade > 0.01) {
        view.callout.object.visible = true
        const calloutClass = `mr-callout is-${calloutTone}`
        if (view.callout.element.className !== calloutClass) {
          view.callout.element.className = calloutClass
        }
        const taskText = currentTasks?.get(view.key) ?? ''
        if (view.callout.task.textContent !== taskText) {
          view.callout.task.textContent = taskText
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
        view.callout.object.visible = false
        view.calloutLine.visible = false
      }

      terminals.edgePoint(view.key, -view.chipSide, chipNear)
      setEnds(view.link, view.group.position, chipNear)
      view.link.material.color.setHex(style.color)
      view.link.material.opacity = (working ? 0.6 : status === 'idle' ? 0.18 : 0.4) * fade
      if (view.parentLink) {
        const parentView = views.get(view.parentKey)
        if (parentView) {
          setEnds(view.parentLink, parentView.group.position, view.group.position)
          view.parentLink.material.color.setHex(parentView.shape.material.color.getHex())
          view.parentLink.material.opacity = 0.3 * fade
          view.parentLink.visible = fade > 0.01
        } else {
          view.parentLink.visible = false
        }
      }

      const pointer = view.pointer ?? (working ? focusPointer(state, entry) : null)
      let color = null
      if (pointer) {
        if (working) color = YELLOW
        else if (fresh) color = GREEN
        else if (status === 'error') color = RED
      }
      const stripOn = Boolean(pointer) && color !== null
      if (color !== null) view.stripColor = color
      view.stripOpacity += ((stripOn ? STRIP_OPACITY : 0) - view.stripOpacity) * easeRate(delta, 6, isStill)
      const stripVisible = view.stripOpacity > 0.02 && fade > 0.01
      view.stripA.visible = stripVisible
      view.stripB.visible = stripVisible
      if (pointer) {
        view.side = world.side(pointer.dir)
        world.edge(pointer.dir, pointer.file, view.side, traceEnd)
        view.touch.copy(traceEnd)
      } else {
        view.touch.copy(view.home)
      }
      if (stripVisible) {
        stripStart.copy(view.group.position).addScaledVector(camUp, 105)
        const points = stripPoints(stripStart, view.touch, { side: view.side, right: world.right })
        const edges = bandEdges(points, world.right, camUp, STRIP_WIDTH)
        setPoints(view.stripA, edges.front)
        setPoints(view.stripB, edges.back)
        view.stripMaterialA.color.setHex(view.stripColor)
        view.stripMaterialB.color.setHex(view.stripColor)
        view.stripMaterialA.opacity = view.stripOpacity * fade
        view.stripMaterialB.opacity = view.stripOpacity * fade
      }
    }
    for (const item of ended) {
      if (item.entry) retired.set(item.view.key, item.entry)
      terminals.setVisible?.(item.view.key, false)
      terminals.setOpen?.(item.view.key, false)
      removeView(item.view)
    }
  }

  function snap(state, world) {
    retired.clear()
    syncViews(state)
    for (const view of views.values()) {
      view.aim = null
      view.pointer = null
      view.side = -1
      view.stripOpacity = 0
      view.stripA.visible = false
      view.stripB.visible = false
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
      view.style = 'idle'
      view.fadeStart = 0
      view.doneAt = 0
    }
  }

  function dispose() {
    for (const view of [...views.values()]) removeView(view)
    views.clear()
    pickables.length = 0
  }

  return { views, pickables, update, snap, aimAt, setTasks, dispose, hubCenter: HUB_CENTER }
}
