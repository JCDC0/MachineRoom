import { describe, expect, it } from 'vitest'
import { layoutTree, BASE_RADIUS } from '../src/engine/layout.js'
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
