import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PACKET_POOL, childPlace, packetSpots, stripPoints } from '../src/engine/agents.js'
import { cardPlan } from '../src/engine/cards.js'
import { HUB_CENTER, ORCHESTRATOR_HOME, slotPoint } from '../src/engine/hub.js'
import { nearestDrawnPath } from '../src/engine/room.js'
import { isOrchestrator } from '../src/engine/shapes.js'
import { RING_CENTER, RING_FRONT, RING_MAX_TOP, ROOT_AHEAD, ROOT_DROP, ringOf, ringRadius, shotgunOffset } from '../src/engine/ring.js'
import { dirname, makeTree } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { loadScenario } from './helpers.js'

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  letterSpacing: '',
  measureText: (text) => ({ width: String(text).length * 10 }),
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  clearRect() {},
  fillRect() {},
  strokeRect() {},
  fillText() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  arc() {},
  closePath() {},
}

function fakeElement(tag = 'div') {
  const listeners = new Map()
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    title: '',
    children: [],
    parentNode: null,
    parentElement: null,
    clientWidth: 0,
    clientHeight: 0,
    scrollHeight: 0,
    scrollTop: 0,
    textContent: '',
    ownerDocument: { defaultView: { Element: function Element() {} } },
    append(...items) {
      node.children.push(...items)
    },
    appendChild(child) {
      node.children.push(child)
      return child
    },
    replaceChildren(...items) {
      node.children.length = 0
      node.children.push(...items)
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type)
      if (!list) return
      const index = list.indexOf(fn)
      if (index !== -1) list.splice(index, 1)
    },
    remove() {
      node.removed = true
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index !== -1) node.children.splice(index, 1)
    },
    setAttribute(name, value) {
      node[name] = value
    },
    cloneNode() {
      return fakeElement(tag)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: node.clientWidth || 1200, height: node.clientHeight || 800 }),
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

function fakeCanvas() {
  const node = fakeElement('canvas')
  node.width = 0
  node.height = 0
  node.getContext = () => context2d
  return node
}

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class FakeWebGLRenderer {
    constructor() {
      this.domElement = fakeCanvas()
    }
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

vi.mock('three/addons/renderers/CSS3DRenderer.js', async (importOriginal) => {
  const actual = await importOriginal()
  class FakeCSS3DRenderer {
    constructor() {
      this.domElement = fakeElement('div')
    }
    setSize() {}
    render() {}
  }
  return { ...actual, CSS3DRenderer: FakeCSS3DRenderer }
})

let savedWindow
let savedDocument
let savedRaf
let savedCancel
let savedResize
let roomFrame = null
let roomSurface
let roomGl
let roomCss

beforeAll(() => {
  savedWindow = globalThis.window
  savedDocument = globalThis.document
  savedRaf = globalThis.requestAnimationFrame
  savedCancel = globalThis.cancelAnimationFrame
  savedResize = globalThis.ResizeObserver

  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : fakeElement(tag)),
    querySelectorAll: () => [],
    body: fakeElement('body'),
  }
  globalThis.requestAnimationFrame = (fn) => {
    roomFrame = fn
    return 1
  }
  globalThis.cancelAnimationFrame = () => {
    roomFrame = null
  }
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  roomSurface = fakeElement('div')
  roomSurface.clientWidth = 1200
  roomSurface.clientHeight = 800
  roomGl = fakeElement('div')
  roomGl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 })
  roomCss = fakeElement('div')
})

afterAll(() => {
  globalThis.window = savedWindow
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancel
  globalThis.ResizeObserver = savedResize
})

async function makeRoom(files, agents) {
  const { createRoom } = await import('../src/engine/room.js')
  const roster = agents.map((key) => ({ key, name: key }))
  const state = createState(makeTree({ root: 'demo', files }), roster)
  let current = state
  const room = createRoom({
    surface: roomSurface,
    gl: roomGl,
    css: roomCss,
    rootName: 'demo',
    agents: roster,
    getState: () => current,
  })
  return {
    room,
    state,
    setState(next) {
      current = next
    },
  }
}

function tickRoom(times = 1) {
  for (let index = 0; index < times; index += 1) roomFrame?.(performance.now())
}

function distance(point) {
  return Math.hypot(point.x - RING_CENTER.x, point.y - RING_CENTER.y, point.z - RING_CENTER.z)
}

