import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { planFolderView } from '../model/folderView.js'
import { basename, dirname, visibleText } from '../model/paths.js'
import { freshRecent } from '../model/state.js'
import { SWAY_LIFT, SWAY_RATE, SWAY_SCALE, danceEnvelope, startDanceEnvelope } from './hub.js'
import { FOLDER_DRIFT_RADIUS, FOLDER_SPACING_DEFAULT, RING_CENTER, ROOT_PLACE, SMALL_TOP, clampFolderSpacing, folderDrift, layoutRing, orbitPlace, ringOf, ringRotation } from './ring.js'
import { easeInOut, easeRate, still } from './sprites.js'
import { speedRate } from './stars.js'

export const CARD_W = 248
export const HEAD_H = 56
export const ROW_H = 22
export const CARD_PAD = 8
const CONTENT_ANIM_SEC = 0.25
const CHAIN_GATE = 0.7
export const BACK_STEP = 12
const BACK_DEPTH = 6
export const CARD_FACE_EDGE = 1
export const CARD_FACE_BORDER = 2
export const CARD_TAB_W = 72
export const CARD_TAB_H = 8
export const CARD_TAB_LEFT = -1
export const CARD_TAB_TOP = -9
export const CARD_SCALES = { closed: 1, open: 1.2, files: 1.8 }
export const CARD_NAME_MAX = 24
const CARD_NAME_PAD = 28
export const FILE_LIMIT_MIN = 4
export const FILE_LIMIT_MAX = 20
export const FILE_LIMIT_DEFAULT = 6
const VIRTUAL_MIN_ROWS = 60
const VIRTUAL_OVERSCAN = 4
const NAME_WIDE = new Set(['M', 'W'])
const NAME_NARROW = new Set(['I', 'J'])
const FLASH_MS = 1100
const FAIL_MS = 2600
const FADE_MS = 400
const DIM_FADE_MS = 1000
const DIM_OPACITY = 0.25
const BRACKETS = ['tl', 'tr', 'bl', 'br']
export const DANCE_LIFT = 24

export function danceOrder(spots) {
  const list = Array.isArray(spots) ? spots : []
  return list
    .filter((spot) => spot && typeof spot.path === 'string')
    .sort((a, b) => {
      const rootA = a.path === '' ? 1 : 0
      const rootB = b.path === '' ? 1 : 0
      if (rootA !== rootB) return rootA - rootB
      const angleA = Number(a.angle)
      const angleB = Number(b.angle)
      const turnA = Number.isFinite(angleA) ? angleA : 0
      const turnB = Number.isFinite(angleB) ? angleB : 0
      if (turnA !== turnB) return turnA - turnB
      const radiusA = Number(a.radius)
      const radiusB = Number(b.radius)
      return (Number.isFinite(radiusA) ? radiusA : 0) - (Number.isFinite(radiusB) ? radiusB : 0)
    })
    .map((spot) => spot.path)
}

export function nextDanceCard(order, previous = '') {
  const list = Array.isArray(order) ? order.filter((path) => typeof path === 'string') : []
  if (list.length === 0) return ''
  return list[(list.indexOf(previous) + 1) % list.length]
}

export function fadeProgress(start, now, stillNow = false, duration = FADE_MS) {
  if (stillNow) return 1
  return Math.min(1, (now - start) / duration)
}

function viewFocus(state, pinned) {
  const focus = ['']
  for (const agent of state.agents.values()) focus.push(...(agent.focus ?? []))
  focus.push(...(state.recent ? freshRecent(state) : []), ...pinned)
  return [...new Set(focus)].sort()
}

let cachedFiles = []
let cachedCount = -1
let cachedMap = null
let cachedVersion = -1
let cachedIterator = null
let cachedIteratorDone = true
let cachedSeen = 0

function rebuildFileList(state) {
  const files = []
  for (const file of state.files.values()) if (file.exists) files.push(file.path)
  cachedFiles = files
  cachedMap = state.files
  cachedCount = Number.isFinite(state.existingFiles) ? state.existingFiles : files.length
  cachedVersion = Number.isFinite(state.fileVersion) ? state.fileVersion : -1
  cachedSeen = state.files.size
  cachedIterator = null
  cachedIteratorDone = true
}

function tailIterator(state) {
  if (!cachedIteratorDone) return
  cachedIterator = state.files.values()
  for (let at = 0; at < cachedSeen; at += 1) {
    if (cachedIterator.next().done) break
  }
  cachedIteratorDone = false
}

function appendFileList(state) {
  const count = Number.isFinite(state.existingFiles) ? state.existingFiles : cachedFiles.length
  const mapDelta = state.files.size - cachedSeen
  const countDelta = count - cachedCount
  const version = Number.isFinite(state.fileVersion) ? state.fileVersion : null
  const versionDelta = version !== null && cachedVersion >= 0 ? version - cachedVersion : null
  const appended =
    countDelta > 0 &&
    mapDelta >= countDelta &&
    (versionDelta === null || versionDelta === countDelta || (versionDelta === 0 && mapDelta === countDelta))
  if (!appended) {
    rebuildFileList(state)
    return
  }
  tailIterator(state)
  let found = 0
  for (let next = cachedIterator.next(); !next.done; next = cachedIterator.next()) {
    if (next.value.exists) {
      cachedFiles.push(next.value.path)
      found += 1
    }
  }
  cachedIteratorDone = true
  cachedSeen = state.files.size
  cachedCount = count
  if (version !== null) cachedVersion = version
  if (found !== countDelta) rebuildFileList(state)
}

export function viewInput(state, pinned = []) {
  if (cachedMap !== state.files) rebuildFileList(state)
  else {
    const count = Number.isFinite(state.existingFiles) ? state.existingFiles : cachedFiles.length
    if (count !== cachedCount) appendFileList(state)
    else if (Number.isFinite(state.fileVersion) && cachedVersion >= 0 && state.fileVersion !== cachedVersion) rebuildFileList(state)
  }
  return { files: cachedFiles, focus: viewFocus(state, pinned), touched: state.recent ?? [] }
}

export function viewKey(state, pinned = []) {
  return `${state.existingFiles}|${viewFocus(state, pinned).join('\n')}`
}

export function openChain(state, extra = []) {
  const focus = new Set()
  for (const agent of state.agents.values()) for (const path of agent.focus ?? []) focus.add(path)
  for (const path of extra) focus.add(path)
  const dirs = new Set()
  for (const path of focus) dirs.add(state.files.has(path) ? dirname(path) : path)
  const chain = new Set()
  for (const dir of dirs) {
    let at = dir
    chain.add(at)
    while (at !== '') {
      at = dirname(at)
      chain.add(at)
    }
  }
  return chain
}

export function cardHeight(rows) {
  return HEAD_H + rows * ROW_H + CARD_PAD
}

export function clampFileLimit(value) {
  if (value === null || value === undefined) return FILE_LIMIT_DEFAULT
  const number = Number(value)
  if (!Number.isFinite(number)) return FILE_LIMIT_DEFAULT
  return Math.min(FILE_LIMIT_MAX, Math.max(FILE_LIMIT_MIN, Math.round(number)))
}

export function rowOffset(rows, index) {
  return cardHeight(rows) / 2 - (HEAD_H + (index + 0.5) * ROW_H)
}

export function cardRows(view) {
  if (view.state !== 'files') return 0
  const total = view.items.length + (view.hiddenItems > 0 ? 1 : 0)
  if (Number.isFinite(view.maxFiles)) return Math.min(total, clampFileLimit(view.maxFiles))
  return total
}

export function rowWindow(total, scrollTop, viewport, { rowHeight = ROW_H, overscan = VIRTUAL_OVERSCAN, threshold = VIRTUAL_MIN_ROWS } = {}) {
  const count = Math.max(0, Math.floor(Number(total) || 0))
  const height = Number(rowHeight) > 0 ? Number(rowHeight) : ROW_H
  if (count <= Math.max(0, Math.floor(Number(threshold) || 0))) {
    return { virtual: false, first: 0, last: count, top: 0, bottom: 0 }
  }
  const view = Math.max(0, Number(viewport) || 0)
  const at = Math.min(Math.max(0, count * height - view), Math.max(0, Number(scrollTop) || 0))
  const pad = Math.max(0, Math.floor(Number(overscan) || 0))
  const first = Math.max(0, Math.floor(at / height) - pad)
  const last = Math.min(count, Math.ceil((at + view) / height) + pad)
  return {
    virtual: true,
    first,
    last,
    top: first * height,
    bottom: (count - last) * height,
  }
}

export function cardMetaText(view) {
  if (view.state === 'files') {
    const items = view.items.length + (Number(view.hiddenItems) || 0)
    const folders = Number(view.hiddenFolders) || 0
    if (folders > 0) return `${items} items  ${folders} ${folders === 1 ? 'folder' : 'folders'}`
    return `${items} items`
  }
  if (view.state === 'open') return `${view.folders.length + view.hiddenFolders} folders`
  return ''
}

