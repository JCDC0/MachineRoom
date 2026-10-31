import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCards } from '../src/engine/cards.js'
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

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = {
    createElement: (tag) => fakeElement(tag),
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
