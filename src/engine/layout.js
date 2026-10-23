import { dirname } from '../model/paths.js'

const FRESH = 1
const SETTLED = 0.12

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

export function treeFromState(state, rootName) {
  return {
    rootName,
    files: [...state.files.keys()].sort(),
    dirs: [...state.dirs.keys()].sort(),
    created: [],
  }
}

export const CARD_HUB = { hw: 900, hh: 320 }
export const CARD_GAP = 70
export const CARD_ROW = 520
export const CARD_V = { low: -1400, high: 1600 }
export const CARD_DEPTH = { root: -320, step: 260, max: 460 }
const CARD_PASSES = 260
const CARD_REPAIR_PASSES = 240
const CARD_SPLIT = 0.25
const CARD_ROOM = 0.6

export function cardDepth(path) {
  const level = path === '' ? 0 : path.split('/').length
  return Math.min(CARD_DEPTH.max, CARD_DEPTH.root + level * CARD_DEPTH.step)
}

function overlap(a, pa, b, pb) {
  const ox = a.hw + b.hw - Math.abs(pb.x - pa.x)
  const oy = a.hh + b.hh - Math.abs(pb.y - pa.y)
  return ox > 0 && oy > 0 ? { ox, oy } : null
}

function crosses(a, b) {
  const ox = a.hw + b.hw - Math.abs(b.x - a.x)
  const oy = a.hh + b.hh - Math.abs(b.y - a.y)
  return ox > 1 && oy > 1 ? Math.min(ox, oy) : 0
}

export function cardOverlaps(entries, placed, obstacles = []) {
  const boxes = []
  for (const entry of entries) {
    const at = placed.get(entry.path)
    if (!at) continue
    boxes.push({ path: entry.path, x: at.x, y: at.y, hw: entry.width / 2, hh: entry.height / 2 })
  }
  const out = []
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i]
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j]
      const cross = crosses(a, b)
      if (cross) out.push({ a: a.path, b: b.path, kind: 'card', overlap: cross })
    }
  }
  const blockers = [{ x: 0, y: 0, hw: CARD_HUB.hw, hh: CARD_HUB.hh, kind: 'hub' }]
  obstacles.forEach((box, index) => blockers.push({ ...box, kind: 'obstacle', index }))
  for (const a of boxes) {
    for (const blocker of blockers) {
      const cross = crosses(a, blocker)
      if (!cross) continue
      if (blocker.kind === 'hub') out.push({ a: a.path, b: null, kind: 'hub', overlap: cross })
      else out.push({ a: a.path, b: null, kind: 'obstacle', index: blocker.index, overlap: cross })
    }
  }
  return out
}

function nearestFreeY(node, x, atY, list, pos, skip, obstacles) {
  const spans = []
  const consider = (hw, hh, boxX, boxY) => {
    if (Math.abs(boxX - x) >= hw + node.hw) return
    spans.push([boxY - hh - node.hh - 1, boxY + hh + node.hh + 1])
  }
  for (const other of list) {
    if (other.path === skip) continue
    const p = pos.get(other.path)
    consider(other.hw, other.hh, p.x, p.y)
  }
  consider(CARD_HUB.hw, CARD_HUB.hh, 0, 0)
  for (const box of obstacles) consider(box.hw, box.hh, box.x, box.y)
  spans.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([span[0], span[1]])
  }
  let low = atY
  let high = atY
  for (const [start, end] of merged) {
    if (atY < start) {
      high = Math.min(high, start)
      break
    }
    if (atY <= end) {
      low = start
      high = end
      break
    }
  }
  if (low === atY && high === atY) return atY
  const below = low - 1
  const above = high + 1
  return atY - below <= above - atY ? below : above
}

function placeNearestFree(node, list, pos, parents, obstacles) {
  const at = pos.get(node.path)
  const parent = parents.get(node.path)
  const parentAt = parent ? pos.get(parent.path) : { x: 0, y: 0 }
  const side = Math.sign(parentAt.x) || Math.sign(at.x) || 1
  const minAbs = Math.abs(parentAt.x) + 1
  const columns = new Set()
  const add = (abs) => {
    if (abs > minAbs) columns.add(Math.round(abs * 1000) / 1000)
  }
  add(Math.abs(at.x))
  add(Math.abs(parentAt.x) + parent.hw + node.hw)
  let outer = 0
  const edges = []
  for (const other of list) {
    if (other.path === node.path) continue
    const p = pos.get(other.path)
    if (Math.sign(p.x) !== side) continue
    const edge = Math.abs(p.x) + other.hw
    edges.push(edge)
    outer = Math.max(outer, edge)
  }
  edges.sort((a, b) => a - b)
  let cluster = null
  for (const edge of edges) {
    if (cluster !== null && edge - cluster > 160) {
      add(cluster + node.hw)
      cluster = edge
    } else {
      cluster = cluster === null ? edge : Math.max(cluster, edge)
    }
  }
  if (cluster !== null) add(cluster + node.hw)
  add(outer + node.hw + 1)

  const ordered = [...columns].sort((a, b) => Math.abs(a - Math.abs(at.x)) - Math.abs(b - Math.abs(at.x)))
  let best = null
  for (const abs of ordered) {
    const x = side * abs
    if (best && Math.abs(x - at.x) >= best.distance) break
    const y = nearestFreeY(node, x, at.y, list, pos, node.path, obstacles)
    const distance = Math.hypot(x - at.x, y - at.y)
    if (!best || distance < best.distance) best = { x, y, distance }
  }
  return best
}

