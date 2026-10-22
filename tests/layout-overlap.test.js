import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_HUB, cardOverlaps, layoutCards } from '../src/engine/layout.js'
import { cardSize, viewInput } from '../src/engine/cards.js'
import { planFolderView } from '../src/model/folderView.js'
import { makeTree } from '../src/model/paths.js'
import { makeScaleTree, scaleActivities } from '../src/model/scaleTree.js'
import { parseFrames, prepare } from '../src/model/source.js'
import { apply, createState } from '../src/model/state.js'
import { replaySources } from '../scripts/scale-probe.mjs'

const PUBLIC = join(import.meta.dirname, '..', 'public')

function walk(activities, state, visit) {
  let homes = new Map()
  let key = ''
  for (const activity of activities) {
    apply(state, activity)
    const input = viewInput(state, [])
    const views = planFolderView(input)
    const next = `${input.files.length}|${input.focus.join('\n')}|${input.touched.join('\n')}`
    if (next === key) continue
    key = next
    const entries = views.map((view) => ({ path: view.path, ...cardSize(view) }))
    const placed = layoutCards(entries, homes)
    homes = new Map([...homes, ...placed])
    visit(entries, placed)
  }
}

describe('cardOverlaps', () => {
  const entries = [
    { path: 'a', width: 200, height: 100 },
    { path: 'b', width: 200, height: 100 },
  ]

  it('finds two crossing cards', () => {
    const placed = new Map([
      ['a', { x: 2000, y: 0, z: 0 }],
      ['b', { x: 2150, y: 50, z: 0 }],
    ])
    expect(cardOverlaps(entries, placed)).toEqual([{ a: 'a', b: 'b', kind: 'card', overlap: 50 }])
  })

  it('does not count two touching cards', () => {
    const placed = new Map([
      ['a', { x: 2000, y: 0, z: 0 }],
      ['b', { x: 2200, y: 0, z: 0 }],
    ])
    expect(cardOverlaps(entries, placed)).toEqual([])
  })

  it('finds a card on the hub', () => {
    const placed = new Map([['a', { x: 0, y: 0, z: 0 }]])
    const found = cardOverlaps([entries[0]], placed)
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('hub')
    expect(found[0].a).toBe('a')
    expect(found[0].overlap).toBe(Math.min(CARD_HUB.hw + 100, CARD_HUB.hh + 50))
  })

  it('finds a card on an obstacle', () => {
    const obstacle = { x: 0, y: -500, hw: 900, hh: 400 }
    const placed = new Map([['a', { x: 0, y: -500, z: 0 }]])
    const found = cardOverlaps([entries[0]], placed, [obstacle])
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('obstacle')
    expect(found[0].index).toBe(0)
  })
})

describe('layoutCards clears every overlap', () => {
  it('keeps every fixture and recording layout clear', () => {
    const sources = replaySources()
    expect(sources.some((source) => source.name.startsWith('fixtures/'))).toBe(true)
    for (const source of sources) {
      if (source.name.startsWith('recordings/') && !existsSync(join(PUBLIC, 'recordings'))) continue
      const read = (file) => readFileSync(join(source.folder, file), 'utf8')
      const { agents, tree, activities } = prepare({
        frames: parseFrames(read(source.run)),
        agentsFile: JSON.parse(read(source.agents)),
        treeFile: JSON.parse(read(source.tree)),
      })
      walk(activities, createState(tree, agents), (entries, placed) => {
        expect(cardOverlaps(entries, placed), `${source.name} at ${entries.length} cards`).toEqual([])
      })
    }
  })

  it('keeps the seeded chain at 200,000 files clear', () => {
    const files = 200000
    const tree = makeTree(makeScaleTree({ files, folders: files / 10 }))
    const activities = scaleActivities(tree).slice(0, 300)
    const agents = [
      { id: 'a1', key: 'claude', name: 'Claude', parser: 'claude' },
      { id: 'a2', key: 'hermes', name: 'Hermes', parser: 'hermes' },
      { id: 'a3', key: 'opencode', name: 'OpenCode', parser: 'opencode' },
    ]
    let layouts = 0
    walk(activities, createState(tree, agents), (entries, placed) => {
      layouts += 1
      expect(cardOverlaps(entries, placed), `layout ${layouts} at ${entries.length} cards`).toEqual([])
    })
    expect(layouts).toBeGreaterThan(100)
  }, 30000)

  it('fits 40 tall cards under one parent', () => {
    const entries = [
      { path: '', width: 450, height: 120 },
      { path: 'p', width: 650, height: 300 },
    ]
    for (let i = 0; i < 40; i += 1) entries.push({ path: `p/c${String(i).padStart(2, '0')}`, width: 370, height: 900 })
    const placed = layoutCards(entries)
    expect(cardOverlaps(entries, placed)).toEqual([])
    expect(placed.get('').y).toBeGreaterThan(CARD_HUB.hh)
    for (let i = 0; i < 40; i += 1) {
      const at = placed.get(`p/c${String(i).padStart(2, '0')}`)
      expect(Math.sign(at.x)).toBe(Math.sign(placed.get('p').x))
      expect(Math.abs(at.x)).toBeGreaterThan(Math.abs(placed.get('p').x))
    }
  })
})
