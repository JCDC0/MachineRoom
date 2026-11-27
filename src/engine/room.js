import * as THREE from 'three'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { basename, dirname } from '../model/paths.js'
import { callPlace } from '../model/online.js'
import { isDeleteCommand, touchSoundKind } from '../ui/sound.js'
import { CALLOUT_CROWD_LIMIT, createAgents, litChain, starOriginKey, thinkingLoopPhase, tunnelRoute, webTunnelEnd } from './agents.js'
import { BLOOM_STRENGTH_DEFAULT, createBloomLayer } from './bloom.js'
import { ANCHOR_DIST, FOV, OVERVIEW, createCameraRig, distanceForRatio, fitView, followTarget, projectPoint } from './camera.js'
import { createCards } from './cards.js'
import { boardVisible, createCostBoard } from './board.js'
import { HUB_CENTER, HUB_RADIUS, RING_LEVEL_MAX, createHub, ringDepth, workingKeys } from './hub.js'
import { GIT_FOCUS_DIST, createGitTree } from './gitTree.js'
import { INTERNET_RADIUS, createInternet } from './internet.js'
import { createLabels } from './labels.js'
import { SMALL_TOP } from './ring.js'
import { BROWSER_RADIUS, BROWSER_TRACE_SECONDS, MCP_NODE_RADIUS, MCP_TRACE_SECONDS, createSatellites } from './satellites.js'
import { agentStar, createStars, speedRate, starRoute, touchLabelPoint } from './stars.js'
import { GREEN, RED, WEB, WHITE, cssColor, disposeStill, glowTexture, still } from './sprites.js'
import { createStrings } from './strings.js'
import { CHIP_REACH, chipSideFromScreen, createTerminals } from './terminals.js'
import { FILE_TRACE_SECONDS, FOLDER_TRACE_SECONDS, TRACE_FADE_SECONDS, TRACE_HOLD_SECONDS, createTraces } from './trace.js'
import { createVoid } from './void.js'

const HUB_SPHERE = { x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z, r: HUB_RADIUS + 160 }
const REFIT_SHIFT = 150
const REFIT_RATIO = 0.08
const HOVER_CHECK_MS = 100
export const FAULT_SOUND_GAP_MS = 600
const FRAME_DELTA_CAP = 0.1
const FRAME_ELAPSED_CAP_MS = 1000

export function frameTimes(previous, now) {
  const elapsed = Math.min(Math.max(now - previous, 0), FRAME_ELAPSED_CAP_MS)
  return { elapsed, delta: Math.min(elapsed / 1000, FRAME_DELTA_CAP) }
}

function hasOpenCall(agent) {
  return (agent?.openCalls?.size ?? 0) > 0
}

export function workingMask(state, colourOf = null, into = null) {
  const lit = into?.lit ?? new Set()
  const targeted = into?.targeted ?? new Set()
  const dirColors = into?.dirColors ?? new Map()
  const fileColors = into?.fileColors ?? new Map()
  lit.clear()
  targeted.clear()
  dirColors.clear()
  fileColors.clear()
  let touched = false
  for (const agent of state.agents.values()) {
    if (agent.status !== 'working' || !hasOpenCall(agent)) continue
    const colour = colourOf ? cssColor(colourOf(agent.key)) : null
    for (const path of agent.focus ?? []) {
      touched = true
      const file = state.files.has(path)
      const dir = file ? dirname(path) : path
      targeted.add(dir)
      if (colour) {
        if (!dirColors.has(dir)) dirColors.set(dir, colour)
        if (file && !fileColors.has(path)) fileColors.set(path, colour)
      }
      let at = dir
      lit.add(at)
      while (at !== '') {
        at = dirname(at)
        lit.add(at)
      }
    }
  }
  return { dimmed: touched, lit, targeted, dirColors, fileColors }
}

function emptyMask() {
  return {
    dimmed: false,
    lit: new Set(),
    targeted: new Set(),
    dirColors: new Map(),
    fileColors: new Map(),
    targetVersion: 0,
  }
}

