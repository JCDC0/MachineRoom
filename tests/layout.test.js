import { describe, expect, it } from 'vitest'
import {
  BASE_RADIUS,
  CORE_CLEAR,
  MIN_CELL_SCALE,
  Y_HIGH,
  Y_LOW,
  layoutTree,
  positionsOf,
} from '../src/engine/layout.js'
import { makeTree } from '../src/model/paths.js'

const tree = makeTree({
  root: 'demo',
  files: ['README.md', 'package.json', 'src/a.js', 'src/b.js', 'src/ui/c.js', 'docs/x.md', 'test/t.js'],
  created: [],
})

function bigTree(extra = []) {
  const files = ['README.md', 'package.json', ...extra]
  for (let a = 0; a < 14; a++) {
    for (let f = 0; f < 3 + (a % 6); f++) files.push(`pkg${String(a).padStart(2, '0')}/f${f}.js`)
    for (let b = 0; b < 1 + (a % 4); b++) {
      for (let f = 0; f < 2 + b; f++) files.push(`pkg${String(a).padStart(2, '0')}/sub${b}/g${f}.js`)
    }
  }
  for (let f = 0; f < 90; f++) files.push(`assets/img${String(f).padStart(3, '0')}.png`)
  return makeTree({ root: 'big', files, created: [] })
}

function spaced(nodes) {
  const places = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const gap = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y, nodes[i].z - nodes[j].z)
      places.push({ pair: `${nodes[i].path || 'root'} and ${nodes[j].path || 'root'}`, gap, needed: nodes[i].r + nodes[j].r })
    }
  }
  return places
}

const rounded = (layout) => layout.nodes.map((n) => [n.path, Math.round(n.x), Math.round(n.y), Math.round(n.z)])

describe('layoutTree', () => {
  it('is the same every time', () => {
    expect(rounded(layoutTree(tree))).toEqual(rounded(layoutTree(tree)))
  })

  it('holds the root in front of the core', () => {
    const root = layoutTree(tree).byPath.get('')
    expect(root.x).toBe(0)
    expect(root.y).toBe(0)
    expect(root.z).toBe(BASE_RADIUS)
  })

  it('keeps every folder apart from the others', () => {
    for (const { pair, gap, needed } of spaced(layoutTree(tree).nodes)) {
      expect(gap, pair).toBeGreaterThanOrEqual(needed * 0.99)
    }
  })

  it('gives every file one slot in its own folder', () => {
    const slots = layoutTree(tree).nodes.flatMap((n) => n.slots.map((s) => s.file)).sort()
    expect(slots).toEqual([...tree.files].sort())
  })

  it('links each folder to its parent', () => {
    const { links } = layoutTree(tree)
    expect(links).toContainEqual({ from: 'src', to: 'src/ui' })
    expect(links).toContainEqual({ from: '', to: 'docs' })
  })

  it('puts a folder further from the core than its parent when it is deeper', () => {
    const layout = layoutTree(tree)
    expect(layout.byPath.get('src/ui').radius).toBeGreaterThan(layout.byPath.get('src').radius)
  })
})

describe('layoutTree with a large project', () => {
  const layout = layoutTree(bigTree())

  it('never lets two folders overlap in space', () => {
    for (const { pair, gap, needed } of spaced(layout.nodes)) {
      expect(gap, pair).toBeGreaterThanOrEqual(needed * 0.99)
    }
  })

  it('spreads the folders through space, not on one plane', () => {
    const levels = new Set(layout.nodes.map((n) => Math.round(n.y / 150)))
    expect(levels.size).toBeGreaterThanOrEqual(4)
  })

  it('surrounds the core instead of sitting on one side', () => {
    const sides = new Set(layout.nodes.map((n) => `${Math.sign(Math.round(n.x))}${Math.sign(Math.round(n.z))}`))
    expect(sides.size).toBeGreaterThanOrEqual(4)
  })

  it('keeps folders out of the core and inside the height limits', () => {
    for (const node of layout.nodes) {
      expect(node.y).toBeGreaterThanOrEqual(Y_LOW)
      expect(node.y).toBeLessThanOrEqual(Y_HIGH)
      if (node.path !== '') expect(node.radius, node.path).toBeGreaterThanOrEqual(CORE_CLEAR - 1)
    }
  })

  it('packs a folder with many files into a compact grid of smaller tiles', () => {
    const assets = layout.byPath.get('assets')
    expect(assets.cols).toBeGreaterThan(5)
    expect(assets.cellScale).toBeLessThan(1)
    expect(assets.cellScale).toBeGreaterThanOrEqual(MIN_CELL_SCALE)
    expect(assets.width).toBeLessThan(1500)
    expect(assets.slots).toHaveLength(90)
  })

  it('reports how far the room reaches', () => {
    const farthest = Math.max(...layout.nodes.map((n) => n.radius))
    expect(layout.extent).toBeGreaterThan(farthest)
  })

  it('reports a bounding sphere that holds every folder and the core stage', () => {
    const { center, radius } = layout.bounds
    const away = (x, y, z) => Math.hypot(x - center.x, y - center.y, z - center.z)
    for (const node of layout.nodes) expect(away(node.x, node.y, node.z) + node.r, node.path).toBeLessThanOrEqual(radius + 1)
    expect(away(0, 0, 0)).toBeLessThan(radius)
    expect(away(0, 1250, 0)).toBeLessThan(radius)
  })

  it('is the same every time', () => {
    expect(rounded(layoutTree(bigTree()))).toEqual(rounded(layout))
  })

  it('lays out a few hundred folders quickly', () => {
    const files = []
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) files.push(`d${a}/e${b}/f.js`)
    const started = performance.now()
    const wide = layoutTree(makeTree({ root: 'wide', files, created: [] }))
    expect(wide.nodes.length).toBe(421)
    expect(performance.now() - started).toBeLessThan(4000)
  })
})

describe('layoutTree when the project grows', () => {
  it('keeps the folders it already placed close to where they were', () => {
    const before = layoutTree(bigTree())
    const after = layoutTree(bigTree(['newpkg/one.js', 'newpkg/two.js', 'newpkg/deep/three.js']), positionsOf(before))
    let moved = 0
    for (const node of before.nodes) {
      const next = after.byPath.get(node.path)
      moved = Math.max(moved, Math.hypot(next.x - node.x, next.y - node.y, next.z - node.z))
    }
    expect(moved).toBeLessThan(500)
    expect(after.byPath.has('newpkg/deep')).toBe(true)
  })

  it('still keeps every folder apart after growing', () => {
    const before = layoutTree(bigTree())
    const after = layoutTree(bigTree(['newpkg/one.js', 'newpkg/deep/three.js']), positionsOf(before))
    for (const { pair, gap, needed } of spaced(after.nodes)) {
      expect(gap, pair).toBeGreaterThanOrEqual(needed * 0.99)
    }
  })
})
