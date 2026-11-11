import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCards, DANCE_LIFT } from '../src/engine/cards.js'
import { DANCE_RISE_MS, DANCE_SETTLE_MS, SWAY_LIFT, SWAY_SCALE } from '../src/engine/hub.js'
import { createStrings } from '../src/engine/strings.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

function fakeElement(tag = 'div') {
  const children = []
  const listeners = new Map()
  let text = ''
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    children,
    parentNode: null,
    ownerDocument: {
      defaultView: {
        Element: function Element() {},
      },
    },
    append(...nodes) {
      children.push(...nodes)
    },
    appendChild(child) {
      children.push(child)
      return child
    },
    replaceChildren(...nodes) {
      children.length = 0
      children.push(...nodes)
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn({ stopPropagation() {} })
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type)
      if (!list) return
      const index = list.indexOf(fn)
      if (index !== -1) list.splice(index, 1)
    },
    remove() {
      node.removed = true
    },
    setAttribute(name, value) {
      node[name] = value
    },
    cloneNode() {
      return fakeElement(tag)
    },
    classList: { add() {}, remove() {}, contains: () => false },
  }
  Object.defineProperty(node, 'textContent', {
    get() {
      return text
    },
    set(value) {
      text = String(value)
      if (value === '') children.length = 0
    },
  })
  return node
}

let savedDocument

const context2d = {
  fillStyle: '',
  createRadialGradient: () => ({ addColorStop: () => {} }),
  fillRect: () => {},
}

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => context2d }
      return fakeElement(tag)
    },
  }
})

afterAll(() => {
  globalThis.document = savedDocument
})

