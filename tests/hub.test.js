import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AGENT_RING_BASE,
  AGENT_RING_GROW,
  AGENT_RING_MAX_OPACITY,
  AGENT_RING_MS,
  AGENT_RING_OPACITY_FLOOR,
  DANCE_RISE_MS,
  DANCE_SETTLE_MS,
  HUB_RADIUS,
  HUB_Y,
  HUB_RING_GROW,
  HUB_RING_MS,
  HUB_RING_POOL,
  PARK_LIFT,
  RING_FLOOR_GAP,
  RING_FLOOR_Y,
  RING_LEVEL_MAX,
  RING_MAX_OPACITY,
  SEAT_LABEL_OPACITY,
  SEAT_LABEL_OUT,
  SEAT_LABEL_SCALE,
  SECTOR_ARC_OPACITY,
  SECTOR_GLOW_MS,
  SECTOR_LABEL_DROP,
  SECTOR_LABEL_INSET,
  SECTOR_LABEL_OUT,
  SECTOR_LABEL_SPREAD,
  SUB_RING_DROP,
  SUB_RING_OPACITY,
  SWAY_LIFT,
  SWAY_RATE,
  SWAY_SCALE,
  createHub,
  danceEnvelope,
  ringArcs,
  ringDepth,
  ringDrop,
  ringLayout,
  ringLevels,
  ringPulse,
  ringRadius,
  ringY,
  seatRingPoint,
  startDanceEnvelope,
  sectorGlow,
  sectorIdForKey,
  sectorLabelAngle,
  sectorLabelPoint,
  sectorLabelRadius,
  sectorLaneAngles,
  sectorSlotAngles,
  sectorSubAngle,
  slotAngle,
  topRingPoint,
  topRingSeats,
  workingKeys,
} from '../src/engine/hub.js'
import { OVERVIEW } from '../src/engine/camera.js'
import { latticeLevels } from '../src/engine/void.js'
import { YELLOW } from '../src/engine/sprites.js'

const drawnLabels = []

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
  fillText: (text) => {
    drawnLabels.push(String(text))
  },
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
    { id: 'backend', name: 'Backend', lanes: ['claude', 'hermes'] },
    { id: 'empty', name: 'Empty', lanes: [] },
  ],
}

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'sub-backend', name: 'Backend', subOrchestrator: true },
  { key: 'sub-empty', name: 'Empty', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
  { key: 'hermes', name: 'Hermes' },
]

const THREE_LANES = {
  subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude', 'hermes'] }],
}

function arcCentre(group) {
  return group.children.filter((child) => child.isLine)[1]
}

describe('where a sector parks its lanes', () => {
  it('keeps level 0 lanes evenly spaced inside the arc', () => {
    const one = sectorLaneAngles({ start: 0.2, end: 1.2, lanes: ['opencode'], level: 0 })
    expect(one).toHaveLength(1)
    expect(one[0]).toBeCloseTo(0.7)

    const arc = { start: 0, end: 3, lanes: ['opencode', 'claude', 'hermes'], level: 0 }
    const three = sectorLaneAngles(arc)
    expect(three).toHaveLength(3)
    expect(three[0] - arc.start).toBeCloseTo(0.5)
    expect(three[1] - three[0]).toBeCloseTo(1)
    expect(three[2] - three[1]).toBeCloseTo(1)
    expect(arc.end - three[2]).toBeCloseTo(0.5)
    expect(three[1]).toBeCloseTo((arc.start + arc.end) / 2)
  })

  it('gives a sub arc lanes + 1 even places with the sub at floor(lanes / 2) and middle on even counts', () => {
    const oneArc = { start: 0.2, end: 1.2, lanes: ['opencode'], level: 1 }
    expect(sectorSubAngle(oneArc)).toBeCloseTo(0.45)
    expect(sectorLaneAngles(oneArc)).toHaveLength(1)
    expect(sectorLaneAngles(oneArc)[0]).toBeCloseTo(0.95)

    const twoArc = { start: 0, end: 3, lanes: ['opencode', 'claude'], level: 1 }
    expect(sectorSubAngle(twoArc)).toBeCloseTo(1.5)
    expect(sectorLaneAngles(twoArc)[0]).toBeCloseTo(0.5)
    expect(sectorLaneAngles(twoArc)[1]).toBeCloseTo(2.5)

    for (const count of [1, 2, 3, 5]) {
      const lanes = Array.from({ length: count }, (_, index) => `lane-${index}`)
      const arc = { start: 0.3, end: 2.7, lanes, level: 1 }
      const span = arc.end - arc.start
      const subAngle = sectorSubAngle(arc)
      const laneAngles = sectorLaneAngles(arc)
      expect(laneAngles).toHaveLength(count)
      expect(subAngle).toBeGreaterThan(arc.start)
      expect(subAngle).toBeLessThan(arc.end)
      for (let i = 0; i < laneAngles.length; i++) {
        expect(laneAngles[i]).toBeGreaterThan(arc.start)
        expect(laneAngles[i]).toBeLessThan(arc.end)
        expect(Math.abs(laneAngles[i] - subAngle)).toBeGreaterThanOrEqual(span / (count + 1) - 1e-9)
        if (i > 0) expect(laneAngles[i]).toBeGreaterThan(laneAngles[i - 1])
      }
    }
  })

  it('parks nothing in an empty sector', () => {
    expect(sectorLaneAngles({ start: 0, end: 1, lanes: [], level: 1 })).toEqual([])
    expect(sectorLaneAngles({ start: 1, end: 1, lanes: ['opencode'], level: 1 })).toEqual([])
    expect(sectorLaneAngles(null)).toEqual([])
    expect(sectorSubAngle({ start: 0, end: 1, lanes: [], level: 1 })).toBeCloseTo(0.5)
    expect(sectorSubAngle(null)).toBe(0)
  })

  it('maps each lane of a ladder through the pure placement', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const arcs = ringArcs(THREE_LANES, keys)
    const angles = sectorSlotAngles(THREE_LANES, keys)
    const expected = sectorLaneAngles(arcs[0])
    keys.forEach((key, index) => {
      expect(angles.get(key)).toBeCloseTo(expected[index])
    })
  })

  it('leaves an empty sub sector out of the slots and does not move the other lanes', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const arcs = ringArcs(LADDER, keys)
    const angles = sectorSlotAngles(LADDER, keys)
    expect(angles.size).toBe(3)
    expect([...angles.keys()]).toEqual(keys)
    const frontend = arcs.find((arc) => arc.id === 'frontend')
    const backend = arcs.find((arc) => arc.id === 'backend')
    expect(angles.get('opencode')).toBeCloseTo(frontend.start + ((frontend.end - frontend.start) * 3) / 4)
    expect(angles.get('claude')).toBeCloseTo(backend.start + (backend.end - backend.start) / 6)
    expect(angles.get('hermes')).toBeCloseTo(backend.start + ((backend.end - backend.start) * 5) / 6)
  })
})

