import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAgents, shapeForNewAgent } from '../src/engine/agents.js'
import {
  HUB_RADIUS,
  HUB_Y,
  PARK_LIFT,
  READER_RADIUS,
  createHub,
  parkedKeysFor,
  readerPoint,
  slotAngle,
  takesHubSlot,
} from '../src/engine/hub.js'
import { createTerminals } from '../src/engine/terminals.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  letterSpacing: '',
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

const TREE = makeTree({ root: 'room', files: [], created: [] })

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator', shape: 'claude', role: 'ceo' },
  { key: 'opencode', name: 'OpenCode', shape: 'opencode' },
  { key: 'claude-session', name: 'Claude Code session', shape: 'claude' },
]

function world() {
  return {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(500, 400, 0),
  }
}

function harness(roster = ROSTER) {
  const scene = new THREE.Scene()
  const cssScene = new THREE.Scene()
  const agents = createAgents(scene, roster, cssScene)
  const terminals = createTerminals(cssScene, roster)
  const state = createState(TREE, roster)
  return { agents, terminals, state, cssScene, scene, world: world() }
}

function slotsOf(hub) {
  return hub.group.children.filter((child) => child.name === 'slot')
}

describe('which agents take a hub slot', () => {
  it('gives a slot to a lane and to no orchestrator, sub or session reader', () => {
    expect(takesHubSlot({ key: 'opencode', name: 'OpenCode' })).toBe(true)
    expect(takesHubSlot({ key: 'orchestrator', name: 'Orchestrator' })).toBe(false)
    expect(takesHubSlot({ key: 'sub-frontend', name: 'Frontend' })).toBe(false)
    expect(takesHubSlot({ key: 'claude-session', name: 'Claude Code session' })).toBe(false)
    expect(takesHubSlot({ key: 'opencode-session', name: 'OpenCode session' })).toBe(false)
    expect(takesHubSlot({ key: 'lane-x', name: 'Lane', sessionReader: true })).toBe(false)
    expect(takesHubSlot(null)).toBe(false)
  })

  it('lists the parked keys in roster order and once each', () => {
    const roster = [
      { key: 'opencode', name: 'OpenCode' },
      { key: 'claude-session', name: 'Claude Code session' },
      { key: 'claude', name: 'Claude Code' },
      { key: 'opencode', name: 'OpenCode again' },
    ]
    expect(parkedKeysFor(roster)).toEqual(['opencode', 'claude'])
    expect(parkedKeysFor(null)).toEqual([])
  })

  it('puts a session reader outside the ring, with no slot marker', () => {
    const point = readerPoint(0, 1)
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(READER_RADIUS)
    expect(point.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    expect(READER_RADIUS).toBeGreaterThan(HUB_RADIUS * 1.14)
  })
})

describe('the hub roster in place', () => {
  it('draws one slot per parked lane and updates it when the roster changes', () => {
    const hub = createHub(new THREE.Scene(), ROSTER)
    expect(slotsOf(hub)).toHaveLength(1)
    expect(hub.parkedKeys()).toEqual(['opencode'])

    hub.setRoster([...ROSTER, { key: 'hermes', name: 'Hermes', shape: 'hermes' }])
    expect(slotsOf(hub)).toHaveLength(2)
    expect(hub.parkedKeys()).toEqual(['opencode', 'hermes'])
    slotsOf(hub).forEach((marker, index) => {
      const angle = slotAngle(index, 2)
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * HUB_RADIUS)
      expect(marker.position.z).toBeCloseTo(Math.sin(angle) * HUB_RADIUS)
    })

    hub.setRoster([ROSTER[0], ROSTER[2]])
    expect(slotsOf(hub)).toHaveLength(0)
    expect(hub.parkedKeys()).toEqual([])
    hub.dispose()
  })
})

