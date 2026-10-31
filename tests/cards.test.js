import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  CARD_NAME_MAX,
  CARD_SCALES,
  CARD_W,
  FILE_LIMIT_DEFAULT,
  FILE_LIMIT_MAX,
  FILE_LIMIT_MIN,
  ROW_H,
  backOffsets,
  cardHeight,
  cardMetaText,
  cardName,
  cardPlan,
  cardRows,
  cardSize,
  cardTitle,
  clampFileLimit,
  createCards,
  createRowFrameKey,
  fadeProgress,
  openChain,
  rowOffset,
  viewInput,
  viewKey,
} from '../src/engine/cards.js'
import { HUB_CENTER } from '../src/engine/hub.js'
import { makeTree } from '../src/model/paths.js'
import { RECENT_KEEP_MS, apply, createState } from '../src/model/state.js'

function fakeElement(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    ownerDocument: { defaultView: { Element: function Element() {} } },
    append(...nodes) {
      node.children.push(...nodes)
    },
    appendChild(child) {
      node.children.push(child)
      return child
    },
    replaceChildren(...nodes) {
      node.children.length = 0
      node.children.push(...nodes)
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    setAttribute(name, value) {
      node[name] = value
    },
    cloneNode() {
      return fakeElement(tag)
    },
  }
  Object.defineProperty(node, 'textContent', {
    get() {
      return node.text ?? ''
    },
    set(value) {
      node.text = String(value)
      if (value === '') node.children.length = 0
    },
  })
  return node
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = { createElement: (tag) => fakeElement(tag) }
})

afterAll(() => {
  globalThis.document = savedDocument
})

function fakeScene() {
  const children = []
  return {
    children,
    add(object) {
      children.push(object)
    },
    remove(object) {
      const index = children.indexOf(object)
      if (index !== -1) children.splice(index, 1)
    },
  }
}

const camera = () => new THREE.PerspectiveCamera(60, 1, 1, 100000)

function recentState() {
  const tree = makeTree({
    root: 'demo',
    files: [
      'docs/b.md',
      'lib/a/x.js',
      'lib/b/x.js',
      'lib/c/x.js',
      'lib/d/x.js',
      'lib/e/x.js',
      'lib/f/x.js',
      'lib/g/x.js',
      'src/alpha/a.js',
      'src/beta/b.js',
      'src/delta/d.js',
      'src/epsilon/e.js',
      'src/gamma/g.js',
      'src/mine/m.js',
      'src/other/o.js',
    ],
  })
  const state = createState(tree, [
    { key: 'claude', name: 'Claude' },
    { key: 'hermes', name: 'Hermes' },
  ])
  state.agents.get('claude').focus = ['docs/b.md']
  state.recent = ['src/mine/m.js']
  state.recentAt = new Map([['src/mine/m.js', 41000]])
  state.latest = 100000
  return state
}

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

  it('uses the smaller, near uniform scales', () => {
    expect(CARD_SCALES).toEqual({ closed: 1, open: 1.2, files: 1.8 })
    expect(cardSize(view('closed')).width).toBe(248)
    expect(cardSize(view('open')).width).toBeCloseTo(297.6, 6)
    expect(cardSize(view('files', 3)).width).toBeCloseTo(446.4, 6)
  })

  it('places rows from the top of the card down', () => {
    expect(rowOffset(3, 0)).toBeGreaterThan(rowOffset(3, 1))
    expect(rowOffset(3, 0)).toBeLessThan(cardHeight(3) / 2)
  })

  it('widens a card for a long name and leaves a short name at the base width', () => {
    const long = 'machineroom-very-long-name-tests'
    expect(cardSize({ path: 'src', state: 'closed' }).width).toBe(CARD_W)
    expect(cardSize({ path: long, state: 'closed' }).width).toBeGreaterThan(CARD_W)
    expect(cardSize({ path: long, state: 'open' }).width).toBeCloseTo(cardSize({ path: long, state: 'closed' }).width * CARD_SCALES.open, 6)
    expect(cardSize({ path: `${long}-more`, state: 'closed' }).width).toBe(cardSize({ path: long, state: 'closed' }).width)
  })
})

