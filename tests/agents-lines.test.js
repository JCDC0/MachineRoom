import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_LINK_OPACITY,
  SUB_ORCHESTRATOR_LINK_OPACITY,
  createAgents,
  lineParentKey,
} from '../src/engine/agents.js'
import { createState } from '../src/model/state.js'

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude'] },
    { id: 'backend', name: 'Backend', lanes: ['hermes'] },
  ],
}

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'sub-backend', name: 'Backend', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
  { key: 'hermes', name: 'Hermes' },
]

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

function harness(roster = ROSTER) {
  const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
  const state = createState({ files: [], dirs: [], created: [] }, roster)
  const terminals = {
    ensure() {},
    remove() {},
    setFade() {},
    setOpen() {},
    setVisible() {},
    edgePoint: (key, side, out) => out.set(100, 290, 0),
  }
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(500, 400, 0),
  }
  return { agents, state, terminals, world }
}

function lineEnds(line) {
  const array = line.geometry.attributes.position.array
  return {
    start: { x: array[0], y: array[1], z: array[2] },
    end: { x: array[3], y: array[4], z: array[5] },
  }
}

function expectAt(point, place) {
  expect(point.x).toBeCloseTo(place.x, 2)
  expect(point.y).toBeCloseTo(place.y, 2)
  expect(point.z).toBeCloseTo(place.z, 2)
}

describe('lineParentKey', () => {
  it('sends every lane to the main with no ladder', () => {
    expect(lineParentKey('opencode', null)).toBe('orchestrator')
    expect(lineParentKey('opencode', undefined)).toBe('orchestrator')
    expect(lineParentKey('opencode', { subs: [] })).toBe('orchestrator')
  })

  it('sends a lane in a sub to that sub', () => {
    expect(lineParentKey('opencode', LADDER)).toBe('sub-frontend')
    expect(lineParentKey('claude', LADDER)).toBe('sub-frontend')
    expect(lineParentKey('hermes', LADDER)).toBe('sub-backend')
  })

  it('keeps a lane in no sub on the main', () => {
    expect(lineParentKey('agy', LADDER)).toBe('orchestrator')
  })

  it('answers the main for an unknown key or the main itself', () => {
    expect(lineParentKey('nobody', LADDER)).toBe('orchestrator')
    expect(lineParentKey('', LADDER)).toBe('orchestrator')
    expect(lineParentKey(null, LADDER)).toBe('orchestrator')
    expect(lineParentKey('orchestrator', LADDER)).toBe('orchestrator')
    expect(lineParentKey('sub-frontend', LADDER)).toBe('orchestrator')
  })
})

describe('the lane line with a ladder', () => {
  it('ends a lane line on its sub and keeps the sub line on the main', () => {
    const { agents, state, terminals, world } = harness()
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const sub = agents.views.get('sub-frontend')
    const main = agents.views.get('orchestrator')

    const laneEnds = lineEnds(lane.orchestratorLink)
    expectAt(laneEnds.start, sub.group.position)
    expectAt(laneEnds.end, lane.group.position)
    expect(lane.orchestratorLink.material.color.getHex()).toBe(0xffffff)
    expect(lane.orchestratorLink.material.opacity).toBe(ORCHESTRATOR_LINK_OPACITY)

    const subEnds = lineEnds(sub.orchestratorLink)
    expectAt(subEnds.start, main.group.position)
    expectAt(subEnds.end, sub.group.position)
    expect(sub.orchestratorLink.material.opacity).toBe(SUB_ORCHESTRATOR_LINK_OPACITY)
    agents.dispose()
  })

  it('falls back to the main when the sub has no view yet', () => {
    const roster = ROSTER.filter((agent) => agent.key !== 'sub-frontend')
    const { agents, state, terminals, world } = harness(roster)
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const main = agents.views.get('orchestrator')
    expect(agents.views.has('sub-frontend')).toBe(false)
    expectAt(lineEnds(lane.orchestratorLink).start, main.group.position)
    agents.dispose()
  })

  it('re-aims the lines in place when the ladder changes', () => {
    const { agents, state, terminals, world } = harness()
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const sub = agents.views.get('sub-frontend')
    const main = agents.views.get('orchestrator')
    expectAt(lineEnds(lane.orchestratorLink).start, sub.group.position)

    const count = agents.views.size
    agents.setLadder(null)
    expect(agents.views.size).toBe(count)
    expect(agents.views.get('opencode')).toBe(lane)
    expectAt(lineEnds(lane.orchestratorLink).start, main.group.position)
    agents.dispose()
  })
})
