import { ancestors, basename, dirname } from '../model/paths.js'

export const BASE_RADIUS = 1000
export const RING_STEP = 750
export const PLANE_W = 100
export const PLANE_H = 64
export const CELL_W = 124
export const CELL_H = 88
export const MAX_COLS = 5
export const DENSE_FILES = 20
export const DENSE_COLS = 14
export const MIN_CELL_SCALE = 0.4
export const MARGIN = 260
const TAU = Math.PI * 2
const FRONT = Math.PI / 2
const BACK = (Math.PI * 3) / 2
const BACK_GAP = 1.1

export function treeFromState(state, rootName) {
  return {
    rootName,
    files: [...state.files.keys()].sort(),
    dirs: [...state.dirs.keys()].sort(),
    created: [],
  }
}

function grid(count) {
  if (count <= DENSE_FILES) {
    const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))))
    return { cols, rows: Math.max(1, Math.ceil(count / cols)), scale: 1 }
  }
  const cols = Math.min(DENSE_COLS, Math.ceil(Math.sqrt(count * 1.6)))
  return { cols, rows: Math.ceil(count / cols), scale: Math.max(MIN_CELL_SCALE, Math.sqrt(DENSE_FILES / count)) }
}

export function layoutTree(tree) {
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
  }

  const weights = new Map()
  function weigh(path) {
    const node = nodes.get(path)
    const weight = Math.max(1, node.files.length) + node.children.reduce((sum, child) => sum + weigh(child), 0)
    weights.set(path, weight)
    return weight
  }
  weigh('')

  const maxDiameter = new Map()
  for (const node of nodes.values()) {
    maxDiameter.set(node.depth, Math.max(maxDiameter.get(node.depth) ?? 0, node.diameter))
  }
  const depths = [...maxDiameter.keys()].sort((a, b) => a - b)
  const baseRadius = new Map([[0, BASE_RADIUS]])
  for (const depth of depths.filter((value) => value > 0)) {
    const before = baseRadius.get(depth - 1) ?? BASE_RADIUS
    const gap = Math.max(RING_STEP, ((maxDiameter.get(depth - 1) ?? 0) + maxDiameter.get(depth)) / 2)
    baseRadius.set(depth, before + gap)
  }

  const demand = new Map()
  function measure(path) {
    const node = nodes.get(path)
    const children = node.children.reduce((sum, child) => sum + measure(child), 0)
    const own = node.diameter / baseRadius.get(node.depth)
    const need = node.depth === 0 ? children : Math.max(own, children)
    demand.set(path, need)
    return need
  }
  measure('')

  const root = nodes.get('')
  const span = TAU - BACK_GAP
  const stretch = Math.max(1, demand.get('') / span)

  function place(path, start, end) {
    const node = nodes.get(path)
    node.angle = (start + end) / 2
    node.radius = path === '' ? BASE_RADIUS : baseRadius.get(node.depth) * stretch
    const room = end - start
    const needs = node.children.map((child) => demand.get(child) / stretch)
    const spare = Math.max(0, room - needs.reduce((sum, value) => sum + value, 0))
    const total = node.children.reduce((sum, child) => sum + weights.get(child), 0)
    let cursor = start
    node.children.forEach((child, index) => {
      const share = needs[index] + (spare * weights.get(child)) / total
      place(child, cursor, cursor + share)
      cursor += share
    })
  }
  place('', BACK + BACK_GAP / 2, BACK + BACK_GAP / 2 + span)
  root.angle = FRONT
  root.radius = BASE_RADIUS

  const list = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))
  let extent = 0
  for (const node of list) {
    node.x = Math.cos(node.angle) * node.radius
    node.z = Math.sin(node.angle) * node.radius
    node.slots = node.files.map((file, index) => {
      const col = index % node.cols
      const row = Math.floor(index / node.cols)
      return {
        file,
        x: (col - (node.cols - 1) / 2) * CELL_W * node.cellScale,
        z: (row - (node.rows - 1) / 2) * CELL_H * node.cellScale,
      }
    })
    extent = Math.max(extent, node.radius + node.diameter / 2)
  }

  const links = []
  for (const node of list) for (const child of node.children) links.push({ from: node.path, to: child })

  return { nodes: list, byPath: nodes, links, extent }
}
