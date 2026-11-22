import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SUB_ORCHESTRATOR_SCALE,
  agentPresence,
  createAgents,
} from '../src/engine/agents.js'
import {
  HUB_RADIUS,
  HUB_Y,
  ORCHESTRATOR_HOME,
  PARK_LIFT,
  RING_FLOOR_GAP,
  RING_FLOOR_Y,
  RING_OPACITY,
  SECTOR_ARC_HALF_WIDTH,
  SECTOR_ARC_OPACITY,
  SUB_STAND_LIFT,
  arcDrawSpan,
  createHub,
  ringArcs,
  ringDrop,
  ringLayout,
  sectorArcRadii,
  sectorArcTone,
  sectorSlotAngles,
  sectorSubAngle,
  slotAngle,
} from '../src/engine/hub.js'
import { isOrchestrator, isSubOrchestrator, shapesFor } from '../src/engine/shapes.js'

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

  it('parks a single lane beside its sub on a sub sector and in the middle on level 0', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const angles = sectorSlotAngles(LADDER, keys)
    const arcs = ringArcs(LADDER, keys)
    expect(angles.get('opencode')).toBeCloseTo(arcs[0].start + ((arcs[0].end - arcs[0].start) * 3) / 4)
    expect(angles.get('claude')).toBeCloseTo(arcs[1].start + ((arcs[1].end - arcs[1].start) * 3) / 4)
    expect(angles.get('hermes')).toBeCloseTo((arcs[2].start + arcs[2].end) / 2)
  })

  it('spreads two lanes inside one sector in roster order', () => {
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude'] }] }
    const keys = ['claude', 'opencode', 'hermes']
    const arcs = ringArcs(ladder, keys)
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

describe('sector arcs a beginner can see', () => {
  it('leaves a gap at each end of an arc', () => {
    const arc = { start: 0.04, end: 2.054 }
    const draw = arcDrawSpan(arc.start, arc.end)
    expect(draw.start).toBeGreaterThan(arc.start)
    expect(draw.end).toBeLessThan(arc.end)
    expect(draw.end - draw.start).toBeCloseTo(arc.end - arc.start - 0.11)
  })

  it('never inverts a short arc and gives nothing for an empty one', () => {
    const small = arcDrawSpan(0, 0.2)
    expect(small.end).toBeGreaterThanOrEqual(small.start)
    expect(arcDrawSpan(1, 1)).toEqual({ start: 0, end: 0 })
    expect(arcDrawSpan(2, 1)).toEqual({ start: 0, end: 0 })
    expect(arcDrawSpan(Number.NaN, 1)).toEqual({ start: 0, end: 0 })
  })

  it('makes each arc brighter than the ring and the main arc dimmer than a sub arc', () => {
    const main = sectorArcTone(true)
    const sub = sectorArcTone(false)
    expect(main.center).toBe(SECTOR_ARC_OPACITY.main)
    expect(sub.center).toBe(SECTOR_ARC_OPACITY.sub)
    expect(sub.center).toBeGreaterThan(main.center)
    expect(main.center).toBeGreaterThan(RING_OPACITY)
    expect(main.edge).toBeLessThan(main.center)
    expect(sub.edge).toBeLessThan(sub.center)
  })

  it('draws a band a little wider than the ring line', () => {
    const radii = sectorArcRadii()
    expect(radii).toHaveLength(3)
    expect(radii[1]).toBe(HUB_RADIUS)
    expect(radii[2] - radii[0]).toBe(SECTOR_ARC_HALF_WIDTH * 2)
    expect(SECTOR_ARC_HALF_WIDTH).toBeGreaterThan(1)
  })
})

describe('the place of a sub orchestrator', () => {
  it('stands on the edge of its ring at its sector sub angle, above its lanes', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const layout = ringLayout(LADDER, keys)
    const agents = createAgents(new THREE.Scene(), [...ROSTER, { key: 'sub-backend', name: 'Backend', subOrchestrator: true }], new THREE.Scene())
    agents.setLadder(LADDER)
    for (const arc of layout.arcs) {
      if (arc.id === 'orchestrator') continue
      const ring = layout.ringOf(arc)
      const home = agents.views.get(`sub-${arc.id}`).home
      const angle = sectorSubAngle(arc)
      expect(home.x).toBeCloseTo(Math.cos(angle) * ring.radius)
      expect(home.z).toBeCloseTo(Math.sin(angle) * ring.radius)
      expect(home.y).toBeCloseTo(ring.y + SUB_STAND_LIFT)
    }
    expect(SUB_ORCHESTRATOR_SCALE).toBe(0.7)
    expect(SUB_STAND_LIFT).toBeGreaterThan(PARK_LIFT)
    agents.dispose()
  })

  it('keeps a sub with one lane off that lane on the x-z plane', () => {
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode'] }] }
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
      { key: 'opencode', name: 'OpenCode' },
    ]
    const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
    agents.setLadder(ladder)
    const sub = agents.views.get('sub-frontend')
    const lane = agents.views.get('opencode')
    expect(Math.hypot(sub.home.x - lane.home.x, sub.home.z - lane.home.z)).toBeGreaterThan(1)
    agents.dispose()
  })

  it('stacks a sub of a sub on the next ring down and keeps every agent above the floor', () => {
    const ladder = {
      subs: [
        { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
        { id: 'deep', name: 'Deep', parent: 'frontend', lanes: ['claude'] },
        { id: 'deeper', name: 'Deeper', parent: 'deep', lanes: ['hermes'] },
      ],
    }
    const roster = [
      ...ROSTER.filter((agent) => !agent.key.startsWith('sub-')),
      ...ladder.subs.map((sub) => ({ key: `sub-${sub.id}`, name: sub.name, subOrchestrator: true })),
    ]
    const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
    agents.setLadder(ladder)
    const high = agents.views.get('sub-frontend').home.y
    const mid = agents.views.get('sub-deep').home.y
    const low = agents.views.get('sub-deeper').home.y
    expect(high).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(low)
    for (const view of agents.views.values()) expect(view.home.y).toBeGreaterThanOrEqual(RING_FLOOR_Y + RING_FLOOR_GAP)
    expect(agents.views.get('hermes').home.y).toBeCloseTo(HUB_Y - 3 * ringDrop(3) + PARK_LIFT)
    agents.dispose()
  })
})

describe('sub orchestrator name and status labels', () => {
  it('shows the sub name label and status line even when its name matches its sector', () => {
    const agents = createAgents(new THREE.Scene(), ROSTER, new THREE.Scene())
    agents.setLadder(LADDER)
    const sub = agents.views.get('sub-frontend')
    expect(sub.label.visible).toBe(true)
    expect(sub.doing.visible).toBe(true)
    expect(agents.views.get('opencode').label.visible).toBe(true)
    expect(agents.views.get('orchestrator').label.visible).toBe(true)

    const world = { right: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, 1) }
    const terminals = {
      ensure() {},
      setVisible() {},
      setFade() {},
      remove() {},
      edgePoint(key, side, out) {
        out.set(0, 0, 0)
      },
    }
    const state = {
      agents: new Map([['sub-frontend', { status: 'working', label: 'planning', calls: new Map() }]]),
      latest: 0,
    }
    agents.update(state, 0.016, 1000, world, terminals)
    expect(sub.label.visible).toBe(true)
    expect(sub.doing.visible).toBe(true)

    agents.setLadder(null)
    expect(sub.label.visible).toBe(true)
    expect(sub.doing.visible).toBe(true)
    agents.dispose()
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
  it('draws one arc per sector with no text sprite and parks the lanes inside them', () => {
    const scene = new THREE.Scene()
    const hub = createHub(scene, ROSTER)
    const ring = hub.group.getObjectByName('ring')
    const sectors = hub.group.getObjectByName('sectors')
    const slots = () => hub.group.children.filter((child) => child.name === 'slot')
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)

    hub.setLadder(LADDER)
    const arcs = ringArcs(LADDER, ['opencode', 'claude', 'hermes'])
    const sectorsOf = () => sectors.children
    expect(ring.visible).toBe(false)
    expect(sectorsOf()).toHaveLength(arcs.length)
    for (const group of sectorsOf()) {
      const lines = group.children.filter((child) => child.isLine)
      const labels = group.children.filter((child) => child.isSprite)
      expect(lines).toHaveLength(3)
      expect(labels).toHaveLength(0)
    }
    const mainGroup = sectorsOf().find((group) => group.name === 'sector:orchestrator')
    const subGroup = sectorsOf().find((group) => group.name === 'sector:frontend')
    const brightest = (group) => Math.max(...group.children.filter((child) => child.isLine).map((line) => line.userData.baseOpacity))
    expect(brightest(mainGroup)).toBe(SECTOR_ARC_OPACITY.main)
    expect(brightest(subGroup)).toBe(SECTOR_ARC_OPACITY.sub)
    expect(brightest(subGroup)).toBeGreaterThan(brightest(mainGroup))
    expect(brightest(mainGroup)).toBeGreaterThan(RING_OPACITY)

    const angles = sectorSlotAngles(LADDER, ['opencode', 'claude', 'hermes'])
    const keys = ['opencode', 'claude', 'hermes']
    slots().forEach((marker, index) => {
      const key = keys[index]
      const angle = angles.get(key)
      const ring = ringLayout(LADDER, keys).ringOfKey(key)
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * ring.radius)
      expect(marker.position.z).toBeCloseTo(Math.sin(angle) * ring.radius)
      expect(marker.position.y).toBe(ring.y - HUB_Y)
    })

    hub.setLadder({ subs: [] })
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)
    hub.update(0, 0.016)
    expect(ring.material.opacity).toBeCloseTo(RING_OPACITY)
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
    const ring = ringLayout(LADDER, keys).ringOfKey('opencode')
    expect(opencode.home.y).toBeCloseTo(ring.y + PARK_LIFT)
    expect(opencode.home.x).toBeCloseTo(Math.cos(angles.get('opencode')) * ring.radius)
    expect(opencode.home.z).toBeCloseTo(Math.sin(angles.get('opencode')) * ring.radius)

    const sub = agents.views.get('sub-frontend')
    const arcs = ringArcs(LADDER, keys)
    const angle = sectorSubAngle(arcs[0])
    expect(sub.home.x).toBeCloseTo(Math.cos(angle) * ring.radius)
    expect(sub.home.y).toBeCloseTo(ring.y + SUB_STAND_LIFT)
    expect(sub.home.z).toBeCloseTo(Math.sin(angle) * ring.radius)
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

  it('keeps a lane in no sub on the main ring and a sub above its own code agents', () => {
    const roster = [...ROSTER, { key: 'agy', name: 'AGY' }]
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode'] }] }
    const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
    agents.setLadder(ladder)
    const keys = ['opencode', 'claude', 'hermes', 'agy']
    const angles = sectorSlotAngles(ladder, keys)
    const agy = agents.views.get('agy')
    expect(agy.home.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    expect(agy.home.x).toBeCloseTo(Math.cos(angles.get('agy')) * HUB_RADIUS)
    expect(agy.home.z).toBeCloseTo(Math.sin(angles.get('agy')) * HUB_RADIUS)
    const sub = agents.views.get('sub-frontend')
    const opencode = agents.views.get('opencode')
    expect(Math.hypot(sub.home.x, sub.home.z)).toBeCloseTo(Math.hypot(opencode.home.x, opencode.home.z))
    expect(sub.home.y).toBeGreaterThan(opencode.home.y)
    agents.dispose()
  })
})
