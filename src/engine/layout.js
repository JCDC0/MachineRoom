import { ancestors, basename, dirname } from '../model/paths.js'

export const BASE_RADIUS = 1000
export const RING_STEP = 750
export const PLANE_W = 100
export const PLANE_H = 64
export const CELL_W = 124
export const CELL_H = 88
export const MAX_COLS = 5
const TAU = Math.PI * 2
const FRONT = Math.PI / 2
const BACK = (Math.PI * 3) / 2
const BACK_GAP = 1.1

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
      const node = make(dir)
      if (index > 0) {
        const parent = make(chain[index - 1])
        if (!parent.children.includes(dir)) parent.children.push(dir)
      }
      return node
    })
    make(dirname(file)).files.push(file)
  }

  for (const node of nodes.values()) {
    node.files.sort()
    node.children.sort()
  }

  const weights = new Map()
  function weigh(path) {
    const node = nodes.get(path)
    const weight = Math.max(1, node.files.length) + node.children.reduce((sum, child) => sum + weigh(child), 0)
    weights.set(path, weight)
    return weight
  }
  weigh('')

  function place(path, start, end) {
    const node = nodes.get(path)
    node.angle = (start + end) / 2
    node.radius = BASE_RADIUS + node.depth * RING_STEP
    const span = end - start
    const total = node.children.reduce((sum, child) => sum + weights.get(child), 0)
    let cursor = start
    for (const child of node.children) {
      const share = (weights.get(child) / total) * span
      place(child, cursor, cursor + share)
      cursor += share
    }
  }

  const root = nodes.get('')
  const first = BACK + BACK_GAP / 2
  const rootTotal = root.children.reduce((sum, child) => sum + weights.get(child), 0)
  let cursor = first
  for (const child of root.children) {
    const share = (weights.get(child) / rootTotal) * (TAU - BACK_GAP)
    place(child, cursor, cursor + share)
    cursor += share
  }
  root.angle = FRONT
  root.radius = BASE_RADIUS

  const list = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))
  for (const node of list) {
    node.x = Math.cos(node.angle) * node.radius
    node.z = Math.sin(node.angle) * node.radius
    const count = node.files.length
    node.cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))))
    node.rows = Math.max(1, Math.ceil(count / node.cols))
    node.slots = node.files.map((file, index) => {
      const col = index % node.cols
      const row = Math.floor(index / node.cols)
      return {
        file,
        x: (col - (node.cols - 1) / 2) * CELL_W,
        z: (row - (node.rows - 1) / 2) * CELL_H,
      }
    })
  }

  const links = []
  for (const node of list) for (const child of node.children) links.push({ from: node.path, to: child })

  return { nodes: list, byPath: nodes, links }
}
