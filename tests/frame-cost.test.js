import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  childOrbit,
  createAgents,
  fullCalloutKeys,
  polylineLengths,
  samplePolyline,
} from '../src/engine/agents.js'
import { createHub, writeColor, writeOpacity } from '../src/engine/hub.js'
import { WHITE } from '../src/engine/sprites.js'
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
  const state = createState({ files: ['src/a.js'], dirs: ['src'], created: [] }, roster)
  const terminals = {
    ensure() {},
    setVisible() {},
    setFade() {},
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
  return { agents, state, terminals, world }
}

function startWrite(state, time) {
  apply(state, { time: time - 10, type: 'run.start', agent: 'a', runId: 'r1' })
  apply(state, {
    time,
    type: 'tool.start',
    agent: 'a',
    id: 't1',
    label: 'write src/a.js',
    touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
  })
}

function positionVersion(view) {
  return view.shape.geometry.getAttribute('position').version
}

describe('a resting pulse', () => {
  it('writes no vertex while Pulse is off and the shape is at rest', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    agents.update(state, 0.016, 1000, world, terminals)
    const settled = positionVersion(view)
    for (let frame = 0; frame < 5; frame += 1) {
      agents.update(state, 0.016, 1016 + frame * 16, world, terminals)
    }
    expect(positionVersion(view)).toBe(settled)
    agents.dispose()
  })

  it('writes once more when Pulse goes off, then nothing', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    agents.setBands([0.6, 0.4, 0.3, 0.2, 0.1])
    agents.update(state, 0.2, 1000, world, terminals)
    const pulsed = positionVersion(view)
    expect(pulsed).toBeGreaterThan(0)

    agents.setBands(null)
    agents.update(state, 0.016, 1016, world, terminals)
    const restored = positionVersion(view)
    expect(restored).toBeGreaterThan(pulsed)
    for (let frame = 0; frame < 5; frame += 1) {
      agents.update(state, 0.016, 1032 + frame * 16, world, terminals)
    }
    expect(positionVersion(view)).toBe(restored)
    agents.dispose()
  })

  it('skips a shape whose band levels and scale did not change since its last write', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    agents.setBands([0.5, 0.5, 0.5, 0.5, 0.5])
    let at = 1000
    for (let frame = 0; frame < 400; frame += 1) {
      at += 16
      agents.update(state, 0.016, at, world, terminals)
    }
    const settled = positionVersion(view)
    for (let frame = 0; frame < 5; frame += 1) {
      at += 16
      agents.update(state, 0.016, at, world, terminals)
    }
    expect(positionVersion(view)).toBe(settled)

    agents.setBands([0.9, 0.2, 0.2, 0.2, 0.2])
    at += 16
    agents.update(state, 0.016, at, world, terminals)
    expect(positionVersion(view)).toBeGreaterThan(settled)
    agents.dispose()
  })

  it('writes an idle agent only while its levels move', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    agents.setBands([0.8, 0.1, 0.1, 0.1, 0.1])
    agents.update(state, 0.2, 1000, world, terminals)
    const first = positionVersion(view)
    agents.update(state, 0.2, 1400, world, terminals)
    expect(positionVersion(view)).toBeGreaterThan(first)
    agents.dispose()
  })
})

describe('the path lengths a star samples', () => {
  const bend = [
    { x: 0, y: 0, z: 0 },
    { x: 300, y: 0, z: 0 },
    { x: 300, y: 0, z: 400 },
  ]

  it('keeps one cumulative length per point', () => {
    const lengths = polylineLengths(bend)
    expect(lengths).toHaveLength(3)
    expect(lengths[0]).toBe(0)
    expect(lengths[1]).toBe(300)
    expect(lengths[2]).toBe(700)
    const out = []
    expect(polylineLengths(bend, out)).toBe(out)
    expect(out).toEqual(lengths)
  })

  it('samples the same points from the kept lengths as from the walk', () => {
    const lengths = polylineLengths(bend)
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100
      expect(samplePolyline(bend, t, {}, lengths)).toEqual(samplePolyline(bend, t))
    }
  })

  it('holds the ends and a line of no length', () => {
    expect(samplePolyline(bend, 0, {}, polylineLengths(bend))).toEqual({ x: 0, y: 0, z: 0 })
    expect(samplePolyline(bend, 1, {}, polylineLengths(bend))).toEqual({ x: 300, y: 0, z: 400 })
    const still = [{ x: 5, y: 6, z: 7 }, { x: 5, y: 6, z: 7 }]
    expect(samplePolyline(still, 0.5, {}, polylineLengths(still))).toEqual({ x: 5, y: 6, z: 7 })
  })
})

