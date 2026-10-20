import { ancestors, basename, dirname } from '../model/paths.js'

export const BASE_RADIUS = 1000
export const SHELL_RADIUS = 1700
export const CORE_CLEAR = 900
export const GAP = 380
export const LEVEL_STEP = 320
export const Y_LOW = -1500
export const Y_HIGH = 700
export const PLANE_W = 100
export const PLANE_H = 64
export const CELL_W = 124
export const CELL_H = 88
export const MAX_COLS = 5
export const DENSE_FILES = 20
export const DENSE_COLS = 14
export const MIN_CELL_SCALE = 0.4
export const MARGIN = 260
export const STAGE = { min: { x: -1100, y: -200, z: -1100 }, max: { x: 1100, y: 800, z: 1100 } }

const TAU = Math.PI * 2
const BACK = (Math.PI * 3) / 2
const BACK_GAP = 1.1
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const LEVELS = [0, 1, -1]
const FRESH = 1
const SETTLED = 0.12

const norm = (v) => {
  const length = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

export function treeFromState(state, rootName) {
  return {
    rootName,
    files: [...state.files.keys()].sort(),
    dirs: [...state.dirs.keys()].sort(),
    created: [],
  }
}

export function positionsOf(layout) {
  return new Map(layout.nodes.map((node) => [node.path, { x: node.x, y: node.y, z: node.z }]))
}

function grid(count) {
  if (count <= DENSE_FILES) {
    const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))))
    return { cols, rows: Math.max(1, Math.ceil(count / cols)), scale: 1 }
  }
  const cols = Math.min(DENSE_COLS, Math.ceil(Math.sqrt(count * 1.6)))
  return { cols, rows: Math.ceil(count / cols), scale: Math.max(MIN_CELL_SCALE, Math.sqrt(DENSE_FILES / count)) }
}