function clipCardName(name, max = CARD_NAME_MAX) {
  const chars = Array.from(String(name ?? ''))
  const limit = Math.max(4, Math.floor(Number(max) || CARD_NAME_MAX))
  if (chars.length <= limit) return chars.join('')
  const keep = limit - 3
  const start = Math.ceil(keep / 2)
  const end = keep - start
  return `${chars.slice(0, start).join('')}...${end > 0 ? chars.slice(-end).join('') : ''}`
}

export function cardName(path, rootName = 'root') {
  if (typeof path !== 'string') return ''
  const folder = path === '' ? String(rootName) : basename(path)
  if (folder === '') return ''
  return `${clipCardName(visibleText(folder))}/`
}

export function cardTitle(path, rootName = 'root') {
  if (typeof path !== 'string') return ''
  return visibleText(path === '' ? String(rootName) : path)
}

export function cardBaseWidth(path, rootName) {
  const name = cardName(path, rootName)
  if (name === '') return CARD_W
  let text = 0
  for (const char of Array.from(name.toUpperCase())) {
    if (NAME_WIDE.has(char)) text += 15
    else if (NAME_NARROW.has(char)) text += 4.5
    else if (/[A-Z0-9]/.test(char)) text += 9.6
    else text += 6.5
    text += 0.6
  }
  return Math.max(CARD_W, Math.ceil(text) + CARD_NAME_PAD)
}

export function cardSize(view, rootName = 'root') {
  const scale = CARD_SCALES[view.state] ?? 1
  const back = (view.back ?? 0) * BACK_STEP
  return { scale, width: (cardBaseWidth(view?.path, rootName) + back) * scale, height: (cardHeight(cardRows(view)) + back) * scale }
}

export function backOffsets(count, step = BACK_STEP) {
  const layers = Math.max(0, Math.floor(Number(count) || 0))
  const raw = Number(step)
  const size = Number.isFinite(raw) && raw > 0 ? raw : BACK_STEP
  const offsets = []
  for (let index = 0; index <= layers; index += 1) offsets.push({ x: 0 - index * size, y: 0 })
  return offsets
}

function backLayers(count) {
  const raw = Number(count)
  if (!Number.isFinite(raw)) return 0
  return Math.min(3, Math.max(0, Math.floor(raw)))
}

function backPlaces(count) {
  return backOffsets(backLayers(count)).slice(1)
}

export function tabAnchorOffset(width, height, scale = 1) {
  const faceWidth = Number(width) > 0 ? Number(width) : CARD_W + CARD_FACE_BORDER
  const faceHeight = Number(height) > 0 ? Number(height) : HEAD_H + CARD_PAD + CARD_FACE_BORDER
  const amount = Number(scale) > 0 ? Number(scale) : 1
  const tabLeft = CARD_TAB_LEFT + CARD_FACE_EDGE
  const tabTop = CARD_TAB_TOP + CARD_FACE_EDGE
  return {
    x: (tabLeft + CARD_TAB_W / 2 - faceWidth / 2) * amount,
    y: (faceHeight / 2 - tabTop - CARD_TAB_H / 2) * amount,
  }
}

export function occluderParts(view, rootName = 'root', heightOverride = null) {
  const width = cardBaseWidth(view?.path, rootName) + CARD_FACE_BORDER
  const baseHeight = Number.isFinite(heightOverride) ? heightOverride : cardHeight(cardRows(view))
  const height = baseHeight + CARD_FACE_BORDER
  const tab = tabAnchorOffset(width, height)
  const parts = [
    { width, height, x: 0, y: 0 },
    { width: CARD_TAB_W, height: CARD_TAB_H, x: tab.x, y: tab.y },
  ]
  for (const offset of backPlaces(view?.back)) {
    parts.push({ width, height, x: offset.x, y: offset.y })
    parts.push({ width: CARD_TAB_W, height: CARD_TAB_H, x: offset.x + tab.x, y: tab.y })
  }
  return parts
}

export function occluderBox(view, scale = 1, rootName = 'root') {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const part of occluderParts(view, rootName)) {
    left = Math.min(left, part.x - part.width / 2)
    right = Math.max(right, part.x + part.width / 2)
    bottom = Math.min(bottom, part.y - part.height / 2)
    top = Math.max(top, part.y + part.height / 2)
  }
  return {
    width: (right - left) * scale,
    height: (top - bottom) * scale,
    offsetX: ((left + right) / 2) * scale,
    offsetY: ((top + bottom) / 2) * scale,
  }
}

export function cardPlan(state, { pinned = [], alwaysDepth = 2, maxFiles = FILE_LIMIT_DEFAULT, spacing = FOLDER_SPACING_DEFAULT, previous = new Map(), sprayed = new Set(), rootName = 'root' } = {}) {
  const pins = [...pinned]
  const sprays = [...sprayed]
  const input = viewInput(state, [...pins, ...sprays])
  const plan = planFolderView({ ...input, alwaysDepth, expanded: sprays, limitItems: false })
  const fileLimit = clampFileLimit(maxFiles)
  const drawn = new Map()
  for (const view of plan) {
    drawn.set(view.path, { ...view, maxFiles: fileLimit, back: view.path === '' ? 0 : view.back })
  }
  const entries = [...drawn.values()].map((view) => ({ path: view.path, ...cardSize(view, rootName) }))
  const layoutKey = `${spacing}|${entries.map((entry) => `${entry.path}:${entry.width}:${entry.height}`).join(';')}|${sprays.sort().join(',')}`
  const placed = layoutRing(entries, { previous, sprayed, small: entries.length - 1 <= SMALL_TOP, spacing })
  return { input, plan, views: plan, drawn, entries, placed, layoutKey }
}

