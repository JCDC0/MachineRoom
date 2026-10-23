import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { planFolderView } from '../model/folderView.js'
import { basename, dirname, visibleText } from '../model/paths.js'
import { freshRecent } from '../model/state.js'
import { ROOT_DROP, SPHERE_CENTER, STACK_LIMIT, layoutSphere } from './sphere.js'
import { easeRate, still } from './sprites.js'

export const CARD_W = 248
export const HEAD_H = 56
export const ROW_H = 22
export const CARD_PAD = 8
export const BACK_STEP = 12
export const CARD_FACE_EDGE = 1
export const CARD_FACE_BORDER = 2
export const CARD_TAB_W = 72
export const CARD_TAB_H = 8
export const CARD_TAB_LEFT = -1
export const CARD_TAB_TOP = -9
export const CARD_SCALES = { closed: 1, open: 1.2, files: 1.8 }
const FLASH_MS = 1100
const FAIL_MS = 2600
const FADE_MS = 400
const DIM_FADE_MS = 1000
const DIM_OPACITY = 0.25
const BRACKETS = ['tl', 'tr', 'bl', 'br']

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

let cachedFiles = null
let cachedCount = -1
let cachedMap = null

export function viewInput(state, pinned = []) {
  if (cachedMap !== state.files || cachedCount !== state.existingFiles) {
    const files = []
    for (const file of state.files.values()) if (file.exists) files.push(file.path)
    cachedFiles = files
    cachedCount = state.existingFiles
    cachedMap = state.files
  }
  return { files: cachedFiles, focus: viewFocus(state, pinned), touched: state.recent ?? [] }
}