function fan(outward, k, m) {
  if (m <= 1 || k === 0) return outward
  const half = Math.min(1.3, 0.45 + 0.16 * m)
  const spread = half * Math.sqrt(k / (m - 1))
  const up = Math.abs(outward.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const first = norm(cross(up, outward))
  const second = cross(outward, first)
  const phi = k * GOLDEN
  const around = Math.sin(spread)
  return norm({
    x: outward.x * Math.cos(spread) + (first.x * Math.cos(phi) + second.x * Math.sin(phi)) * around,
    y: outward.y * Math.cos(spread) + (first.y * Math.cos(phi) + second.y * Math.sin(phi)) * around,
    z: outward.z * Math.cos(spread) + (first.z * Math.cos(phi) + second.z * Math.sin(phi)) * around,
  })
}

function relax(list, pos, parents, mobility, iterations) {
  const n = list.length
  const settleFrom = Math.floor(iterations * 0.6)
  const limit = iterations + Math.max(0, Math.min(300, Math.floor(2400000 / (n * n + 1))))

  for (let pass = 0; pass < limit; pass += 1) {
    const settling = pass >= settleFrom
    let worst = 0
    for (let i = 0; i < n; i += 1) {
      const a = list[i]
      const pa = pos.get(a.path)
      for (let j = i + 1; j < n; j += 1) {
        const b = list[j]
        const pb = pos.get(b.path)
        let dx = pb.x - pa.x
        let dy = pb.y - pa.y
        let dz = pb.z - pa.z
        let dist = Math.hypot(dx, dy, dz)
        const wanted = (a.r + b.r) * (settling ? 1.01 : 1.1)
        if (dist >= wanted) continue
        if (dist < 1e-6) {
          const angle = (i + 1) * GOLDEN
          dx = Math.cos(angle)
          dy = 0.3
          dz = Math.sin(angle)
          dist = Math.hypot(dx, dy, dz)
        }
        const wa = mobility.get(a.path)
        const wb = mobility.get(b.path)
        if (wa + wb === 0) continue
        const push = wanted - dist
        worst = Math.max(worst, push)
        const ux = dx / dist
        const uy = dy / dist
        const uz = dz / dist
        const shareA = (push * wa) / (wa + wb)
        const shareB = (push * wb) / (wa + wb)
        pa.x -= ux * shareA
        pa.y -= uy * shareA
        pa.z -= uz * shareA
        pb.x += ux * shareB
        pb.y += uy * shareB
        pb.z += uz * shareB
      }
    }

    if (!settling) {
      for (const node of list) {
        const parent = parents.get(node.path)
        const weight = mobility.get(node.path)
        if (!parent || weight === 0) continue
        const pc = pos.get(node.path)
        const pp = pos.get(parent.path)
        const dx = pc.x - pp.x
        const dy = pc.y - pp.y
        const dz = pc.z - pp.z
        const dist = Math.hypot(dx, dy, dz) || 1
        const longest = (node.r + parent.r + GAP) * 1.9 + 300
        if (dist > longest) {
          const pull = ((dist - longest) * 0.2 * weight) / dist
          pc.x -= dx * pull
          pc.y -= dy * pull
          pc.z -= dz * pull
        }
      }
    }

    for (const node of list) {
      const weight = mobility.get(node.path)
      if (weight === 0) continue
      const p = pos.get(node.path)
      const reach = Math.hypot(p.x, p.y, p.z) || 1
      const clear = CORE_CLEAR + node.r * 0.5
      if (reach < clear) {
        const out = (clear - reach) / reach
        p.x += p.x * out
        p.y += p.y * out
        p.z += p.z * out
        worst = Math.max(worst, clear - reach)
      }
      p.y = clamp(p.y, Y_LOW, Y_HIGH)
    }

    if (settling && worst < 0.5) break
  }
}

export const CARD_HUB = { hw: 900, hh: 320 }
export const CARD_GAP = 70
export const CARD_ROW = 520
export const CARD_V = { low: -1400, high: 1600 }
export const CARD_DEPTH = { root: -320, step: 260, max: 460 }
const CARD_PASSES = 260

export function cardDepth(path) {
  const level = path === '' ? 0 : path.split('/').length
  return Math.min(CARD_DEPTH.max, CARD_DEPTH.root + level * CARD_DEPTH.step)
}

function overlap(a, pa, b, pb) {
  const ox = a.hw + b.hw - Math.abs(pb.x - pa.x)
  const oy = a.hh + b.hh - Math.abs(pb.y - pa.y)
  return ox > 0 && oy > 0 ? { ox, oy } : null
}

function relaxCards(list, pos, parents, mobility) {
  const hub = { hw: CARD_HUB.hw, hh: CARD_HUB.hh }
  const centre = { x: 0, y: 0 }
  for (let pass = 0; pass < CARD_PASSES; pass += 1) {
    let worst = 0
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]
      const pa = pos.get(a.path)
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]
        const pb = pos.get(b.path)
        const hit = overlap(a, pa, b, pb)
        if (!hit) continue
        const wa = mobility.get(a.path)
        const wb = mobility.get(b.path)
        if (wa + wb === 0) continue
        worst = Math.max(worst, Math.min(hit.ox, hit.oy))
        const alongX = hit.ox < hit.oy
        const push = (alongX ? hit.ox : hit.oy) + 1
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
    if (pass > CARD_PASSES * 0.6 && worst < 0.5) break
  }
}

export function layoutCards(entries, previous = null) {
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

  relaxCards(list, pos, parents, mobility)
  return new Map(
    list.map((node) => {
      const p = pos.get(node.path)
      return [node.path, { x: p.x, y: p.y, z: cardDepth(node.path) }]
    })
  )
}

