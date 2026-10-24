import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PACKET_DURATION, PACKET_POOL, createAgents, packetSpots, stripPoints } from '../src/engine/agents.js'
import { apply, createState } from '../src/model/state.js'

const from = { x: 0, y: 290, z: 300 }
const to = { x: 620, y: 460, z: -80 }

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
  const edge = { x: 500, y: 400, z: 0 }
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(edge.x, edge.y, edge.z),
  }
  return { agents, state, terminals, world, edge }
}

function startWrite(state, time, runId = 'r1') {
  apply(state, { time: time - 10, type: 'run.start', agent: 'a', runId })
  apply(state, {
    time,
    type: 'tool.start',
    agent: 'a',
    id: 't1',
    label: 'write a.js',
    touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
  })
}

describe('stripPoints', () => {
  it('gives one straight segment from the agent to the target', () => {
    const points = stripPoints(from, to)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual(from)
    expect(points[1]).toEqual(to)
  })

  it('returns copies, not its inputs', () => {
    const points = stripPoints(from, to)
    expect(points[0]).not.toBe(from)
    expect(points[1]).not.toBe(to)
  })

  it('gives the same points every time and leaves its inputs alone', () => {
    const first = stripPoints(from, to)
    const second = stripPoints(from, to)
    expect(second).toEqual(first)
    expect(from).toEqual({ x: 0, y: 290, z: 300 })
    expect(to).toEqual({ x: 620, y: 460, z: -80 })
  })

  it('writes into a pair of points it is given', () => {
    const out = [{}, {}]
    const points = stripPoints(from, to, out)
    expect(points[0]).toBe(out[0])
    expect(points[1]).toBe(out[1])
    expect(points).toEqual([from, to])
  })
})

describe('packetSpots', () => {
  it('moves a packet from the agent to the file in 0.45 seconds', () => {
    const sends = [1000]
    expect(packetSpots(1000, sends, PACKET_DURATION)).toEqual([0])
    expect(packetSpots(1200, sends, PACKET_DURATION)[0]).toBeCloseTo(0.2 / 0.45, 10)
    expect(packetSpots(1450, sends, PACKET_DURATION)).toEqual([1])
    expect(packetSpots(1451, sends, PACKET_DURATION)).toEqual([])
  })

  it('keeps a burst of five packets in flight together', () => {
    const sends = [2000, 2000, 2000, 2000, 2000]
    const spots = packetSpots(2090, sends, PACKET_DURATION)
    expect(spots).toHaveLength(5)
    spots.forEach((spot) => expect(spot).toBeCloseTo(0.09 / 0.45, 10))
  })

  it('caps the pool at 24 and keeps the newest packets', () => {
    const sends = Array.from({ length: 30 }, (_, index) => index * 10)
    const spots = packetSpots(290, sends, PACKET_DURATION)
    expect(spots).toHaveLength(PACKET_POOL)
    expect(spots[0]).toBeCloseTo(0.23 / 0.45, 10)
    expect(spots[PACKET_POOL - 1]).toBe(0)
  })

  it('moves nothing under reduced motion', () => {
    expect(packetSpots(1200, [1000], PACKET_DURATION, true)).toEqual([])
    expect(packetSpots(1000, [1000], PACKET_DURATION, true)).toEqual([])
  })
})

describe('packets after a run ends', () => {
  it('keeps the burst at a touch and queues no packet once the status is done', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state, 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const beforeBurst = view.packetSends.length

    agents.aimAt('a', 'src', 'src/a.js', 1100)
    expect(view.packetSends).toHaveLength(beforeBurst + 5)
    agents.update(state, 0.016, 1100, world, terminals)
    expect(view.packetSends.slice(beforeBurst, beforeBurst + 5)).toEqual([1100, 1130, 1160, 1190, 1220])
    const queuedDuringWork = view.packetSends.length

    apply(state, { time: 1200, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 1210, world, terminals)
    expect(state.agents.get('a').status).toBe('done')
    expect(view.packetSends).toHaveLength(queuedDuringWork)

    agents.update(state, 0.016, 1700, world, terminals)
    expect(view.packetSends).toHaveLength(queuedDuringWork)
    expect(view.packets.geometry.drawRange.count).toBe(0)
    agents.dispose()
  })
})

describe('a strip with still ends', () => {
  it('leaves the tunnel geometry alone while its ends stay put, and moves it when the file moves', () => {
    const { agents, state, terminals, world, edge } = harness()
    startWrite(state, 1000)
    agents.aimAt('a', 'src', 'src/a.js', 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const positionVersion = view.strip.geometry.attributes.position.version
    expect(view.strip.visible).toBe(true)

    agents.update(state, 0.016, 1016, world, terminals)
    expect(view.strip.geometry.attributes.position.version).toBe(positionVersion)

    edge.x += 60
    agents.update(state, 0.016, 1032, world, terminals)
    expect(view.strip.geometry.attributes.position.version).toBeGreaterThan(positionVersion)
    const array = view.strip.geometry.attributes.position.array
    expect(array[0]).toBeCloseTo(view.group.position.x, 3)
    expect(array[1]).toBeCloseTo(view.group.position.y, 3)
    expect(array[2]).toBeCloseTo(view.group.position.z, 3)
    agents.dispose()
  })
})
