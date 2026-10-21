import { describe, expect, it } from 'vitest'
import {
  BASE_RADIUS,
  CORE_CLEAR,
  MIN_CELL_SCALE,
  Y_HIGH,
  Y_LOW,
  CARD_DEPTH,
  CARD_HUB,
  cardDepth,
  layoutCards,
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

describe('layoutCards', () => {
  const entries = [
    { path: '', width: 450, height: 120 },
    { path: 'src', width: 650, height: 800 },
    { path: 'docs', width: 370, height: 100 },
    { path: 'test', width: 450, height: 120 },
    { path: 'src/ui', width: 370, height: 100 },
    { path: 'src/engine', width: 650, height: 500 },
    { path: 'src/model', width: 370, height: 100 },
  ]
  const size = new Map(entries.map((entry) => [entry.path, entry]))
  const boxes = (layout) =>
    [...layout].map(([path, p]) => ({ path, x: p.x, y: p.y, hw: size.get(path).width / 2, hh: size.get(path).height / 2 }))
  const clash = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh
  const places = (layout) => [...layout].map(([path, p]) => [path, Math.round(p.x), Math.round(p.y), p.z])

  it('is the same every time', () => {
    expect([...layoutCards(entries)]).toEqual([...layoutCards(entries)])
  })

  it('puts the root above the hub, in the middle', () => {
    const root = layoutCards(entries).get('')
    expect(root.x).toBe(0)
    expect(root.y).toBeGreaterThan(CARD_HUB.hh)
  })

  it('keeps cards apart from each other and from the hub', () => {
    const placed = boxes(layoutCards(entries))
    const hub = { x: 0, y: 0, hw: CARD_HUB.hw, hh: CARD_HUB.hh }
    for (let i = 0; i < placed.length; i++) {
      expect(clash(placed[i], hub), `${placed[i].path || 'root'} and the hub`).toBe(false)
      for (let j = i + 1; j < placed.length; j++) {
        expect(clash(placed[i], placed[j]), `${placed[i].path} and ${placed[j].path}`).toBe(false)
      }
    }
  })

  it('keeps every card clear of an obstacle box', () => {
    const obstacle = { x: 0, y: -500, hw: 900, hh: 400 }
    const placed = boxes(layoutCards(entries, null, { obstacles: [obstacle] }))
    for (const card of placed) {
      expect(clash(card, obstacle), `${card.path || 'root'} and the obstacle`).toBe(false)
    }
  })

  it('places the cards as before when no obstacles are given', () => {
    expect(places(layoutCards(entries))).toEqual([
      ['', 0, 415, CARD_DEPTH.root],
      ['docs', 1121, 128, -60],
      ['src', -1260, 128, -60],
      ['src/engine', -1981, 470, 200],
      ['src/model', -1840, 99, 200],
      ['src/ui', -1840, -184, 200],
      ['test', 1047, -416, -60],
    ])
  })

  it('grows each subfolder outward on the side of its parent', () => {
    const layout = layoutCards(entries)
    for (const child of ['src/ui', 'src/engine', 'src/model']) {
      expect(Math.sign(layout.get(child).x)).toBe(Math.sign(layout.get('src').x))
      expect(Math.abs(layout.get(child).x)).toBeGreaterThan(Math.abs(layout.get('src').x))
    }
  })

  it('adds a root card when the list has none', () => {
    expect(layoutCards([{ path: 'src', width: 400, height: 100 }]).has('')).toBe(true)
  })

  it('keeps cards near their place when a card is added', () => {
    const before = layoutCards(entries.slice(0, 4))
    const after = layoutCards(entries, before)
    for (const path of ['docs', 'test']) {
      const a = before.get(path)
      const b = after.get(path)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(150)
    }
  })

  it('brings deeper folders toward the camera, up to a limit', () => {
    expect(cardDepth('')).toBe(CARD_DEPTH.root)
    expect(cardDepth('src')).toBeGreaterThan(cardDepth(''))
    expect(cardDepth('src/ui')).toBeGreaterThan(cardDepth('src'))
    expect(cardDepth('a/b/c/d/e/f')).toBe(CARD_DEPTH.max)
    expect(layoutCards(entries).get('src/ui').z).toBe(cardDepth('src/ui'))
  })
})