export function viewKey(state, pinned = []) {
  return `${state.existingFiles}|${viewFocus(state, pinned).join('\n')}|${(state.recent ?? []).join('\n')}`
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

export function planOpenSet(views, chain = new Set()) {
  const open = new Set(chain)
  for (const view of views) {
    if (view?.state === 'open' || view?.state === 'files') open.add(view.path)
  }
  return open
}

export function createRowFrameKey() {
  let latest = null
  let mask = null
  let flash = -1
  let revision = -1
  let value = ''
  let builds = 0
  return {
    key(state, maskValue, flashValue, revisionValue) {
      if (
        value !== '' &&
        state.latest === latest &&
        maskValue === mask &&
        flashValue === flash &&
        revisionValue === revision
      ) {
        return value
      }
      const maskKey = maskValue?.dimmed ? `1|${[...(maskValue.lit ?? [])].join('\n')}|${[...(maskValue.targeted ?? [])].join('\n')}` : '0'
      latest = state.latest
      mask = maskValue
      flash = flashValue
      revision = revisionValue
      value = `${latest}|${maskKey}|${flash}|${revision}`
      builds += 1
      return value
    },
    builds: () => builds,
  }
}

export function stackOverflow(views, open = new Set()) {
  const paths = new Set(views.map((view) => view.path))
  const parentOf = new Map()
  for (const view of views) {
    if (view.path === '') continue
    let at = dirname(view.path)
    while (at !== '' && !paths.has(at)) at = dirname(at)
    if (at === '' && paths.has('')) parentOf.set(view.path, '')
    else if (paths.has(at)) parentOf.set(view.path, at)
  }
  const groups = new Map()
  for (const view of views) {
    const parent = parentOf.get(view.path)
    if (parent === undefined) continue
    const list = groups.get(parent)
    if (list) list.push(view)
    else groups.set(parent, [view])
  }
  const hidden = new Set()
  const extra = new Map()
  for (const [parent, kids] of groups) {
    if (parent === '') continue
    if (open.has(parent)) continue
    if (kids.some((view) => open.has(view.path))) continue
    const stack = kids.filter((view) => !open.has(view.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    for (const view of stack.slice(STACK_LIMIT)) hidden.add(view.path)
    const over = Math.max(0, stack.length - STACK_LIMIT)
    if (over > 0) extra.set(parent, over)
  }
  let grew = hidden.size > 0
  while (grew) {
    grew = false
    for (const view of views) {
      if (hidden.has(view.path)) continue
      const parent = parentOf.get(view.path)
      if (parent !== undefined && hidden.has(parent)) {
        hidden.add(view.path)
        grew = true
      }
    }
  }
  return { hidden, extra }
}

export function cardHeight(rows) {
  return HEAD_H + rows * ROW_H + CARD_PAD
}

export function rowOffset(rows, index) {
  return cardHeight(rows) / 2 - (HEAD_H + (index + 0.5) * ROW_H)
}

export function cardRows(view) {
  return view.state === 'files' ? view.items.length + (view.hiddenItems > 0 ? 1 : 0) : 0
}

export function cardSize(view) {
  const scale = CARD_SCALES[view.state] ?? 1
  const back = (view.back ?? 0) * BACK_STEP
  return { scale, width: (CARD_W + back) * scale, height: (cardHeight(cardRows(view)) + back) * scale }
}

function backLayers(view) {
  const raw = Number(view?.back)
  if (!Number.isFinite(raw)) return 0
  return Math.min(3, Math.max(0, Math.floor(raw)))
}

export function occluderParts(view) {
  const height = cardHeight(cardRows(view)) + CARD_FACE_BORDER
  const tabLeft = CARD_TAB_LEFT + CARD_FACE_EDGE
  const tabTop = CARD_TAB_TOP + CARD_FACE_EDGE
  const parts = [
    { width: CARD_W, height, x: 0, y: 0 },
    {
      width: CARD_TAB_W,
      height: CARD_TAB_H,
      x: tabLeft + CARD_TAB_W / 2 - CARD_W / 2,
      y: height / 2 - tabTop - CARD_TAB_H / 2,
    },
  ]
  for (let layer = 1; layer <= backLayers(view); layer += 1) {
    parts.push({ width: CARD_W, height, x: layer * BACK_STEP, y: layer * BACK_STEP })
  }
  return parts
}

export function occluderBox(view, scale = 1) {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const part of occluderParts(view)) {
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

export function overviewSpheres(cards) {
  const out = []
  for (const card of cards ?? []) {
    const root = card?.path === ''
    if (!root && card?.view?.pinned !== true) continue
    const at = card?.home
    if (!at || ![at.x, at.y, at.z].every(Number.isFinite)) continue
    out.push({ x: at.x, y: at.y, z: at.z, r: card.view ? cardRadius(card.view) : 0 })
  }
  return out
}

function obstacleKeyOf(list) {
  if (!Array.isArray(list)) return ''
  return list
    .map((item) =>
      [item?.x, item?.y, item?.z, item?.radius]
        .map((value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '?'))
        .join(',')
    )
    .join(';')
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function occluderGeometry(view) {
  const parts = occluderParts(view)
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

function rowMark(file) {
  if (!file) return ''
  if (file.failed) return 'failed'
  if (file.yellow) return 'finished'
  if (file.writes > 0) return 'written'
  if (file.reads > 0) return 'read'
  return ''
}

function rowNote(file) {
  if (!file) return ''
  const parts = []
  if (file.reads) parts.push(`read ${file.reads}`)
  if (file.writes) parts.push(`written ${file.writes}`)
  if (file.failed) parts.push('failed')
  else if (file.yellow) parts.push('finished')
  return parts.join(' · ') || 'not touched'
}

export function createCards(cssScene, { glScene = null, rootName = 'root', onInspect = () => {}, alwaysDepth = 2, obstacles = [] } = {}) {
  const cards = new Map()
  const hider = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const homes = new Map()
  const pinned = new Set()
  const flashes = new Map()
  let flashVersion = 0
  const rowFrame = createRowFrameKey()
  let boardObstacles = Array.isArray(obstacles) ? [...obstacles] : []
  let obstacleKey = obstacleKeyOf(boardObstacles)
  const initialDepth = Number(alwaysDepth)
  let alwaysLevel = Number.isFinite(initialDepth) ? Math.min(3, Math.max(0, Math.floor(initialDepth))) : 2
  const right = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const back = new THREE.Vector3(0, 0, 1)
  const rootHome = new THREE.Vector3(SPHERE_CENTER.x, SPHERE_CENTER.y - ROOT_DROP, SPHERE_CENTER.z)
  const projection = new THREE.Vector3()
  let planKey = ''
  let layoutKey = ''
  let overviewLayoutKey = ''
  let plan = new Map()
  let active = { files: new Set(), dirs: new Set(), path: new Set() }
  let movingNow = false
  let wasMoving = false
  let inspected = null
  let rowRevision = 0
  let lastRowFrameKey = null

  let lastExistingFiles = -1
  let lastLatest = -1
  let lastPinnedVersion = 0
  let pinnedVersion = 1
  let lastAgentFocus = []

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

  function nearestCard(path) {
    let at = path
    while (at !== '' && (!cards.has(at) || cards.get(at).leaving)) at = dirname(at)
    return cards.get(at) ?? null
  }

  function makeCard(path) {
    const element = el('div', 'mr-card is-closed')
    element.dataset.path = path
    const backs = el('div', 'mr-card-backs')
    const head = el('div', 'mr-card-head')
    const tab = el('div', 'mr-card-tab')
    const name = el('div', 'mr-card-name', visibleText(path === '' ? `${rootName}/` : `${basename(path)}/`))
    const meta = el('div', 'mr-card-meta')
    head.append(tab, name, meta)
    const items = el('div', 'mr-card-items')
    const band = el('div', 'mr-card-band')
    const face = el('div', 'mr-card-face')
    face.append(head, items, band)
    element.append(backs, face)
    for (const corner of BRACKETS) element.append(el('div', `mr-card-bracket is-${corner}`))
    head.addEventListener('click', (event) => {
      event.stopPropagation()
      if (pinned.has(path)) pinned.delete(path)
      else pinned.add(path)
      pinnedVersion += 1
      planKey = ''
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
    const card = {
      path,
      element,
      backs,
      meta,
      items,
      band,
      object,
      occluder,
      home: object.position.clone(),
      scale,
      rows: [],
      rowPaths: [],
      view: null,
      backCount: -1,
      occluderKey: '',
      baseClass: 'mr-card is-closed',
      className: 'mr-card is-closed',
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
    cssScene.remove(card.object)
    glScene?.remove(card.occluder)
    card.occluder.geometry.dispose()
    card.element.remove()
    cards.delete(card.path)
  }

  function paintOccluder(card, view) {
    card.occluder.geometry.dispose()
    card.occluder.geometry = occluderGeometry(view)
    card.occluderKey = `${card.height}|${backLayers(view)}`
  }

  function paintBacks(card, count) {
    if (card.backCount === count) return
    card.backCount = count
    card.backs.replaceChildren(...Array.from({ length: count }, (_, i) => el('div', `mr-card-back is-back-${i + 1}`)))
  }

  function paintRows(card, view) {
    const wanted = view.state === 'files' ? view.items : []
    const paths = wanted.map((item) => item.path)
    const hidden = view.state === 'files' ? view.hiddenItems : 0
    const key = `${paths.join('\n')}|${hidden}`
    if (key === card.rowKey) return
    card.rowKey = key
    card.rows = wanted.map((item) => {
      const row = el('div', `mr-item is-${item.kind}`)
      const label = el('span', 'mr-item-name', visibleText(item.kind === 'dir' ? `${basename(item.path)}/` : basename(item.path)))
      const note = el('span', 'mr-item-note')
      const detail = el('div', 'mr-item-detail')
      row.append(label, note, detail)
      row.addEventListener('click', (event) => {
        event.stopPropagation()
        inspected = inspected === item.path ? null : item.path
        rowRevision += 1
        if (item.kind === 'dir') {
          pinned.add(item.path)
          pinnedVersion += 1
          planKey = ''
        }
        if (inspected) onInspect(item.path)
      })
      return {
        row,
        note,
        detail,
        item,
        file: null,
        baseClass: `mr-item is-${item.kind}`,
        visiblePath: visibleText(item.path),
        rowClass: '',
        noteText: '',
        detailText: '',
        lastReads: -1,
        lastWrites: -1,
        lastFailed: null,
        lastYellow: null,
        mark: '',
        short: '',
        cachedNote: item.kind === 'file' ? 'not touched' : '',
      }
    })
    card.rowPaths = paths
    const more = hidden > 0 ? [el('div', 'mr-card-more', `+ ${hidden} more`)] : []
    card.items.replaceChildren(...card.rows.map((entry) => entry.row), ...more)
    rowRevision += 1
  }

  function resetRow(entry) {
    entry.file = null
    entry.lastReads = -1
    entry.lastWrites = -1
    entry.lastFailed = null
    entry.lastYellow = null
    entry.mark = ''
    entry.short = ''
    entry.cachedNote = entry.item.kind === 'file' ? 'not touched' : ''
    entry.noteText = null
    entry.detailText = null
    entry.rowClass = null
  }

  function metaText(view) {
    if (view.state === 'files') return `${view.items.length + view.hiddenItems} items`
    if (view.state === 'open') return `${view.folders.length + view.hiddenFolders} folders`
    return ''
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
    const unchanged =
      planKey !== '' &&
      pinnedVersion === lastPinnedVersion &&
      state.existingFiles === lastExistingFiles &&
      state.latest === lastLatest &&
      !focusChanged(state)
    if (unchanged) return false

    lastPinnedVersion = pinnedVersion
    lastExistingFiles = state.existingFiles
    lastLatest = state.latest
    saveAgentFocus(state)

    const key = viewKey(state, [...pinned])
    if (key === planKey) return false
    planKey = key
    const input = viewInput(state, [...pinned])
    plan = new Map(planFolderView({ ...input, alwaysDepth: alwaysLevel }).map((view) => [view.path, view]))
    const focusPaths = new Set()
    for (const agent of state.agents.values()) for (const path of agent.focus ?? []) focusPaths.add(path)
    const files = new Set([...focusPaths].filter((path) => state.files.has(path)))
    const dirs = new Set()
    for (const file of files) dirs.add(dirname(file))
    for (const path of focusPaths) if (!state.files.has(path)) dirs.add(path)
    const chain = openChain(state)
    active = { files, dirs, path: chain }
    const openPaths = planOpenSet(plan.values(), openChain(state, [...pinned]))
    const views = [...plan.values()].sort((a, b) => a.path.length - b.path.length)
    const overflow = stackOverflow(views, openPaths)
    const drawn = new Map()
    for (const view of views) {
      if (overflow.hidden.has(view.path)) continue
      drawn.set(view.path, { ...view, back: Math.min(3, (view.back ?? 0) + (overflow.extra.get(view.path) ?? 0)) })
    }
    const now = performance.now()
    const isStill = still()
    for (const card of [...cards.values()]) {
      if (drawn.has(card.path) || card.leaving) continue
      if (!isStill && !(card.view && isPinnedView(card.view))) {
        card.leaving = true
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
      if (card.occluderKey !== `${card.height}|${backLayers(view)}`) paintOccluder(card, view)
      paintRows(card, view)
      card.meta.textContent = metaText(view)
    }
    const entries = [...drawn.values()].map((view) => ({ path: view.path, ...cardSize(view) }))
    const openKey = [...openPaths].sort().join('\n')
    const nextLayoutKey = `${entries.map((entry) => `${entry.path}:${entry.width}:${entry.height}`).join(';')}|${obstacleKey}|${openKey}`
    const layoutChanged = nextLayoutKey !== layoutKey
    if (layoutChanged) {
      layoutKey = nextLayoutKey
      const sizes = new Map(entries.map((entry) => [entry.path, entry]))
      const placed = layoutSphere(entries, { previous: homes, obstacles: boardObstacles, open: openPaths })
      for (const [path, spot] of placed) {
        const size = sizes.get(path)
        homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height })
        const card = cards.get(path)
        if (card) card.home.set(spot.x, spot.y, spot.z)
      }
    }
    const nextOverviewKey = entries
      .filter((entry) => entry.path === '' || drawn.get(entry.path)?.pinned === true)
      .map((entry) => `${entry.path}:${entry.width}:${entry.height}`)
      .join(';')
    const overviewChanged = nextOverviewKey !== overviewLayoutKey
    overviewLayoutKey = nextOverviewKey
    rowRevision += 1
    return layoutChanged || overviewChanged
  }

  function center(path) {
    return (nearestCard(path) ?? cards.get(''))?.object.position ?? rootHome
  }

  function halfWidth(dir) {
    const card = nearestCard(dir)
    return ((card?.scale ?? CARD_SCALES.closed) * CARD_W) / 2
  }

  function sideOf(dir) {
    const card = nearestCard(dir)
    const spot = card ? homes.get(card.path) : null
    return spot && spot.x < 0 ? 1 : -1
  }

  function topPoint(dir, out) {
    const card = nearestCard(dir)
    out.copy(center(dir))
    if (card?.view) out.addScaledVector(up, (cardHeight(cardRows(card.view)) / 2) * card.scale + 40)
    return out
  }

  function slotPosition(dir, file, out) {
    const card = cards.get(dir)
    out.copy(center(dir))
    const index = card ? card.rowPaths.indexOf(file) : -1
    if (index !== -1) out.addScaledVector(up, rowOffset(cardRows(card.view), index) * card.scale)
    return out
  }

  function edgePoint(dir, file, side, out) {
    slotPosition(dir, file, out)
    return out.addScaledVector(right, side * halfWidth(dir))
  }

  function flash(path, tone, text = '') {
    const duration = tone === 'red' ? FAIL_MS : FLASH_MS
    flashes.set(path, { tone, text, until: performance.now() + duration })
    flashVersion += 1
    rowRevision += 1
  }

  function sync(state) {
    flashes.clear()
    flashVersion += 1
    pinnedVersion += 1
    planKey = ''
    recompute(state)
    for (const card of cards.values()) {
      for (const entry of card.rows) resetRow(entry)
    }
    rowRevision += 1
  }

  function setOptions(options = {}) {
    if (!Object.hasOwn(options, 'alwaysDepth')) return false
    const raw = Number(options.alwaysDepth)
    if (!Number.isFinite(raw)) return false
    const value = Math.min(3, Math.max(0, Math.floor(raw)))
    if (value === alwaysLevel) return false
    alwaysLevel = value
    pinnedVersion += 1
    planKey = ''
    layoutKey = ''
    return true
  }

  function visibleLinks() {
    const links = [{ from: null, to: '' }]
    for (const card of cards.values()) {
      if (card.path === '' || card.leaving) continue
      if (!card.path.includes('/')) {
        links.push({ from: null, to: card.path })
        continue
      }
      const parent = cards.get(dirname(card.path)) ?? nearestCard(dirname(card.path))
      if (parent) links.push({ from: parent.path, to: card.path })
    }
    return links
  }

  function overview() {
    return overviewSpheres(cards.values())
  }

  function setObstacles(list) {
    const next = Array.isArray(list) ? [...list] : []
    const key = obstacleKeyOf(next)
    if (key === obstacleKey) return false
    boardObstacles = next
    obstacleKey = key
    planKey = ''
    layoutKey = ''
    return true
  }

  function cardSphere(path) {
    const card = cards.get(path)
    if (!card?.view) return null
    const position = card.object.position
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
        projection.copy(card.object.position).addScaledVector(right, sx * halfWidth).addScaledVector(up, sy * halfHeight).project(camera)
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
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    back.set(0, 0, 1).applyQuaternion(camera.quaternion)
    const changed = recompute(state)
    const now = performance.now()
    const isStill = still()
    const ease = easeRate(delta, 3, isStill)
    const dimmed = Boolean(mask?.dimmed)
    const dimLit = mask?.lit ?? null
    const targeted = mask?.targeted ?? null
    const dimStep = delta / (DIM_FADE_MS / 1000)
    movingNow = false
    let flashesEnded = false
    for (const [path, hit] of flashes) {
      if (hit.until <= now) {
        flashes.delete(path)
        flashesEnded = true
      }
    }
    if (flashesEnded) {
      flashVersion += 1
      rowRevision += 1
    }
    const hasFlashes = flashes.size > 0
    const rowFrameKey = rowFrame.key(state, mask, flashVersion, rowRevision)
    const rowsDue = rowFrameKey !== lastRowFrameKey
    lastRowFrameKey = rowFrameKey
    let removed = false
    for (const card of [...cards.values()]) {
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
        const keep = []
        for (const ghost of card.ghosts) {
          const t = fadeProgress(ghost.start, now, isStill)
          ghost.element.style.opacity = String(1 - t)
          if (t < 1) keep.push(ghost)
          else ghost.element.remove()
        }
        card.ghosts = keep
      }
      if (card.leaving && !card.fade) {
        removeCard(card)
        removed = true
        continue
      }
      const position = card.object.position
      let posChanged = false
      if (position.distanceToSquared(card.home) > 0.25) {
        position.lerp(card.home, ease)
        movingNow = true
        posChanged = true
      } else if (!position.equals(card.home)) {
        position.copy(card.home)
        posChanged = true
      }
      if (posChanged) {
        card.occluder.position.copy(position)
      }
      const view = card.view
      const goal = CARD_SCALES[view.state] ?? 1
      if (Math.abs(card.scale - goal) > 0.002) {
        card.scale += (goal - card.scale) * ease
      } else {
        card.scale = goal
      }
      if (card.lastScale !== card.scale || card.lastHeight !== card.height) {
        card.lastScale = card.scale
        card.lastHeight = card.height
        card.object.scale.setScalar(card.scale)
        card.occluder.scale.setScalar(card.scale)
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

      let className = card.baseClass ?? `mr-card is-${view.state}`
      if (active.dirs.has(card.path)) className += ' is-active'
      else if (active.path.has(card.path)) className += ' is-path'
      if (pinned.has(card.path)) className += ' is-pinned'
      if (tone) className += ` is-flash-${tone}`
      const lit = dimmed && Boolean(dimLit?.has(card.path))
      if (dimmed) className += lit ? ' is-lit' : ' is-dim'
      if (targeted?.has(card.path)) className += ' is-targeted'
      if (card.className !== className) {
        card.className = className
        card.element.className = className
      }

      const dimGoal = dimmed && !lit ? 1 : 0
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

      if (!rowsDue) continue
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

              const parts = []
              const shortParts = []
              if (file.reads) {
                parts.push(`read ${file.reads}`)
                shortParts.push(`r ${file.reads}`)
              }
              if (file.writes) {
                parts.push(`written ${file.writes}`)
                shortParts.push(`w ${file.writes}`)
              }
              if (file.failed) {
                parts.push('failed')
                shortParts.push('failed')
              } else if (file.yellow) {
                parts.push('finished')
                shortParts.push('finished')
              }
              entry.cachedNote = parts.join(' · ') || 'not touched'
              entry.short = shortParts.join(' · ')
            }
          }
        }
        const hit = hasFlashes ? flashes.get(path) : null
        const rowTone = hit && hit.until > now ? hit.tone : null
        let rowClass = entry.baseClass
        if (entry.mark) rowClass += ` is-${entry.mark}`
        if (active.files.has(path) || active.dirs.has(path)) rowClass += ' is-active'
        if (rowTone) rowClass += ` is-flash-${rowTone}`
        if (inspected === path) rowClass += ' is-inspected'
        if (entry.rowClass !== rowClass) {
          entry.rowClass = rowClass
          entry.row.className = rowClass
        }
        if (entry.noteText !== entry.short) {
          entry.noteText = entry.short
          entry.note.textContent = entry.short
        }
        const detail = inspected === path ? `${entry.visiblePath}  ${entry.cachedNote}` : ''
        if (entry.detailText !== detail) {
          entry.detailText = detail
          entry.detail.textContent = detail
        }
      }
    }
    const isMoving = movingNow
    movingNow = movingNow || wasMoving
    wasMoving = isMoving
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

  return {
    cards,
    pin,
    center,
    halfWidth,
    sideOf,
    topPoint,
    slotPosition,
    edgePoint,
    flashFile: (dir, file, tone) => {
      const name = basename(file)
      flash(file, tone === 'red' ? 'red' : 'white', name)
      flash(dir, tone === 'red' ? 'red' : 'white', name)
    },
    onPath: (path) => active.path.has(path),
    flashCluster: (path, tone) => flash(path, tone === 'red' ? 'red' : 'white', basename(path)),
    sync,
    setOptions,
    setObstacles,
    update,
    visibleLinks,
    overviewSpheres: overview,
    cardSphere,
    screenFrame,
    dispose,
    moving: () => movingNow,
    vectors: () => ({ right, up, back }),
  }
}
