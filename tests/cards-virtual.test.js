import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ROW_H, createCards, rowOffset, rowWindow } from '../src/engine/cards.js'
import { makeTree } from '../src/model/paths.js'
import { createState } from '../src/model/state.js'

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
    clientHeight: 0,
    scrollTop: 0,
    ownerDocument: { defaultView: { Element: function Element() {} } },
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
    fire(type, event = { stopPropagation() {} }) {
      for (const fn of listeners.get(type) ?? []) fn(event)
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
  globalThis.document = { createElement: (tag) => fakeElement(tag) }
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

function files(count) {
  return Array.from({ length: count }, (_, index) => `src/f${index}.js`)
}

function setup(count) {
  const state = createState(makeTree({ root: 'demo', files: files(count) }), [{ key: 'hermes', name: 'Hermes' }])
  if (count > 70) state.agents.get('hermes').focus = ['src/f70.js']
  const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1, maxFiles: 4 })
  cards.sync(state)
  cards.update(state, 0.016, camera())
  return { cards, state, card: cards.cards.get('src') }
}

function rowNames(card) {
  return card.items.children
    .filter((node) => node.className.startsWith('mr-item'))
    .map((node) => node.children[0].textContent)
}

describe('a card with 60 items or fewer', () => {
  it('keeps one row per item and no spacer', () => {
    const { cards, card } = setup(60)
    expect(card.virtual).toBe(false)
    expect(card.rows).toHaveLength(60)
    expect(card.items.children).toHaveLength(60)
    expect(card.items.children.every((row) => row.className.startsWith('mr-item '))).toBe(true)
    expect(card.items.children[0].className).toBe('mr-item is-file')
    cards.dispose()
  })
})

describe('a card with more than 2,000 items', () => {
  it('draws the focused row first and a + N more row', () => {
    const { cards, card } = setup(2500)
    expect(card.view.items).toHaveLength(2000)
    expect(card.view.hiddenItems).toBe(500)
    expect(card.view.items[0].path).toBe('src/f70.js')
    const more = card.items.children.find((node) => node.className === 'mr-card-more')
    expect(more).toBeTruthy()
    expect(more.textContent).toBe('+ 500 more')
    cards.dispose()
  })
})

describe('a card with 61 items', () => {
  it('draws only the rows in the window, with a spacer at each end', () => {
    const { cards, state, card } = setup(61)
    expect(card.virtual).toBe(true)
    card.items.scrollTop = 0
    card.items.fire('scroll')
    const win = rowWindow(61, 0, 4 * ROW_H)
    expect(card.rows).toHaveLength(win.last)
    expect(card.rows.length).toBeLessThan(61)
    const gaps = card.items.children.filter((node) => node.className === 'mr-card-gap')
    expect(gaps).toHaveLength(2)
    expect(gaps[0].style.height).toBe('0px')
    expect(gaps[1].style.height).toBe(`${(61 - win.last) * ROW_H}px`)
    expect(card.items.children[0]).toBe(gaps[0])
    expect(card.items.children.at(-1)).toBe(gaps[1])
    expect(card.items.children.filter((node) => node.className.startsWith('mr-item ')).length).toBe(win.last)
    expect(cards.setOptions({ maxFiles: 8 })).toBe(true)
    cards.update(state, 0.016, camera())
    expect(card.rows).toHaveLength(rowWindow(61, 0, 8 * ROW_H).last)
    cards.dispose()
  })
})

describe('a view the card already holds', () => {
  it('keeps its rows and builds the row index only at the first lookup', () => {
    const tree = makeTree({ root: 'demo', files: [...files(80), 'docs/a.md', 'docs/b.md'] })
    const state = createState(tree, [{ key: 'hermes', name: 'Hermes' }])
    state.agents.get('hermes').focus = ['docs/a.md']
    const cards = createCards(fakeScene(), { glScene: fakeScene(), alwaysDepth: 1, maxFiles: 4 })
    cards.sync(state)
    cards.update(state, 0.016, camera())
    const card = cards.cards.get('src')
    const wanted = card.wanted
    const rows = card.rows
    const names = rowNames(card)
    expect(card.rowIndex).toBeNull()

    state.agents.get('hermes').focus = ['docs/b.md']
    cards.update(state, 0.016, camera())

    expect(card.view.items).toBe(wanted)
    expect(card.wanted).toBe(wanted)
    expect(card.rows).toBe(rows)
    expect(rowNames(card)).toEqual(names)
    expect(card.rowIndex).toBeNull()
    cards.dispose()
  })
})