describe('the folder blocks behind a card', () => {
  it('starts every pile at the face and adds one place for each back', () => {
    expect(backOffsets(0)).toEqual([{ x: 0, y: 0 }])
    expect(backOffsets(1)).toEqual([
      { x: 0, y: 0 },
      { x: -12, y: 0 },
    ])
    expect(backOffsets(3)).toEqual([
      { x: 0, y: 0 },
      { x: -12, y: 0 },
      { x: -24, y: 0 },
      { x: -36, y: 0 },
    ])
  })

  it('steps every back along one 270 degree line, straight left', () => {
    const offsets = backOffsets(3, 20)
    expect(offsets.map(({ x }) => x)).toEqual([0, -20, -40, -60])
    expect(offsets.every(({ y }) => y === 0)).toBe(true)
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index].x - offsets[index - 1].x).toBe(-20)
      expect(offsets[index].y).toBe(offsets[index - 1].y)
    }
  })

  it('paints one full back per hidden folder, each one step left and further from the camera', () => {
    const files = ['work/one.js', 'work/a/two.js', 'work/b/two.js', 'work/c/two.js', 'work/d/two.js']
    const state = createState(makeTree({ root: 'demo', files }), [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const work = cards.cards.get('work')
    expect(work.view.back).toBe(3)
    expect(work.backs.children.map((back) => back.className)).toEqual([
      'mr-card-back is-back-1',
      'mr-card-back is-back-2',
      'mr-card-back is-back-3',
    ])
    expect(work.backs.children.map((back) => back.style.transform)).toEqual([
      'translate3d(-12px, 0px, -6px)',
      'translate3d(-24px, 0px, -12px)',
      'translate3d(-36px, 0px, -18px)',
    ])
    expect(cards.cards.get('').backs.children).toHaveLength(0)
    cards.dispose()
  })
})

