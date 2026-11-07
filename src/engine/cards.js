import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { planFolderView } from '../model/folderView.js'
import { basename, dirname, visibleText } from '../model/paths.js'
import { freshRecent } from '../model/state.js'
import { SWAY_LIFT, SWAY_RATE, SWAY_SCALE, danceEnvelope, startDanceEnvelope } from './hub.js'
import { ROOT_PLACE, layoutRing, ringOf } from './ring.js'
import { easeRate, still } from './sprites.js'

export const CARD_W = 248
export const HEAD_H = 56
export const ROW_H = 22
export const CARD_PAD = 8
export const BACK_STEP = 12
export const BACK_DEPTH = 6
export const CARD_FACE_EDGE = 1
export const CARD_FACE_BORDER = 2
export const CARD_TAB_W = 72
export const CARD_TAB_H = 8
export const CARD_TAB_LEFT = -1
export const CARD_TAB_TOP = -9
export const CARD_SCALES = { closed: 1, open: 1.2, files: 1.8 }
export const CARD_NAME_MAX = 24
export const CARD_NAME_PAD = 28
export const FILE_LIMIT_MIN = 4
export const FILE_LIMIT_MAX = 20
export const FILE_LIMIT_DEFAULT = 6
export const VIRTUAL_MIN_ROWS = 60
export const VIRTUAL_OVERSCAN = 4
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
  return focus
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