export function createWorkingMaskCache(colourOf = null) {
  let mask = emptyMask()
  let spare = emptyMask()
  let latest = null
  let focus = []
  let statuses = []
  let open = []
  let colours = []
  let builds = 0

  function changed(state) {
    if (state.latest !== latest || state.agents.size !== focus.length) return true
    let index = 0
    for (const agent of state.agents.values()) {
      if (agent.focus !== focus[index] || agent.status !== statuses[index] || hasOpenCall(agent) !== open[index]) return true
      if (colourOf && colourOf(agent.key) !== colours[index]) return true
      index += 1
    }
    return false
  }

  function sameColors(a, b) {
    if (a.size !== b.size) return false
    for (const [path, colour] of a) {
      if (b.get(path) !== colour) return false
    }
    return true
  }

  function of(state) {
    if (!changed(state)) return mask
    latest = state.latest
    focus.length = 0
    statuses.length = 0
    open.length = 0
    colours.length = 0
    for (const agent of state.agents.values()) {
      focus.push(agent.focus)
      statuses.push(agent.status)
      open.push(hasOpenCall(agent))
      colours.push(colourOf ? colourOf(agent.key) : null)
    }
    const next = workingMask(state, colourOf, spare)
    const same = sameColors(mask.dirColors, next.dirColors) && sameColors(mask.fileColors, next.fileColors)
    next.targetVersion = same ? mask.targetVersion : mask.targetVersion + 1
    spare = mask
    mask = next
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

function touchedPath(state) {
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

function finishedAgentKeys(state, activity) {
  const keys = new Set()
  if (!state || !activity) return keys
  const key = typeof activity.agent === 'string' ? activity.agent : ''
  if (key === '') return keys
  if (activity.type === 'agent.end') {
    keys.add(key)
    return keys
  }
  if (activity.type !== 'run.end') return keys
  const agent = state.agents.get(key)
  if (!agent) return keys
  const mismatch = agent.runId !== null && activity.runId !== agent.runId
  for (const child of state.agents.values()) {
    if (child.parent === null || child.endedAt !== activity.time) continue
    if (child.status !== 'done' && child.status !== 'error') continue
    let at = child.parent
    let below = false
    while (at) {
      if (at === key) {
        below = true
        break
      }
      at = state.agents.get(at)?.parent ?? null
    }
    if (!below) continue
    if (mismatch && child.runId !== activity.runId) continue
    keys.add(child.key)
  }
  if (!mismatch) keys.add(key)
  return keys
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

function roomAgent(agent) {
  return {
    key: agent.key,
    name: agent.name,
    shape: agent.parser ?? agent.key,
    role: agent.role ?? null,
    harness: typeof agent.harness === 'string' ? agent.harness : null,
    model: typeof agent.model === 'string' ? agent.model : null,
    effort: typeof agent.effort === 'string' ? agent.effort : null,
    subOrchestrator: agent.subOrchestrator === true,
    sessionReader: agent.sessionReader === true,
  }
}

export function createRoom({ surface, gl, css, rootName, agents, getState, sound, beforeFrame = () => {}, onPick = () => {}, onInspect = () => {}, onDismiss = () => {} }) {
  const texture = glowTexture()
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, 0.00007)
  const cssScene = new THREE.Scene()
  const calloutScene = new THREE.Scene()

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
  cssRenderer.domElement.style.position = 'absolute'
  cssRenderer.domElement.style.top = '0'
  cssRenderer.domElement.style.left = '0'
  cssRenderer.domElement.style.pointerEvents = 'none'
  css.appendChild(cssRenderer.domElement)
  const calloutRenderer = new CSS3DRenderer()
  calloutRenderer.setSize(width, height)
  calloutRenderer.domElement.style.position = 'absolute'
  calloutRenderer.domElement.style.top = '0'
  calloutRenderer.domElement.style.left = '0'
  calloutRenderer.domElement.style.pointerEvents = 'none'
  css.appendChild(calloutRenderer.domElement)
  let bloom = null

  const space = createVoid(scene, texture)
  const roster = agents.map(roomAgent)
  const hub = createHub(scene, roster)
  const whirs = new Set()
  const deletedFiles = new Set()
  let knownFiles
  let soundFileVersion
  let faultSoundAt = -Infinity
  const agentSet = createAgents(scene, roster, cssScene, {
    calloutScene,
    onRemove: (key) => {
      stopWhir(key)
      dropAgentSatellites(key)
      dropFlyingTouches((item) => item.agent === key)
      stars.cancel((star) => star.agent === key || star.to === key)
      dropPendingTouches((item) => item.agent === key, false)
      for (let index = pendingSpawns.length - 1; index >= 0; index -= 1) {
        const spawn = pendingSpawns[index]
        if (spawn.agent === key || spawn.child === key) pendingSpawns.splice(index, 1)
      }
    },
  })
  agentSet.setViewport(width, height)
  const stars = createStars(scene, sound ? {
    onFlight: (id, point, flightSeconds) => sound.voice(`star:${id}`, 'star', { ...soundFrom(point), flightSeconds }, 1),
    onStop: (id) => sound.stopVoice(`star:${id}`),
  } : undefined)
  const internet = createInternet(scene, texture)
  const satellites = createSatellites(scene)
  const gitTree = createGitTree(scene)
  const terminals = createTerminals(cssScene, roster, { onPick })
  const board = createCostBoard(surface, { onPick })
  let boardShown = boardVisible(width)
  board.setVisible(boardShown)
  const labels = createLabels(scene)
  const traces = createTraces(scene)
  traces.setViewport(width, height)

  const strings = createStrings(scene)
  const cards = createCards(cssScene, {
    glScene: scene,
    rootName,
    onInspect: (path) => inspectPath(path),
    onOpenChange: sound ? (point, open) => sound.play(open ? 'folderOpen' : 'folderClose', soundFrom(point)) : undefined,
    alwaysDepth: 2,
  })
  let linkKey = ''
  let fitted = null
  let heldPath = null
  const tunnelAnchor = new THREE.Vector3()
  const cardAnchorOf = cards.anchor
  const world = {
    anchor: (path) => cards.anchor(path ?? '', tunnelAnchor),
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
    strings.build(links, cardAnchorOf)
  }

  function refit(force = false) {
    const spheres = [HUB_SPHERE, ...cards.overviewSpheres()]
    const max = camera.far / 2
    const next = fitView(spheres, { width, height, center: HUB_CENTER, max })
    if (heldPath !== null) {
      fitted = { target: next.target, dist: next.dist }
      return
    }
    let distance = next.dist
    const drawn = [...cards.cards.values()].filter((card) => card.view && !card.leaving)
    if (drawn.length > 0 && drawn.length - 1 <= SMALL_TOP) {
      const points = cards.overviewSpheres(true)
      distance = Math.min(max, Math.max(distance, distanceForRatio(points, { center: HUB_CENTER })))
    }
    if (!force && fitted) {
      const shift = Math.hypot(next.target.x - fitted.target.x, next.target.y - fitted.target.y, next.target.z - fitted.target.z)
      if (shift < REFIT_SHIFT && Math.abs(distance - fitted.dist) < fitted.dist * REFIT_RATIO) return
    }
    fitted = { target: next.target, dist: distance }
    rig.setFit(next.target, distance)
  }

  const scratch = new THREE.Vector3()
  const inspectPoint = new THREE.Vector3()
  const rig = createCameraRig(camera, surface)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const followFocus = createFollowFocus()
  const colourOf = (key) => agentSet.views.get(key)?.color
  const masks = createWorkingMaskCache(colourOf)
  const calloutInput = { focus: null, hover: null }
  const touchLog = new Map()
  const pendingSpawns = []
  const pendingTouches = []
  const pendingFolderTraces = new Set()
  const flyingTouches = new Set()
  const waitingTraces = new Set()
  const starChain = []
  const starRoutePoints = []
  const starPath = []
  const starEnd = new THREE.Vector3()
  const traceEnd = new THREE.Vector3()
  const starLabelPoint = new THREE.Vector3()
  let replaySpeed = 1
  let ladder = null
  let inspected = null
  let lastWorking = []
  let roomDepth = RING_LEVEL_MAX

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
    const target = event?.target
    let callout = typeof target?.closest === 'function' ? target.closest('.mr-callout[data-agent]') : null
    if (!callout) {
      let node = target
      while (node && typeof node === 'object') {
        if (typeof node.className === 'string' && /(?:^|\s)mr-callout(?:\s|$)/.test(node.className) && node.dataset?.agent) {
          callout = node
          break
        }
        node = node.parentElement ?? node.parentNode ?? null
      }
    }
    const calloutKey = typeof callout?.dataset?.agent === 'string' && callout.dataset.agent !== '' ? callout.dataset.agent : null
    if (calloutKey !== null) {
      hoverAt = 0
      let busy = 0
      for (const agent of getState().agents.values()) {
        if (agent.status === 'working' || agent.status === 'queued') busy += 1
      }
      hoveredKey = busy > CALLOUT_CROWD_LIMIT ? calloutKey : null
      return
    }
    if (target !== renderer.domElement) {
      hoveredKey = null
      hoverAt = 0
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
      cards.setSelected(path)
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
    sound?.stopRoom?.()
    waitingTraces.clear()
    terminals.clearNotes()
    webCalls.clear()
    satelliteCalls.clear()
    pendingSatelliteTraces.clear()
    satellites.reset()
    touchLog.clear()
    labels.clear()
    traces.clear()
    pendingFolderTraces.clear()
    stars.reset()
    for (const key of whirs) stopWhir(key)
    deletedFiles.clear()
    knownFiles = new WeakSet()
    for (const file of state.files.values()) {
      if (file.exists !== false) knownFiles.add(file)
    }
    soundFileVersion = state.fileVersion
    flyingTouches.clear()
    pendingSpawns.length = 0
    pendingTouches.length = 0
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
    if (activity.type !== 'tool.start') return
    const time = Number.isFinite(activity.time) ? activity.time : Date.now()
    for (const touch of activity.touches ?? []) {
      if (touch.kind !== 'file' || typeof touch.path !== 'string') continue
      noteTouch(touchLog, touch.path, { key: agent, mode: touch.mode === 'read' ? 'read' : 'write', time })
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

  const soundProjection = new THREE.Vector3()

  function soundFrom(point) {
    const overviewDistance = fitted?.dist ?? OVERVIEW.dist
    if (point) {
      const { x, y, z } = soundProjection.copy(point).project(camera)
      if (Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1) {
        return {
          x: ((x + 1) / 2) * width,
          y: ((1 - y) / 2) * height,
          width,
          height,
          distance: camera.position.distanceTo(point),
          overviewDistance,
        }
      }
    }
    return { x: -1, y: -1, width, height, distance: Infinity, overviewDistance }
  }

  function soundAt(path) {
    const dir = getState().files.has(path) ? dirname(path) : path
    const target = nearestDrawnPath(dir, {
      has(path) {
        const card = cards.cards.get(path)
        return Boolean(card?.view && !card.leaving)
      },
    })
    return soundFrom(cards.cards.get(target)?.base)
  }

  function soundAtAgent(key) {
    return soundFrom(anchorOf(key))
  }

  function stopWhir(key) {
    if (whirs.delete(key)) sound.stopVoice(`whir:${key}`)
  }

  function moveWhir(view, now) {
    if (view.thinking <= 0 || !view.group.visible) {
      stopWhir(view.key)
      return
    }
    const place = soundFrom(view.group.position)
    place.orbit = view.spinner.group.rotation.y
    place.loop = thinkingLoopPhase(now / 1000, view.thinkingMotion) * 2 * Math.PI
    sound.voice(`whir:${view.key}`, 'whir', place, view.thinking)
    whirs.add(view.key)
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
  const satelliteCalls = new Map()
  const pendingSatelliteTraces = new Map()

  function revealPendingSatellite(item) {
    if (!item) return
    if (item.kind === 'browser') satellites.revealBrowser(1)
    else if (item.kind === 'mcp') satellites.revealMcp(item.server, 1)
  }

  function hasAgentBeam(agentKey) {
    for (const storedAgent of webCalls.values()) {
      if (storedAgent === agentKey) return true
    }
    for (const item of satelliteCalls.values()) {
      if (item.agent === agentKey) return true
    }
    return false
  }

  function dropAgentSatellites(agentKey) {
    for (const [storedKey, storedAgent] of webCalls) {
      if (storedAgent !== agentKey) continue
      webCalls.delete(storedKey)
    }
    for (const [storedKey, item] of satelliteCalls) {
      if (item.agent !== agentKey) continue
      satelliteCalls.delete(storedKey)
      satellites.endCall(storedKey)
    }
    for (const [storedKey, item] of pendingSatelliteTraces) {
      if (item.agent !== agentKey) continue
      pendingSatelliteTraces.delete(storedKey)
      revealPendingSatellite(item)
    }
    agentSet.webEnd(agentKey)
  }

  function trackWeb(activity) {
    const callKey = `${activity.agent}:${activity.id}`
    if (activity.type === 'tool.start') {
      const place = callPlace(activity)
      if (!place) return
      if (place.kind === 'internet') {
        if (typeof activity.id === 'string') webCalls.set(callKey, activity.agent)
        agentSet.webStart(activity.agent, internet.position, { kind: 'internet', radius: INTERNET_RADIUS, color: WEB })
        return
      }
      if (place.kind === 'browser') {
        if (typeof activity.id === 'string') satelliteCalls.set(callKey, { agent: activity.agent, kind: 'browser' })
        satellites.prepareBrowser(callKey)
        const target = satellites.browserAnchor(starEnd)
        agentSet.webStart(activity.agent, target, {
          kind: 'browser',
          radius: BROWSER_RADIUS,
          color: WEB,
          follow: (out) => satellites.browserAnchor(out),
        })
        return
      }
      if (place.kind === 'mcp') {
        if (typeof activity.id === 'string') satelliteCalls.set(callKey, { agent: activity.agent, kind: 'mcp', server: place.server })
        satellites.useMcp(place.server, callKey)
        const target = satellites.mcpAnchor(place.server, starEnd)
        if (target) {
          agentSet.webStart(activity.agent, target, {
            kind: 'mcp',
            radius: MCP_NODE_RADIUS,
            color: WHITE,
            follow: (out) => satellites.mcpAnchor(place.server, out),
          })
        }
      }
      return
    }
    if (activity.type === 'tool.end') {
      const hadWeb = webCalls.delete(callKey)
      const hadSatellite = satelliteCalls.delete(callKey)
      if (hadSatellite) satellites.endCall(callKey)
      if ((hadWeb || hadSatellite) && !hasAgentBeam(activity.agent)) {
        agentSet.webEnd(activity.agent)
      }
      return
    }
    if (activity.type !== 'run.end' && activity.type !== 'agent.end') return
    dropAgentSatellites(activity.agent)
  }

  function currentCardAnchor(card, out) {
    if (!card || cards.cards.get(card.path) !== card) return null
    return cardAnchorOf(card.path, out, true)
  }

  function showTouchLabel(dir, text, color) {
    const card = drawnCard(dir, true)
    const follow = (out) => {
      const anchor = currentCardAnchor(card, out)
      return anchor ? touchLabelPoint(anchor, out) : null
    }
    if (!follow(starLabelPoint)) touchLabelPoint(cards.center(dir), starLabelPoint)
    labels.show(text, starLabelPoint, color, follow)
  }

  function showTouch(touch) {
    const isFile = touch.kind === 'file'
    const dir = isFile ? dirname(touch.path) : touch.path
    const verb = isFile ? (touch.mode === 'read' ? 'read' : 'write') : 'list'
    if (isFile) cards.flashFile(dir, touch.path, 'white')
    else cards.flashCluster(dir, 'white')
    showTouchLabel(dir, `${verb} ${basename(touch.path) || rootName || 'root'}`, '#ffffff')
    if (sound && touch.soundKind) sound.play(touch.soundKind, soundFrom(starLabelPoint))
  }

  function callOf(activity) {
    return typeof activity?.id === 'string' && activity.id !== '' ? activity.id : null
  }

  function launchStarPath(from, to, color, agent = null, call = null, target = null) {
    const points = starRoute(from, null, cardAnchorOf, to, starPath)
    stars.launch({ points, color, agent, to: target, call, speed: replaySpeed })
  }

  function drawnCard(path, includeLeaving = false) {
    let at = path ?? ''
    while (at !== '') {
      const card = cards.cards.get(at)
      if (card && (includeLeaving || !card.leaving)) return card
      at = dirname(at)
    }
    const root = cards.cards.get('')
    return root && (includeLeaving || !root.leaving) ? root : null
  }

  function releaseTouchHold(item) {
    if (!item) return
    if (item.holdDir !== null && item.holdDir !== undefined) {
      pendingFolderTraces.delete(item.holdDir)
      cards.revealCard(item.holdDir, 1)
      item.holdDir = null
    }
    if (item.holdFile) {
      cards.revealRow(item.holdFile, 1)
      item.holdFile = null
    }
  }

  function followTouch(path, touch, flying, traceFile = null) {
    return (end) => {
      const card = cards.cards.get(path)
      if (!card) {
        releaseTouchHold(flying)
        if (flying) flyingTouches.delete(flying)
        return null
      }
      if (card.leaving) {
        releaseTouchHold(flying)
        if (flying) flyingTouches.delete(flying)
        showTouch(touch)
        return null
      }
      if (traceFile) {
        const rowPoint = cards.rowStart(path, traceFile, traceEnd)
        if (rowPoint) {
          end.x = rowPoint.x
          end.y = rowPoint.y
          end.z = rowPoint.z
          return end
        }
      }
      const anchor = cards.anchor(path, starEnd)
      if (!anchor) {
        releaseTouchHold(flying)
        if (flying) flyingTouches.delete(flying)
        return null
      }
      end.x = anchor.x
      end.y = anchor.y
      end.z = anchor.z
      return end
    }
  }

  function recordTouchTarget(touch) {
    if (!touch || typeof touch.path !== 'string') return
    const dir = touch.kind === 'file' ? dirname(touch.path) : touch.path
    cards.recordTouch(dir)
  }

  function dropFlyingTouches(test, record = false) {
    for (const item of [...flyingTouches]) {
      if (!test(item)) continue
      releaseTouchHold(item)
      flyingTouches.delete(item)
      if (record) recordTouchTarget(item.touch)
    }
  }

  function startTouchTrace(color, traceKind, cardDir, filePath, item) {
    if (!traceKind || still()) {
      releaseTouchHold(item)
      return
    }
    if (traceKind === 'folder') {
      const points = cards.faceOutline(cardDir, [])
      if (!points) {
        releaseTouchHold(item)
        return
      }
      item.holdDir = null
      traces.start({
        points,
        color,
        duration: FOLDER_TRACE_SECONDS,
        hold: TRACE_HOLD_SECONDS,
        fade: TRACE_FADE_SECONDS,
        follow: (out) => cards.faceOutline(cardDir, out),
        onProgress: (share) => cards.revealCard(cardDir, share),
        onDone: () => cards.revealCard(cardDir, 1),
      })
      return
    }
    if (traceKind === 'file') {
      const points = cards.rowOutline(cardDir, filePath, [])
      if (!points) {
        waitingTraces.add({ color, cardDir, filePath, item, started: performance.now() })
        return
      }
      item.holdFile = null
      traces.start({
        points,
        color,
        duration: FILE_TRACE_SECONDS,
        hold: TRACE_HOLD_SECONDS,
        fade: TRACE_FADE_SECONDS,
        follow: (out) => cards.rowOutline(cardDir, filePath, out),
        onProgress: (share) => cards.revealRow(filePath, share),
        onDone: () => cards.revealRow(filePath, 1),
      })
    }
  }

  function launchTouchStar(item) {
    const view = agentSet.views.get(item.agent)
    if (!view) {
      releaseTouchHold(item)
      return
    }
    const touch = item.touch
    const isFile = touch.kind === 'file'
    const dir = isFile ? dirname(touch.path) : touch.path
    const file = isFile ? touch.path : null
    if (item.traceKind === 'folder') {
      pendingFolderTraces.delete(dir)
      const ownCard = cards.cards.get(dir)
      if (!ownCard || ownCard.leaving) {
        cards.revealCard(dir, 1)
        item.holdDir = null
        if (isFile && touch.soundKind === 'created') {
          item.traceKind = 'file'
          item.holdFile = touch.path
          cards.holdRow(touch.path)
        } else {
          item.traceKind = null
        }
      }
    }
    const traceKind = item.traceKind
    const target = drawnCard(dir)
    if (traceKind === 'file' && target) {
      if (!cards.rowStart(target.path, file, starEnd) && !cardAnchorOf(dir, starEnd)) {
        world.edge(dir, file, world.side(dir), starEnd)
      }
    } else if (!cardAnchorOf(dir, starEnd)) {
      world.edge(dir, file, world.side(dir), starEnd)
    }
    const chain = litChain(dir, world.links, world.mask, starChain)
    const route = tunnelRoute(chain, world.links, world.mask, starRoutePoints)
    const points = starRoute(view.group.position, route, cardAnchorOf, starEnd, starPath)
    const waypointCards = route.slice(0, points.length - 2).map((path) => drawnCard(path))
    const flying = { agent: item.agent, call: item.call, touch, holdDir: item.holdDir, holdFile: item.holdFile, traceKind, dir, file, color: view.color }
    const launched = stars.launch({
      points,
      color: view.color,
      onLand: () => {
        flyingTouches.delete(flying)
        showTouch(touch)
        startTouchTrace(view.color, traceKind, dir, file, flying)
      },
      agent: item.agent,
      call: item.call,
      speed: replaySpeed,
      follow: target ? followTouch(target.path, touch, flying, traceKind === 'file' ? file : null) : null,
      followWaypoint: waypointCards.length ? (index) => currentCardAnchor(waypointCards[index], traceEnd) : null,
    })
    if (launched) flyingTouches.add(flying)
    else releaseTouchHold(flying)
  }

  function queueTouchStar(activity, touch, removes = false) {
    const dir = touch.kind === 'file' ? dirname(touch.path) : touch.path
    const isCreate = touch.soundKind === 'created' || (touch.kind === 'dir' && touch.mode !== 'read' && touch.mode !== 'list' && !removes)
    let traceKind = null
    let holdDir = null
    let holdFile = null
    if (!still() && isCreate) {
      const card = cards.cards.get(dir)
      if ((!card || card.leaving) && !pendingFolderTraces.has(dir)) {
        pendingFolderTraces.add(dir)
        cards.holdCard(dir)
        traceKind = 'folder'
        holdDir = dir
      } else if (touch.kind === 'file' && touch.soundKind === 'created') {
        cards.holdRow(touch.path)
        traceKind = 'file'
        holdFile = touch.path
      }
    }
    pendingTouches.push({ agent: activity.agent, touch, call: callOf(activity), traceKind, holdDir, holdFile })
  }

  function dropPendingTouches(test, land = false, record = false) {
    for (let index = pendingTouches.length - 1; index >= 0; index -= 1) {
      const item = pendingTouches[index]
      if (!test(item)) continue
      pendingTouches.splice(index, 1)
      releaseTouchHold(item)
      if (land) showTouch(item.touch)
      else if (record) recordTouchTarget(item.touch)
    }
  }

  function flushTouchStars() {
    if (pendingTouches.length === 0) return
    const isStill = still()
    for (const item of pendingTouches) {
      if (isStill) {
        releaseTouchHold(item)
        showTouch(item.touch)
      } else {
        launchTouchStar(item)
      }
    }
    pendingTouches.length = 0
  }

  function launchAgentStar(activity) {
    const pair = agentStar(activity, ladder)
    if (!pair) return
    const topKey = agentSet.topKey()
    const to = agentSet.views.get(pair.to)
    const laneStart = activity.type === 'run.start' && to?.index >= 0
    const origin = laneStart && agentSet.mainHidden() && topKey !== 'orchestrator' ? topKey : pair.from
    const fromKey = starOriginKey(origin, topKey)
    const from = agentSet.views.get(fromKey)
    const useHub = laneStart && agentSet.mainHidden() && fromKey === 'orchestrator'
    if (!from || !to?.group.visible || from === to || (!from.group.visible && !useHub)) return
    launchStarPath(useHub ? from.home : from.group.position, to.group.position, from.color, fromKey, null, pair.to)
  }

  function startBrowserTrace(color) {
    const points = satellites.browserOutline([])
    if (!points || still()) {
      satellites.revealBrowser(1)
      return
    }
    traces.start({
      points,
      color,
      duration: BROWSER_TRACE_SECONDS,
      hold: TRACE_HOLD_SECONDS,
      fade: TRACE_FADE_SECONDS,
      follow: (out) => satellites.browserOutline(out),
      onProgress: (share) => satellites.revealBrowser(share),
      onDone: () => satellites.revealBrowser(1),
    })
  }

  function startMcpTrace(server, color) {
    const points = satellites.mcpOutline(server, [])
    if (!points || still()) {
      satellites.revealMcp(server, 1)
      return
    }
    traces.start({
      points,
      color,
      duration: MCP_TRACE_SECONDS,
      hold: TRACE_HOLD_SECONDS,
      fade: TRACE_FADE_SECONDS,
      follow: (out) => satellites.mcpOutline(server, out),
      onProgress: (share) => satellites.revealMcp(server, share),
      onDone: () => satellites.revealMcp(server, 1),
    })
  }

  function launchWebStar(view, activity, place = callPlace(activity)) {
    if (!place) return
    if (place.kind === 'internet') {
      if (!internet.online()) return
      webTunnelEnd(view.group.position, internet.position, INTERNET_RADIUS, starEnd)
      launchStarPath(view.group.position, starEnd, view.color, activity.agent, callOf(activity))
      return
    }
    const callId = callOf(activity)
    const callKey = `${activity.agent}:${activity.id}`
    if (place.kind === 'browser') {
      const tracePending = satellites.claimBrowserTrace()
      if (!view || still()) {
        if (tracePending) satellites.revealBrowser(1)
        return
      }
      if (tracePending && callId !== null) pendingSatelliteTraces.set(callKey, { agent: activity.agent, kind: 'browser' })
      const anchor = satellites.browserAnchor(starEnd)
      webTunnelEnd(view.group.position, anchor, BROWSER_RADIUS, starEnd)
      const points = starRoute(view.group.position, null, cardAnchorOf, starEnd, starPath)
      const launched = stars.launch({
        points,
        color: view.color,
        agent: activity.agent,
        call: callId,
        speed: replaySpeed,
        follow: (end) => {
          const next = satellites.browserAnchor(traceEnd)
          return next ? webTunnelEnd(view.group.position, next, BROWSER_RADIUS, end) : null
        },
        onLand: () => {
          pendingSatelliteTraces.delete(callKey)
          if (tracePending) startBrowserTrace(view.color)
        },
      })
      if (!launched && tracePending) {
        pendingSatelliteTraces.delete(callKey)
        satellites.revealBrowser(1)
      }
      return
    }
    if (place.kind === 'mcp') {
      const server = place.server
      const anchor = satellites.mcpAnchor(server, starEnd)
      if (!anchor) return
      const tracePending = satellites.claimMcpTrace(server)
      if (!view || still()) {
        if (tracePending) satellites.revealMcp(server, 1)
        return
      }
      if (tracePending && callId !== null) pendingSatelliteTraces.set(callKey, { agent: activity.agent, kind: 'mcp', server })
      webTunnelEnd(view.group.position, anchor, MCP_NODE_RADIUS, starEnd)
      const points = starRoute(view.group.position, null, cardAnchorOf, starEnd, starPath)
      const launched = stars.launch({
        points,
        color: view.color,
        agent: activity.agent,
        call: callId,
        speed: replaySpeed,
        follow: (end) => {
          const next = satellites.mcpAnchor(server, traceEnd)
          return next ? webTunnelEnd(view.group.position, next, MCP_NODE_RADIUS, end) : null
        },
        onLand: () => {
          pendingSatelliteTraces.delete(callKey)
          if (tracePending) startMcpTrace(server, view.color)
        },
      })
      if (!launched && tracePending) {
        pendingSatelliteTraces.delete(callKey)
        satellites.revealMcp(server, 1)
      }
    }
  }

  function flushSpawnStars() {
    if (pendingSpawns.length === 0) return
    if (still()) {
      pendingSpawns.length = 0
      return
    }
    for (const activity of pendingSpawns) launchAgentStar(activity)
    pendingSpawns.length = 0
  }

  function onActivity(activity) {
    noteActivity(activity)
    terminals.note(activity)
    if (activity.agent === 'orchestrator') agentSet.rememberMainWork(getState())
    const view = agentSet.views.get(activity.agent)
    trackWeb(activity)
    if (followFocus.following() && activity.type === 'tool.start') {
      const path = touchedCard(activity)
      if (path !== null) pendingFollow = path
    }

    if (activity.type === 'run.end' || activity.type === 'agent.end') {
      const finished = finishedAgentKeys(getState(), activity)
      if (finished.size > 0) {
        for (const item of pendingTouches) {
          if (!activity.ok || !finished.has(item.agent) || !item.traceKind) continue
          const dir = item.touch.kind === 'file' ? dirname(item.touch.path) : item.touch.path
          const file = item.touch.kind === 'file' ? item.touch.path : null
          const view = agentSet.views.get(item.agent)
          if (view && (item.traceKind !== 'file' || cards.rowOutline(dir, file, []))) {
            startTouchTrace(view.color, item.traceKind, dir, file, item)
          }
        }
        for (const item of [...flyingTouches]) {
          if (!finished.has(item.agent)) continue
          if (activity.ok && item.traceKind && (item.traceKind !== 'file' || cards.rowOutline(item.dir, item.file, []))) {
            startTouchTrace(item.color, item.traceKind, item.dir, item.file, item)
          }
        }
        for (const waiting of [...waitingTraces]) {
          if (!finished.has(waiting.item.agent)) continue
          releaseTouchHold(waiting.item)
          waitingTraces.delete(waiting)
        }
        dropFlyingTouches((item) => finished.has(item.agent), true)
        stars.cancel((star) => finished.has(star.agent) || finished.has(star.to))
        dropPendingTouches((item) => finished.has(item.agent), false, true)
        for (let index = pendingSpawns.length - 1; index >= 0; index -= 1) {
          const spawn = pendingSpawns[index]
          if (finished.has(spawn.agent) || finished.has(spawn.child)) pendingSpawns.splice(index, 1)
        }
        for (const key of finished) {
          dropAgentSatellites(key)
        }
      }
      if (activity.type === 'run.end') {
        hub.pulse(activity.ok ? GREEN : RED, 1)
        cards.markRows()
      }
      return
    }

    if (activity.type === 'tool.start') {
      const state = getState()
      const removes = isDeleteCommand(activity.label)
      for (const touch of activity.touches ?? []) {
        if (touch.kind === 'file') {
          const dir = dirname(touch.path)
          agentSet.aimAt(activity.agent, dir, touch.path, performance.now())
        } else {
          agentSet.aimAt(activity.agent, touch.path, null, performance.now())
        }
        const file = touch.kind === 'file' ? state.files.get(touch.path) : null
        const soundKind = touchSoundKind(touch, removes, deletedFiles, () => (
          file && file.exists !== false &&
          (state.fileVersion === soundFileVersion || knownFiles.has(file) || file.writes > 1)
        ))
        if (file && file.exists !== false && soundKind !== 'deleted') knownFiles.add(file)
        queueTouchStar(activity, soundKind ? { ...touch, soundKind } : touch, removes)
      }
      soundFileVersion = state.fileVersion
      const place = callPlace(activity)
      if (place) {
        if (view && !still()) launchWebStar(view, activity, place)
        else if (place.kind === 'browser') satellites.revealBrowser(1)
        else if (place.kind === 'mcp') satellites.revealMcp(place.server, 1)
      }
      return
    }

    if (activity.type === 'tool.end' && !activity.ok) {
      const callKey = `${activity.agent}:${activity.id}`
      if (pendingSatelliteTraces.has(callKey)) {
        const pending = pendingSatelliteTraces.get(callKey)
        pendingSatelliteTraces.delete(callKey)
        revealPendingSatellite(pending)
      }
      const call = callOf(activity)
      if (call !== null) {
        for (const waiting of [...waitingTraces]) {
          if (waiting.item.agent !== activity.agent || waiting.item.call !== call) continue
          releaseTouchHold(waiting.item)
          waitingTraces.delete(waiting)
        }
        dropFlyingTouches((item) => item.agent === activity.agent && item.call === call)
        stars.cancel((star) => star.agent === activity.agent && star.call === call)
        dropPendingTouches((item) => item.agent === activity.agent && item.call === call)
      }
      const touches = getState().agents.get(activity.agent)?.calls.get(activity.id) ?? []
      touches.forEach((touch) => {
        if (touch.kind === 'file') {
          cards.flashFile(dirname(touch.path), touch.path, 'red')
          showTouchLabel(dirname(touch.path), `failed ${basename(touch.path)}`, '#ff2a2a')
        } else {
          cards.flashCluster(touch.path, 'red')
        }
      })
      const faultAt = performance.now()
      if (sound && touches.length > 0 && faultAt - faultSoundAt >= FAULT_SOUND_GAP_MS) {
        faultSoundAt = faultAt
        sound.play('failed', soundAt(touches[0].path))
      }
      hub.pulse(RED, 0.5)
      return
    }

    if (!view) return

    if (activity.type === 'run.start') {
      hub.pulse(WHITE, 1)
      if (!still()) {
        agentSet.updateTop(getState())
        if (agentSet.mainHidden() && agentSet.topKey() !== 'orchestrator') pendingSpawns.push(activity)
        else launchAgentStar(activity)
      }
    } else if (activity.type === 'error') {
      hub.pulse(RED, 0.6)
    } else if (activity.type === 'agent.spawn' && typeof activity.child === 'string') {
      pendingSpawns.push(activity)
    } else if (activity.type === 'agent.message' && !still()) {
      launchAgentStar(activity)
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
    calloutRenderer.setSize(width, height)
    bloom?.resize(width, height)
    agentSet.setViewport(width, height)
    traces.setViewport(width, height)
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
    const times = frameTimes(last, now)
    const delta = times.delta
    last = now
    beforeFrame(times.elapsed)

    const state = getState()
    if (Number.isFinite(state.depthLimit)) {
      const next = ringDepth(state.depthLimit, RING_LEVEL_MAX)
      if (next !== roomDepth) {
        roomDepth = agentSet.setDepth(next)
        hub.setDepth(roomDepth)
      }
    }
    const mask = masks.of(state)
    const working = workingKeys(state, lastWorking)
    if (working !== lastWorking) {
      lastWorking = working
      hub.setWorking(working)
    }
    space.update(delta)
    hub.update(now / 1000, delta, camera, height)
    internet.update(delta, agentSet.webActive('internet') > 0)
    satellites.update(delta)
    if (gitTree.setTop(cards.bottom(''))) space.setLevels(gitTree.bottom())
    gitTree.update(delta)
    if (cards.update(state, delta, camera, mask, replaySpeed, now / 1000)) {
      const holdLost = releaseLostHold()
      relink()
      refit(holdLost)
    }
    if (followFocus.following() && pendingFollow !== null) {
      const path = pendingFollow
      pendingFollow = null
      followPath(path)
    }
    strings.update(cardAnchorOf, mask, delta)
    labels.update(delta, replaySpeed)
    world.mask = mask
    calloutInput.focus = followFocus.focused()
    calloutInput.hover = hoveredKey
    agentSet.update(state, delta, now, world, terminals, calloutInput)
    for (const waiting of [...waitingTraces]) {
      const card = cards.cards.get(waiting.cardDir)
      if (now - waiting.started >= 10000 || (card && (card.leaving || card.view?.state !== 'files'))) {
        releaseTouchHold(waiting.item)
        waitingTraces.delete(waiting)
      } else if (cards.rowOutline(waiting.cardDir, waiting.filePath, [])) {
        waitingTraces.delete(waiting)
        startTouchTrace(waiting.color, 'file', waiting.cardDir, waiting.filePath, waiting.item)
      }
    }
    flushTouchStars()
    flushSpawnStars()
    stars.update(delta, replaySpeed)
    traces.update(delta)
    for (const view of agentSet.views.values()) {
      const status = state.agents.get(view.key)?.status ?? 'idle'
      const active = status === 'working' || status === 'queued'
      const color = status === 'error' ? RED : status === 'done' ? GREEN : active ? view.color : WHITE
      const opacity = status === 'idle' ? 0.25 : active ? 0.12 : 0.6
      hub.setSlot(view.index, color, opacity * (view.presenceOpacity ?? 1))
    }

    rig.update(delta)
    if (sound) {
      if (replaySpeed > 0) {
        for (const view of agentSet.views.values()) moveWhir(view, now)
      } else {
        for (const key of whirs) stopWhir(key)
      }
    }
    soundFileVersion = state.fileVersion
    const hubPoint = projectPoint(camera, HUB_CENTER, width, height)
    hubScreenX = hubPoint ? hubPoint.x : NaN
    terminals.update(state, now, camera, followFocus.focused(), anchorOf, delta, chipSideOf, colourOf)
    renderer.render(scene, camera)
    bloom?.render()
    cssRenderer.render(cssScene, camera)
    calloutRenderer.render(calloutScene, camera)
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
    inspected = null
    cards.setInspected(null)
    const dir = isFile ? dirname(path) : path
    followFocus.clear()
    cards.pin(dir)
    cards.setSelected(dir)
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
      pixelRatio: 1,
      strength,
    })
  }

  return {
    onActivity,
    soundAt,
    soundAtAgent,
    setBeat: (strength) => {
      agentSet.beat(strength)
      cards.beat(strength)
      hub.beat(strength)
    },
    setSway: (level) => {
      agentSet.setSway(level)
      cards.setSway(level)
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
      const changed = gitTree.setState(state)
      if (changed) space.setLevels(gitTree.bottom())
      return changed
    },
    focusGitTree,
    inspectGitTree,
    setOnline(next) {
      internet.setOnline(next)
      agentSet.setOnline(next)
    },
    setOptions(options = {}) {
      const next = {}
      if (Object.hasOwn(options, 'alwaysDepth')) next.alwaysDepth = options.alwaysDepth
      if (Object.hasOwn(options, 'maxFiles')) next.maxFiles = options.maxFiles
      if (Object.hasOwn(options, 'folderSpacing')) next.folderSpacing = options.folderSpacing
      if (Object.hasOwn(options, 'folderContents')) next.folderContents = options.folderContents
      if (Object.hasOwn(options, 'openOnTouch')) next.openOnTouch = options.openOnTouch
      if (!cards.setOptions(next)) return
      cards.sync(getState(), { quiet: false })
      releaseLostHold()
      relink()
      refit(true)
    },
    setTasks(tasksMap) {
      agentSet.setTasks(tasksMap)
    },
    setLadder(next) {
      ladder = next
      hub.setLadder(next)
      agentSet.setLadder(next)
    },
    setSpeed(value) {
      replaySpeed = speedRate(value)
    },
    setLabels(labels) {
      terminals.setLabels(labels)
      agentSet.setLabels(labels)
    },
    setChosenTop(key, options) {
      agentSet.setChosenTop(key, options)
      return agentSet.topKey()
    },
    setDepth(value) {
      roomDepth = agentSet.setDepth(value)
      hub.setDepth(roomDepth)
      return roomDepth
    },
    setSeatCounts(rows) {
      hub.setSeatCounts(rows)
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
      for (const key of whirs) stopWhir(key)
      observer.disconnect()
      bloom?.dispose()
      bloom = null
      rig.dispose()
      agentSet.dispose()
      stars.dispose()
      terminals.dispose()
      internet.dispose()
      satellites.dispose()
      gitTree.dispose()
      board.dispose()
      labels.dispose()
      traces.dispose()
      strings.dispose()
      cards.dispose()
      hub.dispose()
      space.dispose()
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
      css.removeChild(calloutRenderer.domElement)
      disposeStill()
    },
  }
}
