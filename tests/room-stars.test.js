import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const fakeStars = vi.hoisted(() => ({ launches: [], cancels: [], lands: [], resets: 0 }))

vi.mock('../src/engine/stars.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStars: () => ({
      launch(options) {
        fakeStars.launches.push(options)
        return true
      },
      cancel(test) {
        fakeStars.cancels.push(test)
        return 0
      },
      land(test) {
        fakeStars.lands.push(test)
        return 0
      },
      update() {},
      reset() {
        fakeStars.resets += 1
      },
      dispose() {},
    }),
  }
})

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
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
  fill() {},
  arc() {},
  closePath() {},
  save() {},
  restore() {},
  translate() {},
  rotate() {},
}

function fakeStyle() {
  const style = {}
  style.setProperty = (name, value) => {
    style[name] = String(value)
  }
  style.removeProperty = (name) => {
    delete style[name]
  }
  return style
}

function fakeElement(tag = 'div') {
  const listeners = new Map()
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: fakeStyle(),
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
    removed: false,
    listeners,
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
    fire(type, event = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ target: node, stopPropagation() {}, ...event })
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
let motionMatches = false

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
    matchMedia: () => ({
      get matches() {
        return motionMatches
      },
      addEventListener() {},
      removeEventListener() {},
    }),
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
  motionMatches = false
})

afterAll(() => {
  globalThis.window = savedWindow
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancel
  globalThis.ResizeObserver = savedResize
})

beforeEach(() => {
  fakeStars.launches.length = 0
  fakeStars.cancels.length = 0
  fakeStars.lands.length = 0
  fakeStars.resets = 0
  motionMatches = false
  clock = performance.now()
})

async function makeRoom(files = ['src/a.js'], agents = ['claude']) {
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

let clock = 0

function tickRoom(times = 1) {
  for (let index = 0; index < times; index += 1) {
    clock += 16
    roomFrame?.(clock)
  }
}

function startRun(state, room, time = 1000) {
  const activity = { type: 'run.start', agent: 'claude', time, runId: 'r-claude' }
  apply(state, activity)
  room.onActivity(activity)
  return activity
}

function touchCall(state, room, id = 't1', time = 2000, mode = 'write', path = 'src/a.js') {
  const activity = {
    type: 'tool.start',
    agent: 'claude',
    id,
    time,
    tool: 'edit',
    label: `${mode} ${path}`,
    touches: [{ path, mode, kind: 'file' }],
  }
  apply(state, activity)
  room.onActivity(activity)
  return activity
}

describe('a touch star on the frame it belongs to', () => {
  it('waits for the frame and follows the current chain', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      fakeStars.launches.length = 0
      touchCall(state, room)
      expect(fakeStars.launches).toHaveLength(0)
      tickRoom(1)
      expect(fakeStars.launches).toHaveLength(1)
      const launch = fakeStars.launches[0]
      expect(launch.agent).toBe('claude')
      expect(launch.call).toBe('t1')
      expect(launch.points.length).toBeGreaterThan(2)
      expect(typeof launch.follow).toBe('function')
    } finally {
      room.dispose()
    }
  })

  it('keeps its last point on the card tab while it flies', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      fakeStars.launches.length = 0
      touchCall(state, room)
      tickRoom(1)
      const end = { x: 0, y: 0, z: 0 }
      expect(fakeStars.launches[0].follow(end)).toBe(end)
      expect(Number.isFinite(end.x)).toBe(true)
      expect(Number.isFinite(end.y)).toBe(true)
      expect(Number.isFinite(end.z)).toBe(true)
    } finally {
      room.dispose()
    }
  })
})

describe('the stars of a call and a run', () => {
  it('cancels the flying stars of a failed call', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      tickRoom(1)
      const launch = fakeStars.launches[0]
      fakeStars.cancels.length = 0
      const end = { type: 'tool.end', agent: 'claude', id: 't1', ok: false, time: 2100 }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: launch.agent, call: launch.call })).toBe(true)
      expect(fakeStars.cancels[0]({ agent: 'claude', call: 'other' })).toBe(false)
    } finally {
      room.dispose()
    }
  })

  it('never launches a queued touch star when its call fails first', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      const end = { type: 'tool.end', agent: 'claude', id: 't1', ok: false, time: 2100 }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.launches).toHaveLength(0)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })

  it('lands an agent star when its run ends', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      tickRoom(1)
      const launch = fakeStars.launches[0]
      fakeStars.lands.length = 0
      const end = { type: 'run.end', agent: 'claude', ok: true, time: 2200, runId: 'r-claude' }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.lands).toHaveLength(1)
      expect(fakeStars.lands[0]({ agent: launch.agent, call: launch.call })).toBe(true)
      expect(fakeStars.lands[0]({ agent: 'hermes', call: launch.call })).toBe(false)
    } finally {
      room.dispose()
    }
  })

  it('never launches a queued touch star when its run ends first', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      const end = { type: 'run.end', agent: 'claude', ok: true, time: 2200, runId: 'r-claude' }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.launches).toHaveLength(0)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })

  it('cancels the stars of a view removed from the roster', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['claude', 'hermes'])
    try {
      startRun(state, room)
      touchCall(state, room)
      tickRoom(1)
      const launch = fakeStars.launches[0]
      fakeStars.cancels.length = 0
      room.setRoster([{ key: 'hermes', name: 'hermes' }])
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: launch.agent, call: launch.call })).toBe(true)
    } finally {
      room.dispose()
    }
  })

  it('does not launch a queued touch star when its view leaves the roster', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['claude', 'hermes'])
    try {
      startRun(state, room)
      touchCall(state, room)
      room.setRoster([{ key: 'hermes', name: 'hermes' }])
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })
})

describe('the stars of a spawn and a web call', () => {
  it('sends no spawn star under reduced motion', async () => {
    motionMatches = true
    const { room, state } = await makeRoom()
    try {
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', label: 'task', time: 3000, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })

  it('sends the spawn star when motion is allowed', async () => {
    const { room, state } = await makeRoom()
    try {
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', label: 'task', time: 3000, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(1)
      expect(fakeStars.launches[0].agent).toBe('claude')
    } finally {
      room.dispose()
    }
  })

  it('sends no web star while the room is offline', async () => {
    const { room, state } = await makeRoom()
    try {
      room.setOnline(false)
      const first = {
        type: 'tool.start',
        agent: 'claude',
        id: 'w1',
        time: 4000,
        tool: 'web',
        label: 'search https://example.com',
        touches: [],
      }
      apply(state, first)
      room.onActivity(first)
      tickRoom(1)
      expect(fakeStars.launches).toHaveLength(0)

      room.setOnline(true)
      const second = { ...first, id: 'w2', time: 4100 }
      apply(state, second)
      room.onActivity(second)
      tickRoom(1)
      expect(fakeStars.launches).toHaveLength(1)
      expect(fakeStars.launches[0].agent).toBe('claude')
      expect(fakeStars.launches[0].call).toBe('w2')
    } finally {
      room.dispose()
    }
  })
})
