import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SUB_ORCHESTRATOR_SCALE, agentPresence, createAgents, subOrchestratorPlace } from '../src/engine/agents.js'
import {
  HUB_RADIUS,
  HUB_Y,
  ORCHESTRATOR_HOME,
  ORCHESTRATOR_LIFT,
  PARK_LIFT,
  createHub,
  sectorSlotAngles,
  slotAngle,
} from '../src/engine/hub.js'
import { isOrchestrator, isSubOrchestrator, shapesFor } from '../src/engine/shapes.js'
import { sectorArcs } from '../src/model/hierarchy.js'

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

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
    { id: 'backend', name: 'Backend', lanes: ['claude'] },
  ],
}

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
  { key: 'hermes', name: 'Hermes' },
]

describe('sector slot angles', () => {
  it('uses the plain slot angles with no ladder or an empty one', () => {
    const keys = ['opencode', 'claude', 'hermes']
    for (const ladder of [null, { subs: [] }]) {
      const angles = sectorSlotAngles(ladder, keys)
      keys.forEach((key, index) => {
        expect(angles.get(key)).toBeCloseTo(slotAngle(index, keys.length))
      })
    }
  })

  it('puts each lane in the middle of its own sector when the sector holds one lane', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const angles = sectorSlotAngles(LADDER, keys)
    const arcs = sectorArcs(LADDER, keys)
    expect(angles.get('opencode')).toBeCloseTo((arcs[0].start + arcs[0].end) / 2)
    expect(angles.get('claude')).toBeCloseTo((arcs[1].start + arcs[1].end) / 2)
    expect(angles.get('hermes')).toBeCloseTo((arcs[2].start + arcs[2].end) / 2)
  })

  it('spreads two lanes inside one sector in roster order', () => {
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude'] }] }
    const keys = ['claude', 'opencode', 'hermes']
    const arcs = sectorArcs(ladder, keys)
    const angles = sectorSlotAngles(ladder, keys)
    const arc = arcs[0]
    expect(arc.lanes).toEqual(['claude', 'opencode'])
    expect(angles.get('claude')).toBeGreaterThan(arc.start)
    expect(angles.get('claude')).toBeLessThan(angles.get('opencode'))
    expect(angles.get('opencode')).toBeLessThan(arc.end)
  })

  it('gives the same angles for the same input', () => {
    const keys = ['opencode', 'claude', 'hermes']
    expect(sectorSlotAngles(LADDER, keys)).toEqual(sectorSlotAngles(LADDER, keys))
  })
})

describe('the place of a sub orchestrator', () => {
  it('floats above the middle of its arc at 0.7 of the main orchestrator', () => {
    const arc = { start: 0, end: Math.PI }
    const place = subOrchestratorPlace(arc)
    expect(place.x).toBeCloseTo(0)
    expect(place.z).toBeCloseTo(HUB_RADIUS)
    expect(place.y).toBeCloseTo(HUB_Y + ORCHESTRATOR_LIFT * 0.7)
    expect(SUB_ORCHESTRATOR_SCALE).toBe(0.7)
  })

  it('fills the vector it is given and leaves the arc alone', () => {
    const arc = { start: Math.PI / 2, end: Math.PI / 2 }
    const before = { ...arc }
    const out = new THREE.Vector3()
    expect(subOrchestratorPlace(arc, out)).toBe(out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(HUB_RADIUS)
    expect(arc).toEqual(before)
  })
})

describe('sub orchestrator agents', () => {
  it('tells a sub from the main orchestrator by its key or flag', () => {
    expect(isOrchestrator(ROSTER[0])).toBe(true)
    expect(isOrchestrator(ROSTER[1])).toBe(false)
    expect(isSubOrchestrator(ROSTER[1])).toBe(true)
    expect(isSubOrchestrator({ key: 'x', subOrchestrator: true })).toBe(true)
    expect(isOrchestrator({ key: 'sub-orchestrator', name: 'Sub Orchestrator' })).toBe(false)
  })

  it('never dims a sub orchestrator that has not run', () => {
    expect(agentPresence({ status: 'idle', key: 'sub-frontend' }, false).dim).toBe(false)
  })

  it('gives the main and every sub the armillary shape family', () => {
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'sub-frontend', name: 'Frontend' },
      { key: 'opencode', name: 'OpenCode' },
    ]
    expect(shapesFor(roster)).toEqual(['armillary', 'armillary', 'stella'])
  })
})

describe('the hub with a ladder', () => {
  it('draws one arc and one label per sector and parks the lanes inside them', () => {
    const scene = new THREE.Scene()
    const hub = createHub(scene, ROSTER)
    const ring = hub.group.getObjectByName('ring')
    const sectors = hub.group.getObjectByName('sectors')
    const slots = () => hub.group.children.filter((child) => child.name === 'slot')
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)

    hub.setLadder(LADDER)
    const arcs = sectorArcs(LADDER, ['opencode', 'claude', 'hermes'])
    const lines = sectors.children.filter((child) => child.isLine)
    const labels = sectors.children.filter((child) => child.isSprite)
    expect(ring.visible).toBe(false)
    expect(lines).toHaveLength(arcs.length)
    expect(labels).toHaveLength(arcs.length)
    for (const label of labels) {
      expect(Math.hypot(label.position.x, label.position.z)).toBeGreaterThan(HUB_RADIUS)
    }

    const angles = sectorSlotAngles(LADDER, ['opencode', 'claude', 'hermes'])
    const keys = ['opencode', 'claude', 'hermes']
    slots().forEach((marker, index) => {
      const angle = angles.get(keys[index])
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * HUB_RADIUS)
      expect(marker.position.z).toBeCloseTo(Math.sin(angle) * HUB_RADIUS)
    })

    hub.setLadder({ subs: [] })
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)
    slots().forEach((marker, index) => {
      const angle = slotAngle(index, 3)
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * HUB_RADIUS)
    })
    hub.dispose()
  })
})

describe('the agents with a ladder', () => {
  it('parks each lane in its sector and floats the sub above its arc', () => {
    const agents = createAgents(new THREE.Scene(), ROSTER, new THREE.Scene())
    agents.setLadder(LADDER)
    const keys = ['opencode', 'claude', 'hermes']
    const angles = sectorSlotAngles(LADDER, keys)
    const opencode = agents.views.get('opencode')
    expect(opencode.home.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    expect(opencode.home.x).toBeCloseTo(Math.cos(angles.get('opencode')) * HUB_RADIUS)
    expect(opencode.home.z).toBeCloseTo(Math.sin(angles.get('opencode')) * HUB_RADIUS)

    const sub = agents.views.get('sub-frontend')
    const arcs = sectorArcs(LADDER, keys)
    const place = subOrchestratorPlace(arcs[0])
    expect(sub.home.x).toBeCloseTo(place.x)
    expect(sub.home.y).toBeCloseTo(place.y)
    expect(sub.home.z).toBeCloseTo(place.z)
    expect(sub.scale).toBe(SUB_ORCHESTRATOR_SCALE)
    expect(sub.shapeName).toBe('armillary')
    expect(sub.orchestrator).toBe(false)
    expect(sub.subOrchestrator).toBe(true)
    expect(sub.orchestratorLink).toBeTruthy()

    const main = agents.views.get('orchestrator')
    expect(main.home.equals(ORCHESTRATOR_HOME)).toBe(true)
    expect(main.orchestrator).toBe(true)
    agents.dispose()
  })
})
