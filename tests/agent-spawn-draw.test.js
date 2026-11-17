import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  spawnDrawState,
  UNSEEN_OPACITY,
  UNSEEN_SCALE,
  agentPresence,
  createAgents,
} from '../src/engine/agents.js'
import { apply, createState } from '../src/model/state.js'

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  measureText: (text) => ({ width: String(text).length * 10 }),
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  fillText: () => {},
}

function element(tag) {
  if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext: () => context2d }
  const listeners = new Map()
  const node = {
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    removed: false,
    listeners,
    ownerDocument: { defaultView: { Element: function Element() {} } },
    append(...items) {
      node.children.push(...items)
    },
    remove() {
      node.removed = true
    },
    setAttribute() {},
    addEventListener(type, fn) {
      listeners.set(type, fn)
    },
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = { createElement: element, querySelectorAll: () => [] }
})

afterAll(() => {
  globalThis.document = savedDocument
})

function harness() {
  const scene = new THREE.Scene()
  const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
  const agents = createAgents(scene, roster, new THREE.Scene())
  const state = createState({ files: [], dirs: [], created: [] }, roster)
  const chips = new Map()
  const terminals = {
    ensure() {},
    setVisible(key, visible) {
      chips.set(key, { ...(chips.get(key) ?? { key }), visible })
    },
    setFade(key, alpha) {
      chips.set(key, { ...(chips.get(key) ?? { key }), alpha })
    },
    setOpen() {},
    remove() {},
    edgePoint: (key, side, out) => out.set(100, 290, 0),
  }
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(500, 400, 0),
  }
  return { agents, state, chips, terminals, world }
}

describe('spawnDrawState', () => {
  it('traces the pen, draws segments, and fades', () => {
    expect(spawnDrawState(0, 10)).toEqual({ penProgress: 0, segments: 0, penOpacity: 1 })
    expect(spawnDrawState(200, 10).penProgress).toBe(0.5)
    expect(spawnDrawState(1000, 10).segments).toBe(5)
    expect(spawnDrawState(1800, 10)).toEqual({ penProgress: 1, segments: 10, penOpacity: 0.5 })
    expect(spawnDrawState(2000, 10)).toEqual({ penProgress: 1, segments: 10, penOpacity: 0 })
    expect(spawnDrawState(0, 10, true)).toEqual({ penProgress: 1, segments: 10, penOpacity: 0 })
    expect(spawnDrawState(1000, 0).segments).toBe(0)
  })
})

describe('new views', () => {
  it('draws a child added after the first sync and leaves initial views complete', () => {
    const { agents, state, terminals, world } = harness()
    state.agents.set('first', { key: 'first', name: 'First', parent: 'a', status: 'working' })
    agents.update(state, 0.016, 1000, world, terminals)
    const first = agents.views.get('first')
    expect(first.shape.geometry.drawRange.count).toBe(Infinity)
    state.agents.set('second', { key: 'second', name: 'Second', parent: 'a', status: 'working' })
    agents.update(state, 0.016, 1100, world, terminals)
    const second = agents.views.get('second')
    const count = second.shape.geometry.getAttribute('position').count
    expect(second.shape.geometry.drawRange.count).toBeLessThan(count)
    agents.update(state, 0.016, 3100, world, terminals)
    expect(second.shape.geometry.drawRange.count).toBe(Infinity)
    agents.dispose()
  })
})
