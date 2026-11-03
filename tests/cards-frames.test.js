import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCards, DANCE_LIFT } from '../src/engine/cards.js'
import { DANCE_RISE_MS, DANCE_SETTLE_MS } from '../src/engine/hub.js'
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
    const now = performance.now()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now)
    cards.flashFile('src', 'src/a.js', 'white')
    const walked = reads()
    cards.update(state, 0.016, camera())
    expect(reads()).toBeGreaterThan(walked)
    let entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).toContain('is-flash-white')
    clock.mockReturnValue(now + 1200)
    cards.update(state, 0.016, camera())
    entry = cards.cards.get('src').rows.find((row) => row.item.path === 'src/a.js')
    expect(entry.row.className).not.toContain('is-flash-white')
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
