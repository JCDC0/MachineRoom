import { describe, expect, it } from 'vitest'
import { layoutTree, BASE_RADIUS, MARGIN, MIN_CELL_SCALE } from '../src/engine/layout.js'
import { makeTree } from '../src/model/paths.js'

const tree = makeTree({
  root: 'demo',
  files: ['README.md', 'package.json', 'src/a.js', 'src/b.js', 'src/ui/c.js', 'docs/x.md', 'test/t.js'],
  created: [],
})

describe('layoutTree', () => {
  it('is the same every time', () => {
    const first = layoutTree(tree).nodes.map((n) => [n.path, Math.round(n.x), Math.round(n.z)])
    const second = layoutTree(tree).nodes.map((n) => [n.path, Math.round(n.x), Math.round(n.z)])
    expect(second).toEqual(first)
  })

  it('puts the root at the front and deeper folders further out', () => {
    const layout = layoutTree(tree)
    const root = layout.byPath.get('')
    const ui = layout.byPath.get('src/ui')
    expect(root.radius).toBe(BASE_RADIUS)
    expect(ui.radius).toBeGreaterThan(layout.byPath.get('src').radius)
    expect(root.z).toBeGreaterThan(0)
  })

  it('keeps every folder apart from the others', () => {
    const { nodes } = layoutTree(tree)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z)).toBeGreaterThan(400)
      }
    }
  })

  it('gives every file one slot in its own folder', () => {
    const layout = layoutTree(tree)
    const slots = layout.nodes.flatMap((n) => n.slots.map((s) => s.file)).sort()
    expect(slots).toEqual([...tree.files].sort())
  })

  it('links each folder to its parent', () => {
    const { links } = layoutTree(tree)
    expect(links).toContainEqual({ from: 'src', to: 'src/ui' })
    expect(links).toContainEqual({ from: '', to: 'docs' })
  })
})

function bigTree() {
  const files = ['README.md', 'package.json']
  for (let a = 0; a < 14; a++) {
    for (let f = 0; f < 3 + (a % 6); f++) files.push(`pkg${String(a).padStart(2, '0')}/f${f}.js`)
    for (let b = 0; b < 1 + (a % 4); b++) {
      for (let f = 0; f < 2 + b; f++) files.push(`pkg${String(a).padStart(2, '0')}/sub${b}/g${f}.js`)
    }
  }
  for (let f = 0; f < 90; f++) files.push(`assets/img${String(f).padStart(3, '0')}.png`)
  return makeTree({ root: 'big', files, created: [] })
}

describe('layoutTree with a large project', () => {
  const layout = layoutTree(bigTree())

  it('never lets two folders overlap', () => {
    const { nodes } = layout
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const gap = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z)
        const touching = (nodes[i].diameter + nodes[j].diameter) / 2 - 2 * MARGIN
        expect(gap, `${nodes[i].path || 'root'} and ${nodes[j].path || 'root'}`).toBeGreaterThan(touching)
      }
    }
  })

  it('moves the rings outward when the folders do not fit', () => {
    const small = layoutTree(tree)
    expect(layout.byPath.get('pkg00').radius).toBeGreaterThan(small.byPath.get('docs').radius)
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

  it('is the same every time', () => {
    const again = layoutTree(bigTree())
    expect(again.nodes.map((n) => [n.path, Math.round(n.x), Math.round(n.z)])).toEqual(
      layout.nodes.map((n) => [n.path, Math.round(n.x), Math.round(n.z)])
    )
  })
})
