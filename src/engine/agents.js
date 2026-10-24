import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { sectorArcs } from '../model/hierarchy.js'
import { dirname } from '../model/paths.js'
import { HUB_CENTER, HUB_RADIUS, HUB_Y, ORCHESTRATOR_HOME, ORCHESTRATOR_LIFT, PARK_LIFT, hasSubs, sectorSlotAngles, slotAngle } from './hub.js'
import { isOrchestrator, isSubOrchestrator, nextSpareShape, shapeGeometry, shapesFor } from './shapes.js'
import { GREEN, RED, WHITE, YELLOW, easeRate, lineMaterial, still, textSprite } from './sprites.js'

const STYLE = {
  idle: { color: WHITE, opacity: 0.35, spin: 0.15 },
  queued: { color: WHITE, opacity: 0.6, spin: 0.4 },
  working: { color: WHITE, opacity: 1, spin: 0.9 },
  error: { color: RED, opacity: 1, spin: 0.3 },
  done: { color: GREEN, opacity: 1, spin: 0.25 },
}
export const UNSEEN_OPACITY = 0.35
export const UNSEEN_SCALE = 0.7
export const PRESENCE_GROW_MS = 600
const AIM_HOLD = 4500
const DONE_GLOW_MS = 5000
export const CHILD_HOLD_MS = 6000
const CHILD_FADE_MS = 1500
const CHILD_LIFE_MS = CHILD_HOLD_MS + CHILD_FADE_MS
const STRIP_OPACITY = 0.75
export const PACKET_POOL = 24
export const PACKET_DURATION = 450
export const PACKET_INTERVAL = 90
export const PACKET_BURST = 5
const PACKET_BURST_GAP = 30
const PACKET_SIZE = 3
export const CHILD_SCALE = 0.6
export const CHILD_TURN = Math.PI / 5
export const CHILD_GAP = 120
export const SUB_ORCHESTRATOR_SCALE = 0.7
export const SUB_ORCHESTRATOR_LIFT = ORCHESTRATOR_LIFT * 0.5
export const SUB_ORCHESTRATOR_RADIUS = HUB_RADIUS * 2.4

export function subOrchestratorPlace(arc, out = null) {
  const start = Number(arc?.start)
  const end = Number(arc?.end)
  const mid = Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : 0
  const point = out ?? { x: 0, y: 0, z: 0 }
  point.x = Math.cos(mid) * SUB_ORCHESTRATOR_RADIUS
  point.y = HUB_Y + SUB_ORCHESTRATOR_LIFT
  point.z = Math.sin(mid) * SUB_ORCHESTRATOR_RADIUS
  return point
}

export function agentPresence(agent, everRan = false) {
  const active = agent?.status === 'working' || agent?.status === 'queued'
  const dim = !(active || everRan || isOrchestrator(agent) || isSubOrchestrator(agent))
  return {
    dim,
    opacity: dim ? UNSEEN_OPACITY : 1,
    scale: dim ? UNSEEN_SCALE : 1,
  }
}

export function childFade(sinceEnd, reduced = false) {
  const elapsed = Number.isFinite(sinceEnd) ? Math.max(0, sinceEnd) : 0
  if (elapsed <= CHILD_HOLD_MS) return 1
  if (reduced || elapsed >= CHILD_LIFE_MS) return 0
  return 1 - (elapsed - CHILD_HOLD_MS) / CHILD_FADE_MS
}

export function childEndIsFresh(entry, state) {
  const endedAt = entry?.endedAt ?? 0
  return endedAt > 0 && (state?.latest ?? 0) - endedAt <= CHILD_LIFE_MS
}

export function nameLabel(name) {
  if (typeof name !== 'string') return ''
  const label = name.toUpperCase()
  return label.length > 32 ? `${label.slice(0, 31)}~` : label
}