describe('the top ring of the hub', () => {
  it('puts an Orchestrator alone at the centre', () => {
    const seats = topRingSeats({})
    expect(seats.mode).toBe('centre')
    expect(seats.seats.get('orchestrator')).toBe('centre')
    expect(topRingSeats({ topKey: 'orchestrator' }).mode).toBe('centre')
  })

  it('stacks the chosen top above the Orchestrator when there are two', () => {
    const seats = topRingSeats({ topKey: 'claude-session' })
    expect(seats.mode).toBe('stack')
    expect(seats.order).toEqual(['claude-session', 'orchestrator'])
    expect(seats.seats.get('claude-session')).toBe('top')
    expect(seats.seats.get('orchestrator')).toBe('under')
  })

  it('orbits more than two top agents at equal angles', () => {
    const seats = topRingSeats({ topKey: 'claude-session', extraKeys: ['opencode-session'] })
    expect(seats.mode).toBe('orbit')
    expect(seats.order).toEqual(['claude-session', 'orchestrator', 'opencode-session'])
    for (const key of seats.order) expect(seats.seats.get(key)).toBe('orbit')
  })

  it('puts a chosen top alone at the centre when no Orchestrator is drawn', () => {
    const seats = topRingSeats({ topKey: 'claude-session', withOrchestrator: false })
    expect(seats.mode).toBe('centre')
    expect(seats.order).toEqual(['claude-session'])
    expect(seats.seats.get('claude-session')).toBe('centre')
  })

  it('stacks the chosen top above a second session when no Orchestrator is drawn', () => {
    const seats = topRingSeats({ topKey: 'claude-session', extraKeys: ['opencode-session'], withOrchestrator: false })
    expect(seats.mode).toBe('stack')
    expect(seats.order).toEqual(['claude-session', 'opencode-session'])
    expect(seats.seats.get('claude-session')).toBe('top')
    expect(seats.seats.get('opencode-session')).toBe('under')
  })

  it('keeps the Orchestrator at the centre when no session is chosen', () => {
    const seats = topRingSeats({ topKey: 'orchestrator', extraKeys: ['claude-session'] })
    expect(seats.mode).toBe('centre')
    expect(seats.seats.get('orchestrator')).toBe('centre')
    expect(seats.seats.get('claude-session')).toBe('reader')
    expect(seats.order).toEqual(['orchestrator', 'claude-session'])
  })

  it('puts an orbiting top agent on the ring at the hub height plus the park lift', () => {
    const point = topRingPoint(slotAngle(0, 2))
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(HUB_RADIUS)
    expect(point.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    expect(topRingPoint(Number.NaN).y).toBeCloseTo(HUB_Y + PARK_LIFT)
  })
})

describe('the park ring of each level', () => {
  it('keeps the drop at 260 for one level and shrinks it above the floor for more', () => {
    expect(SUB_RING_DROP).toBe(260)
    expect(RING_FLOOR_Y).toBe(latticeLevels().floor)
    expect(ringDrop(1)).toBe(260)
    expect(ringDrop(2)).toBe(130)
    expect(ringDrop(4)).toBe(65)
    expect(ringY(0, 3)).toBe(HUB_Y)
    for (let count = 1; count <= 4; count += 1) {
      expect(ringY(count, count)).toBeGreaterThanOrEqual(RING_FLOOR_Y + RING_FLOOR_GAP)
    }
    expect(ringDrop(2, -1000)).toBe(260)
    expect(ringDrop(3, HUB_Y)).toBe(0)
  })

  it('gives a sub the level of its parent plus one and stops at the depth less one', () => {
    const subs = [
      { id: 'a', lanes: [] },
      { id: 'b', parent: 'a', lanes: [] },
      { id: 'c', parent: 'b', lanes: [] },
      { id: 'd', parent: 'c', lanes: [] },
      { id: 'e', parent: 'd', lanes: [] },
      { id: 'x', parent: 'y', lanes: [] },
      { id: 'y', parent: 'x', lanes: [] },
    ]
    const levels = ringLevels({ subs })
    expect([...levels.values()]).toEqual([1, 2, 3, 3, 3, 2, 2])
    expect(ringLevels({ subs }, 4)).toEqual(levels)
    expect(ringLevels({ subs }, 3).get('d')).toBe(2)
    expect(ringLevels({ subs }, 2).get('e')).toBe(1)
    expect(ringLevels({ subs: [{ id: 'q', parent: 'orchestrator' }] }, 1).get('q')).toBe(1)
  })

  it('puts a sub of a sub on ring 1 at depth 2, as the seats allow', () => {
    const ladder = { subs: [{ id: 'a', lanes: ['l1'] }, { id: 'b', parent: 'a', lanes: ['l2'] }] }
    const keys = ['l1', 'l2']
    expect(ringLevels(ladder, 2).get('b')).toBe(1)
    const layout = ringLayout(ladder, keys, 2)
    expect(layout.count).toBe(1)
    expect(layout.ringOfKey('l2').level).toBe(1)
  })

  it('widens a ring only when its slots need it', () => {
    expect(ringRadius(0, 99)).toBe(HUB_RADIUS)
    expect(ringRadius(1, 3)).toBe(HUB_RADIUS)
    expect(ringRadius(1, 40)).toBeGreaterThan(HUB_RADIUS)
  })

  it('reads the subagent depth as a cap from 1 to 4 and keeps 4 when it cannot', () => {
    expect(RING_LEVEL_MAX).toBe(4)
    expect(ringDepth(1)).toBe(1)
    expect(ringDepth(2)).toBe(2)
    expect(ringDepth(4)).toBe(4)
    expect(ringDepth(9)).toBe(RING_LEVEL_MAX)
    expect(ringDepth(0)).toBe(1)
    expect(ringDepth(2.7)).toBe(2)
    expect(ringDepth({ limit: 3 })).toBe(3)
    expect(ringDepth({ depth: 2 })).toBe(2)
    expect(ringDepth(undefined)).toBe(RING_LEVEL_MAX)
    expect(ringDepth(null)).toBe(RING_LEVEL_MAX)
    expect(ringDepth('two')).toBe(RING_LEVEL_MAX)
  })

  it('draws only the ring levels the depth allows', () => {
    const ladder = {
      subs: [
        { id: 'a', name: 'A', lanes: ['l1'] },
        { id: 'b', parent: 'a', name: 'B', lanes: ['l2'] },
        { id: 'c', parent: 'b', name: 'C', lanes: ['l3'] },
        { id: 'd', parent: 'c', name: 'D', lanes: ['l4'] },
      ],
    }
    const keys = ['l1', 'l2', 'l3', 'l4']
    expect(ringLayout(ladder, keys).count).toBe(3)
    expect(ringLayout(ladder, keys, 4).count).toBe(3)
    expect(ringLayout(ladder, keys, 3).count).toBe(2)
    expect(ringLayout(ladder, keys, 2).count).toBe(1)
    expect(ringLayout(ladder, keys, 1).count).toBe(1)
    expect(ringLayout(ladder, keys, 4).ringOfKey('l4').level).toBe(3)
    expect(ringLayout(ladder, keys, 1).ringOfKey('l4').level).toBe(1)
  })

  it('keeps the 4 levels until the room is told otherwise', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    expect(hub.depth()).toBe(RING_LEVEL_MAX)
    expect(hub.setDepth(2)).toBe(2)
    expect(hub.depth()).toBe(2)
    expect(hub.setDepth(9)).toBe(RING_LEVEL_MAX)
    expect(hub.setDepth(undefined)).toBe(RING_LEVEL_MAX)
    hub.dispose()
  })

  it('draws fewer level rings after setDepth lowers the cap', () => {
    const ladder = {
      subs: [
        { id: 'a', name: 'A', lanes: ['opencode'] },
        { id: 'b', parent: 'a', name: 'B', lanes: ['claude'] },
        { id: 'c', parent: 'b', name: 'C', lanes: ['hermes'] },
      ],
    }
    const hub = createHub(new THREE.Scene(), ROSTER, ladder)
    const rings = () => hub.group.getObjectByName('level-rings').children
    expect(rings()).toHaveLength(3)
    hub.setDepth(1)
    expect(rings()).toHaveLength(1)
    hub.setDepth(4)
    expect(rings()).toHaveLength(3)
    hub.dispose()
  })

  it('spreads the subs of one level at equal angles and keeps their lanes in their own arc', () => {
    const ladder = {
      subs: [
        { id: 'a', name: 'A', lanes: ['l1'] },
        { id: 'b', name: 'B', lanes: ['l2', 'l3'] },
        { id: 'c', name: 'C', parent: 'a', lanes: ['l4'] },
      ],
    }
    const arcs = ringArcs(ladder, ['l1', 'l2', 'l3', 'l4', 'l5'])
    const byId = Object.fromEntries(arcs.map((arc) => [arc.id, arc]))
    expect(byId.a.level).toBe(1)
    expect(byId.b.level).toBe(1)
    expect(byId.c.level).toBe(2)
    expect(byId.orchestrator.level).toBe(0)
    expect(byId.orchestrator.lanes).toEqual(['l5'])
    const mid = (arc) => (arc.start + arc.end) / 2
    expect(mid(byId.b) - mid(byId.a)).toBeCloseTo(Math.PI)
    expect(byId.c.end - byId.c.start).toBeGreaterThan(Math.PI * 1.9)
    const layout = ringLayout(ladder, ['l1', 'l2', 'l3', 'l4', 'l5'])
    expect(layout.count).toBe(2)
    expect(layout.rings.map((ring) => ring.y)).toEqual([HUB_Y, HUB_Y - 130, HUB_Y - 260])
    expect(layout.ringOfKey('l4')).toBe(layout.rings[2])
    expect(layout.ringOfKey('l5')).toBe(layout.rings[0])
    expect(layout.ringOfKey('nobody')).toBe(layout.rings[0])
    expect(ringLayout(ladder, ['l1', 'l2', 'l3', 'l4', 'l5']).arcs).toEqual(layout.arcs)
  })

  it('draws one faint ring per level the ladder uses', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const rings = hub.group.getObjectByName('level-rings').children
    expect(rings).toHaveLength(1)
    expect(rings[0].name).toBe('sub-ring')
    expect(rings[0].position.y).toBe(-SUB_RING_DROP)
    expect(rings[0].material.opacity).toBe(SUB_RING_OPACITY)
    expect(rings[0].material.opacity).toBeLessThan(SECTOR_ARC_OPACITY.main)
    hub.setLadder({ subs: [...LADDER.subs, { id: 'deep', name: 'Deep', parent: 'frontend', lanes: [] }] })
    expect(hub.group.getObjectByName('level-rings').children.map((ring) => ring.position.y)).toEqual([-130, -260])
    hub.setLadder(null)
    expect(hub.group.getObjectByName('level-rings').children).toHaveLength(0)
    hub.dispose()
  })

  it('puts a sub lane slot tick on its ring, not the main one', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const ticks = hub.group.getObjectByName('ticks').children[0].geometry.getAttribute('position')
    let lowerTicks = 0
    for (let index = 0; index < ticks.count; index += 1) {
      if (ticks.getY(index) === -SUB_RING_DROP) lowerTicks += 1
    }
    expect(lowerTicks).toBeGreaterThan(0)
    expect(lowerTicks % 2).toBe(0)
    hub.dispose()
  })

  it('draws the subs with no lane too', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, { subs: [{ id: 'empty', name: 'Empty', lanes: [] }] })
    expect(hub.group.getObjectByName('level-rings').children).toHaveLength(1)
    hub.dispose()
  })
})

