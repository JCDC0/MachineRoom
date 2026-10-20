import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { planFolderView } from '../model/folderView.js'
import { basename, dirname } from '../model/paths.js'
import { freshRecent } from '../model/state.js'
import { OVERVIEW, viewBasis } from './camera.js'
import { HUB_CENTER } from './hub.js'
import { CARD_HUB, cardDepth, layoutCards } from './layout.js'

export const CARD_W = 248
export const HEAD_H = 56
export const ROW_H = 22
export const CARD_PAD = 8
export const BACK_STEP = 12
export const CARD_SCALES = { closed: 1.5, open: 1.8, files: 2.6 }
const FLASH_MS = 1100
const FAIL_MS = 2600
const BASIS = viewBasis(OVERVIEW.yaw, OVERVIEW.pitch)

let currentActivePath = new Set()

export function isPathActive(path) {
  return currentActivePath.has(path)
}

export function planeToWorld(spot, out = new THREE.Vector3()) {
  const { right, up, back } = BASIS
  return out.set(
    HUB_CENTER.x + right.x * spot.x + up.x * spot.y + back.x * spot.z,
    HUB_CENTER.y + right.y * spot.x + up.y * spot.y + back.y * spot.z,
    HUB_CENTER.z + right.z * spot.x + up.z * spot.y + back.z * spot.z
  )
}