function turn(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function checkPoint(point, label) {
  expect(Number.isFinite(point?.x), `${label} x`).toBe(true)
  expect(Number.isFinite(point?.y), `${label} y`).toBe(true)
  expect(Number.isFinite(point?.z), `${label} z`).toBe(true)
}

function layoutRoom(state, homes) {
  const layout = cardPlan(state, { alwaysDepth: 2, previous: homes })
  for (const [path, spot] of layout.placed) {
    const size = layout.entries.find((entry) => entry.path === path)
    homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height, slot: spot.slot })
  }
  return { drawn: layout.drawn, placed: layout.placed }
}

function nearestDrawnParent(path, paths) {
  let at = dirname(path)
  while (at !== '') {
    if (paths.has(at)) return at
    at = dirname(at)
  }
  return paths.has('') ? '' : null
}

function runRoom(frames, agents, tree) {
  const pipeline = createPipeline({ agents, tree })
  const state = createState(tree, agents)
  const homes = new Map()
  const activities = []
  const layouts = []
  const sends = new Map()
  let largest = 0
  const parked = new Map()
  const roster = agents.filter((agent) => !isOrchestrator(agent))
  roster.forEach((agent, index) => parked.set(agent.key, slotPoint(index, roster.length)))

  function step(activity) {
    apply(state, activity)
    activities.push(activity)
    const { drawn, placed } = layoutRoom(state, homes)
    largest = Math.max(largest, placed.size)

    const signature = []
    for (const path of [...placed.keys()].sort()) {
      const spot = placed.get(path)
      checkPoint(spot, `card ${path || 'root'}`)
      expect(Number.isFinite(spot.width), `card ${path || 'root'} width`).toBe(true)
      expect(Number.isFinite(spot.height), `card ${path || 'root'} height`).toBe(true)
      signature.push([path, spot.x, spot.y, spot.z, spot.width, spot.height])
    }
    layouts.push(JSON.stringify(signature))

    const root = placed.get('')
    expect(root, 'the root is drawn').toBeTruthy()
    expect(root.y + root.height / 2, 'the root top edge sits below the hub plane').toBeCloseTo(HUB_CENTER.y - ROOT_DROP, 6)
    expect((root.x - HUB_CENTER.x) * RING_FRONT.x + (root.z - HUB_CENTER.z) * RING_FRONT.z).toBe(0)

    const drawnPaths = new Set(drawn.keys())
    for (const path of drawnPaths) {
      if (path === '' || path.split('/').length > 1) continue
      const spot = placed.get(path)
      expect(distance(spot), `${path} sits outside the root`).toBeGreaterThan(distance(root))
    }

    for (const agent of state.agents.values()) {
      if (agent.status !== 'working') continue
      const list = sends.get(agent.key) ?? []
      list.push(activity.time)
      if (list.length > PACKET_POOL * 4) list.shift()
      sends.set(agent.key, list)
      const spots = packetSpots(activity.time, list)
      expect(spots.length, `${agent.key} packets`).toBeLessThanOrEqual(PACKET_POOL)
      for (const fraction of spots) expect(Number.isFinite(fraction)).toBe(true)

      const focus = agent.focus ?? []
      for (const path of focus) {
        const dir = state.files.has(path) ? dirname(path) : path
        checkPoint(placed.get(dir), `touch ${dir || 'root'}`)
        let at = dir
        while (at !== '') {
          expect(drawnPaths.has(at), `${agent.key} chain folder ${at} is drawn`).toBe(true)
          const parent = dirname(at)
          expect(drawnPaths.has(parent), `${agent.key} chain parent ${parent || 'root'} is drawn`).toBe(true)
          const childSpot = placed.get(at)
          const parentSpot = placed.get(parent)
          expect(childSpot, `${at} is placed`).toBeTruthy()
          expect(parentSpot, `${parent || 'root'} is placed`).toBeTruthy()
          expect(distance(childSpot), `${at} sits outside ${parent || 'root'}`).toBeGreaterThan(distance(parentSpot))
          at = parent
        }
      }

      const touch = focus[0]
      if (touch === undefined) continue
      const dir = state.files.has(touch) ? dirname(touch) : touch
      const parentHome = agent.parent ? parked.get(agent.parent) ?? ORCHESTRATOR_HOME : null
      const slot = Number(String(agent.key).split('~').at(-1))
      const home = agent.parent
        ? childPlace(parentHome, Number.isFinite(slot) ? slot - 1 : 0)
        : parked.get(agent.key) ?? ORCHESTRATOR_HOME
      const [start, end] = stripPoints(home, placed.get(dir) ?? HUB_CENTER)
      checkPoint(start, `${agent.key} strip start`)
      checkPoint(end, `${agent.key} strip end`)
    }
  }

  for (const frame of frames) {
    for (const activity of pipeline.push(frame)) step(activity)
  }
  for (const activity of pipeline.flush()) step(activity)
  return { state, activities, layouts, largest }
}