afterEach(() => {
  vi.restoreAllMocks()
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

function camera() {
  return new THREE.PerspectiveCamera(60, 1, 1, 100000)
}

function makeState(paths = ['src/a.js', 'src/b.js'], focus = ['src/a.js']) {
  const tree = makeTree({ root: 'demo', files: paths })
  const state = createState(tree, [{ key: 'hermes', name: 'Hermes' }])
  state.agents.get('hermes').focus = [...focus]
  return state
}

function touch(mode, path, time, id) {
  return {
    type: 'tool.start',
    agent: 'hermes',
    runId: 'r1',
    time,
    order: time,
    id,
    tool: mode,
    label: `${mode} ${path}`,
    touches: [{ path, kind: 'file', mode }],
  }
}

function countReads(state, path) {
  const file = state.files.get(path)
  let count = 0
  const wrapped = { ...file }
  Object.defineProperty(wrapped, 'reads', {
    get() {
      count += 1
      return file.reads
    },
    set(value) {
      file.reads = value
    },
  })
  state.files.set(path, wrapped)
  return () => count
}

function makeCards(alwaysDepth = 2) {
  const cssScene = fakeScene()
  const glScene = fakeScene()
  const cards = createCards(cssScene, { glScene, alwaysDepth })
  return { cards, cssScene, glScene }
}

describe('a card depth mesh', () => {
  it('starts at the card position when the card is made at its home', () => {
    const state = makeState()
    const { cards } = makeCards()
    cards.sync(state)
    const root = cards.cards.get('')
    expect(root).toBeTruthy()
    expect(root.object.position.length()).toBeGreaterThan(0)
    expect(root.occluder.position.distanceTo(root.object.position)).toBe(0)
    cards.update(state, 0.016, camera())
    expect(root.occluder.position.distanceTo(root.object.position)).toBe(0)
  })

  it('answers the bottom edge of the root card', () => {
    const state = makeState()
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    expect(root.height).toBeGreaterThan(0)
    expect(cards.bottom('')).toBeCloseTo(root.object.position.y - (root.height * root.scale) / 2, 6)
    expect(cards.bottom('')).toBeLessThan(root.object.position.y)
  })
})

describe('the dance lift on a card', () => {
  it('lifts one card at a time, the root last, and keeps every place for the camera', () => {
    const state = makeState()
    const { cards } = makeCards()
    let clock = 10000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    cards.sync(state)
    for (let step = 0; step < 200; step += 1) cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    const place = cards.center('')
    const placeY = place.y
    expect(root.object.position.y).toBeCloseTo(placeY, 6)

    cards.beat(1)
    clock += DANCE_RISE_MS
    cards.update(state, 0.016, camera())
    expect(root.object.position.y).toBeCloseTo(placeY, 6)
    const first = cards.cards.get('src')
    expect(first.object.position.y - first.base.y).toBeCloseTo(DANCE_LIFT, 6)
    expect(cards.center('src').y).toBeCloseTo(first.base.y, 6)
    expect(first.occluder.position.distanceTo(first.object.position)).toBe(0)

    clock += DANCE_SETTLE_MS
    cards.update(state, 0.016, camera())
    expect(first.object.position.y).toBeCloseTo(first.base.y, 6)

    cards.beat(1)
    clock += DANCE_RISE_MS
    cards.update(state, 0.016, camera())
    expect(root.object.position.y - root.base.y).toBeCloseTo(DANCE_LIFT, 6)
    expect(cards.center('').y).toBeCloseTo(placeY, 6)
    expect(root.occluder.position.distanceTo(root.object.position)).toBe(0)

    clock += DANCE_SETTLE_MS
    cards.update(state, 0.016, camera())
    expect(root.object.position.y).toBeCloseTo(placeY, 6)
    cards.dispose()
  })
})

describe('the tab anchor without a card', () => {
  it('answers null until the root card is drawn', () => {
    const { cards } = makeCards()
    expect(cards.anchor('')).toBeNull()
    cards.sync(makeState())
    expect(cards.anchor('')).toBeTruthy()
    cards.dispose()
  })
})

describe('a string on a lifted card', () => {
  it('moves its end with the tab as the card lifts', () => {
    const state = makeState()
    const { cards } = makeCards()
    let clock = 10000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    cards.sync(state)
    for (let step = 0; step < 200; step += 1) cards.update(state, 0.016, camera())
    const links = cards.visibleLinks()
    const index = links.findIndex((link) => link.from === '' && link.to === 'src')
    expect(index).toBeGreaterThanOrEqual(0)
    const scene = fakeScene()
    const strings = createStrings(scene)
    const anchorOf = (path, out) => cards.anchor(path ?? '', out)
    strings.build(links, anchorOf)
    const line = scene.children.find((child) => child.isLineSegments)
    const position = line.geometry.attributes.position
    const stride = position.count / links.length
    const endAt = (vertex) => {
      const base = (index * stride + vertex) * 3
      return new THREE.Vector3(position.array[base], position.array[base + 1], position.array[base + 2])
    }
    const start = endAt(stride - 1)
    expect(start.distanceTo(cards.anchor('src'))).toBeLessThan(0.001)

    cards.beat(1)
    clock += DANCE_RISE_MS
    cards.update(state, 0.016, camera())
    strings.update(anchorOf, null, 0.016)
    const lifted = endAt(stride - 1)
    expect(lifted.y - start.y).toBeGreaterThan(DANCE_LIFT / 2)
    expect(lifted.distanceTo(cards.anchor('src'))).toBeLessThan(0.001)
    expect(endAt(0).distanceTo(cards.anchor(''))).toBeLessThan(0.001)
    strings.dispose()
    cards.dispose()
  })
})

describe('the sway on a card', () => {
  it('lifts and scales the ring with the smoothed loudness', () => {
    const state = makeState(['src/a.js', 'docs/b.md'])
    const { cards } = makeCards()
    let clock = 10000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    cards.sync(state)
    for (let step = 0; step < 40; step += 1) cards.update(state, 0.016, camera())
    const src = cards.cards.get('src')
    const docs = cards.cards.get('docs')
    cards.setSway(1)
    clock += 16
    cards.update(state, 0.016, camera())
    expect(src.object.position.y - src.base.y).toBeLessThan(1)
    let maxLift = 0
    let maxRatio = 0
    for (let step = 0; step < 240; step += 1) {
      clock += 16
      cards.update(state, 0.016, camera())
      maxLift = Math.max(maxLift, src.object.position.y - src.base.y)
      maxRatio = Math.max(maxRatio, src.object.scale.x / src.scale)
    }
    expect(maxLift).toBeGreaterThan(1)
    expect(maxLift).toBeLessThanOrEqual(SWAY_LIFT + 1e-6)
    expect(maxRatio).toBeGreaterThan(1.005)
    expect(maxRatio).toBeLessThanOrEqual(1 + SWAY_SCALE + 1e-6)
    const srcWave = src.object.position.y - src.base.y
    const docsWave = docs.object.position.y - docs.base.y
    expect(srcWave).not.toBeCloseTo(docsWave, 3)
    cards.setSway(0)
    for (let step = 0; step < 120; step += 1) {
      clock += 16
      cards.update(state, 0.016, camera())
    }
    expect(src.object.position.y - src.base.y).toBeLessThan(0.05)
    cards.dispose()
  })

  it('holds still under reduced motion', () => {
    const savedWindow = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    try {
      const state = makeState()
      const { cards } = makeCards()
      cards.sync(state)
      cards.update(state, 0.016, camera())
      const src = cards.cards.get('src')
      cards.setSway(1)
      cards.update(state, 0.016, camera())
      expect(src.object.position.y).toBeCloseTo(src.base.y, 6)
      expect(src.object.scale.x).toBeCloseTo(src.scale, 6)
      cards.dispose()
    } finally {
      globalThis.window = savedWindow
    }
  })
})

describe('rows after a seek', () => {
  it('drops the old state write count and class when the same row is kept', () => {
    const before = makeState()
    apply(before, touch('write', 'src/a.js', 1000, 'c1'))
    const { cards } = makeCards()
    cards.sync(before)
    cards.update(before, 0.016, camera())
    const card = cards.cards.get('src')
    const entry = card.rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-written')
    expect(entry.note.textContent).toBe('w 1')

    const after = makeState()
    cards.sync(after)
    cards.update(after, 0.016, camera())
    const kept = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(kept).toBe(entry)
    expect(kept.row.className).not.toContain('is-written')
    expect(kept.note.textContent).toBe('')
    expect(kept.mark).toBe('')
  })
})

describe('a clicked row', () => {
  it('marks the row inspected, opens the inspector and adds no detail line', () => {
    const state = makeState()
    const seen = []
    const cards = createCards(fakeScene(), {
      glScene: fakeScene(),
      alwaysDepth: 1,
      onInspect: (path) => seen.push(path),
    })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    entry.row.fire('click')
    cards.update(state, 0.016, camera())

    expect(entry.row.className).toContain('is-inspected')
    expect(entry.row.children.map((child) => child.className)).not.toContain('mr-item-detail')
    expect(seen).toEqual(['src/a.js'])
    cards.dispose()
  })
})

describe('clearing the selection', () => {
  it('drops the inspected row, the selected card, the pins and the pops', () => {
    const state = makeState(['src/a.js', 'src/kid/b.js'], ['src/a.js'])
    const { cards } = makeCards(1)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const card = cards.cards.get('src')
    const entry = card.rows.find((row) => row.item.path === 'src/a.js')
    entry.row.fire('click')
    cards.setSelected('src')
    cards.togglePop('src')
    cards.update(state, 0.016, camera())
    expect(entry.row.className).toContain('is-inspected')
    expect(card.element.className).toContain('is-selected')
    expect(card.element.className).toContain('is-pinned')

    cards.clearSelection()
    cards.update(state, 0.016, camera())

    const kept = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(kept.row.className).not.toContain('is-inspected')
    expect(card.element.className).not.toContain('is-selected')
    expect(card.element.className).not.toContain('is-pinned')
    cards.dispose()
  })
})

describe('idle frames', () => {
  it('does not walk the rows when nothing changed', () => {
    const state = makeState()
    const reads = countReads(state, 'src/a.js')
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const walked = reads()
    for (let frame = 0; frame < 5; frame += 1) cards.update(state, 0.016, camera())
    expect(reads()).toBe(walked)
  })

  it('walks the rows again for a new activity', () => {
    const state = makeState()
    const reads = countReads(state, 'src/a.js')
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const walked = reads()
    apply(state, touch('read', 'src/a.js', 2000, 'c2'))
    cards.update(state, 0.016, camera())
    expect(reads()).toBeGreaterThan(walked)
    const entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-read')
    expect(entry.note.textContent).toBe('r 1')
  })

  it('walks the rows again for a flash and repaints when it ends', () => {
    const state = makeState()
    const reads = countReads(state, 'src/a.js')
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashFile('src', 'src/a.js', 'white')
    const walked = reads()
    cards.update(state, 0.016, camera())
    expect(reads()).toBeGreaterThan(walked)
    let entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-flash-white')
    cards.update(state, 1.2, camera())
    entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).not.toContain('is-flash-white')
  })

  it('holds a flash while the replay is paused', () => {
    const state = makeState()
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashFile('src', 'src/a.js', 'white')
    for (let step = 0; step < 20; step += 1) cards.update(state, 0.5, camera(), null, 0)
    const entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-flash-white')
    cards.dispose()
  })

  it('runs a flash on replay time', () => {
    const state = makeState()
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashFile('src', 'src/a.js', 'white')
    cards.update(state, 0.3, camera())
    let entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-flash-white')
    cards.update(state, 0.3, camera(), null, 4)
    entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).not.toContain('is-flash-white')
    cards.dispose()
  })

  it('flashes only the file row white, never its folder card or folder row', () => {
    const state = makeState(['src/a.js'], ['src/a.js'])
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashFile('src', 'src/a.js', 'white')
    cards.update(state, 0.016, camera())
    const fileRow = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(fileRow.row.className).toContain('is-flash-white')
    expect(cards.cards.get('src').element.className).not.toContain('is-flash-white')
    const folderRow = cards.cards.get('').rows.find((row) => row.item.path === 'src')
    if (folderRow) expect(folderRow.row.className).not.toContain('is-flash-white')
    cards.dispose()
  })

  it('flashes a folder touch on its row in the parent card and not its own card', () => {
    const state = makeState(['src/a.js', 'docs/b.md', 'alpha/a.txt', 'beta/b.txt', 'gamma/c.txt'], ['src/a.js'])
    const { cards } = makeCards(0)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashCluster('gamma', 'white')
    cards.update(state, 0.016, camera())
    const folderRow = cards.cards.get('').rows.find((row) => row.item.path === 'gamma')
    expect(folderRow.row.className).toContain('is-flash-white')
    expect(cards.cards.get('gamma')).toBeUndefined()
    cards.dispose()
  })

  it('shows no white flash on a folder drawn as its own card', () => {
    const state = makeState(['src/a.js'], ['src'])
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    expect(cards.cards.get('src')).toBeTruthy()
    cards.flashCluster('src', 'white')
    cards.update(state, 0.016, camera())
    expect(cards.cards.get('src').element.className).not.toContain('is-flash-white')
    const folderRow = cards.cards.get('').rows.find((row) => row.item.path === 'src')
    expect(folderRow).toBeUndefined()
    cards.dispose()
  })

  it('flashes the nearest drawn card red with the failed folder name', () => {
    const state = makeState(['src/a.js', 'docs/b.md', 'alpha/a.txt', 'beta/b.txt', 'gamma/c.txt'], ['src/a.js'])
    const { cards } = makeCards(0)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    expect(cards.cards.get('gamma')).toBeUndefined()
    cards.flashCluster('gamma', 'red')
    cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    expect(root.element.className).toContain('is-flash-red')
    expect(root.band.textContent).toBe('FAILED gamma')
    const folderRow = root.rows.find((row) => row.item.path === 'gamma')
    expect(folderRow.row.className).toContain('is-flash-red')
    cards.dispose()
  })

  it('flashes the row and anchors the label on a card that is leaving', () => {
    const state = makeState(['src/model/deep/a.js', 'docs/b.md'], ['src/model/deep/a.js'])
    const { cards } = makeCards(0)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    expect(cards.cards.get('src/model/deep').leaving).toBe(false)
    state.agents.get('hermes').focus = ['docs/b.md']
    cards.update(state, 0.016, camera())
    const leaving = cards.cards.get('src/model/deep')
    expect(leaving.leaving).toBe(true)
    cards.flashFile('src/model/deep', 'src/model/deep/a.js', 'white')
    cards.update(state, 0.016, camera())
    const row = leaving.rows.find((entry) => entry.item.path === 'src/model/deep/a.js')
    expect(row.row.className).toContain('is-flash-white')
    const ancestor = cards.anchor('src', new THREE.Vector3())
    const skipped = cards.anchor('src/model/deep', new THREE.Vector3())
    const own = cards.anchor('src/model/deep', new THREE.Vector3(), true)
    expect(skipped.distanceTo(ancestor)).toBe(0)
    expect(own.distanceTo(ancestor)).toBeGreaterThan(0)
    cards.dispose()
  })

  it('marks and anchors a folder inside a leaving ancestor card', () => {
    const state = makeState(
      [
        'src/model/deep/a.js',
        'src/model/deep/sub/b.js',
        'src/model/deep/one/1.js',
        'src/model/deep/one/2.js',
        'src/model/deep/two/1.js',
        'src/model/deep/two/2.js',
        'src/model/deep/three/1.js',
        'src/model/deep/three/2.js',
        'docs/x.md',
      ],
      ['src/model/deep/a.js']
    )
    const { cards } = makeCards(0)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const leaving = cards.cards.get('src/model/deep')
    expect(leaving.leaving).toBe(false)
    expect(cards.cards.get('src/model/deep/sub')).toBeUndefined()
    state.agents.get('hermes').focus = ['docs/x.md']
    cards.update(state, 0.016, camera())
    expect(leaving.leaving).toBe(true)
    cards.flashCluster('src/model/deep/sub', 'red')
    cards.update(state, 0.016, camera())
    const row = leaving.rows.find((entry) => entry.item.path === 'src/model/deep/sub')
    expect(row.row.className).toContain('is-flash-red')
    const leavingAnchor = cards.anchor('src/model/deep/sub', new THREE.Vector3(), true)
    const olderAnchor = cards.anchor('src/model/deep/sub', new THREE.Vector3())
    expect(leavingAnchor.distanceTo(olderAnchor)).toBeGreaterThan(0)
    cards.dispose()
  })


  it('treats a speed that is not a finite number at or above zero as one', () => {
    const state = makeState()
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    for (const speed of [null, '', false, -2, Number.NaN]) {
      cards.flashFile('src', 'src/a.js', 'white')
      cards.update(state, 0.016, camera(), null, speed)
      let entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
      expect(entry.row.className).toContain('is-flash-white')
      cards.update(state, 1.2, camera(), null, speed)
      entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
      expect(entry.row.className).not.toContain('is-flash-white')
    }
    cards.dispose()
  })

  it('keeps a red failure on the file row and its card with the FAILED band', () => {
    const state = makeState(['src/a.js'], ['src/a.js'])
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    cards.flashFile('src', 'src/a.js', 'red')
    cards.update(state, 0.016, camera())
    const fileRow = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(fileRow.row.className).toContain('is-flash-red')
    expect(cards.cards.get('src').element.className).toContain('is-flash-red')
    expect(cards.cards.get('src').band.textContent).toBe('FAILED a.js')
    cards.dispose()
  })

  it('walks only the card a flash names, not a resting card beside it', () => {
    const state = makeState(['src/a.js', 'docs/b.md'], ['src/a.js'])
    const docs = countReads(state, 'docs/b.md')
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const before = docs()

    cards.flashFile('src', 'src/a.js', 'white')
    cards.update(state, 0.016, camera())
    expect(docs()).toBe(before)
    const entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-flash-white')
    cards.dispose()
  })

  it('walks every card when the room marks the rows after a run', () => {
    const state = makeState(['src/a.js', 'docs/b.md'], ['src/a.js'])
    const docs = countReads(state, 'docs/b.md')
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const before = docs()

    cards.markRows()
    cards.update(state, 0.016, camera())
    expect(docs()).toBeGreaterThan(before)
    cards.dispose()
  })

  it('paints a finished file when the room marks the rows at a run end', () => {
    const state = makeState()
    apply(state, touch('write', 'src/a.js', 1000, 'c1'))
    const { cards } = makeCards()
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-written')

    state.files.get('src/a.js').yellow = true
    state.latest += 1
    cards.update(state, 0.016, camera())
    expect(entry.row.className).toContain('is-written')

    cards.markRows()
    cards.update(state, 0.016, camera())
    expect(entry.row.className).toContain('is-finished')
    cards.dispose()
  })

  it('still paints a fade while the newest activity stays put', () => {
    const state = makeState(['src/deep/a.js'], ['src/deep/a.js'])
    const { cards } = makeCards(0)
    let clock = 5000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const root = cards.cards.get('')
    expect(Number(root.element.style.opacity)).toBeLessThan(1)
    clock += 200
    cards.update(state, 0.016, camera())
    expect(Number(root.element.style.opacity)).toBeGreaterThan(0)
    expect(Number(root.element.style.opacity)).toBeLessThan(1)
  })
})