describe('the file limit', () => {
  it('clamps the row count to a whole number from 4 to 20, 6 by default', () => {
    expect(FILE_LIMIT_MIN).toBe(4)
    expect(FILE_LIMIT_MAX).toBe(20)
    expect(FILE_LIMIT_DEFAULT).toBe(6)
    expect(clampFileLimit(undefined)).toBe(6)
    expect(clampFileLimit(null)).toBe(6)
    expect(clampFileLimit(Number.NaN)).toBe(6)
    expect(clampFileLimit('9')).toBe(9)
    expect(clampFileLimit(2)).toBe(4)
    expect(clampFileLimit(40)).toBe(20)
    expect(clampFileLimit(6.6)).toBe(7)
  })

  it('caps the rows of a card at maxFiles and leaves a view without one uncapped', () => {
    expect(cardRows({ ...view('files', 10, 6), maxFiles: 6 })).toBe(6)
    expect(cardRows({ ...view('files', 3, 0), maxFiles: 6 })).toBe(3)
    expect(cardRows({ ...view('files', 3, 2), maxFiles: 6 })).toBe(4)
    expect(cardRows(view('files', 10, 6))).toBe(11)
  })

  it('gives every planned card the clamped limit and all of its items', () => {
    const files = Array.from({ length: 12 }, (_, index) => `root-${index}.js`)
    const state = createState(makeTree({ root: 'demo', files }), [])
    const layout = cardPlan(state, { alwaysDepth: 2, maxFiles: 50 })
    const root = layout.drawn.get('')
    expect(root.maxFiles).toBe(20)
    expect(root.items).toHaveLength(12)
    expect(root.hiddenItems).toBe(0)
    expect(cardRows(root)).toBe(12)
    expect(layout.plan.find((planned) => planned.path === '')?.items).toHaveLength(12)
  })

  it('takes a new file limit from setOptions and marks a long list scrollable', () => {
    const files = Array.from({ length: 12 }, (_, index) => `root-${index}.js`)
    const state = createState(makeTree({ root: 'demo', files }), [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2, maxFiles: 4 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    expect(root.items.style.maxHeight).toBe(`${4 * ROW_H}px`)
    expect(root.items.className).toBe('mr-card-items is-scrollable')
    expect(cards.setOptions({ maxFiles: 20 })).toBe(true)
    cards.update(state, 0.016, camera())
    expect(root.items.style.maxHeight).toBe(`${20 * ROW_H}px`)
    expect(root.items.className).toBe('mr-card-items')
    expect(cards.setOptions({ alwaysDepth: 2 })).toBe(false)
    cards.dispose()
  })
  it('keeps the tunnel row of a file below the cap on the last visible row', () => {
    const files = Array.from({ length: 10 }, (_, index) => `src/f${index}.js`)
    const state = createState(makeTree({ root: 'demo', files }), [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1, maxFiles: 4 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const last = cards.slotPosition('src', 'src/f3.js', new THREE.Vector3())
    const past = cards.slotPosition('src', 'src/f9.js', new THREE.Vector3())
    expect(past.equals(last)).toBe(true)
    expect(cards.slotPosition('src', 'src/f0.js', new THREE.Vector3()).equals(last)).toBe(false)
    cards.dispose()
  })
})

describe('card meta text', () => {
  it('counts the listed items and the unexpanded folders behind the card', () => {
    expect(cardMetaText({ state: 'files', items: [{}, {}], hiddenItems: 1, hiddenFolders: 2 })).toBe('3 items  2 folders')
    expect(cardMetaText({ state: 'files', items: [{}], hiddenItems: 0, hiddenFolders: 1 })).toBe('1 items  1 folder')
    expect(cardMetaText({ state: 'files', items: [{}, {}], hiddenItems: 0, hiddenFolders: 0 })).toBe('2 items')
    expect(cardMetaText({ state: 'files', items: [{}], hiddenFolders: 0 })).toBe('1 items')
  })

  it('keeps the text of a folder card that is not listing files', () => {
    expect(cardMetaText({ state: 'closed' })).toBe('')
    expect(cardMetaText({ state: 'open', folders: [{}, {}], hiddenFolders: 3 })).toBe('5 folders')
  })

  it('shows the file and folder counts on the card', () => {
    const tree = makeTree({
      root: 'demo',
      files: ['work/one.js', 'work/a/two.js', 'work/b/two.js'],
    })
    const state = createState(tree, [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    expect(cards.cards.get('work').meta.textContent).toBe('3 items  2 folders')
    cards.dispose()
  })
})

describe('card names', () => {
  const LONG = 'machineroom-very-long-name-tests'

  it('shows a short name in full with its slash and the long name cut from the middle', () => {
    expect(cardName('src')).toBe('src/')
    expect(cardName('', 'demo')).toBe('demo/')
    const exact = 'abcdefghijklmnopqrstuvwx'
    expect(exact).toHaveLength(CARD_NAME_MAX)
    expect(cardName(exact)).toBe(`${exact}/`)
    const name = cardName(LONG)
    expect(name.endsWith('/')).toBe(true)
    const cut = name.slice(0, -1)
    expect(cut).toHaveLength(CARD_NAME_MAX)
    expect(cut).toContain('...')
    expect(cut.startsWith('machineroom')).toBe(true)
    expect(cut.endsWith('name-tests')).toBe(true)
  })

  it('keeps the full path for the title', () => {
    expect(cardTitle('src/engine/cards')).toBe('src/engine/cards')
    expect(cardTitle(LONG)).toBe(LONG)
    expect(cardTitle('', 'demo')).toBe('demo')
  })

  it('puts the full path on the card and keeps a long name inside its width', () => {
    const rootName = LONG
    const tree = makeTree({ root: rootName, files: [`${rootName}/a.js`] })
    const state = createState(tree, [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), rootName, alwaysDepth: 2 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    const folder = cards.cards.get(rootName)
    expect(root.element.title).toBe(rootName)
    expect(root.name.textContent).toBe('machineroom...name-tests/')
    expect(parseFloat(root.element.style.width)).toBeGreaterThan(CARD_W)
    expect(folder.element.title).toBe(rootName)
    expect(folder.name.textContent).toBe('machineroom...name-tests/')
    cards.dispose()
  })

  it('keeps a short name clear of a lens width cap', () => {
    const state = recentState()
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2 })
    cards.sync(state)
    const first = cards.cards.values().next().value
    first.element.parentElement = { clientHeight: 400 }
    const view = camera()
    view.position.set(0, 0, 5000)
    view.updateMatrixWorld(true)
    cards.update(state, 0.016, view)
    const card = cards.cards.get('docs')
    expect(card.name.style.transform).toMatch(/^scale\(/)
    expect(card.name.style.maxWidth).toBeUndefined()
    cards.dispose()
  })

  it('shows every card name on the ring', () => {
    const state = recentState()
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    for (const card of cards.cards.values()) {
      expect(card.name.style.display, card.path || 'root').not.toBe('none')
    }
    cards.dispose()
  })
})

describe('the strings the room draws', () => {
  it('starts every top-level string at the root card and gives the root no line', () => {
    const state = recentState()
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const links = cards.visibleLinks()
    expect(links).toContainEqual({ from: '', to: 'docs' })
    expect(links).toContainEqual({ from: 'lib', to: 'lib/a' })
    expect(links.some((link) => link.to === '')).toBe(false)
    expect(links.some((link) => link.from === null)).toBe(false)
    cards.dispose()
  })
})

describe('fadeProgress', () => {
  it('finishes at once when still is true and eases over the fade otherwise', () => {
    expect(fadeProgress(0, 0, true)).toBe(1)
    expect(fadeProgress(0, 200, false)).toBeCloseTo(0.5)
    expect(fadeProgress(0, 900, false)).toBe(1)
  })
})

describe('createRowFrameKey', () => {
  const mask = { dimmed: true, lit: new Set(['', 'src']), targeted: new Set(['src']) }

  it('builds once over idle frames and again when the state, mask, flash or rows change', () => {
    const cache = createRowFrameKey()
    const key = cache.key({ latest: 10 }, mask, 0, 0)
    expect(cache.key({ latest: 10 }, mask, 0, 0)).toBe(key)
    expect(cache.key({ latest: 10 }, mask, 0, 0)).toBe(key)
    expect(cache.builds()).toBe(1)
    expect(cache.key({ latest: 11 }, mask, 0, 0)).not.toBe(key)
    expect(cache.builds()).toBe(2)
    const idleMask = { dimmed: false, lit: new Set(), targeted: new Set() }
    cache.key({ latest: 11 }, idleMask, 0, 0)
    expect(cache.builds()).toBe(3)
    cache.key({ latest: 11 }, idleMask, 1, 0)
    expect(cache.builds()).toBe(4)
    cache.key({ latest: 11 }, idleMask, 1, 1)
    expect(cache.builds()).toBe(5)
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

describe('openChain', () => {
  const tree = makeTree({ root: 'demo', files: ['src/engine/a.js', 'docs/b.md'], created: [] })
  const state = createState(tree, [{ key: 'hermes', name: 'Hermes' }])

  it('walks from a focused file to its folder and up to the root', () => {
    state.agents.get('hermes').focus = ['src/engine/a.js']
    expect([...openChain(state)].sort()).toEqual(['', 'src', 'src/engine'].sort())
  })

  it('keeps a focused folder and adds a pinned folder', () => {
    state.agents.get('hermes').focus = ['docs']
    expect([...openChain(state)].sort()).toEqual(['', 'docs'].sort())
  })

  it('adds a pinned folder with its ancestors', () => {
    state.agents.get('hermes').focus = []
    expect([...openChain(state, ['src/engine'])].sort()).toEqual(['', 'src', 'src/engine'].sort())
  })

  it('is empty when no agent has a focus', () => {
    state.agents.get('hermes').focus = []
    expect([...openChain(state)]).toEqual([])
  })
})

describe('the folders on the ring', () => {
  it('draws a fresh recent folder and its file row when another agent works elsewhere', () => {
    const state = recentState()
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const src = cards.cards.get('src')
    expect(src.view.state).toBe('files')
    expect(src.view.items).toEqual([])
    const mine = cards.cards.get('src/mine')
    expect(mine.view.state).toBe('files')
    expect(mine.view.items).toEqual([{ path: 'src/mine/m.js', kind: 'file' }])
    expect(cards.center('src/mine').equals(cards.cards.get('src/mine').object.position)).toBe(true)
    expect(cards.center('src/mine').equals(cards.center(''))).toBe(false)
    cards.dispose()
  })

  it('sprays every child of a folder passed as clicked', () => {
    const state = recentState()
    const flat = cardPlan(state, { alwaysDepth: 0 })
    const sprayed = cardPlan(state, { alwaysDepth: 0, sprayed: new Set(['lib']) })
    expect(flat.drawn.has('lib/a')).toBe(false)
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) expect(sprayed.drawn.has(`lib/${name}`)).toBe(true)
    expect(sprayed.placed.get('lib').y).toBeGreaterThan(flat.placed.get('lib').y)
    expect(sprayed.placed.get('lib').y).toBe(flat.placed.get('lib').y + 140)
    expect(sprayed.placed.get('lib/a').y).toBe(flat.placed.get('lib').y)
  })
})

describe('cardPlan', () => {
  it('passes the unexpanded folder outlines through to the cards', () => {
    const files = ['work/one.js', 'work/a/two.js', 'work/b/two.js', 'work/c/two.js', 'work/d/two.js']
    const state = createState(makeTree({ root: 'demo', files }), [])
    const layout = cardPlan(state, { alwaysDepth: 1 })
    const work = layout.drawn.get('work')
    expect(work.hiddenFolders).toBe(4)
    expect(work.back).toBe(3)
    expect(layout.drawn.get('').back).toBe(0)
  })

  it('draws the whole plan and gives the cards the same keys', () => {
    const state = recentState()
    const layout = cardPlan(state, { alwaysDepth: 2 })
    expect(layout.drawn.has('src/mine')).toBe(true)
    expect(layout.drawn.size).toBe(layout.plan.length)
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 2 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    expect([...cards.cards.keys()].sort()).toEqual([...layout.drawn.keys()].sort())
    expect(layout.drawn.get('lib').back).toBe(0)
    cards.dispose()
  })

  it('keeps a root card with ten file rows below the hub plane', () => {
    const tree = makeTree({ root: 'demo', files: Array.from({ length: 10 }, (_, index) => `root-${index}.js`) })
    const state = createState(tree, [])
    const layout = cardPlan(state, { alwaysDepth: 2, maxFiles: 10 })
    const root = layout.drawn.get('')
    expect(cardRows(root)).toBe(10)
    const size = cardSize(root)
    const center = layout.placed.get('')
    expect(center.x).toBe(0)
    expect(center.z).toBe(0)
    expect(center.y + size.height / 2).toBeLessThan(HUB_CENTER.y)
  })
})

describe('the selected card', () => {
  it('marks one card with is-selected and clears the mark with null', () => {
    const state = createState(makeTree({ root: 'demo', files: ['src/a.js', 'docs/b.md'] }), [])
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const card = cards.cards.get('src')
    expect(cards.setSelected('src')).toBe(true)
    cards.update(state, 0.016, camera())
    expect(card.element.className).toContain('is-selected')
    expect(cards.setSelected('src')).toBe(false)
    expect(cards.setSelected(null)).toBe(true)
    cards.update(state, 0.016, camera())
    expect(card.element.className).not.toContain('is-selected')
    cards.dispose()
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