export function clipCardName(name, max = CARD_NAME_MAX) {
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

export function occluderParts(view, rootName = 'root') {
  const width = cardBaseWidth(view?.path, rootName) + CARD_FACE_BORDER
  const height = cardHeight(cardRows(view)) + CARD_FACE_BORDER
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

export function cardRadius(view) {
  const { width, height } = cardSize(view)
  return Math.hypot(width, height) / 2
}

export function cardPlan(state, { pinned = [], alwaysDepth = 2, maxFiles = FILE_LIMIT_DEFAULT, previous = new Map(), sprayed = new Set(), rootName = 'root' } = {}) {
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
  const layoutKey = `${entries.map((entry) => `${entry.path}:${entry.width}:${entry.height}`).join(';')}|${sprays.sort().join(',')}`
  const placed = layoutRing(entries, { previous, sprayed })
  return { input, plan, views: plan, drawn, entries, placed, layoutKey }
}

export function overviewSpheres(cards) {
  const out = []
  for (const card of cards ?? []) {
    const root = card?.path === ''
    const top = !root && typeof card?.path === 'string' && !card.path.includes('/')
    if (!root && !top) continue
    const at = card?.home
    if (!at || ![at.x, at.y, at.z].every(Number.isFinite)) continue
    const size = card.view ? cardSize(card.view, card.rootName) : null
    out.push({
      x: at.x,
      y: at.y,
      z: at.z,
      r: size ? Math.hypot(size.width, size.height) / 2 : 0,
      rx: size ? size.width / 2 : 0,
      ry: size ? size.height / 2 : 0,
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

function occluderGeometry(view, rootName = 'root') {
  const parts = occluderParts(view, rootName)
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
  const { glScene = null, rootName = 'root', onInspect = () => {}, alwaysDepth = 2 } = options
  const cards = new Map()
  const hider = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const homes = new Map()
  const pinned = new Set()
  const sprayed = new Set()
  let selected = null
  const flashes = new Map()
  const rowDirty = new Set()
  let rowDirtyAll = true
  const initialDepth = Number(alwaysDepth)
  let alwaysLevel = Number.isFinite(initialDepth) ? Math.min(3, Math.max(0, Math.floor(initialDepth))) : 2
  let maxFilesLevel = clampFileLimit(options.maxFiles)
  const right = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const back = new THREE.Vector3(0, 0, 1)
  const rootHome = new THREE.Vector3(ROOT_PLACE.x, ROOT_PLACE.y, ROOT_PLACE.z)
  const projection = new THREE.Vector3()
  let planKey = ''
  let layoutKey = ''
  let overviewLayoutKey = ''
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

  let lastExistingFiles = -1
  let lastLatest = -1
  let lastPinnedVersion = 0
  let pinnedVersion = 1
  let lastSprayVersion = 0
  let sprayVersion = 1
  let lastAgentFocus = []
  let danceOrderKeys = []
  let danceNextPath = ''
  let swayTarget = 0
  let swayLevel = 0

  function focusChanged(state) {
    if (state.agents.size !== lastAgentFocus.length) return true
    let i = 0
    for (const agent of state.agents.values()) {
      if (agent.focus !== lastAgentFocus[i]) return true
      i += 1
    }
    return false
  }

  function saveAgentFocus(state) {
    lastAgentFocus = []
    for (const agent of state.agents.values()) {
      lastAgentFocus.push(agent.focus)
    }
  }

  function togglePop(path) {
    if (sprayed.has(path)) sprayed.delete(path)
    else sprayed.add(path)
    sprayVersion += 1
    planKey = ''
  }

  function nearestCard(path) {
    let at = path
    while (at !== '' && (!cards.has(at) || cards.get(at).leaving)) at = dirname(at)
    return cards.get(at) ?? null
  }

  function markRowPath(path) {
    const card = nearestCard(dirname(path))
    if (card) rowDirty.add(card.path)
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
    head.addEventListener('click', (event) => {
      event.stopPropagation()
      if (event.detail > 1) return
      togglePop(path)
    })
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
      danceFrom: 0,
      danceTo: 0,
      danceAt: 0,
      lastLift: 0,
      lastSwayScale: 1,
      scale,
      rootName,
      rows: [],
      rowPaths: [],
      rowIndex: null,
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
    }
    cards.set(path, card)
    return card
  }

  function removeCard(card) {
    linksCache = null
    cssScene.remove(card.object)
    glScene?.remove(card.occluder)
    card.occluder.geometry.dispose()
    card.element.remove()
    homes.delete(card.path)
    cards.delete(card.path)
  }

  function paintOccluder(card, view) {
    card.occluder.geometry.dispose()
    card.occluder.geometry = occluderGeometry(view, card.rootName)
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
    const tone = hit && hit.until > performance.now() ? hit.tone : null
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
      }
      onInspect(item.path)
      inspected = item.path
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

  function paintRows(card, view) {
    const wanted = view.state === 'files' ? view.items : []
    const limit = clampFileLimit(view.maxFiles ?? maxFilesLevel)
    card.items.style.maxHeight = `${limit * ROW_H}px`
    const itemsClass = wanted.length > limit ? 'mr-card-items is-scrollable' : 'mr-card-items'
    if (card.itemsClass !== itemsClass) {
      card.itemsClass = itemsClass
      card.items.className = itemsClass
    }
    const paths = wanted.map((item) => item.path)
    const hidden = view.state === 'files' ? view.hiddenItems : 0
    const key = `${paths.join('\n')}|${hidden}`
    const limitChanged = card.limitRows !== limit
    card.limitRows = limit
    if (key === card.rowKey) {
      if (card.virtual && limitChanged) paintWindow(card, lastState, true)
      return
    }
    card.rowKey = key
    card.rowPaths = paths
    card.rowIndex = new Map(paths.map((path, index) => [path, index]))
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
    if (planKeyNext === planKey) return false
    planKey = planKeyNext
    const layout = cardPlan(state, { pinned: [...pinned], alwaysDepth: alwaysLevel, maxFiles: maxFilesLevel, previous: homes, sprayed, rootName })
    const drawn = layout.drawn
    const focusPaths = new Set()
    for (const agent of state.agents.values()) for (const path of agent.focus ?? []) focusPaths.add(path)
    const files = new Set([...focusPaths].filter((path) => state.files.has(path)))
    const dirs = new Set()
    for (const file of files) dirs.add(dirname(file))
    for (const path of focusPaths) if (!state.files.has(path)) dirs.add(path)
    const chain = openChain(state)
    active = { files, dirs, path: chain }
    const now = performance.now()
    const isStill = still()
    for (const card of [...cards.values()]) {
      if (drawn.has(card.path) || card.leaving) continue
      if (!isStill && !(card.view && isPinnedView(card.view))) {
        card.leaving = true
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
        linksCache = null
        if (!isStill && !pinnedView) {
          card.fade = { from: card.opacity, to: 1, start: now }
        } else {
          card.fade = null
          setCardOpacity(card, 1)
        }
      }
      if (card.fresh) {
        card.fresh = false
        if (!isStill && !pinnedView) {
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
      card.height = cardHeight(cardRows(view))
      paintBacks(card, view.back)
      if (card.occluderKey !== `${card.height}|${backLayers(view.back)}`) paintOccluder(card, view)
      paintRows(card, view)
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

  function anchor(path, out = new THREE.Vector3()) {
    const card = nearestCard(path)
    if (!card) return null
    const width = cardBaseWidth(card.path, card.rootName) + CARD_FACE_BORDER
    const height = (card.height || cardHeight(card.view ? cardRows(card.view) : 0)) + CARD_FACE_BORDER
    const offset = tabAnchorOffset(width, height, card.scale)
    out.copy(card.object.position)
    out.addScaledVector(right, offset.x)
    out.addScaledVector(up, offset.y)
    return out
  }

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
    const spot = card ? homes.get(card.path) : null
    return spot && spot.x < 0 ? 1 : -1
  }

  function slotPosition(dir, file, out) {
    const card = cards.get(dir)
    out.copy(center(dir))
    const index = card?.rowIndex ? card.rowIndex.get(file) ?? -1 : -1
    if (index === -1) return out
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
    flashes.set(path, { tone, text, until: performance.now() + duration })
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

  function sync(state) {
    flashes.clear()
    pinnedVersion += 1
    sprayed.clear()
    sprayVersion += 1
    planKey = ''
    recompute(state)
    for (const card of cards.values()) {
      for (const entry of card.rows) resetRow(entry)
    }
    rowRevision += 1
  }

  function setOptions(options = {}) {
    let changed = false
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
    if (!changed) return false
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

  function overview() {
    return overviewSpheres(cards.values())
  }

  function cardSphere(path) {
    const card = cards.get(path)
    if (!card?.view) return null
    const position = card.base
    return { x: position.x, y: position.y, z: position.z, r: cardRadius(card.view) }
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

  function update(state, delta, camera, mask = null) {
    lastState = state
    movingNow = false
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    back.set(0, 0, 1).applyQuaternion(camera.quaternion)
    targetDirColors = mask?.dirColors ?? null
    targetFileColors = mask?.fileColors ?? null
    const targetVersion = mask?.targetVersion ?? -1
    if (targetVersion !== lastTargetVersion) {
      lastTargetVersion = targetVersion
      rowDirtyAll = true
    }
    const changed = recompute(state)
    const now = performance.now()
    const isStill = still()
    swayLevel = isStill ? 0 : swayLevel + (swayTarget - swayLevel) * easeRate(delta, 1.5, false)
    const ease = easeRate(delta, 3, isStill)
    const dimmed = Boolean(mask?.dimmed)
    const dimLit = mask?.lit ?? null
    const targeted = mask?.targeted ?? null
    const dimStep = delta / (DIM_FADE_MS / 1000)
    for (const [path, hit] of flashes) {
      if (hit.until <= now) {
        flashes.delete(path)
        markRowPath(path)
      }
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
      let posChanged = false
      if (base.distanceToSquared(card.home) > 0.25) {
        base.lerp(card.home, ease)
        posChanged = true
      } else if (!base.equals(card.home)) {
        base.copy(card.home)
        posChanged = true
      }
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
      }
      if (posChanged) movingNow = true
      const view = card.view
      const goal = CARD_SCALES[view.state] ?? 1
      if (Math.abs(card.scale - goal) > 0.002) {
        card.scale += (goal - card.scale) * ease
      } else {
        card.scale = goal
      }
      const swayScale = isStill ? 1 : 1 + swayLevel * SWAY_SCALE * wave
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
      const tone = flashing && flashing.until > now ? flashing.tone : null
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
      if (
        card.classBase !== card.baseClass ||
        card.classActive !== isActive ||
        card.classPath !== isPath ||
        card.classPinned !== isPinned ||
        card.classSelected !== selectedNow ||
        card.classTone !== tone ||
        card.classDim !== dimFlag ||
        card.classTargeted !== isTargeted
      ) {
        card.classBase = card.baseClass
        card.classActive = isActive
        card.classPath = isPath
        card.classPinned = isPinned
        card.classSelected = selectedNow
        card.classTone = tone
        card.classDim = dimFlag
        card.classTargeted = isTargeted
        let className = card.baseClass ?? `mr-card is-${view.state}`
        if (isActive) className += ' is-active'
        else if (isPath) className += ' is-path'
        if (isPinned) className += ' is-pinned'
        if (selectedNow) className += ' is-selected'
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
        const rowTone = hit && hit.until > now ? hit.tone : null
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
      }
    }
    if (rowDirtyAll) rowDirtyAll = false
    rowDirty.clear()
    return changed || removed
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
    bottom,
    halfWidth,
    sideOf,
    slotPosition,
    edgePoint,
    flashFile: (dir, file, tone) => {
      const name = basename(file)
      flash(file, tone === 'red' ? 'red' : 'white', name)
      flash(dir, tone === 'red' ? 'red' : 'white', name)
    },
    flashCluster: (path, tone) => flash(path, tone === 'red' ? 'red' : 'white', basename(path)),
    sync,
    setOptions,
    update,
    markRows,
    beat,
    setSway,
    moving: () => movingNow,
    visibleLinks,
    homes: () => homes,
    overviewSpheres: overview,
    cardSphere,
    screenFrame,
    dispose,
    vectors: () => ({ right, up, back }),
  }
}
