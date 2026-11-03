import * as THREE from 'three'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { basename, dirname } from '../model/paths.js'
import { isOnlineCall } from '../model/online.js'
import { CALLOUT_CROWD_LIMIT, createAgents } from './agents.js'
import { BLOOM_STRENGTH_DEFAULT, createBloomLayer } from './bloom.js'
import { ANCHOR_DIST, FOV, OVERVIEW, createCameraRig, fitView, followTarget, projectPoint } from './camera.js'
import { createCards } from './cards.js'
import { boardVisible, createCostBoard } from './board.js'
import { HUB_CENTER, HUB_RADIUS, createHub, workingKeys } from './hub.js'
import { GIT_FOCUS_DIST, createGitTree } from './gitTree.js'
import { createInternet } from './internet.js'
import { createLabels } from './labels.js'
import { createMessages } from './messages.js'
import { GREEN, RED, WHITE, disposeStill, glowTexture, still } from './sprites.js'
import { createStrings } from './strings.js'
import { CHIP_REACH, chipSideFromScreen, createTerminals } from './terminals.js'
import { createVoid } from './void.js'

const HUB_SPHERE = { x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z, r: HUB_RADIUS + 160 }
const REFIT_SHIFT = 150
const REFIT_RATIO = 0.08
const HOVER_CHECK_MS = 100

function workingMask(state) {
  const lit = new Set()
  const targeted = new Set()
  let touched = false
  for (const agent of state.agents.values()) {
    if (agent.status !== 'working') continue
    for (const path of agent.focus ?? []) {
      touched = true
      const dir = state.files.has(path) ? dirname(path) : path
      targeted.add(dir)
      let at = dir
      lit.add(at)
      while (at !== '') {
        at = dirname(at)
        lit.add(at)
      }
    }
  }
  return { dimmed: touched, lit, targeted }
}

export function createWorkingMaskCache() {
  let mask = { dimmed: false, lit: new Set(), targeted: new Set() }
  let latest = null
  let focus = []
  let statuses = []
  let builds = 0

  function changed(state) {
    if (state.latest !== latest || state.agents.size !== focus.length) return true
    let index = 0
    for (const agent of state.agents.values()) {
      if (agent.focus !== focus[index] || agent.status !== statuses[index]) return true
      index += 1
    }
    return false
  }

  function of(state) {
    if (!changed(state)) return mask
    latest = state.latest
    focus = []
    statuses = []
    for (const agent of state.agents.values()) {
      focus.push(agent.focus)
      statuses.push(agent.status)
    }
    mask = workingMask(state)
    builds += 1
    return mask
  }

  return { of, builds: () => builds }
}

export function createFollowFocus() {
  let following = false
  let focused = null
  return {
    focus(key, hasView = true) {
      focused = hasView ? key : null
    },
    clear() {
      focused = null
    },
    setFollowing(value) {
      following = value
    },
    following: () => following,
    focused: () => focused,
  }
}

export function touchedPath(state) {
  let best = null
  let bestIndex = -1
  for (const agent of state.agents.values()) {
    if (agent.status !== 'working') continue
    for (const path of agent.focus ?? []) {
      const index = state.recent ? state.recent.lastIndexOf(path) : -1
      if (best === null || index >= bestIndex) {
        best = state.files.has(path) ? dirname(path) : path
        bestIndex = index
      }
    }
  }
  return best
}

export function followAfterSeek(state, following) {
  return { followCard: null, pendingFollow: null, path: following ? touchedPath(state) : null }
}

export const TOUCH_PATH_LIMIT = 2000
export const TOUCH_ENTRY_LIMIT = 50

export function noteTouch(log, path, entry, pathLimit = TOUCH_PATH_LIMIT, entryLimit = TOUCH_ENTRY_LIMIT) {
  const list = log.get(path) ?? []
  log.delete(path)
  list.push(entry)
  if (list.length > entryLimit) list.splice(0, list.length - entryLimit)
  log.set(path, list)
  if (log.size > pathLimit) {
    const oldest = log.keys().next().value
    if (oldest !== undefined) log.delete(oldest)
  }
  return list
}

export function nearestDrawnPath(path, drawn) {
  let at = typeof path === 'string' ? path : ''
  while (at !== '') {
    if (drawn.has(at)) return at
    at = dirname(at)
  }
  return drawn.has('') ? '' : null
}