describe('the nearest drawn card', () => {
  it('takes the folder itself or the nearest drawn ancestor', () => {
    const drawn = new Set(['', 'src', 'src/engine'])
    expect(nearestDrawnPath('src/engine', drawn)).toBe('src/engine')
    expect(nearestDrawnPath('src/engine/room.js', drawn)).toBe('src/engine')
    expect(nearestDrawnPath('src/model/state.js', drawn)).toBe('src')
    expect(nearestDrawnPath('docs/agents/TASKS.md', drawn)).toBe('')
    expect(nearestDrawnPath(null, drawn)).toBe('')
    expect(nearestDrawnPath('src/engine/room.js', new Set())).toBeNull()
  })
})

describe('the room, played from a recorded lane run', () => {
  it('lays out every activity and plays the same frames twice', () => {
    const { frames, agents, tree } = loadScenario('scenario-e')
    expect(ROOT_AHEAD).toBe(0)
    expect(ROOT_DROP).toBe(240)
    expect(agents.map((agent) => agent.key)).toEqual(['claude', 'hermes', 'opencode', 'orchestrator'])
    expect(tree.files.length).toBeGreaterThan(0)

    const first = runRoom(frames, agents, tree)
    const second = runRoom(frames, agents, tree)
    expect(second.layouts).toEqual(first.layouts)
    expect(second.largest).toBe(first.largest)
    expect(first.activities.length).toBeGreaterThan(0)

    for (const key of ['claude', 'hermes', 'opencode', 'orchestrator']) {
      const agent = first.state.agents.get(key)
      expect(agent, `${key} ends in the state`).toBeTruthy()
      expect(agent.runs, `${key} runs`).toBe(1)
      const mine = first.activities.filter((activity) => activity.agent === key)
      expect(mine[0]?.type, `${key} starts queued`).toBe('run.queued')
      expect(mine.some((activity) => activity.type === 'run.start'), `${key} starts`).toBe(true)
      expect(mine.at(-1), `${key} ends`).toMatchObject({ type: 'run.end' })
    }

    expect(first.state.agents.get('claude').status).toBe('error')
    expect(first.state.agents.get('opencode').status).toBe('done')

    const spawns = first.activities.filter((activity) => activity.type === 'agent.spawn' && activity.agent === 'opencode')
    expect(spawns.map((activity) => activity.child)).toEqual(['opencode~1', 'opencode~2'])
    expect(spawns.map((activity) => activity.name)).toEqual(['Count the exported functions', 'Check the test names'])
    for (const key of ['opencode~1', 'opencode~2']) {
      const child = first.state.agents.get(key)
      expect(child, `${key} is in the state`).toBeTruthy()
      expect(child).toMatchObject({ parent: 'opencode', status: 'done' })
    }

    const flood = Array.from({ length: PACKET_POOL * 3 }, (_, index) => first.state.latest - index * 4)
    expect(packetSpots(first.state.latest, flood)).toHaveLength(PACKET_POOL)
  })

  it('caps the base ring at twelve folders and sprays the rest outside it', () => {
    const files = []
    for (let index = 0; index < 16; index += 1) files.push(`top-${String(index).padStart(2, '0')}/file.js`)
    for (let index = 0; index < 4; index += 1) files.push(`wide/kid-${index}/file.js`)
    const state = createState({ files, dirs: [], created: [] }, [])
    const layout = cardPlan(state, { alwaysDepth: 2 })
    const tops = layout.entries.filter((entry) => entry.path !== '' && !entry.path.includes('/'))
    expect(tops).toHaveLength(17)
    const base = tops.slice(0, RING_MAX_TOP)
    const overflow = tops.slice(RING_MAX_TOP)
    const radius = ringRadius(RING_MAX_TOP, base)
    expect(overflow).toHaveLength(5)
    base.forEach((entry, index) => {
      const spot = ringOf(layout.placed.get(entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius, 6)
      expect(turn(spot.angle, (index / RING_MAX_TOP) * Math.PI * 2), entry.path).toBeCloseTo(0, 6)
    })
    overflow.forEach((entry, index) => {
      const off = shotgunOffset(index, overflow.length)
      const spot = ringOf(layout.placed.get(entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius + off.radiusStep, 6)
      expect(turn(spot.angle, off.angleOffset), entry.path).toBeCloseTo(0, 6)
    })
    const parent = ringOf(layout.placed.get('wide'))
    const kids = ['wide/kid-0', 'wide/kid-1', 'wide/kid-2', 'wide/kid-3']
    kids.forEach((path, index) => {
      const off = shotgunOffset(index, kids.length)
      const spot = ringOf(layout.placed.get(path))
      expect(spot.radius, path).toBeCloseTo(parent.radius + off.radiusStep, 6)
      expect(turn(spot.angle, parent.angle + off.angleOffset), path).toBeCloseTo(0, 6)
    })
    expect(kids.map((_, index) => shotgunOffset(index, kids.length).cols)).toEqual([2, 2, 2, 2])
    expect(kids.map((_, index) => shotgunOffset(index, kids.length).rows)).toEqual([2, 2, 2, 2])
  })
})

describe('the camera hold on a live room', () => {
  it('inspects a folder and keeps the zoom and park working', async () => {
    const { room } = await makeRoom(['src/a.js', 'docs/b.md'], ['claude'])
    try {
      expect(room.inspect({ kind: 'folder', id: 'src' })).toBe(true)
      expect(room.inspecting()).toEqual({ kind: 'folder', id: 'src' })
      tickRoom(2)
      expect(room.holding()).toBe('src')
      expect(room.soundAt('src').distance).toBeCloseTo(700, 0)
      room.zoomBy(-600)
      tickRoom(1)
      expect(room.soundAt('src').distance).toBeLessThan(700)
      room.park()
      expect(room.holding()).toBe(null)
    } finally {
      room.dispose()
    }
  })

  it('inspects an agent and the internet sphere without a card hold', async () => {
    const { room } = await makeRoom(['src/a.js'], ['claude'])
    try {
      expect(room.inspect({ kind: 'agent', id: 'claude' })).toBe(true)
      expect(room.inspecting()).toEqual({ kind: 'agent', id: 'claude' })
      expect(room.focused()).toBe('claude')
      tickRoom(2)
      expect(room.holding()).toBe(null)
      expect(room.inspect({ kind: 'internet', id: 'internet' })).toBe(true)
      tickRoom(2)
      expect(room.inspecting()).toEqual({ kind: 'internet', id: 'internet' })
      room.park()
    } finally {
      room.dispose()
    }
  })

  it('releases the hold and refits when the held card leaves the plan', async () => {
    const first = await makeRoom(['src/a.js', 'docs/b.md'], ['claude'])
    expect(first.room.anchor('src')).toBe(true)
    tickRoom(2)
    expect(first.room.holding()).toBe('src')
    expect(first.room.soundAt('src').distance).toBeCloseTo(700, 0)
    const heldFit = first.room.soundAt('').overviewDistance

    const files = Array.from({ length: 9 }, (_, index) => `top-${index}/f.js`)
    const next = createState(makeTree({ root: 'demo', files }), [{ key: 'claude', name: 'claude' }])
    first.setState(next)
    first.room.reset(next)

    expect(first.room.holding()).toBe(null)
    expect(first.room.soundAt('src').x).toBe(-1)
    expect(first.room.soundAt('').overviewDistance).toBeGreaterThan(heldFit)
    first.room.park()
    const parked = first.room.soundAt('').overviewDistance
    first.room.dispose()

    const fresh = await makeRoom(files, ['claude'])
    expect(fresh.room.soundAt('').overviewDistance).toBeCloseTo(parked, 6)
    fresh.room.dispose()
  })

  it('records the fresh fit while a card is held', async () => {
    const files = []
    for (let index = 0; index < 10; index += 1) files.push(`src/file-${index}.js`)
    files.push('docs/b.md')
    const { room } = await makeRoom(files, ['claude'])
    expect(room.anchor('src')).toBe(true)
    tickRoom(2)
    const held = room.soundAt('').overviewDistance
    room.setOptions({ maxFiles: 20 })
    expect(room.holding()).toBe('src')
    expect(room.soundAt('').overviewDistance).not.toBe(held)
    expect(room.soundAt('src').distance).toBeCloseTo(700, 0)
    room.park()
    expect(room.holding()).toBe(null)
    room.dispose()
  })

  it('stops following when a focus names no agent view', async () => {
    const { room } = await makeRoom(['src/a.js'], ['claude', 'hermes'])
    room.focus('claude')
    tickRoom(2)
    const before = room.soundAt('').distance
    room.focus('ghost')
    expect(room.focused()).toBe(null)
    room.setRoster([
      { key: 'hermes', name: 'hermes' },
      { key: 'claude', name: 'claude' },
    ])
    tickRoom(3)
    expect(room.soundAt('').distance).toBeCloseTo(before, 3)
    room.dispose()
  })
})
