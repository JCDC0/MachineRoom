import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const fakeStars = vi.hoisted(() => ({ launches: [], cancels: [], lands: [], resets: 0 }))
const fakeLabels = vi.hoisted(() => ({ shows: [] }))

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

vi.mock('../src/engine/labels.js', () => ({
  createLabels: () => ({
    show(text, point, color = '#ffffff') {
      fakeLabels.shows.push({ text, point: { x: point.x, y: point.y, z: point.z }, color })
    },
    update() {},
    clear() {},
    dispose() {},
  }),
}))

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

const createdNodes = []

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
  createdNodes.push(node)
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
  fakeLabels.shows.length = 0
  createdNodes.length = 0
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
  it('sends the orchestrator star in yellow', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['orchestrator', 'claude'])
    try {
      startRun(state, room)
      expect(fakeStars.launches).toHaveLength(1)
      expect(fakeStars.launches[0].color).toBe(0xe5ff00)
    } finally {
      room.dispose()
    }
  })

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

  it('cancels the stars of an agent when its run ends and shows no touch', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      tickRoom(1)
      fakeStars.cancels.length = 0
      fakeStars.lands.length = 0
      fakeStars.launches.length = 0
      fakeLabels.shows.length = 0
      const end = { type: 'run.end', agent: 'claude', ok: true, time: 2200, runId: 'r-claude' }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.lands).toHaveLength(0)
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: 'claude', to: null })).toBe(true)
      expect(fakeStars.cancels[0]({ agent: 'hermes', to: null })).toBe(false)
      expect(fakeLabels.shows).toHaveLength(0)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
      expect(fakeLabels.shows).toHaveLength(0)
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

  it('finishes only the child run when the run id belongs to the child', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['orchestrator', 'claude'])
    try {
      startRun(state, room)
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', time: 1500, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      tickRoom(2)
      const childRun = { type: 'run.start', agent: 'claude~1', time: 1600, runId: 'r-child' }
      apply(state, childRun)
      room.onActivity(childRun)
      const childTouch = {
        type: 'tool.start',
        agent: 'claude~1',
        id: 'c1',
        time: 1700,
        tool: 'edit',
        label: 'write src/a.js',
        touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
      }
      apply(state, childTouch)
      room.onActivity(childTouch)
      tickRoom(1)
      const parentTouch = {
        type: 'tool.start',
        agent: 'claude',
        id: 'p1',
        time: 1750,
        tool: 'edit',
        label: 'write src/a.js',
        touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
      }
      apply(state, parentTouch)
      room.onActivity(parentTouch)
      fakeStars.cancels.length = 0
      fakeStars.launches.length = 0
      const end = { type: 'run.end', agent: 'claude', ok: true, time: 1800, runId: 'r-child' }
      apply(state, end)
      room.onActivity(end)
      expect(state.agents.get('claude').status).toBe('working')
      expect(state.agents.get('claude~1').status).toBe('done')
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: 'claude', to: null })).toBe(false)
      expect(fakeStars.cancels[0]({ agent: 'claude~1', to: null })).toBe(true)
      tickRoom(1)
      expect(fakeStars.launches).toHaveLength(1)
      expect(fakeStars.launches[0].agent).toBe('claude')
    } finally {
      room.dispose()
    }
  })

  it('finishes the working children a parent run end finishes', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['orchestrator', 'claude'])
    try {
      startRun(state, room)
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', time: 1500, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      tickRoom(2)
      const childRun = { type: 'run.start', agent: 'claude~1', time: 1600, runId: 'r-child' }
      apply(state, childRun)
      room.onActivity(childRun)
      fakeStars.cancels.length = 0
      const end = { type: 'run.end', agent: 'claude', ok: true, time: 1800, runId: 'r-claude' }
      apply(state, end)
      room.onActivity(end)
      expect(state.agents.get('claude').status).toBe('done')
      expect(state.agents.get('claude~1').status).toBe('done')
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: 'claude', to: null })).toBe(true)
      expect(fakeStars.cancels[0]({ agent: 'claude~1', to: null })).toBe(true)
    } finally {
      room.dispose()
    }
  })

  it('cancels the stars and queued touches of an agent that ends', async () => {
    const { room, state } = await makeRoom()
    try {
      startRun(state, room)
      touchCall(state, room)
      tickRoom(1)
      fakeStars.cancels.length = 0
      fakeStars.lands.length = 0
      fakeLabels.shows.length = 0
      const end = { type: 'agent.end', agent: 'claude', ok: false, time: 2300 }
      apply(state, end)
      room.onActivity(end)
      expect(fakeStars.lands).toHaveLength(0)
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: 'claude', to: null })).toBe(true)
      expect(fakeLabels.shows).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })

  it('queues a touch from a child whose view is not built yet', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['claude'])
    try {
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', time: 3000, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      const touch = {
        type: 'tool.start',
        agent: 'claude~1',
        id: 'c1',
        time: 3100,
        tool: 'edit',
        label: 'write src/a.js',
        touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
      }
      apply(state, touch)
      room.onActivity(touch)
      expect(fakeStars.launches).toHaveLength(0)
      tickRoom(1)
      const launched = fakeStars.launches.find((launch) => launch.agent === 'claude~1')
      expect(launched).toBeTruthy()
    } finally {
      room.dispose()
    }
  })

  it('drops a failed touch from a child whose view is not built yet', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['claude'])
    try {
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', time: 3000, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      const touch = {
        type: 'tool.start',
        agent: 'claude~1',
        id: 'c1',
        time: 3100,
        tool: 'edit',
        label: 'write src/a.js',
        touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
      }
      apply(state, touch)
      room.onActivity(touch)
      const end = { type: 'tool.end', agent: 'claude~1', id: 'c1', ok: false, time: 3200 }
      apply(state, end)
      room.onActivity(end)
      expect(fakeLabels.shows.map((show) => show.text)).toContain('failed a.js')
      tickRoom(2)
      expect(fakeStars.launches.filter((launch) => launch.agent === 'claude~1')).toHaveLength(0)
      const card = createdNodes.find((node) => node.dataset?.path === 'src')
      expect(card.className).toContain('is-flash-red')
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

  it('cancels a star flowing to a removed agent and drops its queued spawn', async () => {
    const { room, state } = await makeRoom(['src/a.js'], ['orchestrator', 'claude'])
    try {
      startRun(state, room)
      expect(fakeStars.launches).toHaveLength(1)
      fakeStars.launches.length = 0
      fakeStars.cancels.length = 0
      const spawn = { type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', time: 3000, runId: 'r-claude' }
      apply(state, spawn)
      room.onActivity(spawn)
      room.setRoster([{ key: 'orchestrator', name: 'orchestrator' }])
      expect(fakeStars.cancels).toHaveLength(1)
      expect(fakeStars.cancels[0]({ agent: 'orchestrator', to: 'claude' })).toBe(true)
      expect(fakeStars.cancels[0]({ agent: 'orchestrator', to: 'hermes' })).toBe(false)
      tickRoom(2)
      expect(fakeStars.launches).toHaveLength(0)
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

describe('a touch under reduced motion', () => {
  it('shows its label after the frame draws the card', async () => {
    motionMatches = true
    const { room, state } = await makeRoom(['src/model/deep/a.js'], ['claude'])
    try {
      tickRoom(1)
      fakeLabels.shows.length = 0
      fakeStars.launches.length = 0
      const touch = {
        type: 'tool.start',
        agent: 'claude',
        id: 'm1',
        time: 2000,
        tool: 'edit',
        label: 'write src/model/deep/a.js',
        touches: [{ path: 'src/model/deep/a.js', mode: 'write', kind: 'file' }],
      }
      apply(state, touch)
      room.onActivity(touch)
      expect(fakeLabels.shows).toHaveLength(0)
      tickRoom(1)
      expect(fakeLabels.shows).toHaveLength(1)
      expect(fakeLabels.shows[0].text).toBe('write a.js')
      expect(fakeStars.launches).toHaveLength(0)
      expect(createdNodes.some((node) => node.dataset?.path === 'src/model/deep')).toBe(true)
    } finally {
      room.dispose()
    }
  })
})