export function overviewSpheres(cards, { orbit = false, includeChildren = false } = {}) {
  const out = []
  for (const card of cards ?? []) {
    const root = card?.path === ''
    const top = !root && typeof card?.path === 'string' && !card.path.includes('/')
    if (!root && !top && !includeChildren) continue
    const at = card?.home
    if (!at || ![at.x, at.y, at.z].every(Number.isFinite)) continue
    const size = card.view ? cardSize(card.view, card.rootName) : null
    out.push({
      x: orbit ? RING_CENTER.x : at.x,
      y: at.y,
      z: orbit ? RING_CENTER.z : at.z,
      r: size ? Math.hypot(size.width, size.height) / 2 : 0,
      rx: size ? size.width / 2 : 0,
      ry: size ? size.height / 2 : 0,
      ...(orbit && { orbitRadius: (root ? 0 : ringOf(at).radius) + FOLDER_DRIFT_RADIUS }),
    })
  }
  return out
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function paintTarget(node, value) {
  if (value) node.style.setProperty('--mr-target', value)
  else node.style.removeProperty('--mr-target')
}

function occluderGeometry(view, rootName = 'root', heightOverride = null) {
  const parts = occluderParts(view, rootName, heightOverride)
  const positions = new Float32Array(parts.length * 18)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const left = part.x - part.width / 2
    const right = part.x + part.width / 2
    const bottom = part.y - part.height / 2
    const top = part.y + part.height / 2
    positions.set([left, bottom, 0, right, bottom, 0, right, top, 0, left, bottom, 0, right, top, 0, left, top, 0], index * 18)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

export function createCards(cssScene, options = {}) {
  const { glScene = null, rootName = 'root', onInspect = () => {}, onOpenChange, alwaysDepth = 2 } = options
  const cards = new Map()
  const hider = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const homes = new Map()
  const pinned = new Set()
  const sprayed = new Set()
  let selected = null
  const flashes = new Map()
  const touchLife = new Map()
  const heldCards = new Set()
  const heldRows = new Map()
  const rowDirty = new Set()
  let rowDirtyAll = true
  const initialDepth = Number(alwaysDepth)
  let alwaysLevel = Number.isFinite(initialDepth) ? Math.min(3, Math.max(0, Math.floor(initialDepth))) : 2
  let maxFilesLevel = clampFileLimit(options.maxFiles)
  let spacing = clampFolderSpacing(options.folderSpacing)
  let folderContentsEnabled = typeof options.folderContents === 'boolean' ? options.folderContents : true
  let openOnTouchEnabled = typeof options.openOnTouch === 'boolean' ? options.openOnTouch : true
  const right = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const back = new THREE.Vector3(0, 0, 1)
  const rootHome = new THREE.Vector3(ROOT_PLACE.x, ROOT_PLACE.y, ROOT_PLACE.z)
  const projection = new THREE.Vector3()
  let planKey = ''
  let layoutKey = ''
  let overviewLayoutKey = ''
  let pendingChange = false
  let keepLevels = false
  let active = { files: new Set(), dirs: new Set(), path: new Set() }
  let targetDirColors = null
  let targetFileColors = null
  let lastTargetVersion = -1
  let inspected = null
  let rowRevision = 0
  let lastRowRevision = -1
  let movingNow = false
  let lastState = null
  let linksCache = null
  let stampSeq = 0
  let basisVersion = 0
  const counters = { anchors: 0, offsets: 0, widths: 0 }
  const previousRight = new THREE.Vector3(1, 0, 0)
  const previousUp = new THREE.Vector3(0, 1, 0)
  const previousBack = new THREE.Vector3(0, 0, 1)

  let lastExistingFiles = -1
  let lastLatest = -1
  let lastPinnedVersion = 0
  let pinnedVersion = 1
  let lastSprayVersion = 0
  let sprayVersion = 1
  let lastAgentFocus = []
  let lastAgentOpen = []
  let danceOrderKeys = []
  let danceNextPath = ''
  let swayTarget = 0
  let swayLevel = 0

  function hasActiveCall(agent) {
    return agent?.status === 'working' && (agent?.openCalls?.size ?? 0) > 0
  }

  function focusChanged(state) {
    if (state.agents.size !== lastAgentFocus.length) return true
    let i = 0
    for (const agent of state.agents.values()) {
      if (agent.focus !== lastAgentFocus[i] || hasActiveCall(agent) !== lastAgentOpen[i]) return true
      i += 1
    }
    return false
  }

  function saveAgentFocus(state) {
    lastAgentFocus = []
    lastAgentOpen = []
    for (const agent of state.agents.values()) {
      lastAgentFocus.push(agent.focus)
      lastAgentOpen.push(hasActiveCall(agent))
    }
  }

  function togglePop(path) {
    if (sprayed.has(path)) sprayed.delete(path)
    else sprayed.add(path)
    sprayVersion += 1
    planKey = ''
  }

  function nearestCard(path, includeLeaving = false) {
    let at = path
    while (at !== '' && (!cards.has(at) || (!includeLeaving && cards.get(at).leaving))) at = dirname(at)
    return cards.get(at) ?? null
  }

  function markRowPath(path) {
    const card = nearestCard(dirname(path))
    if (card) rowDirty.add(card.path)
    const leaving = nearestCard(dirname(path), true)
    if (leaving?.leaving) rowDirty.add(leaving.path)
  }

  function markRows() {
    rowDirtyAll = true
  }

  function targetColour(kind, path) {
    const map = kind === 'dir' ? targetDirColors : targetFileColors
    return map?.get(path) ?? null
  }

  function makeCard(path) {
    linksCache = null
    const width = cardBaseWidth(path, rootName)
    counters.widths += 1
    const title = cardTitle(path, rootName)
    const element = el('div', 'mr-card is-closed')
    element.dataset.path = path
    element.style.width = `${width}px`
    element.title = title
    const backs = el('div', 'mr-card-backs')
    const head = el('div', 'mr-card-head')
    const tab = el('div', 'mr-card-tab')
    const name = el('div', 'mr-card-name', cardName(path, rootName))
    name.title = title
    const meta = el('div', 'mr-card-meta')
    head.append(tab, name, meta)
    const items = el('div', 'mr-card-items')
    items.addEventListener(
      'wheel',
      (event) => {
        if (items.scrollHeight > items.clientHeight) event.stopPropagation()
      },
      { passive: true },
    )
    items.addEventListener(
      'scroll',
      () => {
        const card = cards.get(path)
        if (card?.virtual) paintWindow(card, lastState)
      },
      { passive: true },
    )
    const band = el('div', 'mr-card-band')
    const face = el('div', 'mr-card-face')
    face.append(head, items, band)
    element.append(backs, face)
    for (const corner of BRACKETS) element.append(el('div', `mr-card-bracket is-${corner}`))
    const object = new CSS3DObject(element)
    const parent = path === '' ? null : nearestCard(dirname(path))
    object.position.copy(parent ? parent.object.position : rootHome)
    const scale = parent ? parent.scale * 0.5 : CARD_SCALES.closed
    object.scale.setScalar(scale)
    cssScene.add(object)
    const occluder = new THREE.Mesh(new THREE.BufferGeometry(), hider)
    occluder.renderOrder = -1
    glScene?.add(occluder)
    occluder.position.copy(object.position)
    const base = object.position.clone()
    const card = {
      path,
      element,
      backs,
      name,
      meta,
      items,
      band,
      object,
      occluder,
      base,
      home: base.clone(),
      glide: parent ? parent.glide.clone() : base.clone(),
      drift: folderDrift(path),
      danceFrom: 0,
      danceTo: 0,
      danceAt: 0,
      lastLift: 0,
      lastSwayScale: 1,
      scale,
      rootName,
      rows: [],
      rowPaths: null,
      rowIndex: null,
      rowItems: null,
      rowHidden: -1,
      wanted: [],
      drawn: new Map(),
      virtual: false,
      window: null,
      rowHeight: 0,
      limitRows: 0,
      hiddenRows: 0,
      view: null,
      backCount: -1,
      occluderKey: '',
      baseClass: 'mr-card is-closed',
      className: 'mr-card is-closed',
      classBuilds: 0,
      targetColor: null,
      bandText: '',
      bandFailed: false,
      height: 0,
      lastHeight: -1,
      openLevel: folderContentsEnabled ? 1 : 0,
      soundGoal: undefined,
      touchOpen: false,
      pulse: false,
      itemsClass: 'mr-card-items',
      opacity: 1,
      lastOpacity: 1,
      dimLevel: 0,
      lastDimLevel: -1,
      fade: null,
      listOpacity: 1,
      lastListOpacity: 1,
      listFade: null,
      leaving: false,
      fresh: true,
      ghosts: [],
      stamp: ++stampSeq,
      anchorWidth: width + CARD_FACE_BORDER,
      anchorHeight: -1,
      anchorScale: -1,
      anchorOffset: { x: 0, y: 0 },
      tab: new THREE.Vector3(),
      tabStamp: -1,
      tabBasis: -1,
    }
    cards.set(path, card)
    return card
  }

  function removeCard(card) {
    linksCache = null
    stampSeq += 1
    cssScene.remove(card.object)
    glScene?.remove(card.occluder)
    card.occluder.geometry.dispose()
    card.element.remove()
    homes.delete(card.path)
    cards.delete(card.path)
  }

  function paintOccluder(card, view, heightOverride = card.height) {
    card.occluder.geometry.dispose()
    card.occluder.geometry = occluderGeometry(view, card.rootName, heightOverride)
    card.occluderKey = `${card.height}|${backLayers(view.back)}`
  }

  function paintBacks(card, count) {
    const layers = backLayers(count)
    if (card.backCount === layers) return
    card.backCount = layers
    card.backs.replaceChildren(
      ...backPlaces(layers).map((offset, index) => {
        const back = el('div', `mr-card-back is-back-${index + 1}`)
        back.style.transform = `translate3d(${offset.x}px, ${offset.y}px, ${-BACK_DEPTH * (index + 1)}px)`
        return back
      }),
    )
  }

  function rowLook(state, path, kind) {
    const file = kind === 'file' && state ? state.files.get(path) : null
    let mark = ''
    let short = ''
    if (file) {
      if (file.failed) mark = 'failed'
      else if (file.yellow) mark = 'finished'
      else if (file.writes > 0) mark = 'written'
      else if (file.reads > 0) mark = 'read'
      const shortParts = []
      if (file.reads) shortParts.push(`r ${file.reads}`)
      if (file.writes) shortParts.push(`w ${file.writes}`)
      if (file.failed) shortParts.push('failed')
      else if (file.yellow) shortParts.push('finished')
      short = shortParts.join(' · ')
    }
    const hit = flashes.get(path)
    const tone = hit ? hit.tone : null
    let rowClass = `mr-item is-${kind}`
    if (mark) rowClass += ` is-${mark}`
    const isActive = active.files.has(path) || active.dirs.has(path)
    if (isActive) rowClass += ' is-active'
    if (tone) rowClass += ` is-flash-${tone}`
    if (inspected === path) rowClass += ' is-inspected'
    const target = isActive && !file?.failed ? targetColour(kind, path) : null
    return { file, mark, short, rowClass, target }
  }

  function makeRow(item, state) {
    const look = rowLook(state, item.path, item.kind)
    const row = el('div', look.rowClass)
    const heldAlpha = item.kind === 'file' ? heldRows.get(item.path) : undefined
    const rowOpacity = heldAlpha !== undefined ? String(heldAlpha) : ''
    if (rowOpacity !== '') row.style.opacity = rowOpacity
    if (look.target) paintTarget(row, look.target)
    const label = el('span', 'mr-item-name', visibleText(item.kind === 'dir' ? `${basename(item.path)}/` : basename(item.path)))
    const note = el('span', 'mr-item-note', look.short)
    row.append(label, note)
    row.addEventListener('click', (event) => {
      event.stopPropagation()
      if (item.kind === 'dir') {
        pinned.add(item.path)
        pinnedVersion += 1
        planKey = ''
        if (lastState && recompute(lastState)) pendingChange = true
        selected = item.path
        inspected = null
        onInspect(item.path)
      } else {
        onInspect(item.path)
        inspected = item.path
      }
      rowRevision += 1
    })
    return {
      row,
      note,
      item,
      file: look.file,
      baseClass: `mr-item is-${item.kind}`,
      rowClass: look.rowClass,
      noteText: look.short,
      lastReads: look.file ? look.file.reads : -1,
      lastWrites: look.file ? look.file.writes : -1,
      lastFailed: look.file ? look.file.failed : null,
      lastYellow: look.file ? look.file.yellow : null,
      mark: look.mark,
      short: look.short,
      targetColor: look.target,
      lastOpacity: rowOpacity,
    }
  }

  function rowHeightOf(card) {
    if (card.rowHeight > 0) return card.rowHeight
    const sample = card.rows[0]?.row
    const measured = Number(sample?.offsetHeight)
    card.rowHeight = measured > 0 ? measured : ROW_H
    return card.rowHeight
  }

  function paintWindow(card, state, force = false) {
    const total = card.wanted.length
    if (total === 0) return false
    const height = rowHeightOf(card)
    const viewport = Math.min(total, card.limitRows > 0 ? card.limitRows : total) * height
    const scrollTop = Number(card.items.scrollTop) || 0
    const next = rowWindow(total, scrollTop, viewport, { rowHeight: height })
    if (!force && card.window && card.window.first === next.first && card.window.last === next.last) return false
    card.window = next
    const rows = []
    for (let index = next.first; index < next.last; index += 1) {
      const item = card.wanted[index]
      if (!item) break
      rows.push(makeRow(item, state))
    }
    card.rows = rows
    card.drawn = new Map(rows.map((entry) => [entry.item.path, entry]))
    if (!card.gapTop) card.gapTop = el('div', 'mr-card-gap')
    if (!card.gapBottom) card.gapBottom = el('div', 'mr-card-gap')
    const top = `${next.top}px`
    const bottom = `${next.bottom}px`
    if (card.gapTop.style.height !== top) card.gapTop.style.height = top
    if (card.gapBottom.style.height !== bottom) card.gapBottom.style.height = bottom
    const more = card.hiddenRows > 0 ? [el('div', 'mr-card-more', `+ ${card.hiddenRows} more`)] : []
    card.items.replaceChildren(card.gapTop, ...rows.map((entry) => entry.row), card.gapBottom, ...more)
    const kept = Math.min(scrollTop, Math.max(0, total * height - viewport))
    if ((Number(card.items.scrollTop) || 0) !== kept) card.items.scrollTop = kept
    rowRevision += 1
    return true
  }

  function rowIndexOf(card) {
    if (!card.rowIndex) {
      card.rowPaths = card.wanted.map((item) => item.path)
      card.rowIndex = new Map(card.rowPaths.map((path, index) => [path, index]))
    }
    return card.rowIndex
  }

  function paintRows(card, view) {
    const wanted = view.state === 'files' ? view.items : []
    const limit = clampFileLimit(view.maxFiles ?? maxFilesLevel)
    card.items.style.maxHeight = `${limit * ROW_H}px`
    const itemsClass = wanted.length > limit ? 'mr-card-items is-scrollable' : 'mr-card-items'
    if (card.itemsClass !== itemsClass) {
      card.itemsClass = itemsClass
      card.items.className = itemsClass
    }
    const hidden = view.state === 'files' ? view.hiddenItems : 0
    const limitChanged = card.limitRows !== limit
    card.limitRows = limit
    if (card.rowItems === wanted && card.rowHidden === hidden) {
      if (card.virtual && limitChanged) paintWindow(card, lastState, true)
      return
    }
    card.rowItems = wanted
    card.rowHidden = hidden
    card.rowPaths = null
    card.rowIndex = null
    card.wanted = wanted
    card.hiddenRows = hidden
    card.window = null
    card.virtual = wanted.length > VIRTUAL_MIN_ROWS
    if (card.virtual) {
      paintWindow(card, lastState, true)
    } else {
      card.rows = wanted.map((item) => makeRow(item, lastState))
      card.drawn = new Map(card.rows.map((entry) => [entry.item.path, entry]))
      const more = hidden > 0 ? [el('div', 'mr-card-more', `+ ${hidden} more`)] : []
      card.items.replaceChildren(...card.rows.map((entry) => entry.row), ...more)
      rowRevision += 1
    }
  }

  function clearRows(card) {
    if (card.rowItems !== null || card.rows.length > 0 || (card.items.children?.length ?? 0) > 0) {
      card.rowItems = null
      card.rowHidden = -1
      card.rowPaths = null
      card.rowIndex = null
      card.wanted = []
      card.hiddenRows = 0
      card.window = null
      card.virtual = false
      card.rows = []
      card.drawn = new Map()
      card.items.replaceChildren()
      rowRevision += 1
    }
    card.items.hidden = true
    if (card.items.style.maxHeight !== '0px') card.items.style.maxHeight = '0px'
    if (card.itemsClass !== 'mr-card-items') {
      card.itemsClass = 'mr-card-items'
      card.items.className = 'mr-card-items'
    }
  }

  function syncCardContents(card) {
    const view = card.view
    if (!view) return
    const fullRows = cardRows(view)
    const eased = card.openLevel <= 0 ? 0 : card.openLevel >= 1 ? 1 : easeInOut(card.openLevel)
    const nextHeight = cardHeight(fullRows * eased)
    if (nextHeight !== card.height) {
      card.height = nextHeight
      card.stamp = ++stampSeq
    }
    const nextOccluderKey = `${card.height}|${backLayers(view.back)}`
    if (card.occluderKey !== nextOccluderKey) paintOccluder(card, view, card.height)
    if (eased <= 0) {
      clearRows(card)
      return
    }
    card.items.hidden = false
    paintRows(card, view)
    const limit = clampFileLimit(view.maxFiles ?? maxFilesLevel)
    if (eased < 1) {
      const maxPx = Math.min(limit, fullRows) * ROW_H * eased
      card.items.style.maxHeight = `${maxPx.toFixed(1)}px`
      if (card.itemsClass !== 'mr-card-items is-opening') {
        card.itemsClass = 'mr-card-items is-opening'
        card.items.className = 'mr-card-items is-opening'
      }
    } else {
      card.items.style.maxHeight = `${limit * ROW_H}px`
      const itemsClass = card.wanted.length > limit ? 'mr-card-items is-scrollable' : 'mr-card-items'
      if (card.itemsClass !== itemsClass) {
        card.itemsClass = itemsClass
        card.items.className = itemsClass
      }
    }
  }

  function resetRow(entry) {
    entry.file = null
    entry.lastReads = -1
    entry.lastWrites = -1
    entry.lastFailed = null
    entry.lastYellow = null
    entry.mark = ''
    entry.short = ''
    entry.noteText = null
    entry.rowClass = null
    entry.lastOpacity = null
  }

  function metaText(view) {
    return cardMetaText(view)
  }

  function isPinnedView(view) {
    return view.pinned === true || pinned.has(view.path)
  }

  function paintCardOpacity(card) {
    const level = card.opacity * (1 - (1 - DIM_OPACITY) * card.dimLevel)
    const text = level >= 1 ? '' : String(level)
    if (card.lastOpacity !== text) {
      card.lastOpacity = text
      card.element.style.opacity = text
    }
  }

  function setCardOpacity(card, level) {
    card.opacity = level
    paintCardOpacity(card)
  }

  function startListGhost(card) {
    if (card.items.childNodes.length === 0) return
    const ghost = card.items.cloneNode(true)
    ghost.style.position = 'absolute'
    ghost.style.left = '0'
    ghost.style.right = '0'
    ghost.style.top = `${HEAD_H}px`
    ghost.style.pointerEvents = 'none'
    ghost.style.zIndex = '2'
    ghost.style.opacity = '1'
    card.element.appendChild(ghost)
    card.ghosts.push({ element: ghost, start: performance.now() })
  }

  function setListOpacity(card, level) {
    card.listOpacity = level
    const text = level === 1 ? '' : String(level)
    if (card.lastListOpacity !== text) {
      card.lastListOpacity = text
      card.items.style.opacity = text
    }
  }

  function sameSet(a, b) {
    if (a.size !== b.size) return false
    for (const item of a) if (!b.has(item)) return false
    return true
  }

  function computeActive(state) {
    const files = new Set()
    const dirs = new Set()
    for (const agent of state.agents.values()) {
      if (!hasActiveCall(agent)) continue
      for (const path of agent.focus ?? []) {
        if (state.files.has(path)) {
          files.add(path)
          dirs.add(dirname(path))
        } else {
          dirs.add(path)
        }
      }
    }
    const chain = openChain(state)
    const changed = !sameSet(active.dirs, dirs) || !sameSet(active.files, files)
    active = { files, dirs, path: chain }
    return changed
  }

  function armTouchPulses(touchedCards) {
    for (const card of cards.values()) {
      const nowOpen = touchOpenGoal(card, touchedCards)
      if (nowOpen && !card.touchOpen && card.path !== '') {
        let at = dirname(card.path)
        for (;;) {
          const parent = nearestCard(at)
          if (!parent) break
          parent.pulse = true
          if (parent.path === '') break
          at = dirname(parent.path)
        }
      }
      card.touchOpen = nowOpen
    }
  }

  function touchOpenGoal(card, touchedCards) {
    if (folderContentsEnabled || !openOnTouchEnabled) return false
    return active.dirs.has(card.path) || Boolean(touchedCards?.has(card.path))
  }

  function recompute(state) {
    lastState = state
    const unchanged =
      planKey !== '' &&
      pinnedVersion === lastPinnedVersion &&
      sprayVersion === lastSprayVersion &&
      state.existingFiles === lastExistingFiles &&
      state.latest === lastLatest &&
      !focusChanged(state)
    if (unchanged) return false

    lastPinnedVersion = pinnedVersion
    lastSprayVersion = sprayVersion
    lastExistingFiles = state.existingFiles
    lastLatest = state.latest
    saveAgentFocus(state)

    const planKeyNext = viewKey(state, [...pinned, ...sprayed])
    if (planKeyNext === planKey) {
      if (computeActive(state)) rowRevision += 1
      return false
    }
    planKey = planKeyNext
    const layout = cardPlan(state, { pinned: [...pinned], alwaysDepth: alwaysLevel, maxFiles: maxFilesLevel, spacing, previous: homes, sprayed, rootName })
    const drawn = layout.drawn
    computeActive(state)
    const now = performance.now()
    const isStill = still()
    for (const card of [...cards.values()]) {
      if (drawn.has(card.path) || card.leaving) continue
      if (!isStill && !(card.view && isPinnedView(card.view))) {
        card.leaving = true
        card.stamp = ++stampSeq
        linksCache = null
        card.fade = { from: card.opacity, to: 0, start: now }
      } else {
        removeCard(card)
      }
    }
    for (const view of drawn.values()) {
      const card = cards.get(view.path) ?? makeCard(view.path)
      const before = card.view
      const pinnedView = isPinnedView(view)
      if (card.leaving) {
        card.leaving = false
        card.stamp = ++stampSeq
        linksCache = null
        if (heldCards.has(card.path)) {
          card.fade = null
          setCardOpacity(card, 0)
        } else if (!isStill && !pinnedView) {
          card.fade = { from: card.opacity, to: 1, start: now }
        } else {
          card.fade = null
          setCardOpacity(card, 1)
        }
      }
      if (card.fresh) {
        card.fresh = false
        if (heldCards.has(card.path)) {
          setCardOpacity(card, 0)
          card.fade = null
        } else if (!isStill && !pinnedView) {
          setCardOpacity(card, 0)
          card.fade = { from: 0, to: 1, start: now }
        } else {
          setCardOpacity(card, 1)
        }
      }
      if (before?.state === 'files' && view.state !== 'files') {
        if (!isStill && !pinnedView) startListGhost(card)
        card.listFade = null
        setListOpacity(card, 1)
      } else if (before?.state !== 'files' && view.state === 'files') {
        if (!isStill && !pinnedView) {
          setListOpacity(card, 0)
          card.listFade = { from: 0, to: 1, start: now }
        } else {
          card.listFade = null
          setListOpacity(card, 1)
        }
      }
      card.view = view
      card.baseClass = `mr-card is-${view.state}`
      paintBacks(card, view.back)
      syncCardContents(card)
      card.meta.textContent = metaText(view)
    }
    const entries = layout.entries
    const layoutChanged = layout.layoutKey !== layoutKey
    if (layoutChanged) {
      layoutKey = layout.layoutKey
      const sizes = new Map(entries.map((entry) => [entry.path, entry]))
      const spots = []
      for (const [path, spot] of layout.placed) {
        const size = sizes.get(path)
        homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height, slot: spot.slot })
        const card = cards.get(path)
        if (card) card.home.set(spot.x, spot.y, spot.z)
        const ring = ringOf(spot)
        spots.push({ path, angle: ring.angle, radius: ring.radius })
      }
      danceOrderKeys = danceOrder(spots)
    }
    const nextOverviewKey = entries
      .filter((entry) => entry.path === '' || !entry.path.includes('/'))
      .map((entry) => `${entry.path}:${entry.width}:${entry.height}`)
      .join(';')
    const overviewChanged = nextOverviewKey !== overviewLayoutKey
    overviewLayoutKey = nextOverviewKey
    rowRevision += 1
    return layoutChanged || overviewChanged
  }

  function center(path) {
    return (nearestCard(path) ?? cards.get(''))?.base ?? rootHome
  }

  function anchorOffsetOf(card) {
    const faceHeight = (card.height || cardHeight(card.view ? cardRows(card.view) : 0)) + CARD_FACE_BORDER
    const scale = card.object.scale.x
    if (card.anchorHeight !== faceHeight || card.anchorScale !== scale) {
      card.anchorHeight = faceHeight
      card.anchorScale = scale
      const offset = tabAnchorOffset(card.anchorWidth, faceHeight, scale)
      card.anchorOffset.x = offset.x
      card.anchorOffset.y = offset.y
      counters.offsets += 1
    }
    return card.anchorOffset
  }

  function stamp() {
    return `${stampSeq}:${basisVersion}`
  }

  function anchor(path = '', out = new THREE.Vector3(), includeLeaving = false) {
    const card = nearestCard(path ?? '', includeLeaving)
    if (!card) return null
    if (card.tabStamp !== card.stamp || card.tabBasis !== basisVersion) {
      const offset = anchorOffsetOf(card)
      card.tab.copy(card.object.position)
      card.tab.addScaledVector(right, offset.x)
      card.tab.addScaledVector(up, offset.y)
      card.tabStamp = card.stamp
      card.tabBasis = basisVersion
      counters.anchors += 1
    }
    out.copy(card.tab)
    out.anchorStamp = card.stamp
    out.anchorBasis = basisVersion
    return out
  }
  anchor.stamp = stamp

  function halfWidth(dir) {
    const card = nearestCard(dir)
    return ((card?.scale ?? CARD_SCALES.closed) * CARD_W) / 2
  }

  function bottom(dir) {
    const card = nearestCard(dir)
    if (!card) return rootHome.y
    return card.base.y - (card.height * card.scale) / 2
  }

  function sideOf(dir) {
    const card = nearestCard(dir)
    return card?.base.x < 0 ? 1 : -1
  }

  function slotPosition(dir, file, out) {
    const card = cards.get(dir)
    out.copy(center(dir))
    const index = card ? rowIndexOf(card).get(file) ?? -1 : -1
    if (index === -1) return out
    if (card.openLevel <= 0) return out
    if (card.virtual && !card.drawn.has(file)) return out
    const rows = cardRows(card.view)
    if (!(rows > 0)) return out
    const scroll = card.virtual ? Math.max(0, Number(card.items.scrollTop) || 0) : 0
    const steps = Math.floor(scroll / ROW_H)
    const rest = scroll - steps * ROW_H
    const slot = index - steps
    let offset = rowOffset(rows, Math.min(rows - 1, Math.max(0, slot)))
    if (slot >= 0 && slot < rows) offset -= rest
    out.addScaledVector(up, offset * card.scale)
    return out
  }

  const rowScratch = []

  function holdCard(path) {
    if (typeof path === 'string') heldCards.add(path)
  }

  function revealCard(path, level = 1) {
    if (typeof path !== 'string') return
    const alpha = Math.min(1, Math.max(0, Number(level) || 0))
    if (alpha >= 1) heldCards.delete(path)
    else heldCards.add(path)
    const card = cards.get(path)
    if (card) {
      card.fade = null
      setCardOpacity(card, alpha)
    }
  }

  function holdRow(filePath) {
    if (typeof filePath !== 'string') return
    heldRows.set(filePath, 0)
    markRowPath(filePath)
  }

  function revealRow(filePath, level = 1) {
    if (typeof filePath !== 'string') return
    const alpha = Math.min(1, Math.max(0, Number(level) || 0))
    if (alpha >= 1) heldRows.delete(filePath)
    else heldRows.set(filePath, alpha)
    markRowPath(filePath)
    const card = nearestCard(dirname(filePath))
    const entry = card?.drawn?.get(filePath)
    if (entry) {
      const text = alpha >= 1 ? '' : String(alpha)
      if (entry.lastOpacity !== text) {
        entry.lastOpacity = text
        entry.row.style.opacity = text
      }
    }
  }

  function writeOutlinePoint(out, index, cx, cy, cz, lx, ly) {
    const point = out[index] ?? (out[index] = { x: 0, y: 0, z: 0 })
    point.x = cx + right.x * lx + up.x * ly
    point.y = cy + right.y * lx + up.y * ly
    point.z = cz + right.z * lx + up.z * ly
  }

  function faceOutline(dir, out = []) {
    const card = cards.get(dir)
    if (!card || card.leaving) return null
    const scale = card.object.scale.x || card.scale || 1
    const baseHeight = (card.height || cardHeight(card.view ? cardRows(card.view) : 0)) + CARD_FACE_BORDER
    const halfW = (card.anchorWidth * scale) / 2
    const halfH = (baseHeight * scale) / 2
    const tab = tabAnchorOffset(card.anchorWidth, baseHeight, scale)
    const cx = card.object.position.x + back.x * 2
    const cy = card.object.position.y + back.y * 2
    const cz = card.object.position.z + back.z * 2
    writeOutlinePoint(out, 0, cx, cy, cz, tab.x, tab.y)
    writeOutlinePoint(out, 1, cx, cy, cz, tab.x, halfH)
    writeOutlinePoint(out, 2, cx, cy, cz, halfW, halfH)
    writeOutlinePoint(out, 3, cx, cy, cz, halfW, -halfH)
    writeOutlinePoint(out, 4, cx, cy, cz, -halfW, -halfH)
    writeOutlinePoint(out, 5, cx, cy, cz, -halfW, halfH)
    writeOutlinePoint(out, 6, cx, cy, cz, tab.x, halfH)
    writeOutlinePoint(out, 7, cx, cy, cz, tab.x, tab.y)
    out.length = 8
    return out
  }

  function rowOutline(dir, file, out = []) {
    const card = cards.get(dir)
    if (!card || card.leaving) return null
    const index = rowIndexOf(card).get(file) ?? -1
    if (index === -1 || card.openLevel <= 0) return null
    if (card.virtual && !card.drawn.has(file)) return null
    const rows = cardRows(card.view)
    if (!(rows > 0)) return null
    const scroll = card.virtual ? Math.max(0, Number(card.items.scrollTop) || 0) : 0
    const steps = Math.floor(scroll / ROW_H)
    const rest = scroll - steps * ROW_H
    const slot = index - steps
    if (card.virtual && (slot < 0 || slot >= rows)) return null
    const scale = card.object.scale.x || card.scale || 1
    const cardH = card.height || cardHeight(rows)
    const clamped = Math.min(rows - 1, Math.max(0, slot))
    const offset = cardH / 2 - (HEAD_H + (clamped + 0.5) * ROW_H) - (slot >= 0 && slot < rows ? rest : 0)
    const halfW = ((card.anchorWidth - CARD_FACE_BORDER - CARD_PAD * 2) * scale) / 2
    const halfH = (ROW_H * scale) / 2
    const cx = card.object.position.x + up.x * (offset * scale) + back.x * 2
    const cy = card.object.position.y + up.y * (offset * scale) + back.y * 2
    const cz = card.object.position.z + up.z * (offset * scale) + back.z * 2
    writeOutlinePoint(out, 0, cx, cy, cz, -halfW, halfH)
    writeOutlinePoint(out, 1, cx, cy, cz, halfW, halfH)
    writeOutlinePoint(out, 2, cx, cy, cz, halfW, -halfH)
    writeOutlinePoint(out, 3, cx, cy, cz, -halfW, -halfH)
    writeOutlinePoint(out, 4, cx, cy, cz, -halfW, halfH)
    out.length = 5
    return out
  }

  function rowStart(dir, file, out = new THREE.Vector3()) {
    const points = rowOutline(dir, file, rowScratch)
    if (!points || points.length === 0) return null
    out.set(points[0].x, points[0].y, points[0].z)
    return out
  }

  function edgePoint(dir, file, side, out) {
    const card = cards.get(dir)
    if (card?.virtual && !card.drawn.has(file)) {
      out.copy(center(dir))
      return out.addScaledVector(right, side * halfWidth(dir))
    }
    slotPosition(dir, file, out)
    return out.addScaledVector(right, side * halfWidth(dir))
  }

  function flash(path, tone, text = '') {
    const duration = tone === 'red' ? FAIL_MS : FLASH_MS
    flashes.set(path, { tone, text, life: duration / 1000 })
    markRowPath(path)
  }

  function setSway(level) {
    const value = Number(level)
    swayTarget = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    return swayTarget
  }

  function beat(strength) {
    if (still()) return false
    const value = Math.min(1, Math.max(0, Number(strength) || 0))
    if (!(value > 0)) return false
    const order = danceOrderKeys.length > 0 ? danceOrderKeys : [...cards.keys()]
    let path = nextDanceCard(order, danceNextPath)
    let card = cards.get(path)
    let step = 0
    while ((!card || card.leaving) && step < order.length) {
      path = nextDanceCard(order, path)
      card = cards.get(path)
      step += 1
    }
    if (!card || card.leaving) return false
    danceNextPath = path
    const now = performance.now()
    const next = startDanceEnvelope({ from: card.danceFrom, to: card.danceTo, at: card.danceAt }, value, now)
    card.danceFrom = next.from
    card.danceTo = next.to
    card.danceAt = next.at
    return true
  }

  function recordTouch(dir, duration = FLASH_MS) {
    if (typeof dir !== 'string') return
    const ms = Number.isFinite(duration) ? duration : FLASH_MS
    const life = Math.max(CONTENT_ANIM_SEC, ms / 1000)
    const prev = touchLife.get(dir) ?? 0
    if (life > prev) touchLife.set(dir, life)
  }

  function touchedCardPaths() {
    if (!openOnTouchEnabled || touchLife.size === 0) return null
    const paths = new Set()
    for (const dir of touchLife.keys()) {
      const card = nearestCard(dir)
      if (card) paths.add(card.path)
    }
    return paths
  }

  function isCardOpen(card, touchedCards) {
    if (folderContentsEnabled) return true
    if (cardRows(card.view) <= 0) return false
    if (card.pulse) return true
    if (selected !== null && selected === card.path) return true
    if (inspected !== null && dirname(inspected) === card.path) return true
    return openOnTouchEnabled && (active.dirs.has(card.path) || Boolean(touchedCards?.has(card.path)))
  }

  function chainHeld(card, openGoal, touchedCards) {
    if (card.path === '') return false
    const parent = nearestCard(dirname(card.path))
    if (!parent || parent === card) return false
    const parentGoal = isCardOpen(parent, touchedCards) ? 1 : 0
    if (parentGoal !== openGoal) return false
    if (openGoal === 1) return parent.openLevel < CHAIN_GATE
    return parent.openLevel > 1 - CHAIN_GATE
  }

  function sync(state, { quiet = true } = {}) {
    flashes.clear()
    touchLife.clear()
    for (const path of [...heldCards]) revealCard(path, 1)
    for (const path of [...heldRows.keys()]) revealRow(path, 1)
    for (const card of cards.values()) {
      card.pulse = false
      card.touchOpen = false
      if (quiet) card.soundGoal = undefined
    }
    pinnedVersion += 1
    sprayed.clear()
    sprayVersion += 1
    planKey = ''
    pendingChange = false
    recompute(state)
    if (keepLevels) keepLevels = false
    else {
      for (const card of cards.values()) {
        const target = isCardOpen(card, null) ? 1 : 0
        if (card.openLevel !== target) {
          card.openLevel = target
          syncCardContents(card)
        }
      }
    }
    for (const card of cards.values()) {
      for (const entry of card.rows) resetRow(entry)
    }
    rowRevision += 1
  }

  function setOptions(options = {}) {
    let changed = false
    let contentsChanged = false
    if (Object.hasOwn(options, 'alwaysDepth')) {
      const raw = Number(options.alwaysDepth)
      if (Number.isFinite(raw)) {
        const value = Math.min(3, Math.max(0, Math.floor(raw)))
        if (value !== alwaysLevel) {
          alwaysLevel = value
          changed = true
        }
      }
    }
    if (Object.hasOwn(options, 'maxFiles')) {
      const value = clampFileLimit(options.maxFiles)
      if (value !== maxFilesLevel) {
        maxFilesLevel = value
        changed = true
      }
    }
    if (Object.hasOwn(options, 'folderSpacing')) {
      const value = clampFolderSpacing(options.folderSpacing)
      if (value !== spacing) {
        spacing = value
        changed = true
      }
    }
    if (Object.hasOwn(options, 'folderContents')) {
      const value = typeof options.folderContents === 'boolean' ? options.folderContents : true
      if (value !== folderContentsEnabled) {
        folderContentsEnabled = value
        changed = true
        contentsChanged = true
      }
    }
    if (Object.hasOwn(options, 'openOnTouch')) {
      const value = typeof options.openOnTouch === 'boolean' ? options.openOnTouch : true
      if (value !== openOnTouchEnabled) {
        openOnTouchEnabled = value
        changed = true
      }
    }
    if (!changed) return false
    if (contentsChanged) keepLevels = true
    pinnedVersion += 1
    planKey = ''
    layoutKey = ''
    return true
  }

  function visibleLinks() {
    if (linksCache) return linksCache
    const links = []
    for (const card of cards.values()) {
      if (card.path === '' || card.leaving) continue
      if (!card.path.includes('/')) {
        links.push({ from: '', to: card.path })
        continue
      }
      const parent = cards.get(dirname(card.path)) ?? nearestCard(dirname(card.path))
      if (parent) links.push({ from: parent.path, to: card.path })
    }
    linksCache = links
    return links
  }

  function overview(includeChildren = false) {
    return overviewSpheres(cards.values(), { orbit: !still(), includeChildren })
  }

  function cardSphere(path) {
    const card = cards.get(path)
    if (!card?.view) return null
    const { width, height } = cardSize(card.view, rootName)
    const { x, y, z } = card.base
    return { x, y, z, r: Math.hypot(width, height) / 2 }
  }

  function screenFrame(path, camera, viewWidth, viewHeight) {
    const card = cards.get(path)
    if (!card?.view || !(viewWidth > 0) || !(viewHeight > 0)) return null
    const halfWidth = (CARD_W * card.scale) / 2
    const halfHeight = (card.height * card.scale) / 2
    let left = Infinity
    let rightEdge = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        projection.copy(card.base).addScaledVector(right, sx * halfWidth).addScaledVector(up, sy * halfHeight).project(camera)
        if (![projection.x, projection.y].every(Number.isFinite)) return null
        const x = ((projection.x + 1) / 2) * viewWidth
        const y = ((1 - projection.y) / 2) * viewHeight
        left = Math.min(left, x)
        rightEdge = Math.max(rightEdge, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    return {
      x: (left + rightEdge) / 2,
      y: (top + bottom) / 2,
      width: rightEdge - left,
      height: bottom - top,
    }
  }

  function update(state, delta, camera, mask = null, speed = 1, wallSeconds) {
    lastState = state
    movingNow = false
    previousRight.copy(right)
    previousUp.copy(up)
    previousBack.copy(back)
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    back.set(0, 0, 1).applyQuaternion(camera.quaternion)
    if (!previousRight.equals(right) || !previousUp.equals(up) || !previousBack.equals(back)) basisVersion += 1
    targetDirColors = mask?.dirColors ?? null
    targetFileColors = mask?.fileColors ?? null
    const targetVersion = mask?.targetVersion ?? -1
    if (targetVersion !== lastTargetVersion) {
      lastTargetVersion = targetVersion
      rowDirtyAll = true
    }
    const hadPending = pendingChange
    pendingChange = false
    const changed = recompute(state)
    const now = performance.now()
    const isStill = still()
    if (isStill) {
      if (heldCards.size > 0) {
        for (const path of [...heldCards]) revealCard(path, 1)
      }
      if (heldRows.size > 0) {
        for (const path of [...heldRows.keys()]) revealRow(path, 1)
      }
    }
    const orbit = !isStill && Number.isFinite(wallSeconds)
    const rotation = orbit ? ringRotation(wallSeconds) : null
    swayLevel = isStill ? 0 : swayLevel + (swayTarget - swayLevel) * easeRate(delta, 1.5, false)
    const ease = easeRate(delta, 3, isStill)
    const dimmed = Boolean(mask?.dimmed)
    const dimLit = mask?.lit ?? null
    const targeted = mask?.targeted ?? null
    const dimStep = delta / (DIM_FADE_MS / 1000)
    const flashStep = delta * speedRate(speed)
    for (const [path, hit] of flashes) {
      hit.life -= flashStep
      if (hit.life <= 0) {
        flashes.delete(path)
        markRowPath(path)
      }
    }
    let touchedCards = touchedCardPaths()
    if (!isStill) armTouchPulses(touchedCards)
    const waitForWave = !isStill && !folderContentsEnabled && touchedCards
    const touchStep = delta > 0 ? delta : 0
    let touchExpired = false
    for (const [dir, life] of touchLife) {
      const card = waitForWave ? nearestCard(dir) : null
      if (card?.openLevel === 0 && isCardOpen(card, touchedCards) && chainHeld(card, 1, touchedCards)) continue
      const next = life - touchStep
      if (next <= 0) {
        touchLife.delete(dir)
        touchExpired = true
      } else touchLife.set(dir, next)
    }
    if (touchExpired && touchedCards) {
      touchedCards = touchedCardPaths()
      if (!isStill) armTouchPulses(touchedCards)
    }
    const hasFlashes = flashes.size > 0
    if (rowRevision !== lastRowRevision) {
      lastRowRevision = rowRevision
      rowDirtyAll = true
    }
    let removed = false
    for (const card of cards.values()) {
      if (card.fade) {
        const t = fadeProgress(card.fade.start, now, isStill)
        setCardOpacity(card, t >= 1 ? card.fade.to : card.fade.from + (card.fade.to - card.fade.from) * t)
        if (t >= 1) card.fade = null
      }
      if (card.listFade) {
        const t = fadeProgress(card.listFade.start, now, isStill)
        setListOpacity(card, t >= 1 ? card.listFade.to : card.listFade.from + (card.listFade.to - card.listFade.from) * t)
        if (t >= 1) card.listFade = null
      }
      if (card.ghosts.length > 0) {
        let keptGhosts = 0
        for (let index = 0; index < card.ghosts.length; index += 1) {
          const ghost = card.ghosts[index]
          const t = fadeProgress(ghost.start, now, isStill)
          ghost.element.style.opacity = String(1 - t)
          if (t < 1) {
            card.ghosts[keptGhosts] = ghost
            keptGhosts += 1
          } else {
            ghost.element.remove()
          }
        }
        card.ghosts.length = keptGhosts
      }
      if (card.leaving && !card.fade) {
        removeCard(card)
        removed = true
        continue
      }
      const position = card.object.position
      const base = card.base
      const glide = card.glide
      if (glide.distanceToSquared(card.home) > 0.25) glide.lerp(card.home, ease)
      else glide.copy(card.home)
      const next = orbit ? orbitPlace(glide, card.path === '' ? null : rotation, card.drift, wallSeconds) : glide
      const posChanged = !base.equals(next)
      if (posChanged) base.copy(next)
      const wave = 0.5 + 0.5 * Math.sin(now * SWAY_RATE + Math.atan2(card.home.z, card.home.x))
      const swayLift = isStill ? 0 : swayLevel * SWAY_LIFT * wave
      const danceLift = !isStill && card.danceAt > 0
        ? DANCE_LIFT * danceEnvelope(card.danceFrom, card.danceTo, now - card.danceAt)
        : 0
      const lift = danceLift + swayLift
      if (posChanged || lift !== card.lastLift) {
        card.lastLift = lift
        position.copy(base)
        position.y += lift
        card.occluder.position.copy(position)
        card.stamp = ++stampSeq
      }
      if (posChanged) movingNow = true
      const view = card.view
      const openGoal = isCardOpen(card, touchedCards) ? 1 : 0
      const previousOpen = card.openLevel
      if (card.openLevel !== openGoal) {
        if (isStill) {
          card.openLevel = openGoal
          syncCardContents(card)
        } else if (!chainHeld(card, openGoal, touchedCards)) {
          const step = delta > 0 ? delta / CONTENT_ANIM_SEC : 0
          if (card.openLevel < openGoal) card.openLevel = Math.min(openGoal, card.openLevel + step)
          else card.openLevel = Math.max(openGoal, card.openLevel - step)
          syncCardContents(card)
        }
      }
      if (onOpenChange) {
        if (card.leaving) card.soundGoal = undefined
        else if (card.soundGoal === undefined) card.soundGoal = openGoal
        else if (openGoal !== card.soundGoal && (card.openLevel !== previousOpen || card.openLevel === openGoal)) {
          card.soundGoal = openGoal
          if (card.openLevel !== previousOpen) onOpenChange(position, openGoal === 1)
        }
      }
      if (card.pulse && (card.openLevel >= 1 || cardRows(view) <= 0)) card.pulse = false
      const goal = CARD_SCALES[view.state] ?? 1
      const previousScale = card.scale
      if (Math.abs(card.scale - goal) > 0.002) {
        card.scale += (goal - card.scale) * ease
      } else {
        card.scale = goal
      }
      if (card.scale !== previousScale) card.stamp = ++stampSeq
      const swayScale = isStill ? 1 : 1 + swayLevel * SWAY_SCALE * wave
      if (card.lastSwayScale !== swayScale) card.stamp = ++stampSeq
      if (card.lastScale !== card.scale || card.lastHeight !== card.height || card.lastSwayScale !== swayScale) {
        card.lastScale = card.scale
        card.lastHeight = card.height
        card.lastSwayScale = swayScale
        card.object.scale.setScalar(card.scale * swayScale)
        card.occluder.scale.setScalar(card.scale * swayScale)
      }
      if (!card.object.quaternion.equals(camera.quaternion)) {
        card.object.quaternion.copy(camera.quaternion)
      }
      if (!card.occluder.quaternion.equals(camera.quaternion)) {
        card.occluder.quaternion.copy(camera.quaternion)
      }

      const flashing = hasFlashes ? flashes.get(card.path) : null
      const tone = flashing?.tone === 'red' ? 'red' : null
      let failedText = ''
      if (tone === 'red') {
        const failedName = visibleText(flashing.text || (card.path === '' ? rootName : basename(card.path)))
        failedText = `FAILED ${failedName}`
      }
      if (failedText) {
        if (card.bandText !== failedText) {
          card.bandText = failedText
          card.band.textContent = failedText
        }
        if (!card.bandFailed) {
          card.bandFailed = true
          card.band.classList.add('is-failed')
        }
      } else {
        if (card.bandText !== '') {
          card.bandText = ''
          card.band.textContent = ''
        }
        if (card.bandFailed) {
          card.bandFailed = false
          card.band.classList.remove('is-failed')
        }
      }

      const isActive = active.dirs.has(card.path)
      const isPath = !isActive && active.path.has(card.path)
      const isPinned = pinned.has(card.path) || sprayed.has(card.path)
      const selectedNow = selected !== null && selected === card.path
      const lit = dimmed && Boolean(dimLit?.has(card.path))
      const isTargeted = Boolean(targeted?.has(card.path))
      const dimFlag = dimmed ? (lit ? 1 : 2) : 0
      const isCollapsed = !folderContentsEnabled && card.openLevel <= 0
      if (
        card.classBase !== card.baseClass ||
        card.classActive !== isActive ||
        card.classPath !== isPath ||
        card.classPinned !== isPinned ||
        card.classSelected !== selectedNow ||
        card.classTone !== tone ||
        card.classDim !== dimFlag ||
        card.classTargeted !== isTargeted ||
        card.classCollapsed !== isCollapsed
      ) {
        card.classBase = card.baseClass
        card.classActive = isActive
        card.classPath = isPath
        card.classPinned = isPinned
        card.classSelected = selectedNow
        card.classTone = tone
        card.classDim = dimFlag
        card.classTargeted = isTargeted
        card.classCollapsed = isCollapsed
        let className = card.baseClass ?? `mr-card is-${view.state}`
        if (isActive) className += ' is-active'
        else if (isPath) className += ' is-path'
        if (isPinned) className += ' is-pinned'
        if (selectedNow) className += ' is-selected'
        if (isCollapsed) className += ' is-collapsed'
        if (tone) className += ` is-flash-${tone}`
        if (dimmed) className += lit ? ' is-lit' : ' is-dim'
        if (isTargeted) className += ' is-targeted'
        card.classBuilds = (card.classBuilds ?? 0) + 1
        if (card.className !== className) {
          card.className = className
          card.element.className = className
        }
      }

      const targetColor = isTargeted ? targetColour('dir', card.path) : null
      if (card.targetColor !== targetColor) {
        card.targetColor = targetColor
        paintTarget(card.element, targetColor)
      }

      const dimGoal = dimmed && !lit && !selectedNow ? 1 : 0
      if (isStill) {
        card.dimLevel = dimGoal
      } else if (card.dimLevel < dimGoal) {
        card.dimLevel = Math.min(dimGoal, card.dimLevel + dimStep)
      } else if (card.dimLevel > dimGoal) {
        card.dimLevel = Math.max(dimGoal, card.dimLevel - dimStep)
      }
      if (card.dimLevel !== card.lastDimLevel) {
        card.lastDimLevel = card.dimLevel
        paintCardOpacity(card)
      }

      if (!rowDirtyAll && !rowDirty.has(card.path)) continue
      for (const entry of card.rows) {
        const path = entry.item.path
        if (entry.item.kind === 'file') {
          const file = state.files.get(path)
          if (file) {
            entry.file = file
            if (
              file.reads !== entry.lastReads ||
              file.writes !== entry.lastWrites ||
              file.failed !== entry.lastFailed ||
              file.yellow !== entry.lastYellow
            ) {
              entry.lastReads = file.reads
              entry.lastWrites = file.writes
              entry.lastFailed = file.failed
              entry.lastYellow = file.yellow
              let mark = ''
              if (file.failed) mark = 'failed'
              else if (file.yellow) mark = 'finished'
              else if (file.writes > 0) mark = 'written'
              else if (file.reads > 0) mark = 'read'
              entry.mark = mark

              const shortParts = []
              if (file.reads) shortParts.push(`r ${file.reads}`)
              if (file.writes) shortParts.push(`w ${file.writes}`)
              if (file.failed) shortParts.push('failed')
              else if (file.yellow) shortParts.push('finished')
              entry.short = shortParts.join(' · ')
            }
          }
        }
        const hit = hasFlashes ? flashes.get(path) : null
        const rowTone = hit ? hit.tone : null
        const activeRow = active.files.has(path) || active.dirs.has(path)
        let rowClass = entry.baseClass
        if (entry.mark) rowClass += ` is-${entry.mark}`
        if (activeRow) rowClass += ' is-active'
        if (rowTone) rowClass += ` is-flash-${rowTone}`
        if (inspected === path) rowClass += ' is-inspected'
        if (entry.rowClass !== rowClass) {
          entry.rowClass = rowClass
          entry.row.className = rowClass
        }
        const target = activeRow && !entry.file?.failed ? targetColour(entry.item.kind, path) : null
        if (entry.targetColor !== target) {
          entry.targetColor = target
          paintTarget(entry.row, target)
        }
        if (entry.noteText !== entry.short) {
          entry.noteText = entry.short
          entry.note.textContent = entry.short
        }
        const heldAlpha = entry.item.kind === 'file' ? heldRows.get(path) : undefined
        const rowOpacity = heldAlpha !== undefined ? String(heldAlpha) : ''
        if (entry.lastOpacity !== rowOpacity) {
          entry.lastOpacity = rowOpacity
          entry.row.style.opacity = rowOpacity
        }
      }
    }
    if (rowDirtyAll) rowDirtyAll = false
    rowDirty.clear()
    return changed || removed || hadPending
  }

  function dispose() {
    for (const card of [...cards.values()]) removeCard(card)
    hider.dispose()
  }

  function pin(path) {
    if (!pinned.has(path)) {
      pinned.add(path)
      pinnedVersion += 1
      planKey = ''
    }
  }

  function setSelected(path) {
    const next = typeof path === 'string' ? path : null
    if (next === selected) return false
    selected = next
    return true
  }

  function setInspected(path) {
    const next = typeof path === 'string' ? path : null
    if (next === inspected) return false
    inspected = next
    rowRevision += 1
    return true
  }

  function clearSelection({ pins = true, pops = true } = {}) {
    inspected = null
    selected = null
    if (pins) {
      pinned.clear()
      pinnedVersion += 1
      planKey = ''
    }
    if (pops) {
      sprayed.clear()
      sprayVersion += 1
      planKey = ''
    }
    rowRevision += 1
  }

  return {
    cards,
    pin,
    togglePop,
    setSelected,
    setInspected,
    clearSelection,
    center,
    anchor,
    stamp,
    bottom,
    halfWidth,
    sideOf,
    slotPosition,
    edgePoint,
    holdCard,
    revealCard,
    holdRow,
    revealRow,
    faceOutline,
    rowOutline,
    rowStart,
    recordTouch,
    flashFile: (dir, file, tone) => {
      const name = basename(file)
      const duration = tone === 'red' ? FAIL_MS : FLASH_MS
      recordTouch(dir, duration)
      if (tone === 'red') {
        flash(file, 'red', name)
        flash(dir, 'red', name)
      } else {
        flash(file, 'white', name)
      }
    },
    flashCluster: (path, tone) => {
      const red = tone === 'red'
      const duration = red ? FAIL_MS : FLASH_MS
      const name = basename(path)
      const own = cards.get(path)
      if ((own && !own.leaving) || pinned.has(path)) {
        recordTouch(path, duration)
        if (!red) return
      } else {
        recordTouch(dirname(path), duration)
      }
      flash(path, red ? 'red' : 'white', name)
      if (!red) return
      const card = nearestCard(path)
      if (card && card.path !== path) flash(card.path, 'red', name)
    },
    sync,
    setOptions,
    update,
    markRows,
    beat,
    setSway,
    moving: () => movingNow,
    stats: () => ({ anchors: counters.anchors, offsets: counters.offsets, widths: counters.widths }),
    visibleLinks,
    homes: () => homes,
    overviewSpheres: overview,
    cardSphere,
    screenFrame,
    dispose,
    vectors: () => ({ right, up, back }),
  }
}