describe('where a sector name sits', () => {
  it('puts the name outside the ring and below its plane, just inside the arc start', () => {
    const arc = { start: 0.2, end: 1.2 }
    const angle = sectorLabelAngle(arc)
    expect(angle).toBeGreaterThan(arc.start)
    expect(angle).toBeLessThan((arc.start + arc.end) / 2)
    expect(angle).toBeCloseTo(arc.start + (arc.end - arc.start) * SECTOR_LABEL_INSET)
    const point = sectorLabelPoint(angle, HUB_RADIUS, 2)
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(sectorLabelRadius(HUB_RADIUS, 2))
    expect(Math.hypot(point.x, point.z)).toBeGreaterThan(HUB_RADIUS + 200)
    expect(point.y).toBe(-SECTOR_LABEL_DROP)
    expect(point.y).toBeLessThan(0)
  })

  it('moves the name further out as sectors are added', () => {
    expect(sectorLabelRadius(HUB_RADIUS, 2)).toBe(HUB_RADIUS + SECTOR_LABEL_OUT + SECTOR_LABEL_SPREAD)
    expect(sectorLabelRadius(HUB_RADIUS, 4)).toBe(HUB_RADIUS + SECTOR_LABEL_OUT + SECTOR_LABEL_SPREAD * 3)
    expect(sectorLabelRadius(HUB_RADIUS, 4)).toBeGreaterThan(sectorLabelRadius(HUB_RADIUS, 3))
  })

  it('fills the vector it is given and leaves the angle alone', () => {
    const out = new THREE.Vector3()
    expect(sectorLabelPoint(Math.PI / 2, HUB_RADIUS, 3, out)).toBe(out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(sectorLabelRadius(HUB_RADIUS, 3))
  })

  it('falls back to the first angle when the arc is empty or malformed', () => {
    expect(sectorLabelAngle(null)).toBe(0)
    expect(sectorLabelAngle({ start: 1, end: 1 })).toBe(0)
    expect(sectorLabelAngle({ start: Number.NaN, end: 1 })).toBe(0)
  })
})

describe('which sector an agent belongs to', () => {
  it('names the sub sector for its key and for each of its lanes', () => {
    expect(sectorIdForKey('sub-frontend', LADDER)).toBe('frontend')
    expect(sectorIdForKey('opencode', LADDER)).toBe('frontend')
    expect(sectorIdForKey('claude', LADDER)).toBe('backend')
  })

  it('keeps the main orchestrator and a lane in no sub in the main sector', () => {
    expect(sectorIdForKey('orchestrator', LADDER)).toBe('orchestrator')
    expect(sectorIdForKey('agy', LADDER)).toBe('orchestrator')
    expect(sectorIdForKey('', LADDER)).toBe('orchestrator')
    expect(sectorIdForKey('opencode', null)).toBe('orchestrator')
  })
})

function roomState(entries) {
  const agents = new Map()
  for (const [key, status] of entries) agents.set(key, { key, status })
  return { agents }
}

describe('which agents a sector lights for', () => {
  it('names no key when no agent works', () => {
    expect(workingKeys(roomState([]))).toEqual([])
    expect(workingKeys(roomState([['opencode', 'idle'], ['claude', 'done']]))).toEqual([])
    expect(workingKeys(null)).toEqual([])
    expect(workingKeys(undefined, undefined)).toEqual([])
  })

  it('names a working lane, in its own sector', () => {
    const state = roomState([['opencode', 'working'], ['claude', 'idle']])
    expect(workingKeys(state)).toEqual(['opencode'])
    expect(sectorIdForKey('opencode', LADDER)).toBe('frontend')
  })

  it('names a working sub orchestrator', () => {
    const state = roomState([['sub-backend', 'working'], ['claude', 'queued']])
    expect(workingKeys(state)).toEqual(['sub-backend'])
    expect(sectorIdForKey('sub-backend', LADDER)).toBe('backend')
  })

  it('keeps the previous list when the set has not changed', () => {
    const state = roomState([['opencode', 'working'], ['sub-backend', 'working']])
    const first = workingKeys(state)
    expect(first).toEqual(['opencode', 'sub-backend'])
    expect(workingKeys(state, first)).toBe(first)
    state.agents.get('opencode').status = 'idle'
    expect(workingKeys(state, first)).toEqual(['sub-backend'])
  })

  it('calls once across frames while the working set holds', () => {
    const state = roomState([['opencode', 'working'], ['claude', 'idle']])
    const calls = []
    let last = []
    for (let frame = 0; frame < 60; frame++) {
      const next = workingKeys(state, last)
      if (next !== last) {
        calls.push(next)
        last = next
      }
    }
    expect(calls).toEqual([['opencode']])
  })

  it('gives an empty list when the last working agent stops', () => {
    const state = roomState([['opencode', 'working']])
    const first = workingKeys(state)
    state.agents.get('opencode').status = 'done'
    const next = workingKeys(state, first)
    expect(next).toEqual([])
    expect(next).not.toBe(first)
  })
})

describe('how a sector returns to rest', () => {
  it('holds full brightness while one of its agents works', () => {
    expect(sectorGlow(0, true, 0)).toBe(1)
    expect(sectorGlow(0.2, true, 1)).toBe(1)
    expect(sectorGlow(1, true, 0.5, true)).toBe(1)
  })

  it('returns to rest over one second when none works', () => {
    expect(SECTOR_GLOW_MS).toBe(1000)
    expect(sectorGlow(1, false, 0.25)).toBeCloseTo(0.75)
    expect(sectorGlow(1, false, 0.5)).toBeCloseTo(0.5)
    expect(sectorGlow(0.2, false, 1)).toBe(0)
    expect(sectorGlow(1, false, 2)).toBe(0)
  })

  it('returns at once under reduced motion', () => {
    expect(sectorGlow(1, false, 0.016, true)).toBe(0)
  })

  it('starts at rest and never runs past its ends', () => {
    expect(sectorGlow(0, false, 0.5)).toBe(0)
    expect(sectorGlow(-1, false, 0.5)).toBe(0)
    expect(sectorGlow(2, false, 0.5)).toBeCloseTo(0.5)
    expect(sectorGlow(0.5, false, Number.NaN)).toBeCloseTo(0.5)
    expect(sectorGlow(0.5, false, -1)).toBeCloseTo(0.5)
  })
})

describe('the sway the room shows', () => {
  it('lifts a card 16 units and grows it 5 percent on a slow wave', () => {
    expect(SWAY_LIFT).toBe(16)
    expect(SWAY_SCALE).toBe(0.05)
    expect(SWAY_RATE).toBeGreaterThan(0)
  })
})

describe('the dance envelope', () => {
  it('rises over 90 ms with an ease out and settles over 420 ms', () => {
    expect(DANCE_RISE_MS).toBe(90)
    expect(DANCE_SETTLE_MS).toBe(420)
    expect(danceEnvelope(0, 1, 0)).toBe(0)
    expect(danceEnvelope(0, 1, DANCE_RISE_MS / 2)).toBeCloseTo(1 - 0.5 ** 3, 10)
    expect(danceEnvelope(0, 1, DANCE_RISE_MS)).toBeCloseTo(1, 10)
    expect(danceEnvelope(0, 1, DANCE_RISE_MS + DANCE_SETTLE_MS / 2)).toBeCloseTo(0.5, 10)
    expect(danceEnvelope(0, 1, DANCE_RISE_MS + DANCE_SETTLE_MS)).toBe(0)
    expect(danceEnvelope(0, 1, DANCE_RISE_MS + DANCE_SETTLE_MS * 2)).toBe(0)
  })

  it('starts a second beat from the value the first one reached', () => {
    const first = { from: 0, to: 1, at: 0 }
    const at = DANCE_RISE_MS + 100
    const before = danceEnvelope(first.from, first.to, at)
    const next = startDanceEnvelope(first, 1, at)
    expect(next.from).toBeCloseTo(before, 10)
    expect(next.to).toBe(1)
    expect(danceEnvelope(next.from, next.to, 0)).toBeCloseTo(before, 10)
    expect(danceEnvelope(next.from, next.to, DANCE_RISE_MS)).toBeCloseTo(1, 10)
  })

  it('never jumps back to rest when a softer beat lands', () => {
    const first = { from: 0, to: 1, at: 0 }
    const at = DANCE_RISE_MS + 100
    const before = danceEnvelope(first.from, first.to, at)
    const next = startDanceEnvelope(first, 0.2, at)
    expect(next.from).toBeCloseTo(before, 10)
    expect(next.to).toBeGreaterThanOrEqual(before)
    expect(danceEnvelope(next.from, next.to, 0)).toBeCloseTo(before, 10)
  })
})

describe('the ring a beat sends out', () => {
  it('grows from its own radius and fades over its time', () => {
    const start = ringPulse(HUB_RADIUS, HUB_RING_GROW, 0, HUB_RING_MS, 1)
    expect(start.radius).toBe(HUB_RADIUS)
    expect(start.opacity).toBeCloseTo(RING_MAX_OPACITY, 10)
    const half = ringPulse(HUB_RADIUS, HUB_RING_GROW, HUB_RING_MS / 2, HUB_RING_MS, 1)
    expect(half.radius).toBeCloseTo(HUB_RADIUS + HUB_RING_GROW * (1 - 0.5 ** 2), 10)
    expect(half.opacity).toBeCloseTo(RING_MAX_OPACITY / 2, 10)
    const end = ringPulse(HUB_RADIUS, HUB_RING_GROW, HUB_RING_MS, HUB_RING_MS, 1)
    expect(end.radius).toBe(HUB_RADIUS + HUB_RING_GROW)
    expect(end.opacity).toBe(0)
    const soft = ringPulse(HUB_RADIUS, HUB_RING_GROW, 0, HUB_RING_MS, 0.25)
    expect(soft.opacity).toBeCloseTo(RING_MAX_OPACITY * 0.25, 10)
    const out = {}
    expect(ringPulse(130, 130, 450, 900, 1, 0.32, out)).toBe(out)
  })

  it('gives an agent ring an opacity floor for a weak beat and fades to 0', () => {
    const weakStart = ringPulse(AGENT_RING_BASE, AGENT_RING_GROW, 0, AGENT_RING_MS, 0.1, AGENT_RING_MAX_OPACITY, null, AGENT_RING_OPACITY_FLOOR)
    expect(weakStart.opacity).toBeCloseTo(AGENT_RING_MAX_OPACITY * AGENT_RING_OPACITY_FLOOR, 10)
    const weakEnd = ringPulse(AGENT_RING_BASE, AGENT_RING_GROW, AGENT_RING_MS, AGENT_RING_MS, 0.1, AGENT_RING_MAX_OPACITY, null, AGENT_RING_OPACITY_FLOOR)
    expect(weakEnd.opacity).toBe(0)
    const strongStart = ringPulse(AGENT_RING_BASE, AGENT_RING_GROW, 0, AGENT_RING_MS, 1, AGENT_RING_MAX_OPACITY, null, AGENT_RING_OPACITY_FLOOR)
    expect(strongStart.opacity).toBeCloseTo(AGENT_RING_MAX_OPACITY, 10)
    const strongEnd = ringPulse(AGENT_RING_BASE, AGENT_RING_GROW, AGENT_RING_MS, AGENT_RING_MS, 1, AGENT_RING_MAX_OPACITY, null, AGENT_RING_OPACITY_FLOOR)
    expect(strongEnd.opacity).toBe(0)
  })

  it('takes one ring from a fixed pool on each beat', () => {
    let clock = 1000
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
      const rings = hub.group.children.filter((child) => child.name === 'beat-ring')
      expect(rings).toHaveLength(HUB_RING_POOL)
      expect(hub.beat(1)).toBe(true)
      clock += HUB_RING_MS / 2
      hub.update(0.6, 0.016)
      const lit = rings.filter((ring) => ring.visible)
      expect(lit).toHaveLength(1)
      expect(lit[0].scale.x).toBeGreaterThan(HUB_RADIUS)
      expect(lit[0].material.opacity).toBeGreaterThan(0)
      clock += HUB_RING_MS
      hub.update(1.2, 0.016)
      expect(rings.some((ring) => ring.visible)).toBe(false)
      hub.dispose()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the hub ring on a beat', () => {
  it('brightens over the envelope and settles back', () => {
    let clock = 1000
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
      const line = arcCentre(hub.group.getObjectByName('sector:frontend'))
      const base = line.userData.baseOpacity
      expect(hub.beat(1)).toBe(true)
      clock += DANCE_RISE_MS
      hub.update(0, 0.016)
      expect(line.material.opacity).toBeGreaterThan(base)
      clock += DANCE_SETTLE_MS
      hub.update(0.5, 0.016)
      expect(line.material.opacity).toBeCloseTo(base)
      hub.dispose()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('an equal ladder', () => {
  it('leaves the hub geometry and a run pulse alone', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const builds = hub.builds()
    const same = { subs: LADDER.subs.map((sub) => ({ ...sub, lanes: [...sub.lanes] })) }
    expect(hub.setLadder(same)).toBe(false)
    expect(hub.builds()).toBe(builds)

    hub.pulse(0xffffff, 1)
    const line = arcCentre(hub.group.getObjectByName('sector:frontend'))
    const base = line.userData.baseOpacity
    expect(hub.setLadder({ subs: same.subs.map((sub) => ({ ...sub })) })).toBe(false)
    hub.update(0, 0.016)
    expect(line.material.opacity).toBeGreaterThan(base)

    expect(hub.setLadder(null)).toBe(true)
    expect(hub.builds()).toBe(builds + 1)
    hub.dispose()
  })
})

describe('the hub arc of a working sector', () => {
  it('brightens to full white and returns over one second without touching the rest of the ring', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const front = arcCentre(hub.group.getObjectByName('sector:frontend'))
    const back = arcCentre(hub.group.getObjectByName('sector:backend'))
    const base = SECTOR_ARC_OPACITY.sub

    hub.setWorking(['opencode'])
    hub.update(0, 0.016)
    expect(front.material.opacity).toBeCloseTo(1)
    expect(back.material.opacity).toBeCloseTo(base)

    hub.setWorking([])
    hub.update(1, 0.5)
    expect(front.material.opacity).toBeCloseTo(base + (1 - base) * 0.5)
    expect(back.material.opacity).toBeCloseTo(base)

    hub.update(1.5, 0.6)
    expect(front.material.opacity).toBeCloseTo(base)
    hub.dispose()
  })

  it('lights a sector when its sub works', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const back = arcCentre(hub.group.getObjectByName('sector:backend'))
    hub.setWorking(['sub-backend'])
    hub.update(0, 0.016)
    expect(back.material.opacity).toBeCloseTo(1)
    hub.dispose()
  })

  it('returns at once under reduced motion', () => {
    const savedWindow = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    try {
      const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
      const front = arcCentre(hub.group.getObjectByName('sector:frontend'))
      hub.setWorking(['opencode'])
      hub.update(0, 0.016)
      expect(front.material.opacity).toBeCloseTo(1)
      hub.setWorking([])
      hub.update(0.016, 0.016)
      expect(front.material.opacity).toBeCloseTo(SECTOR_ARC_OPACITY.sub)
      hub.dispose()
    } finally {
      globalThis.window = savedWindow
    }
  })
})

describe('the seats on the park rings', () => {
  function seatLabels(hub) {
    return hub.group.getObjectByName('seat-labels').children
  }

  function labelFor(hub, ring) {
    return seatLabels(hub).find((sprite) => sprite.userData.ring === ring)
  }

  it('writes one label per ring with a limit', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const layout = ringLayout(LADDER, hub.parkedKeys())
    drawnLabels.length = 0
    hub.setSeatCounts([
      { ring: 0, taken: 2, limit: 4 },
      { ring: 1, taken: 1, limit: 3 },
    ])
    expect(seatLabels(hub)).toHaveLength(2)
    expect(drawnLabels).toContain('2 / 4')
    expect(drawnLabels).toContain('1 / 3')
    const top = labelFor(hub, 0)
    const angle = -OVERVIEW.yaw
    expect(Math.hypot(top.position.x, top.position.z)).toBeCloseTo(HUB_RADIUS + SEAT_LABEL_OUT)
    expect(top.position.x).toBeCloseTo(Math.cos(angle) * (HUB_RADIUS + SEAT_LABEL_OUT))
    expect(top.position.z).toBeCloseTo(Math.sin(angle) * (HUB_RADIUS + SEAT_LABEL_OUT))
    expect(top.position.y).toBe(0)
    const lower = labelFor(hub, 1)
    expect(Math.hypot(lower.position.x, lower.position.z)).toBeCloseTo(layout.rings[1].radius + SEAT_LABEL_OUT)
    expect(lower.position.x).toBeCloseTo(Math.cos(angle) * (layout.rings[1].radius + SEAT_LABEL_OUT))
    expect(lower.position.z).toBeCloseTo(Math.sin(angle) * (layout.rings[1].radius + SEAT_LABEL_OUT))
    expect(lower.position.y).toBe(layout.rings[1].y - HUB_Y)
    hub.dispose()
  })

  it('turns a full ring yellow and leaves the other white', () => {
    expect(SEAT_LABEL_SCALE).toBe(1.5)
    expect(SEAT_LABEL_OPACITY).toBe(0.8)
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    hub.setSeatCounts([
      { ring: 0, taken: 4, limit: 4 },
      { ring: 1, taken: 1, limit: 4 },
    ])
    const full = labelFor(hub, 0)
    const room = labelFor(hub, 1)
    expect(full.material.color.getHex()).toBe(YELLOW)
    expect(full.material.opacity).toBe(1)
    expect(room.material.color.getHex()).toBe(0xffffff)
    expect(room.material.opacity).toBe(0.8)
    expect(room.scale.y).toBe(40 * 1.5)
    hub.dispose()
  })

  it('keeps each ring seat label at the same point for 1, 2, 3 and 4 lanes and with and without a sub', () => {
    const expectedRing0 = seatRingPoint(0)
    const ring0Points = []
    for (const laneCount of [1, 2, 3, 4]) {
      const lanes = Array.from({ length: laneCount }, (_, index) => ({ key: `l${index + 1}`, name: `Lane ${index + 1}` }))
      const hub = createHub(new THREE.Scene(), [{ key: 'orchestrator', name: 'Orchestrator' }, ...lanes])
      hub.setSeatCounts([{ ring: 0, taken: laneCount, limit: 4 }])
      const label = labelFor(hub, 0)
      ring0Points.push({ x: label.position.x, y: label.position.y, z: label.position.z })
      hub.dispose()
    }
    const subRoster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
      { key: 'l1', name: 'Lane 1' },
      { key: 'l2', name: 'Lane 2' },
      { key: 'l3', name: 'Lane 3' },
      { key: 'l4', name: 'Lane 4' },
    ]
    const subLadder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['l1', 'l2'] }] }
    const hubWithSub = createHub(new THREE.Scene(), subRoster, subLadder)
    hubWithSub.setSeatCounts([
      { ring: 0, taken: 2, limit: 4 },
      { ring: 1, taken: 2, limit: 4 },
    ])
    const ring0WithSub = labelFor(hubWithSub, 0)
    ring0Points.push({ x: ring0WithSub.position.x, y: ring0WithSub.position.y, z: ring0WithSub.position.z })
    hubWithSub.dispose()
    for (const point of ring0Points) {
      expect(point.x).toBeCloseTo(expectedRing0.x)
      expect(point.y).toBe(expectedRing0.y)
      expect(point.z).toBeCloseTo(expectedRing0.z)
    }

    const ring1Points = []
    for (const laneCount of [1, 2, 3, 4]) {
      const keys = Array.from({ length: laneCount }, (_, index) => `l${index + 1}`)
      const roster = [
        { key: 'orchestrator', name: 'Orchestrator' },
        { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
        ...keys.map((key, index) => ({ key, name: `Lane ${index + 1}` })),
      ]
      const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: keys }] }
      const hub = createHub(new THREE.Scene(), roster, ladder)
      hub.setSeatCounts([{ ring: 1, taken: laneCount, limit: 4 }])
      const label = labelFor(hub, 1)
      ring1Points.push({ x: label.position.x, y: label.position.y, z: label.position.z })
      hub.dispose()
    }
    const expectedRing1 = seatRingPoint(1, ringLayout(THREE_LANES, ['opencode', 'claude', 'hermes']))
    for (const point of ring1Points) {
      expect(point.x).toBeCloseTo(expectedRing1.x)
      expect(point.y).toBe(expectedRing1.y)
      expect(point.z).toBeCloseTo(expectedRing1.z)
    }
  })

  it('places ring 0 and ring 1 seat labels at different heights and at least 150 units outside their rings', () => {
    expect(SEAT_LABEL_OUT).toBeGreaterThanOrEqual(150)
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const layout = ringLayout(LADDER, hub.parkedKeys())
    hub.setSeatCounts([
      { ring: 0, taken: 1, limit: 4 },
      { ring: 1, taken: 2, limit: 4 },
    ])
    const ring0 = labelFor(hub, 0)
    const ring1 = labelFor(hub, 1)
    expect(ring0.position.y).not.toBe(ring1.position.y)
    expect(Math.hypot(ring0.position.x, ring0.position.z) - HUB_RADIUS).toBeGreaterThanOrEqual(150)
    expect(Math.hypot(ring1.position.x, ring1.position.z) - layout.rings[1].radius).toBeGreaterThanOrEqual(150)
    hub.dispose()
  })

  it('leaves a ring with no limit alone', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    drawnLabels.length = 0
    hub.setSeatCounts([{ ring: 0, taken: 1, limit: null }])
    expect(seatLabels(hub)).toHaveLength(0)
    expect(drawnLabels.some((text) => text.includes('/'))).toBe(false)
    hub.dispose()
  })

  it('draws no label for a ring the layout does not have', () => {
    const hub = createHub(new THREE.Scene(), 3)
    expect(hub.parkedKeys()).toEqual([])
    hub.setSeatCounts([
      { ring: 0, taken: 1, limit: 2 },
      { ring: 1, taken: 0, limit: 2 },
    ])
    expect(seatLabels(hub)).toHaveLength(1)
    const expected = seatRingPoint(0)
    expect(labelFor(hub, 0).position.x).toBeCloseTo(expected.x)
    expect(labelFor(hub, 0).position.z).toBeCloseTo(expected.z)
    expect(labelFor(hub, 1)).toBeUndefined()
    hub.dispose()
  })

  it('drops every label when the rows are not a list', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    hub.setSeatCounts([{ ring: 0, taken: 1, limit: 2 }])
    expect(seatLabels(hub)).toHaveLength(1)
    hub.setSeatCounts(null)
    expect(seatLabels(hub)).toHaveLength(0)
    hub.dispose()
  })

  it('moves the labels to the new rings and keeps the last rows', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    hub.setSeatCounts([{ ring: 0, taken: 1, limit: 2 }, { ring: 1, taken: 1, limit: 2 }])
    expect(seatLabels(hub)).toHaveLength(2)
    const beforeTop = labelFor(hub, 0).position.clone()
    hub.setLadder(null)
    expect(seatLabels(hub)).toHaveLength(1)
    const unladdered = seatRingPoint(0)
    expect(labelFor(hub, 0).position.x).toBeCloseTo(unladdered.x)
    expect(labelFor(hub, 0).position.z).toBeCloseTo(unladdered.z)
    hub.setLadder(THREE_LANES)
    expect(seatLabels(hub)).toHaveLength(2)
    const singleAngle = Math.atan2(labelFor(hub, 1).position.z, labelFor(hub, 1).position.x)
    hub.setLadder(LADDER)
    expect(seatLabels(hub)).toHaveLength(2)
    expect(labelFor(hub, 0).position.x).toBeCloseTo(beforeTop.x)
    expect(labelFor(hub, 0).position.z).toBeCloseTo(beforeTop.z)
    const multiAngle = Math.atan2(labelFor(hub, 1).position.z, labelFor(hub, 1).position.x)
    expect(singleAngle).toBeCloseTo(-OVERVIEW.yaw)
    expect(multiAngle).toBeCloseTo(-OVERVIEW.yaw)
    hub.dispose()
  })
})
