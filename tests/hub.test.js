import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SECTOR_ARC_OPACITY,
  SECTOR_GLOW_MS,
  createHub,
  sectorGlow,
  sectorIdForKey,
  sectorLaneAngles,
  sectorSlotAngles,
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