function applyPlace(node, pos, place) {
  if (!place) return false
  const at = pos.get(node.path)
  at.x = place.x
  at.y = place.y
  return true
}

function repairCards(list, pos, parents, obstacles) {
  const exact = list.map((node) => ({ path: node.path, width: node.hw * 2 - CARD_GAP, height: node.hh * 2 - CARD_GAP }))
  const byPath = new Map(list.map((node) => [node.path, node]))
  const parentOf = (node) => parents.get(node.path)
  for (let round = 0; round < CARD_REPAIR_PASSES; round += 1) {
    const found = cardOverlaps(exact, pos, obstacles)
    if (found.length === 0) break
    let movedNow = 0
    for (const hit of found) {
      const first = hit.a === '' ? null : byPath.get(hit.a)
      const second = hit.b === '' ? null : byPath.get(hit.b)
      if (!first || !second) {
        const node = first ?? second
        if (!node) continue
        applyPlace(node, pos, placeNearestFree(node, list, pos, parents, obstacles))
        movedNow += 1
        continue
      }
      const pa = pos.get(first.path)
      const pb = pos.get(second.path)
      const ox = first.hw + second.hw - Math.abs(pb.x - pa.x)
      const oy = first.hh + second.hh - Math.abs(pb.y - pa.y)
      if (oy <= ox) {
        const lower = pa.y <= pb.y ? first : second
        const upper = lower === first ? second : first
        pos.get(lower.path).y -= oy * (1 - CARD_SPLIT) + 0.5
        pos.get(upper.path).y += oy * CARD_SPLIT + 0.5
        movedNow += 1
      } else {
        const outer = Math.abs(pa.x) > Math.abs(pb.x) ? first : second
        const inner = outer === first ? second : first
        const sign = Math.sign(pos.get(outer.path).x) || 1
        const parent = parentOf(inner)
        const parentX = parent ? pos.get(parent.path).x : 0
        const probe = pos.get(inner.path).x - sign * (ox * CARD_ROOM + 0.5)
        const stays = parent ? Math.abs(probe) > Math.abs(parentX) && (parent.path !== '' || Math.sign(probe) === sign) : false
        if (!stays) {
          pos.get(outer.path).x += sign * (ox + 1)
        } else {
          pos.get(inner.path).x -= sign * (ox * CARD_SPLIT + 0.5)
          pos.get(outer.path).x += sign * (ox * (1 - CARD_SPLIT) + 0.5)
        }
        movedNow += 1
      }
    }
    if (movedNow === 0) break
  }
  const left = cardOverlaps(exact, pos, obstacles)
  if (left.length === 0) return
  const selected = new Set()
  for (const hit of left) {
    if (hit.a !== '') selected.add(hit.a)
    if (hit.b && hit.b !== '') selected.add(hit.b)
  }
  for (const path of selected) {
    const node = byPath.get(path)
    applyPlace(node, pos, placeNearestFree(node, list, pos, parents, obstacles))
  }
}