export function layoutTree(tree, previous = null) {
  const nodes = new Map()

  function make(path) {
    if (!nodes.has(path)) {
      nodes.set(path, {
        path,
        name: path === '' ? tree.rootName : basename(path),
        depth: path === '' ? 0 : path.split('/').length,
        files: [],
        children: [],
      })
    }
    return nodes.get(path)
  }

  make('')
  for (const file of tree.files) {
    const chain = ancestors(file)
    chain.forEach((dir, index) => {
      make(dir)
      if (index > 0) {
        const parent = make(chain[index - 1])
        if (!parent.children.includes(dir)) parent.children.push(dir)
      }
    })
    make(dirname(file)).files.push(file)
  }

  for (const node of nodes.values()) {
    node.files.sort()
    node.children.sort()
    const { cols, rows, scale } = grid(node.files.length)
    node.cols = cols
    node.rows = rows
    node.cellScale = scale
    node.width = cols * CELL_W * scale
    node.depthSize = rows * CELL_H * scale
    node.diameter = Math.hypot(node.width, node.depthSize) + MARGIN
    node.r = node.diameter / 2
  }

  const weights = new Map()
  function weigh(path) {
    const node = nodes.get(path)
    const weight = Math.max(1, node.files.length) + node.children.reduce((sum, child) => sum + weigh(child), 0)
    weights.set(path, weight)
    return weight
  }
  weigh('')

  const list = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))
  const parents = new Map()
  for (const node of list) for (const child of node.children) parents.set(child, node)

  const pos = new Map()
  const mobility = new Map()
  const known = (path) => previous?.get(path)
  const root = nodes.get('')

  pos.set('', { x: 0, y: 0, z: BASE_RADIUS })
  mobility.set('', 0)

  const top = root.children
  const share = (path) => Math.max(nodes.get(path).diameter, 380 * Math.sqrt(weights.get(path)))
  const totalShare = top.reduce((sum, path) => sum + share(path), 0) || 1
  const span = TAU - BACK_GAP
  const shell = Math.max(SHELL_RADIUS, (totalShare * 1.15) / span)
  let cursor = 0
  top.forEach((path, index) => {
    const slice = share(path)
    const angle = BACK + BACK_GAP / 2 + ((cursor + slice / 2) / totalShare) * span
    cursor += slice
    const before = known(path)
    pos.set(
      path,
      before
        ? { ...before }
        : { x: Math.cos(angle) * shell, y: LEVELS[index % LEVELS.length] * LEVEL_STEP, z: Math.sin(angle) * shell }
    )
    mobility.set(path, before ? SETTLED : FRESH)
  })

  const queue = [...top]
  while (queue.length > 0) {
    const path = queue.shift()
    const node = nodes.get(path)
    const here = pos.get(path)
    const outward = norm({ x: here.x, y: here.y * 0.3, z: here.z })
    node.children.forEach((childPath, index) => {
      queue.push(childPath)
      const before = known(childPath)
      if (before) {
        pos.set(childPath, { ...before })
        mobility.set(childPath, SETTLED)
        return
      }
      const child = nodes.get(childPath)
      const direction = fan(outward, index, node.children.length)
      const distance = node.r + child.r + GAP + 140 * Math.sqrt(weights.get(childPath))
      pos.set(childPath, {
        x: here.x + direction.x * distance,
        y: clamp(here.y + direction.y * distance, Y_LOW, Y_HIGH),
        z: here.z + direction.z * distance,
      })
      mobility.set(childPath, FRESH)
    })
  }

  const iterations = list.length <= 120 ? 140 : Math.max(24, Math.floor((140 * 120 * 120) / (list.length * list.length)))
  relax(list, pos, parents, mobility, iterations)

  let extent = 0
  const low = { ...STAGE.min }
  const high = { ...STAGE.max }
  for (const node of list) {
    const p = pos.get(node.path)
    node.x = p.x
    node.y = p.y
    node.z = p.z
    node.radius = Math.hypot(p.x, p.y, p.z)
    node.angle = Math.atan2(p.z, p.x)
    node.slots = node.files.map((file, index) => {
      const col = index % node.cols
      const row = Math.floor(index / node.cols)
      return {
        file,
        x: (col - (node.cols - 1) / 2) * CELL_W * node.cellScale,
        z: (row - (node.rows - 1) / 2) * CELL_H * node.cellScale,
      }
    })
    extent = Math.max(extent, node.radius + node.r)
    low.x = Math.min(low.x, p.x - node.r)
    low.y = Math.min(low.y, p.y - 200)
    low.z = Math.min(low.z, p.z - node.r)
    high.x = Math.max(high.x, p.x + node.r)
    high.y = Math.max(high.y, p.y + 300)
    high.z = Math.max(high.z, p.z + node.r)
  }
  const bounds = {
    center: { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2, z: (low.z + high.z) / 2 },
    radius: Math.hypot(high.x - low.x, high.y - low.y, high.z - low.z) / 2,
  }

  const links = []
  for (const node of list) for (const child of node.children) links.push({ from: node.path, to: child })

  return { nodes: list, byPath: nodes, links, extent, bounds }
}