describe('the row index of a card', () => {
  it('maps every path to its place in one pass', () => {
    const { cards, card } = setup(80)
    expect(card.rowIndex).toBeNull()
    cards.slotPosition('src', 'src/f71.js', new THREE.Vector3())
    expect(card.rowIndex).toBeInstanceOf(Map)
    expect(card.rowIndex.size).toBe(card.rowPaths.length)
    for (const path of ['src/f0.js', 'src/f70.js', 'src/f71.js', 'src/f79.js']) {
      expect(card.rowIndex.get(path)).toBe(card.rowPaths.indexOf(path))
    }

    const index = card.rowIndex.get('src/f71.js')
    card.items.scrollTop = index * ROW_H
    card.items.fire('scroll')
    const at = cards.slotPosition('src', 'src/f71.js', new THREE.Vector3())
    const center = cards.center('src')
    expect(at.y).not.toBe(center.y)
    expect(at.y - center.y).toBeCloseTo(rowOffset(4, 0) * card.scale, 6)
    cards.dispose()
  })
})

describe('a row that scrolls out of view', () => {
  function crowded() {
    const made = setup(80)
    const state = made.state
    state.files.get('src/f70.js').reads = 2
    state.files.get('src/f71.js').writes = 1
    state.files.get('src/f72.js').yellow = true
    state.files.get('src/f73.js').failed = true
    made.cards.setInspected('src/f70.js')
    made.cards.update(state, 0.016, camera())
    return made
  }

  function scroll(card, top) {
    card.items.scrollTop = top
    card.items.fire('scroll')
  }

  function scrollTo(card, path) {
    const index = card.wanted.findIndex((item) => item.path === path)
    card.items.scrollTop = Math.max(0, index) * ROW_H
    card.items.fire('scroll')
  }

  it('comes back with its read, written, finished, failed, active and inspected marks', () => {
    const { cards, card } = crowded()
    scroll(card, 0)
    const first = card.drawn.get('src/f70.js')
    expect(first).toBeTruthy()
    expect(first.row.className).toContain('is-read')
    expect(first.row.className).toContain('is-active')
    expect(first.row.className).toContain('is-inspected')
    expect(first.note.textContent).toBe('r 2')

    scrollTo(card, 'src/f71.js')
    expect(card.drawn.has('src/f70.js')).toBe(false)
    expect(rowNames(card)).not.toContain('f70.js')
    expect(card.drawn.get('src/f71.js').row.className).toContain('is-written')
    expect(card.drawn.get('src/f71.js').note.textContent).toBe('w 1')
    expect(card.drawn.get('src/f72.js').row.className).toContain('is-finished')
    expect(card.drawn.get('src/f72.js').note.textContent).toBe('finished')
    expect(card.drawn.get('src/f73.js').row.className).toContain('is-failed')
    expect(card.drawn.get('src/f73.js').note.textContent).toBe('failed')

    scroll(card, 0)
    const again = card.drawn.get('src/f70.js')
    expect(again).toBeTruthy()
    expect(again).not.toBe(first)
    expect(again.row.className).toContain('is-read')
    expect(again.row.className).toContain('is-active')
    expect(again.row.className).toContain('is-inspected')
    expect(again.note.textContent).toBe('r 2')

    const now = performance.now()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now)
    cards.flashFile('src', 'src/f70.js', 'white')
    scrollTo(card, 'src/f71.js')
    expect(card.drawn.get('src/f70.js')).toBeUndefined()
    scroll(card, 0)
    expect(card.drawn.get('src/f70.js').row.className).toContain('is-flash-white')
    clock.mockRestore()
    cards.dispose()
  })

  it('looks up a row out of view from the card itself and flashes nothing', () => {
    const { cards, card } = crowded()
    scroll(card, 0)
    const center = cards.center('src')
    const slot = cards.slotPosition('src', 'src/f71.js', new THREE.Vector3())
    expect(slot.equals(center)).toBe(true)
    const edge = cards.edgePoint('src', 'src/f71.js', 1, new THREE.Vector3())
    expect(edge.x).toBeGreaterThan(center.x)
    expect(edge.y).toBe(center.y)

    const count = card.items.children.length
    cards.flashFile('src', 'src/f71.js', 'white')
    expect(card.items.children).toHaveLength(count)
    expect(card.drawn.has('src/f71.js')).toBe(false)

    scrollTo(card, 'src/f71.js')
    const drawn = card.drawn.get('src/f71.js')
    const at = cards.slotPosition('src', 'src/f71.js', new THREE.Vector3())
    expect(at.y).not.toBe(center.y)
    expect(at.y - center.y).toBeCloseTo(rowOffset(4, 0) * card.scale, 6)
    expect(drawn.row.className).toContain('is-written')
    cards.dispose()
  })
})