export function inspectorNamesPath(detail, path) {
  if (!detail || (detail.kind !== 'folder' && detail.kind !== 'file')) return false
  if (typeof detail.id !== 'string' || typeof path !== 'string') return false
  const dir = detail.kind === 'file' ? dirname(detail.id) : detail.id
  if (dir === path) return true
  return path !== '' && dir.startsWith(`${path}/`)
}

export function createLater(delay = 250) {
  const pending = new Set()
  function later(fn) {
    const timer = setTimeout(() => {
      pending.delete(timer)
      fn()
    }, delay)
    pending.add(timer)
  }
  function clear() {
    pending.forEach((timer) => clearTimeout(timer))
    pending.clear()
  }
  return { later, clear }
}

export function roomAgent(agent) {
  return {
    key: agent.key,
    name: agent.name,
    shape: agent.parser ?? agent.key,
    role: agent.role ?? null,
    subOrchestrator: agent.subOrchestrator === true,
    sessionReader: agent.sessionReader === true,
  }
}

export function createRoom({ surface, gl, css, rootName, agents, getState, beforeFrame = () => {}, onPick = () => {}, onInspect = () => {}, onDismiss = () => {} }) {
  const texture = glowTexture()
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, 0.00007)
  const cssScene = new THREE.Scene()

  let width = surface.clientWidth || window.innerWidth || 1
  let height = surface.clientHeight || window.innerHeight || 1
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 1, 60000)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(width, height)
  gl.appendChild(renderer.domElement)
  const cssRenderer = new CSS3DRenderer()
  cssRenderer.setSize(width, height)
  cssRenderer.domElement.style.pointerEvents = 'none'
  css.appendChild(cssRenderer.domElement)
  let bloom = null

  const space = createVoid(scene, texture)
  const roster = agents.map(roomAgent)
  const hub = createHub(scene, roster)
  const agentSet = createAgents(scene, roster, cssScene)
  const messages = createMessages(scene, {
    viewOf: (key) => agentSet.views.get(key)?.group.position ?? null,
  })
  const internet = createInternet(scene, texture)
  const gitTree = createGitTree(scene)
  const terminals = createTerminals(cssScene, roster, { onPick })
  const board = createCostBoard(surface, { onPick })
  let boardShown = boardVisible(width)
  board.setVisible(boardShown)
  const labels = createLabels(scene)

  const strings = createStrings(scene)
  const cards = createCards(cssScene, {
    glScene: scene,
    rootName,
    onInspect: (path) => inspectPath(path),
    alwaysDepth: 2,
  })
  let linkKey = ''
  let fitted = null
  let heldPath = null
  const centerOf = (path) => cards.center(path ?? '')
  const world = {
    center: centerOf,
    slot: (dir, file, out) => (file ? cards.slotPosition(dir, file, out) : out.copy(cards.center(dir))),
    edge: (dir, file, side, out) => cards.edgePoint(dir, file, side, out),
    side: (dir) => cards.sideOf(dir ?? ''),
    reach: (dir) => cards.halfWidth(dir ?? '') + CHIP_REACH,
    mask: null,
    links: [],
    get right() {
      return cards.vectors().right
    },
    get back() {
      return cards.vectors().back
    },
  }

  function relink() {
    const links = cards.visibleLinks()
    const key = links.map((link) => `${link.from}>${link.to}`).join('\n')
    if (key === linkKey) return
    linkKey = key
    world.links = links
    strings.build(links, centerOf, false)
  }

  function refit(force = false) {
    const spheres = [HUB_SPHERE, ...cards.overviewSpheres()]
    const next = fitView(spheres, { width, height, center: HUB_CENTER })
    if (heldPath !== null) {
      fitted = next
      return
    }
    if (!force && fitted) {
      const shift = Math.hypot(next.target.x - fitted.target.x, next.target.y - fitted.target.y, next.target.z - fitted.target.z)
      if (shift < REFIT_SHIFT && Math.abs(next.dist - fitted.dist) < fitted.dist * REFIT_RATIO) return
    }
    fitted = next
    rig.setFit(next.target, next.dist)
  }

  const pulses = Array.from({ length: 32 }, () => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, color: WHITE, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    sprite.scale.set(110, 110, 1)
    scene.add(sprite)
    return { sprite, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), start: 0, duration: 1 }
  })

  function firePulse(from, to, color, duration = 800) {
    const pulse = pulses.find((item) => !item.active)
    if (!pulse) return
    pulse.active = true
    pulse.from.copy(from)
    pulse.to.copy(to)
    pulse.start = performance.now()
    pulse.duration = duration
    pulse.sprite.material.color.setHex(color)
  }

  const scratch = new THREE.Vector3()
  const inspectPoint = new THREE.Vector3()
  const rig = createCameraRig(camera, surface)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const followFocus = createFollowFocus()
  const masks = createWorkingMaskCache()
  const openCalls = new Map()
  const touchLog = new Map()
  let inspected = null
  let lastWorking = []

  function agentAt(event) {
    const rect = gl.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster
      .intersectObjects(agentSet.pickables, false)
      .find((item) => agentSet.views.get(item.object.userData.key)?.group.visible !== false)
    return hit ? hit.object.userData.key : null
  }

  function internetAt(event) {
    const rect = gl.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(internet.group, true).length > 0
  }

  function gitAt(event) {
    if (!gitTree.ready()) return false
    const rect = gl.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(gitTree.hitBox, false).length > 0
  }

  let hoveredKey = null
  let hoverAt = 0

  function onPointerMove(event) {
    if (event.target !== renderer.domElement) {
      hoveredKey = null
      return
    }
    const at = performance.now()
    if (at - hoverAt < HOVER_CHECK_MS) return
    hoverAt = at
    let busy = 0
    for (const agent of getState().agents.values()) {
      if (agent.status === 'working') busy += 1
    }
    hoveredKey = busy > CALLOUT_CROWD_LIMIT ? agentAt(event) : null
  }
  window.addEventListener('pointermove', onPointerMove)

  rig.setClickHandler((event) => {
    const key = agentAt(event)
    if (key !== null) {
      onPick(key)
      return
    }
    if (internetAt(event)) {
      inspectObject({ kind: 'internet', id: 'internet' })
      onInspect({ kind: 'internet', id: 'internet' })
      return
    }
    if (gitAt(event)) {
      inspectGitTree()
      return
    }
    clearSelection()
    endFollow()
    onDismiss()
  })

  function onCardClick(event) {
    const card = event.target?.closest?.('.mr-card')
    if (!card) return
    if (event.target?.closest?.('.mr-item')) return
    const path = card.dataset.path ?? ''
    if (event.target?.closest?.('.mr-card-head')) {
      endFollow()
      if (heldPath !== path) cards.setSelected(null)
      setInspected({ kind: 'folder', id: path })
      onInspect({ kind: 'folder', id: path })
      return
    }
    if (anchor(path)) {
      setInspected({ kind: 'folder', id: path })
      onInspect({ kind: 'folder', id: path })
    }
  }
  cssRenderer.domElement.addEventListener('click', onCardClick, true)

  function onCardDoubleClick(event) {
    const card = event.target?.closest?.('.mr-card')
    if (!card) return
    if (event.target?.closest?.('.mr-item')) return
    const path = card.dataset.path ?? ''
    const opened = anchor(path)
    if (event.target?.closest?.('.mr-card-head')) cards.togglePop(path)
    if (opened) {
      setInspected({ kind: 'folder', id: path })
      onInspect({ kind: 'folder', id: path })
    }
  }
  cssRenderer.domElement.addEventListener('dblclick', onCardDoubleClick, true)

  function onCardWheel(event) {
    const card = event.target?.closest?.('.mr-card')
    if (!card) return
    const items = card.querySelector('.mr-card-items')
    if (!items || items.scrollHeight <= items.clientHeight) return
    event.preventDefault()
    event.stopPropagation()
    items.scrollTop += event.deltaY
  }
  cssRenderer.domElement.addEventListener('wheel', onCardWheel, { passive: false })

  function sync(state) {
    timers.clear()
    terminals.clearNotes()
    webCalls.clear()
    openCalls.clear()
    touchLog.clear()
    labels.clear()
    pulses.forEach((pulse) => {
      pulse.active = false
      pulse.sprite.material.opacity = 0
    })
    cards.sync(state)
    const holdLost = releaseLostHold()
    const follow = followAfterSeek(state, followFocus.following())
    followCard = follow.followCard
    pendingFollow = follow.pendingFollow
    if (followFocus.following()) {
      if (follow.path !== null && followCardPath(follow.path, followFocus.following())) {
        followCard = { path: follow.path, at: performance.now() }
      } else {
        rig.stopFollow()
      }
    }
    relink()
    refit(holdLost)
    agentSet.snap(state, world)
  }

  let followCard = null
  let pendingFollow = null
  const timers = createLater()

  function releaseHold() {
    heldPath = null
    cards.setSelected(null)
  }

  function releaseLostHold() {
    if (heldPath === null) return false
    const card = cards.cards.get(heldPath)
    if (card?.view && !card.leaving) return false
    const lost = heldPath
    releaseHold()
    const named = inspectorNamesPath(inspected, lost)
    cards.setInspected(null)
    if (named) {
      inspected = null
      onDismiss()
    }
    rig.overview()
    return true
  }

  function endFollow() {
    if (!followFocus.following() && followFocus.focused() === null) return
    followFocus.setFollowing(false)
    followFocus.clear()
    followCard = null
    pendingFollow = null
    rig.stopFollow()
    onPick(null)
  }

  function anchor(path) {
    const drawn = new Set()
    for (const card of cards.cards.values()) {
      if (card.view && !card.leaving) drawn.add(card.path)
    }
    const target = nearestDrawnPath(path, drawn)
    if (target === null) return false
    const card = cards.cards.get(target)
    followFocus.setFollowing(false)
    followFocus.clear()
    followCard = null
    pendingFollow = null
    heldPath = target
    cards.setSelected(target)
    rig.hold(() => card.base, ANCHOR_DIST)
    onPick(null)
    return true
  }

  function noteActivity(activity) {
    const agent = activity?.agent
    if (typeof agent !== 'string' || agent === '') return
    if (activity.type === 'tool.start') {
      if (!openCalls.has(agent)) openCalls.set(agent, new Map())
      openCalls.get(agent).set(activity.id ?? '', activity.tool)
      const time = Number.isFinite(activity.time) ? activity.time : Date.now()
      for (const touch of activity.touches ?? []) {
        if (touch.kind !== 'file' || typeof touch.path !== 'string') continue
        noteTouch(touchLog, touch.path, { key: agent, mode: touch.mode === 'read' ? 'read' : 'write', time })
      }
      return
    }
    if (activity.type === 'tool.end') {
      openCalls.get(agent)?.delete(activity.id ?? '')
      return
    }
    if (activity.type === 'run.start' || activity.type === 'run.end' || activity.type === 'agent.end') {
      openCalls.delete(agent)
    }
  }

  function setInspected(detail) {
    inspected = detail
    cards.setInspected(detail?.kind === 'file' ? detail.id : null)
  }

  function inspectObject(detail) {
    if (!detail || typeof detail !== 'object') return false
    const kind = detail.kind
    const id = typeof detail.id === 'string' ? detail.id : ''
    if (kind === 'agent') {
      const view = agentSet.views.get(id)
      if (!view) return false
      releaseHold()
      followFocus.setFollowing(false)
      followFocus.focus(id, true)
      followCard = null
      pendingFollow = null
      rig.hold(() => view.group.position, ANCHOR_DIST)
      setInspected({ kind, id })
      return true
    }
    if (kind === 'internet') {
      releaseHold()
      followFocus.setFollowing(false)
      followFocus.clear()
      followCard = null
      pendingFollow = null
      rig.hold(() => internet.position, ANCHOR_DIST)
      setInspected({ kind: 'internet', id: 'internet' })
      return true
    }
    if (kind === 'git') {
      if (!focusGitTree()) return false
      setInspected({ kind: 'git', id: 'git' })
      return true
    }
    if (kind !== 'folder' && kind !== 'file') return false
    const state = getState()
    if (kind === 'file' && !state.files.has(id)) return false
    if (kind === 'folder' && id !== '' && !state.dirs.has(id)) return false
    const drawn = new Set()
    for (const card of cards.cards.values()) {
      if (card.view && !card.leaving) drawn.add(card.path)
    }
    const target = nearestDrawnPath(kind === 'file' ? dirname(id) : id, drawn)
    if (target === null) return false
    releaseHold()
    followFocus.setFollowing(false)
    followFocus.clear()
    followCard = null
    pendingFollow = null
    heldPath = target
    cards.setSelected(kind === 'folder' ? target : null)
    if (kind === 'file' && target === dirname(id)) {
      rig.hold(() => cards.slotPosition(target, id, inspectPoint), ANCHOR_DIST)
    } else {
      rig.hold(() => cards.center(target), ANCHOR_DIST)
    }
    setInspected({ kind, id })
    return true
  }

  function inspectPath(path) {
    const state = getState()
    const kind = state.files.has(path) ? 'file' : state.dirs.has(path) ? 'folder' : null
    if (kind === null) return false
    const shown = inspectObject({ kind, id: path })
    if (shown) onInspect({ kind, id: path })
    return shown
  }

  function inspect(detail) {
    const shown = inspectObject(detail)
    if (!shown) return false
    return true
  }

  function clearSelection(options) {
    cards.clearSelection(options)
    inspected = null
  }

  function park() {
    clearSelection()
    cards.sync(getState())
    releaseHold()
    followFocus.setFollowing(false)
    followFocus.clear()
    followCard = null
    pendingFollow = null
    rig.overview()
    refit(true)
  }

  function focusAgent(key, style = 'wide') {
    releaseHold()
    const view = agentSet.views.get(key)
    followFocus.focus(key, Boolean(view))
    if (!view) {
      rig.stopFollow()
      return
    }
    const middle = new THREE.Vector3()
    if (style === 'close') {
      rig.focus(() => middle.copy(view.group.position).lerp(view.touch, view.aim ? 0.5 : 0), 1500, 0.3)
    } else if (view.touch.distanceToSquared(view.home) > 1) {
      rig.focus(() => middle.copy(view.group.position).lerp(view.touch, 0.5), 2400, 0.3)
    } else {
      rig.focus(() => middle.copy(view.group.position).add(terminals.positionOf(key)).multiplyScalar(0.5), 2400, 0.3)
    }
  }

  function touchedCard(activity) {
    const touches = activity.touches ?? []
    const file = touches.find((touch) => touch.kind === 'file')
    if (file) return dirname(file.path)
    const dir = touches.find((touch) => touch.kind === 'dir')
    return dir ? dir.path : null
  }

  const soundPoint = new THREE.Vector3()
  const soundProjection = new THREE.Vector3()

  function soundAt(path) {
    const state = getState()
    const isFile = state.files.has(path)
    const dir = isFile ? dirname(path) : (path ?? '')
    const overviewDistance = fitted?.dist ?? OVERVIEW.dist
    const card = cards.cardSphere(dir)
    if (!card) return { x: -1, y: -1, width, height, distance: overviewDistance * 2, overviewDistance }
    soundPoint.copy(cards.center(dir))
    const distance = camera.position.distanceTo(soundPoint)
    soundProjection.copy(soundPoint).project(camera)
    if (![soundProjection.x, soundProjection.y, soundProjection.z].every(Number.isFinite)) {
      return { x: -1, y: -1, width, height, distance, overviewDistance }
    }
    const behind = soundProjection.z < -1 || soundProjection.z > 1
    return {
      x: behind ? -1 : ((soundProjection.x + 1) / 2) * width,
      y: behind ? -1 : ((1 - soundProjection.y) / 2) * height,
      width,
      height,
      distance,
      overviewDistance,
    }
  }

  function followCardPath(path, style) {
    const wide = style !== 'close'
    const start = []
    const own = cards.cardSphere(path)
    if (!own) return false
    start.push(own)
    if (wide && path !== '') {
      const parent = cards.cardSphere(dirname(path))
      if (parent) start.push(parent)
    }
    rig.followSpheres(() => {
      const next = []
      const current = cards.cardSphere(path)
      if (current) next.push(current)
      if (wide && path !== '') {
        const above = cards.cardSphere(dirname(path))
        if (above) next.push(above)
      }
      return next.length > 0 ? next : start
    }, wide ? 'wide' : 'close')
    return true
  }

  function followPath(path) {
    const box = cards.screenFrame(path, camera, width, height)
    const decision = followTarget(followCard, { path }, box && { width, height, card: box }, performance.now())
    if (!decision?.moved) return
    if (followCardPath(path, followFocus.following())) followCard = { path: decision.path, at: decision.at }
  }

  const webCalls = new Map()

  function trackWeb(activity) {
    const now = performance.now()
    const callKey = `${activity.agent}:${activity.id}`
    if (activity.type === 'tool.start' && isOnlineCall(activity)) {
      if (typeof activity.id === 'string') webCalls.set(callKey, activity.agent)
      agentSet.webStart(activity.agent, internet.position)
      return
    }
    if (activity.type === 'tool.end' && webCalls.has(callKey)) {
      webCalls.delete(callKey)
      agentSet.webEnd(activity.agent, now)
      return
    }
    if (activity.type !== 'run.end' && activity.type !== 'agent.end') return
    for (const [storedKey, agentKey] of webCalls) {
      if (agentKey !== activity.agent) continue
      webCalls.delete(storedKey)
      agentSet.webEnd(agentKey, now)
    }
  }

  function onActivity(activity) {
    noteActivity(activity)
    terminals.note(activity)
    messages.note(activity)
    const view = agentSet.views.get(activity.agent)
    if (!view) return
    trackWeb(activity)
    const position = view.group.position
    if (followFocus.following() && activity.type === 'tool.start') {
      const path = touchedCard(activity)
      if (path !== null) pendingFollow = path
    }

    if (activity.type === 'run.start') {
      hub.pulse(WHITE, 1)
      firePulse(HUB_CENTER, position, WHITE, 700)
    } else if (activity.type === 'tool.start') {
      for (const touch of activity.touches) {
        if (touch.kind === 'file') {
          const dir = dirname(touch.path)
          cards.flashFile(dir, touch.path, 'white')
          cards.topPoint(dir, scratch)
          labels.show(`${touch.mode === 'read' ? 'read' : 'write'} ${basename(touch.path)}`, scratch, '#ffffff')
          agentSet.aimAt(activity.agent, dir, touch.path, performance.now())
        } else {
          cards.flashCluster(touch.path, 'white')
          scratch.copy(cards.center(touch.path))
          agentSet.aimAt(activity.agent, touch.path, null, performance.now())
        }
        firePulse(position, scratch, WHITE, 600)
      }
    } else if (activity.type === 'tool.end' && !activity.ok) {
      const touches = getState().agents.get(activity.agent)?.calls.get(activity.id) ?? []
      touches.forEach((touch) => {
        if (touch.kind === 'file') {
          cards.flashFile(dirname(touch.path), touch.path, 'red')
          cards.topPoint(dirname(touch.path), scratch)
          labels.show(`failed ${basename(touch.path)}`, scratch, '#ff2a2a')
        } else {
          cards.flashCluster(touch.path, 'red')
        }
      })
      hub.pulse(RED, 0.5)
    } else if (activity.type === 'run.end') {
      const color = activity.ok ? GREEN : RED
      hub.pulse(color, 1)
      firePulse(position, view.home, color, 900)
    } else if (activity.type === 'error') {
      hub.pulse(RED, 0.6)
    }
  }

  function onResize() {
    const nextWidth = surface.clientWidth || window.innerWidth
    const nextHeight = surface.clientHeight || window.innerHeight
    if (!nextWidth || !nextHeight) return
    width = nextWidth
    height = nextHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
    cssRenderer.setSize(width, height)
    bloom?.resize(width, height)
    rig.resize()
    const shown = boardVisible(width)
    if (shown !== boardShown) {
      boardShown = shown
      board.setVisible(shown)
    }
    refit(true)
  }
  const observer = new ResizeObserver(onResize)
  observer.observe(surface)

  let last = performance.now()
  let frameId = 0
  const anchorOf = (key) => agentSet.views.get(key)?.group.position
  const chipSides = new Map()
  let hubScreenX = NaN

  function chipSideOf(key) {
    const view = agentSet.views.get(key)
    if (!view) return 1
    if (!view.orchestrator && !view.subOrchestrator) return view.chipSide ?? 1
    const previous = chipSides.get(key) ?? view.chipSide ?? 1
    const point = projectPoint(camera, view.group.position, width, height)
    if (!point || !Number.isFinite(hubScreenX)) return previous
    const side = chipSideFromScreen(point.x, hubScreenX, previous)
    chipSides.set(key, side)
    return side
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame)
    const delta = Math.min((now - last) / 1000, 0.1)
    last = now
    beforeFrame(delta * 1000)

    const state = getState()
    const mask = masks.of(state)
    const working = workingKeys(state, lastWorking)
    if (working !== lastWorking) {
      lastWorking = working
      hub.setWorking(working)
    }
    space.update(delta)
    hub.update(now / 1000, delta, camera, height)
    internet.update(delta, agentSet.webActive() > 0)
    gitTree.setTop(cards.bottom(''))
    gitTree.update(delta)
    if (cards.update(state, delta, camera, mask)) {
      const holdLost = releaseLostHold()
      relink()
      refit(holdLost)
    }
    if (followFocus.following() && pendingFollow !== null) {
      const path = pendingFollow
      pendingFollow = null
      followPath(path)
    }
    strings.update(centerOf, mask, delta, cards.moving())
    labels.update(delta)
    messages.update(now)
    world.mask = mask
    agentSet.update(state, delta, now, world, terminals, { focus: followFocus.focused(), hover: hoveredKey })
    for (const view of agentSet.views.values()) {
      const status = state.agents.get(view.key)?.status ?? 'idle'
      const color = status === 'error' ? RED : status === 'done' ? GREEN : WHITE
      const opacity = status === 'idle' ? 0.25 : status === 'working' || status === 'queued' ? 0.12 : 0.6
      hub.setSlot(view.index, color, opacity * (view.presenceOpacity ?? 1))
    }

    const isStill = still()
    pulses.forEach((pulse) => {
      if (!pulse.active) return
      const t = (now - pulse.start) / pulse.duration
      if (t >= 1) {
        pulse.active = false
        pulse.sprite.material.opacity = 0
        return
      }
      if (isStill) {
        pulse.sprite.position.copy(pulse.to)
      } else {
        pulse.sprite.position.lerpVectors(pulse.from, pulse.to, t)
      }
      pulse.sprite.material.opacity = t < 0.1 ? t * 10 : t > 0.85 ? (1 - t) / 0.15 : 1
    })

    rig.update(delta)
    const hubPoint = projectPoint(camera, HUB_CENTER, width, height)
    hubScreenX = hubPoint ? hubPoint.x : NaN
    terminals.update(state, now, camera, followFocus.focused(), anchorOf, delta, chipSideOf)
    renderer.render(scene, camera)
    bloom?.render()
    cssRenderer.render(cssScene, camera)
  }

  const onContextLost = () => console.warn('machine-room: WebGL context lost')
  const onContextRestored = () => console.warn('machine-room: WebGL context restored')
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored)
  sync(getState())
  rig.snap()
  frameId = requestAnimationFrame(frame)

  const pathTarget = new THREE.Vector3()

  function focusTerminal(key) {
    releaseHold()
    if (!terminals.terminals.has(key)) return false
    terminals.setOpen(key, true)
    followFocus.focus(key)
    rig.focus(() => terminals.positionOf(key), 1300, 0.12)
    return true
  }

  function focusPath(path) {
    const state = getState()
    const isFile = state.files.has(path)
    if (!isFile && path !== '' && !state.dirs.has(path)) return false
    releaseHold()
    endFollow()
    if (!isFile) {
      inspected = null
      cards.setInspected(null)
    }
    const dir = isFile ? dirname(path) : path
    followFocus.clear()
    cards.pin(dir)
    if (isFile) {
      cards.flashFile(dir, path, 'white')
      timers.later(() => {
        cards.slotPosition(dir, path, scratch)
        labels.show(basename(path), scratch, '#ffffff')
      })
    } else {
      cards.flashCluster(path, 'white')
    }
    rig.focus(
      () => {
        if (isFile) cards.slotPosition(dir, path, pathTarget)
        else pathTarget.copy(cards.center(path))
        return pathTarget
      },
      isFile ? 1100 : 1700,
      0.25
    )
    return true
  }

  function focusGitTree() {
    if (!gitTree.ready()) return false
    releaseHold()
    followFocus.setFollowing(false)
    followFocus.clear()
    followCard = null
    pendingFollow = null
    rig.hold(() => gitTree.center(), GIT_FOCUS_DIST)
    return true
  }

  function inspectGitTree() {
    if (followFocus.focused() !== null) rig.stopFollow()
    followFocus.clear()
    cards.setSelected(null)
    setInspected({ kind: 'git', id: 'git' })
    onInspect({ kind: 'git', id: 'git' })
    return true
  }

  function bloomPixelRatio() {
    const ratio = Number(window.devicePixelRatio)
    return Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1.5) : 1
  }

  function setBloom(next) {
    const settings = next && typeof next === 'object' && !Array.isArray(next) ? next : {}
    const raw = Number(settings.strength)
    const strength = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : BLOOM_STRENGTH_DEFAULT
    if (settings.on !== true || strength <= 0) {
      if (!bloom) return
      bloom.dispose()
      bloom = null
      return
    }
    if (bloom) {
      bloom.setStrength(strength)
      return
    }
    bloom = createBloomLayer({
      container: gl,
      scene,
      camera,
      width,
      height,
      pixelRatio: bloomPixelRatio(),
      strength,
    })
  }

  return {
    onActivity,
    soundAt,
    setBeat: (strength) => {
      agentSet.beat(strength)
      cards.beat(strength)
      hub.beat(strength)
    },
    setBands: (levels) => agentSet.setBands(levels),
    setBloom,
    reset: sync,
    yaw: () => rig.yaw(),
    pitch: () => rig.pitch(),
    free: () => rig.free(),
    setIdle: (on) => rig.setSpin(on),
    zoomBy: (deltaY) => rig.zoomBy(deltaY),
    zoomShare: () => rig.zoomShare(),
    setZoomShare: (share) => rig.setZoomShare(share),
    zoomMultiplier: () => rig.zoomMultiplier(),
    focus: focusAgent,
    focusTerminal,
    focusPath,
    inspect,
    inspecting: () => inspected,
    touches: (path) => touchLog.get(path) ?? [],
    callsFor(key) {
      const calls = openCalls.get(key)
      if (!calls || calls.size === 0) return { count: 0, tool: '' }
      return { count: calls.size, tool: [...calls.values()].at(-1) ?? '' }
    },
    webAgents: () => [...new Set(webCalls.values())],
    toggleTerminal(key) {
      if (key) terminals.toggle(key)
      else terminals.openAll(terminals.openKeys().length === 0)
      return terminals.openKeys()
    },
    openTerminals: (open) => terminals.openAll(open),
    openTerminalKeys: () => terminals.openKeys(),
    anchor,
    clearSelection,
    park,
    holding: () => heldPath,
    agentAt,
    gitAt,
    overview() {
      park()
    },
    setFollow(mode) {
      releaseHold()
      followFocus.setFollowing(mode)
      followFocus.clear()
      followCard = null
      pendingFollow = null
      rig.stopFollow()
      if (!mode) return
      const path = touchedPath(getState())
      if (path === null) return
      if (followCardPath(path, mode)) followCard = { path, at: performance.now() }
    },
    following: () => followFocus.following(),
    focused: () => followFocus.focused(),
    setCosts(costBoardData) {
      board.update(costBoardData)
    },
    setGitState(state) {
      return gitTree.setState(state)
    },
    focusGitTree,
    inspectGitTree,
    setOnline(next) {
      internet.setOnline(next)
      agentSet.setOnline(next)
    },
    setOptions(options = {}) {
      if (!cards.setOptions(options)) return
      cards.sync(getState())
      releaseLostHold()
      relink()
      refit(true)
    },
    setTasks(tasksMap) {
      agentSet.setTasks(tasksMap)
    },
    setLadder(ladder) {
      hub.setLadder(ladder)
      agentSet.setLadder(ladder)
    },
    setLabels(labels) {
      terminals.setLabels(labels)
      agentSet.setLabels(labels)
    },
    setRoster(next) {
      const list = (Array.isArray(next) ? next : []).map(roomAgent)
      hub.setRoster(list)
      agentSet.setRoster(list, terminals)
      const focused = followFocus.focused()
      if (focused && !agentSet.views.has(focused)) {
        const onAgent = !rig.free()
        if (followFocus.following()) endFollow()
        followFocus.clear()
        followFocus.setFollowing(false)
        followCard = null
        pendingFollow = null
        const named = inspected?.kind === 'agent' && inspected.id === focused
        if (named) {
          cards.setInspected(null)
          inspected = null
          onDismiss()
        }
        if (onAgent) rig.overview()
      }
    },
    dispose() {
      cancelAnimationFrame(frameId)
      timers.clear()
      observer.disconnect()
      bloom?.dispose()
      bloom = null
      rig.dispose()
      agentSet.dispose()
      messages.dispose()
      terminals.dispose()
      internet.dispose()
      gitTree.dispose()
      board.dispose()
      labels.dispose()
      strings.dispose()
      cards.dispose()
      hub.dispose()
      space.dispose()
      for (const pulse of pulses) {
        scene.remove(pulse.sprite)
        pulse.sprite.material.dispose()
      }
      texture.dispose()
      cssRenderer.domElement.removeEventListener('click', onCardClick, true)
      cssRenderer.domElement.removeEventListener('dblclick', onCardDoubleClick, true)
      cssRenderer.domElement.removeEventListener('wheel', onCardWheel)
      window.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      renderer.dispose()
      renderer.forceContextLoss()
      gl.removeChild(renderer.domElement)
      css.removeChild(cssRenderer.domElement)
      disposeStill()
    },
  }
}