export function showsNameLabel(agent, sector) {
  if (!isSubOrchestrator(agent)) return true
  const name = typeof agent?.name === 'string' ? agent.name.trim() : ''
  const sectorName = typeof sector?.name === 'string' ? sector.name.trim() : ''
  if (!name || !sectorName) return true
  return name.toLowerCase() !== sectorName.toLowerCase()
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

export function stripPoints(from, to, out = []) {
  const points = out ?? []
  points.length = 2
  points[0] = points[0] ?? {}
  points[1] = points[1] ?? {}
  points[0].x = from.x
  points[0].y = from.y
  points[0].z = from.z
  points[1].x = to.x
  points[1].y = to.y
  points[1].z = to.z
  return points
}

export function packetSpots(now, sends, duration = PACKET_DURATION, reduced = false, out = []) {
  const spots = out ?? []
  spots.length = 0
  if (reduced || !Number.isFinite(now) || !(duration > 0)) return spots
  if (!sends || sends.length === 0) return spots
  for (let i = 0; i < sends.length; i += 1) {
    const sent = sends[i]
    const age = now - sent
    if (!(age >= 0) || age > duration) continue
    spots.push(age / duration)
    if (spots.length > PACKET_POOL) spots.shift()
  }
  return spots
}

function packetPoints() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PACKET_POOL * 3), 3))
  geometry.setDrawRange(0, 0)
  const material = new THREE.PointsMaterial({
    color: YELLOW,
    size: PACKET_SIZE,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.visible = false
  return points
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

function setEnds(line, a, b) {
  const last = line.userData.ends
  if (
    last &&
    last[0] === a.x &&
    last[1] === a.y &&
    last[2] === a.z &&
    last[3] === b.x &&
    last[4] === b.y &&
    last[5] === b.z
  ) {
    return false
  }
  const array = line.geometry.attributes.position.array
  array[0] = a.x
  array[1] = a.y
  array[2] = a.z
  array[3] = b.x
  array[4] = b.y
  array[5] = b.z
  line.userData.ends = [a.x, a.y, a.z, b.x, b.y, b.z]
  line.geometry.attributes.position.needsUpdate = true
  return true
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
  const parked = roster.filter((agent) => !isOrchestrator(agent) && !isSubOrchestrator(agent))
  const parkedKeys = parked.map((agent) => agent.key)
  const agentByKey = new Map(roster.map((agent) => [agent.key, agent]))
  const rosterKeys = new Set(roster.map((agent) => agent.key))
  const usedShapes = new Set(shapes)
  const retired = new Map()
  const pendingChipRemovals = new Set()
  let parkedIndex = 0
  let sectorList = []
  let slotAngles = sectorSlotAngles(null, parkedKeys)

  function subIdOf(agent) {
    const key = String(agent?.key ?? '')
    return key.startsWith('sub-') ? key.slice(4) : key
  }

  function subHome(agent) {
    const id = subIdOf(agent)
    const arc = sectorList.find((entry) => entry.id === id) ?? { start: 0, end: 0 }
    const place = subOrchestratorPlace(arc)
    return new THREE.Vector3(place.x, place.y, place.z)
  }

  function laneHome(key, index) {
    const angle = slotAngles.get(key) ?? slotAngle(index, Math.max(1, parkedKeys.length))
    return new THREE.Vector3(Math.cos(angle) * HUB_RADIUS, HUB_Y + PARK_LIFT, Math.sin(angle) * HUB_RADIUS)
  }

  function layoutHomes(ladder) {
    sectorList = hasSubs(ladder) ? sectorArcs(ladder, parkedKeys) : []
    slotAngles = sectorSlotAngles(ladder, parkedKeys)
  }

  function queuePacket(view, at) {
    view.packetSends.push(at)
    if (view.packetSends.length > PACKET_POOL) view.packetSends.shift()
  }

  function hidePackets(view) {
    view.packets.visible = false
    view.packetNextAt = 0
    view.packetSends.length = 0
    view.packetFractions.length = 0
  }

  function updatePackets(view, now, fade, sending) {
    if (sending && (view.packetNextAt === 0 || now >= view.packetNextAt)) {
      queuePacket(view, now)
      view.packetNextAt = now + PACKET_INTERVAL
    }
    const spots = packetSpots(now, view.packetSends, PACKET_DURATION, false, view.packetFractions)
    const geometry = view.packets.geometry
    const attr = geometry.getAttribute('position')
    const array = attr.array
    const a = stripStart
    const b = view.touch
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
    for (let i = 0; i < spots.length; i += 1) {
      const t = spots[i]
      const base = i * 3
      array[base] = a.x + dx * t
      array[base + 1] = a.y + dy * t
      array[base + 2] = a.z + dz * t
    }
    geometry.setDrawRange(0, spots.length)
    attr.needsUpdate = true
    view.packets.material.color.setHex(view.stripColor)
    view.packets.material.opacity = view.stripOpacity * fade
    view.packets.visible = true
  }

  function addView(agent, { index, shapeName, home, scale = 1, parentKey = null, subOrchestrator = false }) {
    const group = new THREE.Group()
    const shape = new THREE.LineSegments(shapeGeometry(shapeName), lineMaterial(WHITE, 0.35))
    const orchestrator = parentKey === null && isOrchestrator(agent)
    const sub = parentKey === null && subOrchestrator
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
    const stripMaterial = lineMaterial(YELLOW, 0)
    const strip = lineBetween(stripMaterial)
    strip.visible = false
    const packets = packetPoints()
    const parentLink = parentKey ? lineBetween(lineMaterial(WHITE, 0.3)) : null
    const orchestratorLink = sub ? lineBetween(lineMaterial(WHITE, 0.3)) : null

    const callout = makeCallout(agent.name)
    const calloutLine = lineBetween(lineMaterial(WHITE, 0.3))
    calloutLine.visible = false

    scene.add(group, link, strip, packets, calloutLine)
    if (parentLink) scene.add(parentLink)
    if (orchestratorLink) scene.add(orchestratorLink)
    cssScene?.add(callout.object)
    pickables.push(picker)
    const view = {
      key: agent.key,
      name: agent.name,
      index: orchestrator ? -1 : index,
      orchestrator,
      subOrchestrator: sub,
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
      orchestratorLink,
      scale,
      fadeStart: 0,
      strip,
      stripEnds: [{}, {}],
      stripMaterial,
      packets,
      packetSends: [],
      packetFractions: [],
      packetNextAt: 0,
      packetBurstAt: -Infinity,
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
      presence: orchestrator ? 1 : 0,
      presenceReady: false,
      presenceOpacity: 1,
    }
    views.set(agent.key, view)
    return view
  }

  function removeView(view, chips = null) {
    if (chips) chips.remove?.(view.key)
    else pendingChipRemovals.add(view.key)
    view.callout.object.removeFromParent()
    view.callout.element.remove()
    scene.remove(view.group, view.link, view.strip, view.packets, view.calloutLine)
    if (view.parentLink) scene.remove(view.parentLink)
    if (view.orchestratorLink) scene.remove(view.orchestratorLink)
    for (const root of [view.group, view.link, view.strip, view.packets, view.calloutLine, view.parentLink, view.orchestratorLink]) {
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

  function syncViews(state, chips = null) {
    for (const view of [...views.values()]) {
      if (rosterKeys.has(view.key)) continue
      if (!state.agents.has(view.key)) removeView(view, chips)
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

  layoutHomes(null)
  roster.forEach((agent, rosterIndex) => {
    const orchestrator = isOrchestrator(agent)
    const sub = isSubOrchestrator(agent)
    const index = orchestrator || sub ? -1 : parkedIndex
    if (!orchestrator && !sub) parkedIndex += 1
    const home = orchestrator ? ORCHESTRATOR_HOME.clone() : sub ? subHome(agent) : laneHome(agent.key, index)
    addView(agent, {
      index,
      shapeName: shapes[rosterIndex],
      home,
      scale: sub ? SUB_ORCHESTRATOR_SCALE : 1,
      subOrchestrator: sub,
    })
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
    if (now - view.packetBurstAt > 4) {
      view.packetBurstAt = now
      for (let i = 0; i < PACKET_BURST; i += 1) queuePacket(view, now + i * PACKET_BURST_GAP)
    }
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
    for (const key of pendingChipRemovals) terminals.remove?.(key)
    pendingChipRemovals.clear()
    const isStill = still()
    const ended = []
    syncViews(state, terminals)
    let mainView = null
    for (const view of views.values()) {
      if (view.orchestrator) {
        mainView = view
        break
      }
    }

    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = entry?.status ?? 'idle'
      setStatus(view, status, now)
      const style = STYLE[status] ?? STYLE.idle
      const fade = view.parentKey ? (view.fadeStart > 0 ? childFade(now - view.fadeStart, isStill) : 1) : 1
      const ran = Boolean(entry) && (entry.status !== 'idle' || (entry.runs ?? 0) > 0 || (entry.lines?.length ?? 0) > 0)
      const presence = agentPresence({ status, orchestrator: view.orchestrator || view.subOrchestrator }, ran)
      if (!view.presenceReady) {
        view.presence = presence.dim ? 0 : 1
        view.presenceReady = true
      } else if (presence.dim) {
        view.presence = 0
      } else if (view.presence < 1) {
        view.presence = isStill ? 1 : Math.min(1, view.presence + (delta * 1000) / PRESENCE_GROW_MS)
      }
      const opacityFactor = UNSEEN_OPACITY + (1 - UNSEEN_OPACITY) * view.presence
      const scaleFactor = UNSEEN_SCALE + (1 - UNSEEN_SCALE) * view.presence
      view.presenceOpacity = opacityFactor
      view.group.scale.setScalar(view.scale * scaleFactor)

      if (view.parentKey) {
        const parentName = state.agents.get(view.parentKey)?.name ?? view.parentKey
        terminals.ensure?.(view.key, `${parentName} > ${entry?.name ?? view.name}`)
        terminals.setVisible?.(view.key, true)
        terminals.setFade?.(view.key, fade)
        if (fade <= 0) ended.push({ view, entry })
      } else {
        terminals.setVisible?.(view.key, !presence.dim)
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
      view.shape.material.opacity = opacity * fade * opacityFactor
      view.label.material.opacity = fade * opacityFactor
      const ringColor = status === 'working' || status === 'queued' ? YELLOW : style.color
      view.rings.forEach((ring, index) => {
        ring.material.color.setHex(ringColor)
        ring.material.opacity = opacity * fade * opacityFactor * (index === 0 ? 0.55 : 0.4)
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
      const lastFailed = lastLine?.tone === 'error'
      const failedFresh = status === 'error' && now - view.doneAt < DONE_GLOW_MS
      let calloutTone = null
      let calloutText = ''
      if (working) {
        calloutTone = lastFailed ? 'error' : 'working'
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
        view.calloutLine.material.color.setHex(WHITE)
        view.calloutLine.visible = true
      } else {
        view.callout.object.visible = false
        view.calloutLine.visible = false
      }

      terminals.edgePoint(view.key, -view.chipSide, chipNear)
      setEnds(view.link, view.group.position, chipNear)
      view.link.material.color.setHex(style.color)
      view.link.material.opacity = (working ? 0.6 : status === 'idle' ? 0.18 : 0.4) * fade * opacityFactor
      view.link.visible = !presence.dim
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
      if (view.orchestratorLink) {
        const mainAt = mainView ? mainView.group.position : ORCHESTRATOR_HOME
        setEnds(view.orchestratorLink, mainAt, view.group.position)
        view.orchestratorLink.material.color.setHex(WHITE)
        view.orchestratorLink.material.opacity = 0.3 * opacityFactor
        view.orchestratorLink.visible = opacityFactor > 0.01
      }

      const pointer = view.pointer ?? (working ? focusPointer(state, entry) : null)
      let color = null
      if (pointer) {
        if (working && lastFailed) color = RED
        else if (working) color = YELLOW
        else if (fresh) color = GREEN
        else if (status === 'error') color = RED
      }
      const stripOn = Boolean(pointer) && color !== null
      if (color !== null) view.stripColor = color
      view.stripOpacity += ((stripOn ? STRIP_OPACITY : 0) - view.stripOpacity) * easeRate(delta, 6, isStill)
      const stripVisible = view.stripOpacity > 0.02 && fade > 0.01
      view.strip.visible = stripVisible
      if (pointer) {
        view.side = world.side(pointer.dir)
        world.edge(pointer.dir, pointer.file, view.side, traceEnd)
        view.touch.copy(traceEnd)
      } else {
        view.touch.copy(view.home)
      }
      if (stripVisible) {
        stripStart.copy(view.group.position)
        const [a, b] = stripPoints(stripStart, view.touch, view.stripEnds)
        setEnds(view.strip, a, b)
        view.stripMaterial.color.setHex(view.stripColor)
        view.stripMaterial.opacity = view.stripOpacity * fade
      }
      if (stripVisible && !isStill) {
        updatePackets(view, now, fade, status === 'working' && stripOn)
      } else {
        hidePackets(view)
      }
    }
    for (const item of ended) {
      if (item.entry) retired.set(item.view.key, item.entry)
      terminals.setVisible?.(item.view.key, false)
      terminals.setOpen?.(item.view.key, false)
      removeView(item.view, terminals)
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
      view.strip.visible = false
      hidePackets(view)
      view.packetBurstAt = -Infinity
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
      view.style = 'idle'
      view.fadeStart = 0
      view.doneAt = 0
      view.presence = 0
      view.presenceReady = false
      view.presenceOpacity = 1
      view.group.scale.setScalar(view.scale)
    }
  }

  function setLadder(ladder) {
    layoutHomes(ladder)
    const isStill = still()
    for (const view of views.values()) {
      if (view.parentKey) continue
      const agent = agentByKey.get(view.key) ?? { key: view.key, name: view.name }
      if (view.subOrchestrator) {
        const sector = sectorList.find((entry) => entry.id === subIdOf(agent))
        view.label.visible = showsNameLabel(agent, sector)
      } else {
        view.label.visible = true
      }
      if (view.orchestrator) view.home.copy(ORCHESTRATOR_HOME)
      else if (view.subOrchestrator) view.home.copy(subHome(agent))
      else view.home.copy(laneHome(view.key, view.index))
      if (isStill) view.group.position.copy(view.home)
    }
  }

  function dispose() {
    for (const view of [...views.values()]) removeView(view)
    pendingChipRemovals.clear()
    views.clear()
    pickables.length = 0
  }

  return { views, pickables, update, snap, aimAt, setTasks, setLadder, dispose, hubCenter: HUB_CENTER }
}
