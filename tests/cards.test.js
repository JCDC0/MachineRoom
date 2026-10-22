import { describe, expect, it } from 'vitest'
import { CARD_SCALES, CARD_W, cardHeight, cardRows, cardSize, rowOffset, viewInput, viewKey } from '../src/engine/cards.js'
import { makeTree } from '../src/model/paths.js'
import { RECENT_KEEP_MS, apply, createState } from '../src/model/state.js'

const view = (state, items = 0, hiddenItems = 0, back = 0) => ({
  path: 'src',
  state,
  back,
  items: Array.from({ length: items }, (_, i) => ({ path: `src/f${i}.js`, kind: 'file' })),
  hiddenItems,
})

describe('card size', () => {
  it('counts rows only on a card that lists its files, with one more for the hidden line', () => {
    expect(cardRows(view('open', 4))).toBe(0)
    expect(cardRows(view('files', 4))).toBe(4)
    expect(cardRows(view('files', 10, 6))).toBe(11)
  })

  it('makes a card that lists files larger than an open one, and an open one larger than a closed one', () => {
    const closed = cardSize(view('closed'))
    const open = cardSize(view('open'))
    const files = cardSize(view('files', 3))
    expect(open.width).toBeGreaterThan(closed.width)
    expect(files.width).toBeGreaterThan(open.width)
    expect(files.height).toBeGreaterThan(open.height)
    expect(files.scale).toBe(CARD_SCALES.files)
  })

  it('widens a card for each faint back folder', () => {
    expect(cardSize(view('open', 0, 0, 3)).width).toBeGreaterThan(cardSize(view('open')).width)
    expect(cardSize(view('closed')).width).toBe(CARD_W * CARD_SCALES.closed)
  })

  it('places rows from the top of the card down', () => {
    expect(rowOffset(3, 0)).toBeGreaterThan(rowOffset(3, 1))
    expect(rowOffset(3, 0)).toBeLessThan(cardHeight(3) / 2)
  })
})

describe('viewInput', () => {
  const state = (recent, recentAt, latest) => ({
    files: new Map([['src/a.js', { path: 'src/a.js', exists: true }], ['docs/b.md', { path: 'docs/b.md', exists: true }]]),
    agents: new Map([['hermes', { focus: ['src/a.js'] }]]),
    recent,
    recentAt: new Map(Object.entries(recentAt)),
    latest,
  })

  it('opens only the recent paths touched in the last minute and a half', () => {
    const input = viewInput(state(['docs/b.md', 'src/a.js'], { 'docs/b.md': 0, 'src/a.js': 100000 }, 100000))
    expect(input.focus).toEqual(['', 'src/a.js', 'src/a.js'])
    expect(input.touched).toEqual(['docs/b.md', 'src/a.js'])
  })

  it('keeps pinned folders open', () => {
    expect(viewInput(state([], {}, 0), ['docs']).focus).toEqual(['', 'src/a.js', 'docs'])
  })
})

describe('viewKey', () => {
  const oldKey = (state, pinned = []) => {
    const input = viewInput(state, pinned)
    return `${input.files.length}|${input.focus.join('\n')}|${input.touched.join('\n')}`
  }

  const fixture = () => {
    const tree = makeTree({ root: 'demo', files: ['src/a.js', 'docs/b.md', 'src/new.js'], created: ['src/new.js'] })
    const state = createState(tree, [{ key: 'hermes', name: 'Hermes' }])
    state.agents.get('hermes').focus = ['src/a.js']
    state.recent = ['docs/b.md', 'src/a.js']
    state.recentAt = new Map([['docs/b.md', 1000], ['src/a.js', 2000]])
    state.latest = 2000
    return state
  }

  it('makes the same key for the same state', () => {
    const state = fixture()
    expect(viewKey(state, ['docs'])).toBe(viewKey(state, ['docs']))
  })

  it('makes the same key as the old form for a fixture state', () => {
    const state = fixture()
    expect(viewKey(state, ['docs'])).toBe(oldKey(state, ['docs']))
  })

  it('changes when a write creates a file', () => {
    const state = fixture()
    const before = viewKey(state)
    apply(state, {
      type: 'tool.start',
      agent: 'hermes',
      runId: 'r1',
      time: 3000,
      order: 3000,
      id: 'c1',
      tool: 'write',
      label: 'write src/new.js',
      touches: [{ path: 'src/new.js', kind: 'file', mode: 'write' }],
    })
    expect(viewKey(state)).not.toBe(before)
  })

  it('changes when an agent focus changes', () => {
    const state = fixture()
    const before = viewKey(state)
    state.agents.get('hermes').focus = ['docs/b.md']
    expect(viewKey(state)).not.toBe(before)
  })

  it('changes when a pin is added or removed', () => {
    const state = fixture()
    const before = viewKey(state)
    expect(viewKey(state, ['src'])).not.toBe(before)
    expect(viewKey(state, ['src', 'docs'])).not.toBe(viewKey(state, ['src']))
    expect(viewKey(state)).toBe(before)
  })

  it('changes when a recent path is added and when it ages out', () => {
    const state = fixture()
    const before = viewKey(state)
    apply(state, {
      type: 'tool.start',
      agent: 'hermes',
      runId: 'r1',
      time: 3000,
      order: 3000,
      id: 'c1',
      tool: 'read',
      label: 'read gen/c.js',
      touches: [{ path: 'gen/c.js', kind: 'file', mode: 'read' }],
    })
    const added = viewKey(state)
    expect(added).not.toBe(before)
    apply(state, {
      type: 'tool.start',
      agent: 'hermes',
      runId: 'r1',
      time: 3000 + RECENT_KEEP_MS + 1,
      order: 3001,
      id: 'c2',
      tool: 'read',
      label: 'read',
      touches: [],
    })
    expect(viewKey(state)).not.toBe(added)
  })
})

describe('existingFiles', () => {
  const tree = makeTree({ root: 'demo', files: ['src/a.js', 'src/b.js', 'docs/notes.md'], created: ['src/b.js'] })
  const agents = [{ key: 'hermes', name: 'Hermes' }]
  const write = (path, time = 1) => ({
    type: 'tool.start',
    agent: 'hermes',
    runId: 'r1',
    time,
    order: time,
    id: `c${time}`,
    tool: 'write',
    label: `write ${path}`,
    touches: [{ path, kind: 'file', mode: 'write' }],
  })

  it('counts the files that exist at the start, not the created ones', () => {
    expect(createState(tree, agents).existingFiles).toBe(2)
  })

  it('adds one when a write turns a created file into an existing one, and not again', () => {
    const state = createState(tree, agents)
    apply(state, write('src/b.js'))
    expect(state.existingFiles).toBe(3)
    apply(state, write('src/b.js', 2))
    expect(state.existingFiles).toBe(3)
  })

  it('adds one when a write brings a file the tree does not hold', () => {
    const state = createState(tree, agents)
    apply(state, write('gen/new.js'))
    expect(state.existingFiles).toBe(3)
  })
})