describe('the agent views when the roster changes', () => {
  it('adds a view and a chip for a new lane and re-spaces the parked lanes', () => {
    const first = harness([ROSTER[0], { key: 'opencode', name: 'OpenCode', shape: 'opencode' }])
    const opencode = first.agents.views.get('opencode')
    expect(opencode.index).toBe(0)
    expect(opencode.home.x).toBeCloseTo(Math.cos(slotAngle(0, 1)) * HUB_RADIUS)

    first.agents.setRoster([ROSTER[0], { key: 'hermes', name: 'Hermes', shape: 'hermes' }], first.terminals)
    expect(first.agents.views.has('opencode')).toBe(false)
    expect(first.terminals.terminals.has('opencode')).toBe(false)
    expect(first.agents.pickables.some((picker) => picker.userData.key === 'opencode')).toBe(false)
    const hermes = first.agents.views.get('hermes')
    expect(hermes).toBeTruthy()
    expect(hermes.index).toBe(0)
    expect(hermes.home.x).toBeCloseTo(Math.cos(slotAngle(0, 1)) * HUB_RADIUS)
    expect(hermes.home.z).toBeCloseTo(Math.sin(slotAngle(0, 1)) * HUB_RADIUS)
    expect(first.terminals.terminals.has('hermes')).toBe(true)
    first.agents.dispose()
  })

  it('moves the remaining lane to its new slot when another lane goes', () => {
    const { agents, terminals } = harness([
      ROSTER[0],
      { key: 'opencode', name: 'OpenCode', shape: 'opencode' },
      { key: 'claude', name: 'Claude Code', shape: 'claude' },
    ])
    expect(agents.views.get('claude').index).toBe(1)
    agents.setRoster([ROSTER[0], { key: 'claude', name: 'Claude Code', shape: 'claude' }], terminals)
    const claude = agents.views.get('claude')
    expect(claude.index).toBe(0)
    expect(claude.home.x).toBeCloseTo(Math.cos(slotAngle(0, 1)) * HUB_RADIUS)
    expect(claude.home.z).toBeCloseTo(Math.sin(slotAngle(0, 1)) * HUB_RADIUS)
    agents.dispose()
  })

  it('removes the view, callout and chip of an agent that is gone', () => {
    const { agents, terminals } = harness()
    const view = agents.views.get('opencode')
    expect(view.callout.element.removed).toBe(false)
    agents.setRoster([ROSTER[0], ROSTER[2]], terminals)
    expect(agents.views.has('opencode')).toBe(false)
    expect(view.callout.element.removed).toBe(true)
    expect(view.callout.object.parent).toBe(null)
    expect(terminals.terminals.has('opencode')).toBe(false)
    agents.dispose()
  })

  it('removes the children of an agent that is gone', () => {
    const { agents, terminals, state, world: sight } = harness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'opencode', child: 'opencode~1', name: 'Helper', label: 'reading' })
    agents.update(state, 0.016, 1000, sight, terminals)
    expect(agents.views.has('opencode~1')).toBe(true)
    agents.setRoster([ROSTER[0], ROSTER[2]], terminals)
    expect(agents.views.has('opencode~1')).toBe(false)
    expect(terminals.terminals.has('opencode~1')).toBe(false)
    agents.dispose()
  })
})

describe('a session reader before its first run', () => {
  it('takes no slot and draws nothing', () => {
    const { agents, terminals, state, world: sight } = harness()
    const view = agents.views.get('claude-session')
    expect(view.index).toBe(-1)
    expect(view.sessionReader).toBe(true)
    agents.update(state, 0.016, 1000, sight, terminals)
    expect(view.group.visible).toBe(false)
    expect(view.link.visible).toBe(false)
    expect(view.orchestratorLink.visible).toBe(false)
    expect(terminals.terminals.get('claude-session').object.visible).toBe(false)
    agents.dispose()
  })

  it('draws after its first run starts', () => {
    const { agents, terminals, state, world: sight } = harness()
    const view = agents.views.get('claude-session')
    apply(state, { time: 1000, type: 'run.start', agent: 'claude-session', runId: 's1' })
    agents.update(state, 0.016, 1000, sight, terminals)
    expect(view.group.visible).toBe(true)
    expect(terminals.terminals.get('claude-session').object.visible).toBe(true)
    agents.dispose()
  })
})

describe('the shape of a new agent', () => {
  it('keeps a harness shape that is free and takes the next spare otherwise', () => {
    expect(shapeForNewAgent({ key: 'orchestrator', name: 'Orchestrator' })).toBe('armillary')
    expect(shapeForNewAgent({ key: 'opencode', name: 'OpenCode', shape: 'opencode' })).toBe('stella')
    const used = ['stella']
    expect(shapeForNewAgent({ key: 'opencode2', name: 'OpenCode 2', shape: 'opencode' }, used)).not.toBe('stella')
  })
})