export function viewInput(state, pinned = []) {
  const files = []
  for (const file of state.files.values()) if (file.exists) files.push(file.path)
  const focus = ['']
  for (const agent of state.agents.values()) focus.push(...(agent.focus ?? []))
  focus.push(...(state.recent ? freshRecent(state) : []), ...pinned)
  return { files, focus, touched: state.recent ?? [] }
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

export function cardRadius(view) {
  const { width, height } = cardSize(view)
  return Math.hypot(width, height) / 2
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
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

export function createCards(cssScene, { glScene = null, rootName = 'root', onInspect = () => {} } = {}) {
  const cards = new Map()
  const plane = new THREE.PlaneGeometry(1, 1)
  const hider = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const homes = new Map()
  const pinned = new Set()
  const flashes = new Map()
  const right = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  const back = new THREE.Vector3(0, 0, 1)
  const rootHome = planeToWorld({ x: 0, y: CARD_HUB.hh + 80, z: cardDepth('') })
  let planKey = ''
  let plan = new Map()
  let active = { files: new Set(), dirs: new Set(), path: new Set() }
  let movingNow = false
  let inspected = null

  function nearestCard(path) {
    let at = path
    while (!cards.has(at) && at !== '') at = dirname(at)
    return cards.get(at) ?? null
  }

  function makeCard(path) {
    const element = el('div', 'mr-card is-closed')
    element.dataset.path = path
    const backs = el('div', 'mr-card-backs')
    const head = el('div', 'mr-card-head')
    const tab = el('div', 'mr-card-tab')
    const name = el('div', 'mr-card-name', path === '' ? `${rootName}/` : `${basename(path)}/`)
    const meta = el('div', 'mr-card-meta')
    head.append(tab, name, meta)
    const items = el('div', 'mr-card-items')
    const band = el('div', 'mr-card-band')
    const face = el('div', 'mr-card-face')
    face.append(head, items, band)
    element.append(backs, face)
    head.addEventListener('click', (event) => {
      event.stopPropagation()
      if (pinned.has(path)) pinned.delete(path)
      else pinned.add(path)
      planKey = ''
    })
    const object = new CSS3DObject(element)
    const parent = path === '' ? null : nearestCard(dirname(path))
    object.position.copy(parent ? parent.object.position : rootHome)
    const scale = parent ? parent.scale * 0.5 : CARD_SCALES.closed
    object.scale.setScalar(scale)
    cssScene.add(object)
    const occluder = new THREE.Mesh(plane, hider)
    occluder.renderOrder = -1
    glScene?.add(occluder)
    const card = { path, element, backs, meta, items, band, object, occluder, home: object.position.clone(), scale, rows: [], rowPaths: [], view: null, backCount: -1 }
    cards.set(path, card)
    return card
  }

  function removeCard(card) {
    cssScene.remove(card.object)
    glScene?.remove(card.occluder)
    card.element.remove()
    cards.delete(card.path)
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
      const label = el('span', 'mr-item-name', item.kind === 'dir' ? `${basename(item.path)}/` : basename(item.path))
      const note = el('span', 'mr-item-note')
      const detail = el('div', 'mr-item-detail')
      row.append(label, note, detail)
      row.addEventListener('click', (event) => {
        event.stopPropagation()
        inspected = inspected === item.path ? null : item.path
        if (item.kind === 'dir') {
          pinned.add(item.path)
          planKey = ''
        }
        if (inspected) onInspect(item.path)
      })
      return { row, note, detail, item }
    })
    card.rowPaths = paths
    const more = hidden > 0 ? [el('div', 'mr-card-more', `+ ${hidden} more`)] : []
    card.items.replaceChildren(...card.rows.map((entry) => entry.row), ...more)
  }

  function metaText(view) {
    if (view.state === 'files') return `${view.items.length + view.hiddenItems} items`
    if (view.state === 'open') return `${view.folders.length + view.hiddenFolders} folders`
    return ''
  }

  function recompute(state) {
    const input = viewInput(state, [...pinned])
    const key = `${input.files.length}|${input.focus.join('\n')}|${input.touched.join('\n')}`
    if (key === planKey) return false
    planKey = key
    plan = new Map(planFolderView(input).map((view) => [view.path, view]))
    for (const card of [...cards.values()]) if (!plan.has(card.path)) removeCard(card)
    const views = [...plan.values()].sort((a, b) => a.path.length - b.path.length)
    for (const view of views) {
      const card = cards.get(view.path) ?? makeCard(view.path)
      card.view = view
      paintBacks(card, view.back)
      paintRows(card, view)
      card.meta.textContent = metaText(view)
    }
    const placed = layoutCards(views.map((view) => ({ path: view.path, ...cardSize(view) })), homes)
    for (const [path, spot] of placed) {
      homes.set(path, spot)
      const card = cards.get(path)
      if (card) planeToWorld(spot, card.home)
    }
    const focusPaths = new Set()
    for (const agent of state.agents.values()) for (const path of agent.focus ?? []) focusPaths.add(path)
    const files = new Set([...focusPaths].filter((path) => state.files.has(path)))
    const dirs = new Set([...files].map(dirname))
    for (const path of focusPaths) if (!state.files.has(path)) dirs.add(path)
    const chain = new Set()
    for (const dir of dirs) {
      let at = dir
      chain.add(at)
      while (at !== '') {
        at = dirname(at)
        chain.add(at)
      }
    }
    active = { files, dirs, path: chain }
    currentActivePath = chain
    return true
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
  }

  function sync(state) {
    flashes.clear()
    planKey = ''
    recompute(state)
  }

  function visibleLinks() {
    const links = []
    for (const card of cards.values()) {
      if (card.path === '') continue
      const parent = nearestCard(dirname(card.path))
      if (parent) links.push({ from: parent.path, to: card.path })
    }
    return links
  }

  function spheres() {
    return [...cards.values()].map((card) => ({ x: card.home.x, y: card.home.y, z: card.home.z, r: cardRadius(card.view) }))
  }

  function update(state, delta, camera) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    back.set(0, 0, 1).applyQuaternion(camera.quaternion)
    const changed = recompute(state)
    const now = performance.now()
    const ease = 1 - Math.exp(-delta * 3)
    movingNow = false
    for (const card of cards.values()) {
      const position = card.object.position
      if (position.distanceToSquared(card.home) > 0.25) {
        position.lerp(card.home, ease)
        movingNow = true
      } else {
        position.copy(card.home)
      }
      const view = card.view
      const goal = CARD_SCALES[view.state] ?? 1
      if (Math.abs(card.scale - goal) > 0.002) {
        card.scale += (goal - card.scale) * ease
        movingNow = true
      } else {
        card.scale = goal
      }
      card.object.scale.setScalar(card.scale)
      card.object.quaternion.copy(camera.quaternion)
      card.occluder.position.copy(position)
      card.occluder.quaternion.copy(camera.quaternion)
      card.occluder.scale.set(CARD_W * card.scale, cardHeight(cardRows(view)) * card.scale, 1)
      const flashing = flashes.get(card.path)
      const tone = flashing && flashing.until > now ? flashing.tone : null
      const failedName = flashing?.text || (card.path === '' ? rootName : basename(card.path))
      const failedText = tone === 'red' ? `FAILED ${failedName}` : ''
      if (failedText) {
        if (card.band.textContent !== failedText) card.band.textContent = failedText
        if (!card.band.classList.contains('is-failed')) card.band.classList.add('is-failed')
      } else {
        if (card.band.textContent !== '') card.band.textContent = ''
        if (card.band.classList.contains('is-failed')) card.band.classList.remove('is-failed')
      }
      const classes = ['mr-card', `is-${view.state}`]
      if (active.dirs.has(card.path)) classes.push('is-active')
      else if (active.path.has(card.path)) classes.push('is-path')
      if (pinned.has(card.path)) classes.push('is-pinned')
      if (tone) classes.push(`is-flash-${tone}`)
      const className = classes.join(' ')
      if (card.element.className !== className) card.element.className = className
      for (const entry of card.rows) {
        const path = entry.item.path
        const file = state.files.get(path)
        const hit = flashes.get(path)
        const rowTone = hit && hit.until > now ? hit.tone : null
        const mark = entry.item.kind === 'file' ? rowMark(file) : ''
        const rowClasses = ['mr-item', `is-${entry.item.kind}`]
        if (mark) rowClasses.push(`is-${mark}`)
        if (active.files.has(path) || active.dirs.has(path)) rowClasses.push('is-active')
        if (rowTone) rowClasses.push(`is-flash-${rowTone}`)
        if (inspected === path) rowClasses.push('is-inspected')
        const rowClass = rowClasses.join(' ')
        if (entry.row.className !== rowClass) entry.row.className = rowClass
        const note = entry.item.kind === 'file' ? rowNote(file) : ''
        const short = note === 'not touched' ? '' : note.replace('written', 'w').replace('read', 'r')
        if (entry.note.textContent !== short) entry.note.textContent = short
        const detail = inspected === path ? `${path}  ${note}` : ''
        if (entry.detail.textContent !== detail) entry.detail.textContent = detail
      }
    }
    for (const [path, hit] of flashes) if (hit.until <= now) flashes.delete(path)
    return changed
  }

  function dispose() {
    for (const card of [...cards.values()]) removeCard(card)
    plane.dispose()
    hider.dispose()
    currentActivePath.clear()
  }

  function pin(path) {
    if (!pinned.has(path)) {
      pinned.add(path)
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
    flashCluster: (path, tone) => flash(path, tone === 'red' ? 'red' : 'white', basename(path)),
    sync,
    update,
    visibleLinks,
    spheres,
    dispose,
    moving: () => movingNow,
    vectors: () => ({ right, up, back }),
  }
}
