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
import { layoutChain, replaySources } from '../scripts/scale-probe.mjs'

const PUBLIC = join(import.meta.dirname, '..', 'public')
const RECORDINGS = join(PUBLIC, 'recordings')
const FIXTURE_MOVES = 3
const CHAIN_MOVES = 90
const CHAIN_WORST_MOVE = 600

function readSource(source) {
  const read = (file) => readFileSync(join(source.folder, file), 'utf8')
  return prepare({
    frames: parseFrames(read(source.run)),
    agentsFile: JSON.parse(read(source.agents)),
    treeFile: JSON.parse(read(source.tree)),
  })
}

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

function totals(sources) {
  const sum = { layouts: 0, overlapping: 0, moves: 0, worstMove: 0, tallest: 0 }
  for (const source of sources) {
    const { agents, tree, activities } = readSource(source)
    const one = layoutChain(activities, tree, agents)
    sum.layouts += one.layouts
    sum.overlapping += one.overlapping
    sum.moves += one.moves
    sum.worstMove = Math.max(sum.worstMove, one.worstMove)
    sum.tallest = Math.max(sum.tallest, one.tallest)
  }
  return sum
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
  it('keeps every fixture layout clear and still', () => {
    const sources = replaySources().filter((source) => source.name.startsWith('fixtures/'))
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      const { agents, tree, activities } = readSource(source)
      walk(activities, createState(tree, agents), (entries, placed) => {
        expect(cardOverlaps(entries, placed), `${source.name} at ${entries.length} cards`).toEqual([])
      })
    }
    const found = totals(sources)
    expect(found.layouts).toBeGreaterThan(0)
    expect(found.overlapping).toBe(0)
    expect(found.moves).toBeLessThanOrEqual(FIXTURE_MOVES)
  })

  it.skipIf(!existsSync(RECORDINGS))('keeps every recording layout clear and still', () => {
    const sources = replaySources().filter((source) => source.name.startsWith('recordings/'))
    expect(sources.length).toBeGreaterThan(0)
    const found = totals(sources)
    expect(found.layouts).toBeGreaterThan(0)
    expect(found.overlapping).toBe(0)
    expect(found.moves).toBeLessThanOrEqual(CHAIN_MOVES)
    expect(found.worstMove).toBeLessThanOrEqual(CHAIN_WORST_MOVE)
  }, 60000)

  it('keeps the seeded chain at 200,000 files clear and still', () => {
    const tree = makeTree(makeScaleTree({ files: 200000, folders: 20000 }))
    const activities = scaleActivities(tree).slice(0, 300)
    const agents = [
      { id: 'a1', key: 'claude', name: 'Claude', parser: 'claude' },
      { id: 'a2', key: 'hermes', name: 'Hermes', parser: 'hermes' },
      { id: 'a3', key: 'opencode', name: 'OpenCode', parser: 'opencode' },
    ]
    const found = layoutChain(activities, tree, agents)
    expect(found.layouts).toBeGreaterThan(100)
    expect(found.overlapping).toBe(0)
    expect(found.moves).toBeLessThanOrEqual(80)
    expect(found.worstMove).toBeLessThanOrEqual(1000)
  }, 30000)

  it('moves only the two cards of one overlapping pair', () => {
    const entries = [
      { path: '', width: 450, height: 120 },
      { path: 'a', width: 400, height: 3000 },
      { path: 'b', width: 400, height: 3000 },
      { path: 'c', width: 800, height: 100 },
    ]
    const previous = new Map([
      ['', { x: 0, y: 415, z: 0 }],
      ['a', { x: 1200, y: 1600, z: 0 }],
      ['b', { x: 1200, y: -1200, z: 0 }],
      ['c', { x: -1335, y: 0, z: 0 }],
    ])
    const placed = layoutCards(entries, previous)
    expect(cardOverlaps(entries, placed)).toEqual([])
    const changed = entries
      .filter((entry) => {
        const before = previous.get(entry.path)
        const after = placed.get(entry.path)
        return Math.hypot(after.x - before.x, after.y - before.y) > 1
      })
      .map((entry) => entry.path)
      .sort()
    expect(changed).toEqual(['a', 'b'])
  })

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
      expect(Math.abs(at.x)).toBeGreaterThan(1)
    }
  })
})
