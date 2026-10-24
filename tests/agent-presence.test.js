import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
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

describe('agentPresence', () => {
  it('dims an idle agent that has not run', () => {
    expect(agentPresence({ status: 'idle' }, false)).toEqual({
      dim: true,
      opacity: UNSEEN_OPACITY,
      scale: UNSEEN_SCALE,
    })
  })

  it('keeps a queued agent full before its first run starts', () => {
    expect(agentPresence({ status: 'queued' }, false).dim).toBe(false)
  })

  it('keeps a working agent full', () => {
    expect(agentPresence({ status: 'working' }, false).dim).toBe(false)
  })

  it('keeps an agent that ran full when it is idle again', () => {
    expect(agentPresence({ status: 'idle' }, true).dim).toBe(false)
  })

  it('never dims the orchestrator', () => {
    const presence = agentPresence({ status: 'idle', name: 'Orchestrator' }, false)
    expect(presence.dim).toBe(false)
    expect(presence.scale).toBe(1)
  })
})

describe('an agent that has not run in the room', () => {
  it('draws small and faint with no chip and no link', () => {
    const { agents, state, chips, terminals, world } = harness()
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    expect(view.group.scale.x).toBeCloseTo(UNSEEN_SCALE, 5)
    expect(view.shape.material.opacity).toBeCloseTo(0.35 * UNSEEN_OPACITY, 5)
    expect(view.link.visible).toBe(false)
    expect(chips.get('a').visible).toBe(false)
    expect(view.presenceOpacity).toBeCloseTo(UNSEEN_OPACITY, 5)
    agents.dispose()
  })

  it('grows over 600 ms when queued and keeps its chip', () => {
    const { agents, state, chips, terminals, world } = harness()
    agents.update(state, 0.016, 1000, world, terminals)
    apply(state, { time: 1000, type: 'run.queued', agent: 'a' })
    agents.update(state, 0.3, 1000, world, terminals)
    const view = agents.views.get('a')
    expect(chips.get('a').visible).toBe(true)
    expect(view.group.scale.x).toBeCloseTo(0.85, 5)
    expect(view.group.scale.x).toBeGreaterThan(UNSEEN_SCALE)
    expect(view.group.scale.x).toBeLessThan(1)

    agents.update(state, 0.3, 1300, world, terminals)
    expect(view.group.scale.x).toBeCloseTo(1, 5)
    agents.dispose()
  })
})

describe('an agent that has run', () => {
  let savedWindow

  beforeEach(() => {
    savedWindow = globalThis.window
    globalThis.window = undefined
  })

  afterEach(() => {
    globalThis.window = savedWindow
  })

  it('keeps its chip after the run ends', () => {
    const { agents, state, chips, terminals, world } = harness()
    apply(state, { time: 1000, type: 'run.start', agent: 'a', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    apply(state, { time: 2000, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 2000, world, terminals)
    expect(chips.get('a').visible).toBe(true)
    expect(agents.views.get('a').group.scale.x).toBeCloseTo(1, 5)
    agents.dispose()
  })
})

describe('an agent under reduced motion', () => {
  let savedWindow

  beforeEach(() => {
    savedWindow = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) }
  })

  afterEach(() => {
    globalThis.window = savedWindow
  })

  it('grows to full size and opacity at once', () => {
    const { agents, state, terminals, world } = harness()
    agents.update(state, 0.016, 1000, world, terminals)
    apply(state, { time: 1000, type: 'run.start', agent: 'a', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    expect(view.group.scale.x).toBeCloseTo(1, 5)
    expect(view.shape.material.opacity).toBeCloseTo(1, 5)
    agents.dispose()
  })
})