function relaxCards(list, pos, parents, mobility, obstacles = [], isWarm = false) {
  const hub = { hw: CARD_HUB.hw, hh: CARD_HUB.hh }
  const centre = { x: 0, y: 0 }
  const points = list.map((node) => pos.get(node.path))
  const weights = list.map((node) => mobility.get(node.path))
  for (let pass = 0; pass < CARD_PASSES; pass += 1) {
    let worst = 0
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]
      const pa = points[i]
      const wa = weights[i]
      for (let j = i + 1; j < list.length; j += 1) {
        const pb = points[j]
        const b = list[j]
        const maxH = a.hh + b.hh
        const dy = Math.abs(pb.y - pa.y)
        if (dy >= maxH) continue
        const maxW = a.hw + b.hw
        const dx = Math.abs(pb.x - pa.x)
        if (dx >= maxW) continue
        const ox = maxW - dx
        const oy = maxH - dy
        const wb = weights[j]
        if (wa + wb === 0) continue
        worst = Math.max(worst, Math.min(ox, oy))
        const alongX = ox < oy
        const push = (alongX ? ox : oy) + 1
        const sign = alongX ? Math.sign(pb.x - pa.x) || (i % 2 ? 1 : -1) : Math.sign(pb.y - pa.y) || -1
        const shareA = (push * wa) / (wa + wb)
        const shareB = (push * wb) / (wa + wb)
        if (alongX) {
          pa.x -= sign * shareA
          pb.x += sign * shareB
        } else {
          pa.y -= sign * shareA
          pb.y += sign * shareB
        }
      }
    }
    for (const node of list) {
      const weight = mobility.get(node.path)
      if (weight === 0) continue
      const p = pos.get(node.path)
      const hit = overlap(hub, centre, node, p)
      if (hit) {
        worst = Math.max(worst, Math.min(hit.ox, hit.oy))
        if (hit.ox < hit.oy) p.x += (Math.sign(p.x) || 1) * (hit.ox + 1)
        else p.y += (Math.sign(p.y) || 1) * (hit.oy + 1)
      }
      for (const box of obstacles) {
        const blocked = overlap(box, { x: box.x, y: box.y }, node, p)
        if (!blocked) continue
        worst = Math.max(worst, Math.min(blocked.ox, blocked.oy))
        if (blocked.ox < blocked.oy) p.x += (Math.sign(p.x - box.x) || 1) * (blocked.ox + 1)
        else p.y += (Math.sign(p.y - box.y) || -1) * (blocked.oy + 1)
      }
      const parent = parents.get(node.path)
      if (parent && pass < CARD_PASSES * 0.6) {
        const pp = pos.get(parent.path)
        const longest = parent.hw + node.hw + CARD_GAP * 3
        const dy = p.y - pp.y
        if (Math.abs(dy) > CARD_ROW * 2) p.y -= dy * 0.05 * weight
        const dx = p.x - pp.x
        if (Math.abs(dx) > longest * 1.5) p.x -= dx * 0.05 * weight
      }
      p.y = clamp(p.y, CARD_V.low, CARD_V.high)
    }
    if (worst < 0.5 && (isWarm || pass > CARD_PASSES * 0.6)) break
  }
}

export function layoutCards(entries, previous = null, { obstacles = [] } = {}) {
  const list = [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, width, height }) => ({ path, hw: width / 2 + CARD_GAP / 2, hh: height / 2 + CARD_GAP / 2 }))
  const byPath = new Map(list.map((node) => [node.path, node]))
  if (!byPath.has('')) {
    const root = { path: '', hw: 220, hh: 80 }
    list.unshift(root)
    byPath.set('', root)
  }
  const parentOf = (path) => {
    let at = path
    while (at !== '') {
      at = dirname(at)
      if (byPath.has(at)) return at
    }
    return ''
  }
  const parents = new Map()
  const children = new Map(list.map((node) => [node.path, []]))
  for (const node of list) {
    if (node.path === '') continue
    const parent = parentOf(node.path)
    parents.set(node.path, byPath.get(parent))
    children.get(parent).push(node.path)
  }

  const pos = new Map()
  const mobility = new Map()
  const known = (path) => previous?.get(path)
  const root = byPath.get('')
  pos.set('', { x: 0, y: CARD_HUB.hh + root.hh, z: 0 })
  mobility.set('', 0)

  const place = (path, x, y) => {
    const before = known(path)
    if (before) {
      pos.set(path, { x: before.x, y: before.y, z: 0 })
      mobility.set(path, SETTLED)
    } else {
      pos.set(path, { x, y: clamp(y, CARD_V.low, CARD_V.high), z: 0 })
      mobility.set(path, FRESH)
    }
  }

  const top = children.get('')
  top.forEach((path, index) => {
    const node = byPath.get(path)
    const side = index % 2 === 0 ? 1 : -1
    const row = Math.floor(index / 2)
    place(path, side * (CARD_HUB.hw + node.hw), CARD_HUB.hh * 0.4 - row * CARD_ROW)
  })

  const queue = [...top]
  while (queue.length > 0) {
    const path = queue.shift()
    const here = pos.get(path)
    const parent = byPath.get(path)
    const side = Math.sign(here.x) || 1
    const kids = children.get(path)
    kids.forEach((childPath, index) => {
      queue.push(childPath)
      const node = byPath.get(childPath)
      place(childPath, here.x + side * (parent.hw + node.hw), here.y + ((kids.length - 1) / 2 - index) * CARD_ROW * 0.6)
    })
  }

  relaxCards(list, pos, parents, mobility, obstacles, previous !== null)
  repairCards(list, pos, parents, obstacles)
  return new Map(
    list.map((node) => {
      const p = pos.get(node.path)
      return [node.path, { x: p.x, y: p.y, z: cardDepth(node.path) }]
    })
  )
}