describe('the path lengths a star samples', () => {
  it('keeps the path lengths until the path itself moves', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state, 1000)
    agents.update(state, 0.4, 1400, world, terminals)
    const view = agents.views.get('a')
    expect(view.pathLengths).toHaveLength(view.path.length)
    const kept = [...view.pathLengths]
    agents.update(state, 0.016, 1416, world, terminals)
    expect(view.pathLengths).toEqual(kept)

    world.edge = (dir, file, side, out) => out.set(900, 400, 0)
    agents.update(state, 0.016, 1432, world, terminals)
    expect(view.pathLengths[view.pathLengths.length - 1]).toBeGreaterThan(kept[kept.length - 1])
    agents.dispose()
  })
})

describe('the material writes of a resting frame', () => {
  function countWrites(material) {
    let colors = 0
    let opacities = 0
    const setHex = material.color.setHex.bind(material.color)
    material.color.setHex = (hex) => {
      colors += 1
      return setHex(hex)
    }
    const holder = { value: material.opacity }
    Object.defineProperty(material, 'opacity', {
      configurable: true,
      get: () => holder.value,
      set: (value) => {
        opacities += 1
        holder.value = value
      },
    })
    return () => ({ colors, opacities })
  }

  it('writes an agent shape colour and opacity only when they change', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    agents.update(state, 0.016, 1000, world, terminals)
    agents.update(state, 0.016, 1016, world, terminals)
    const read = countWrites(view.shape.material)
    for (let frame = 0; frame < 5; frame += 1) {
      agents.update(state, 0.016, 1032 + frame * 16, world, terminals)
    }
    expect(read()).toEqual({ colors: 0, opacities: 0 })
    agents.dispose()
  })

  it('writes a hub slot colour and opacity only when they change', () => {
    const hub = createHub(new THREE.Scene(), [{ key: 'opencode', name: 'OpenCode' }])
    const slot = hub.group.children.find((child) => child.name === 'slot')
    hub.setSlot(0, WHITE, 0.5)
    const read = countWrites(slot.material)
    hub.setSlot(0, WHITE, 0.5)
    expect(read()).toEqual({ colors: 0, opacities: 0 })
    hub.setSlot(0, WHITE, 0.25)
    expect(read()).toEqual({ colors: 0, opacities: 1 })
    hub.dispose()
  })

  it('writes the hub ring opacity only when it changes', () => {
    const hub = createHub(new THREE.Scene(), [{ key: 'opencode', name: 'OpenCode' }])
    const ring = hub.group.getObjectByName('ring')
    hub.update(0, 0.016)
    const read = countWrites(ring.material)
    hub.update(0.016, 0.016)
    hub.update(0.032, 0.016)
    expect(read()).toEqual({ colors: 0, opacities: 0 })
    hub.dispose()
  })

  it('writes a material once through the guarded helpers', () => {
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 1 })
    expect(writeColor(material, WHITE)).toBe(true)
    expect(writeColor(material, WHITE)).toBe(false)
    expect(writeOpacity(material, 1)).toBe(false)
    expect(writeOpacity(material, 0.5)).toBe(true)
  })
})

describe('the scratch objects of a frame', () => {
  it('answers the same set for the same callout scratch', () => {
    const scratch = { list: [], keys: new Set(), kept: new Set(), ranked: [], pool: [] }
    const busy = [
      { key: 'a', since: 1 },
      { key: 'b', since: 2 },
    ]
    const first = fullCalloutKeys(busy, null, null, scratch)
    expect(first).toBe(scratch.keys)
    expect(first.has('a')).toBe(true)
    const crowded = Array.from({ length: 6 }, (_, index) => ({ key: `a${index}`, since: index }))
    const kept = fullCalloutKeys(crowded, 'a0', null, scratch)
    expect(kept).toBe(scratch.kept)
    expect(kept.has('a0')).toBe(true)
    expect(scratch.pool).toHaveLength(6)
  })

  it('fills the place it is given for a child orbit', () => {
    const out = {}
    const place = childOrbit({ x: 0, y: 290, z: 300 }, 0, 1, 0, out)
    expect(place).toBe(out)
    expect(Number.isFinite(place.x)).toBe(true)
    expect(Number.isFinite(place.y)).toBe(true)
    expect(Number.isFinite(place.z)).toBe(true)
  })
})
