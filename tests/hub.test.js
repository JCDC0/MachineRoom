import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DANCE_RISE_MS,
  DANCE_SETTLE_MS,
  HUB_RADIUS,
  HUB_Y,
  PARK_LIFT,
  HUB_RING_GROW,
  HUB_RING_MS,
  HUB_RING_POOL,
  RING_MAX_OPACITY,
  SECTOR_ARC_OPACITY,
  SECTOR_GLOW_MS,
  SECTOR_LABEL_DROP,
  SECTOR_LABEL_INSET,
  SECTOR_LABEL_OUT,
  SECTOR_LABEL_SPREAD,
  SUB_RING_DROP,
  SUB_RING_OPACITY,
  SUB_RING_RADIUS,
  SUB_RING_Y,
  createHub,
  danceEnvelope,
  ringPulse,
  startDanceEnvelope,
  sectorGlow,
  sectorIdForKey,
  sectorLabelAngle,
  sectorLabelPoint,
  sectorLabelRadius,
  sectorLaneAngles,
  sectorSlotAngles,
  subRingPlace,
  workingKeys,
} from '../src/engine/hub.js'
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
  it('puts one lane at the middle of the arc, under its sub', () => {
    const angles = sectorLaneAngles({ start: 0.2, end: 1.2, lanes: ['opencode'] })
    expect(angles).toHaveLength(1)
    expect(angles[0]).toBeCloseTo(0.7)
  })

  it('spreads three lanes evenly inside the arc with the same gap at each end', () => {
    const arc = { start: 0, end: 3, lanes: ['opencode', 'claude', 'hermes'] }
    const angles = sectorLaneAngles(arc)
    expect(angles).toHaveLength(3)
    expect(angles[0] - arc.start).toBeCloseTo(0.5)
    expect(angles[1] - angles[0]).toBeCloseTo(1)
    expect(angles[2] - angles[1]).toBeCloseTo(1)
    expect(arc.end - angles[2]).toBeCloseTo(0.5)
    expect(angles[1]).toBeCloseTo((arc.start + arc.end) / 2)
  })

  it('parks nothing in an empty sector', () => {
    expect(sectorLaneAngles({ start: 0, end: 1, lanes: [] })).toEqual([])
    expect(sectorLaneAngles({ start: 1, end: 1, lanes: ['opencode'] })).toEqual([])
    expect(sectorLaneAngles(null)).toEqual([])
  })

  it('maps each lane of a ladder through the pure placement', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const arcs = sectorArcs(THREE_LANES, keys)
    const angles = sectorSlotAngles(THREE_LANES, keys)
    const expected = sectorLaneAngles(arcs[0])
    keys.forEach((key, index) => {
      expect(angles.get(key)).toBeCloseTo(expected[index])
    })
  })

  it('leaves an empty sub sector out of the slots and does not move the other lanes', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const arcs = sectorArcs(LADDER, keys)
    const angles = sectorSlotAngles(LADDER, keys)
    expect(angles.size).toBe(3)
    expect([...angles.keys()]).toEqual(keys)
    const frontend = arcs.find((arc) => arc.id === 'frontend')
    const backend = arcs.find((arc) => arc.id === 'backend')
    expect(angles.get('opencode')).toBeCloseTo((frontend.start + frontend.end) / 2)
    expect(angles.get('claude')).toBeCloseTo(backend.start + (backend.end - backend.start) / 4)
    expect(angles.get('hermes')).toBeCloseTo(backend.start + ((backend.end - backend.start) * 3) / 4)
  })
})

describe('the lower park ring', () => {
  it('sits at 0.6 of the hub radius and 260 units below it', () => {
    expect(SUB_RING_RADIUS).toBeCloseTo(HUB_RADIUS * 0.6)
    expect(SUB_RING_Y).toBe(HUB_Y - SUB_RING_DROP)
    expect(SUB_RING_DROP).toBe(260)
  })

  it('puts a lane on the lower ring at the angle it is given', () => {
    const point = subRingPlace(Math.PI / 2)
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(SUB_RING_RADIUS)
    expect(point.x).toBeCloseTo(0)
    expect(point.z).toBeCloseTo(SUB_RING_RADIUS)
    expect(point.y).toBe(SUB_RING_Y + PARK_LIFT)
  })

  it('fills the vector it is given and falls back to zero', () => {
    const out = new THREE.Vector3()
    expect(subRingPlace(0, out)).toBe(out)
    expect(out.x).toBeCloseTo(SUB_RING_RADIUS)
    expect(out.z).toBeCloseTo(0)
    const fallback = subRingPlace(Number.NaN)
    expect(fallback.x).toBeCloseTo(SUB_RING_RADIUS)
    expect(fallback.z).toBeCloseTo(0)
  })

  it('draws a faint lower ring only with a ladder', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, LADDER)
    const lower = hub.group.getObjectByName('sub-ring')
    expect(lower.visible).toBe(true)
    expect(lower.position.y).toBe(-SUB_RING_DROP)
    expect(lower.material.opacity).toBe(SUB_RING_OPACITY)
    expect(lower.material.opacity).toBeLessThan(SECTOR_ARC_OPACITY.main)
    hub.setLadder(null)
    expect(lower.visible).toBe(false)
    hub.dispose()
  })

  it('puts a sub lane slot tick on the lower ring, not the main one', () => {
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

  it('hides the lower ring while no lane sits on it', () => {
    const hub = createHub(new THREE.Scene(), ROSTER, { subs: [{ id: 'empty', name: 'Empty', lanes: [] }] })
    expect(hub.group.getObjectByName('sub-ring').visible).toBe(false)
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