function makeWideState(folders) {
  const files = []
  for (let index = 0; index < folders; index += 1) files.push(`d${index}/a.js`)
  const tree = makeTree({ root: 'demo', files })
  return createState(tree, [{ key: 'hermes', name: 'Hermes' }])
}

function settle(cards, state, cam, frames = 400) {
  for (let step = 0; step < frames; step += 1) cards.update(state, 0.016, cam)
}

describe('the frame cost of a card that did not move', () => {
  it('computes no anchor and writes no string over 171 resting cards', () => {
    const state = makeWideState(170)
    const { cards } = makeCards()
    const strings = createStrings(fakeScene())
    const cam = camera()
    cards.sync(state)
    cards.update(state, 0.016, cam)
    const anchorOf = (path, out) => cards.anchor(path ?? '', out)
    strings.build(cards.visibleLinks(), anchorOf)
    settle(cards, state, cam)
    strings.update(anchorOf)
    expect(cards.cards.size).toBe(171)

    const before = cards.stats()
    let written = 0
    for (let frame = 0; frame < 10; frame += 1) {
      cards.update(state, 0.016, cam)
      written += strings.update(anchorOf)
    }
    expect(cards.stats().anchors).toBe(before.anchors)
    expect(written).toBe(0)
    strings.dispose()
    cards.dispose()
  })

  it('recomputes the moved card and writes only the strings that end on it', () => {
    const state = makeWideState(170)
    const { cards } = makeCards()
    const strings = createStrings(fakeScene())
    const cam = camera()
    cards.sync(state)
    cards.update(state, 0.016, cam)
    const anchorOf = (path, out) => cards.anchor(path ?? '', out)
    strings.build(cards.visibleLinks(), anchorOf)
    settle(cards, state, cam)
    strings.update(anchorOf)

    const before = cards.stats()
    const moving = cards.cards.get('d5')
    let written = 0
    for (let frame = 0; frame < 4; frame += 1) {
      moving.home.x += 50
      cards.update(state, 0.016, cam)
      written += strings.update(anchorOf)
    }
    expect(cards.stats().anchors - before.anchors).toBe(4)
    expect(written).toBe(4)
    strings.dispose()
    cards.dispose()
  })

  it('computes a card width once and its offset once per size change', () => {
    const state = makeState(Array.from({ length: 8 }, (_, index) => `d0/f${index}.js`), [])
    const { cards } = makeCards()
    const cam = camera()
    cards.sync(state)
    cards.update(state, 0.016, cam)
    for (const path of cards.cards.keys()) cards.anchor(path, new THREE.Vector3())
    const before = cards.stats()
    expect(before.widths).toBe(cards.cards.size)

    cards.setOptions({ maxFiles: 8 })
    cards.update(state, 0.016, cam)
    cards.anchor('d0', new THREE.Vector3())
    const after = cards.stats()
    expect(after.widths).toBe(before.widths)
    expect(after.offsets).toBe(before.offsets + 1)

    for (let step = 0; step < 4; step += 1) cards.anchor('d0', new THREE.Vector3())
    expect(cards.stats().offsets).toBe(after.offsets)
    expect(cards.stats().widths).toBe(before.widths)
    cards.dispose()
  })

  it('moves the kept anchor when the camera turns', () => {
    const state = makeWideState(4)
    const { cards } = makeCards()
    const first = camera()
    cards.sync(state)
    cards.update(state, 0.016, first)
    const at = cards.anchor('d1', new THREE.Vector3()).clone()

    const turned = camera()
    turned.rotation.set(0.4, 0.7, 0)
    cards.update(state, 0.016, turned)
    const after = cards.anchor('d1', new THREE.Vector3())
    expect(after.distanceTo(at)).toBeGreaterThan(1)
    cards.dispose()
  })
})
