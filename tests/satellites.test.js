import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERNET_HOME, INTERNET_RADIUS } from '../src/engine/internet.js'
import {
  BROWSER_HOME,
  BROWSER_RADIUS,
  BROWSER_TRACE_SECONDS,
  MAX_MCP_NODES,
  MCP_NODE_RADIUS,
  MCP_TRACE_SECONDS,
  browserBobY,
  createSatellites,
  mcpOrbitParams,
  mcpOrbitPoint,
} from '../src/engine/satellites.js'
import { agentColor } from '../src/engine/sprites.js'
import { TRACE_FADE_SECONDS, TRACE_HOLD_SECONDS } from '../src/engine/trace.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const spies = vi.hoisted(() => ({
  traces: [],
  stars: [],
  satellites: null,
  internet: null,
  agents: null,
  camera: null,
  clickHandler: null,
}))

vi.mock('../src/engine/trace.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTraces: (scene) => {
      const manager = actual.createTraces(scene)
      const start = manager.start
      manager.start = (options) => {
        const trace = start(options)
        if (trace) spies.traces.push({ trace, options })
        return trace
      }
      return manager
    },
  }
})

vi.mock('../src/engine/stars.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStars: (scene, callbacks) => {
      const manager = actual.createStars(scene, callbacks)
      const launch = manager.launch
      manager.launch = (options) => {
        spies.stars.push(options)
        return launch(options)
      }
      return manager
    },
  }
})

vi.mock('../src/engine/satellites.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createSatellites: (scene) => {
      const sat = actual.createSatellites(scene)
      spies.satellites = sat
      return sat
    },
  }
})

vi.mock('../src/engine/internet.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createInternet: (scene, texture) => {
      const net = actual.createInternet(scene, texture)
      spies.internet = net
      return net
    },
  }
})

vi.mock('../src/engine/agents.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createAgents: (...args) => {
      const set = actual.createAgents(...args)
      spies.agents = set
      return set
    },
  }
})

vi.mock('../src/engine/camera.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createCameraRig: (camera, surface) => {
      spies.camera = camera
      const rig = actual.createCameraRig(camera, surface)
      const setClick = rig.setClickHandler
      rig.setClickHandler = (handler) => {
        spies.clickHandler = handler
        return setClick(handler)
      }
      return rig
    },
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
      node.append(...items)
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    removeChild() {},
    setAttribute() {},
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
let clock = 1000

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
})

afterAll(() => {
  globalThis.window = savedWindow
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancel
  globalThis.ResizeObserver = savedResize
})

beforeEach(() => {
  spies.traces.length = 0
  spies.stars.length = 0
  spies.satellites = null
  spies.internet = null
  spies.agents = null
  spies.camera = null
  spies.clickHandler = null
  motionMatches = false
  clock = 1000
})

describe('satellites pure helpers and LRU nodes', () => {
  it('computes deterministic orbits without Math.random and keeps still under reduced motion', () => {
    const randomSpy = vi.spyOn(Math, 'random')
    const paramsA = mcpOrbitParams('github')
    const paramsB = mcpOrbitParams('github')
    const paramsC = mcpOrbitParams('node_repl')
    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
    expect(paramsA).toEqual(paramsB)
    expect(paramsA).not.toEqual(paramsC)

    const p0 = mcpOrbitPoint(paramsA, 0, INTERNET_HOME, {})
    const p1 = mcpOrbitPoint(paramsA, 5, INTERNET_HOME, {})
    expect(p1).not.toEqual(p0)
    expect(mcpOrbitPoint(paramsA, 5, INTERNET_HOME, {}, true)).toEqual(p0)
    expect(browserBobY(1, BROWSER_HOME.y, false)).not.toBe(BROWSER_HOME.y)
    expect(browserBobY(1, BROWSER_HOME.y, true)).toBe(BROWSER_HOME.y)
  })

  it('keeps at most 12 MCP nodes, evicting least recently used first', () => {
    const sat = createSatellites(new THREE.Scene())
    try {
      for (let index = 1; index <= MAX_MCP_NODES; index += 1) {
        sat.useMcp(`srv-${index}`)
      }
      expect(sat.mcpServers()).toHaveLength(12)
      expect(sat.mcpServers()[0]).toBe('srv-1')

      sat.useMcp('srv-1')
      sat.useMcp('srv-13')
      expect(sat.mcpServers()).toHaveLength(12)
      expect(sat.mcpNode('srv-1')).not.toBeNull()
      expect(sat.mcpNode('srv-2')).toBeNull()
      expect(sat.mcpServers()[0]).toBe('srv-3')
      expect(sat.mcpServers()[11]).toBe('srv-13')

      const node = sat.mcpNode('srv-1')
      expect(node.label).toBeTruthy()
      const startPos = node.group.position.clone()
      sat.update(2)
      expect(node.group.position.distanceTo(startPos)).toBeGreaterThan(1)
    } finally {
      sat.dispose()
    }
  })

  it('keeps browser and MCP nodes still under reduced motion', () => {
    motionMatches = true
    const sat = createSatellites(new THREE.Scene())
    try {
      sat.prepareBrowser('c1')
      sat.useMcp('github', 'c2')
      const browserStart = sat.browserGroup.position.clone()
      const node = sat.mcpNode('github')
      const mcpStart = node.group.position.clone()

      sat.update(2)
      expect(sat.browserVisible()).toBe(true)
      expect(node.group.visible).toBe(true)
      expect(sat.browserGroup.position).toEqual(browserStart)
      expect(node.group.position).toEqual(mcpStart)
    } finally {
      sat.dispose()
    }
  })
})

describe('browser and MCP satellites in the room', () => {
  async function makeRoom() {
    const { createRoom } = await import('../src/engine/room.js')
    const roster = [{ key: 'claude', name: 'Claude' }]
    const state = createState(makeTree({ root: 'demo', files: ['src/a.js'] }), roster)
    const room = createRoom({
      surface: roomSurface,
      gl: roomGl,
      css: roomCss,
      rootName: 'demo',
      agents: roster,
      getState: () => state,
    })
    return { room, state }
  }

  function tick(times = 1, stepMs = 16) {
    for (let index = 0; index < times; index += 1) {
      clock += stepMs
      roomFrame?.(clock)
    }
  }

  it('hides the browser until the first browser call, aims its star at the browser and traces it', async () => {
    const { room, state } = await makeRoom()
    try {
      tick(2)
      expect(spies.satellites.browserVisible()).toBe(false)
      expect(spies.traces).toHaveLength(0)

      const activity = {
        type: 'tool.start',
        agent: 'claude',
        id: 'b1',
        time: clock,
        tool: 'mcp',
        label: 'mcp playwright browser_navigate https://example.com',
        touches: [],
      }
      apply(state, activity)
      room.onActivity(activity)

      expect(spies.stars).toHaveLength(1)
      const end = spies.stars[0].points.at(-1)
      const browserPos = spies.satellites.browserAnchor(new THREE.Vector3())
      expect(Math.hypot(end.x - browserPos.x, end.y - browserPos.y, end.z - browserPos.z)).toBeCloseTo(BROWSER_RADIUS, 1)
      expect(Math.hypot(end.x - INTERNET_HOME.x, end.y - INTERNET_HOME.y, end.z - INTERNET_HOME.z)).toBeGreaterThan(INTERNET_RADIUS + 50)
      expect(spies.satellites.browserVisible()).toBe(false)
      expect(room.webAgents()).toEqual([])

      tick(2)
      const liveBrowserPos = spies.satellites.browserAnchor(new THREE.Vector3())
      const view = spies.agents.views.get('claude')
      expect(view.beam.visible).toBe(true)
      const beamEnd = view.beamPath[1]
      expect(Math.hypot(beamEnd.x - liveBrowserPos.x, beamEnd.y - liveBrowserPos.y, beamEnd.z - liveBrowserPos.z)).toBeCloseTo(BROWSER_RADIUS, 1)

      tick(60)
      expect(spies.internet.glow()).toBe(0)
      expect(spies.traces).toHaveLength(1)
      expect(spies.traces[0].trace.color).toBe(agentColor(0))
      expect(spies.traces[0].options.duration).toBe(BROWSER_TRACE_SECONDS)

      tick(5)
      expect(spies.satellites.browserVisible()).toBe(true)

      tick(Math.ceil((BROWSER_TRACE_SECONDS + TRACE_HOLD_SECONDS + TRACE_FADE_SECONDS) / 0.016) + 5)
      expect(spies.satellites.browserReveal()).toBe(1)

      const second = { ...activity, id: 'b2', time: clock }
      apply(state, second)
      room.onActivity(second)
      tick(60)
      expect(spies.traces).toHaveLength(1)
    } finally {
      room.dispose()
    }
  })

  it('sends MCP stars to the server node with a trace and keeps the internet sphere unlit', async () => {
    const { room, state } = await makeRoom()
    try {
      tick(2)
      room.setOnline(false)
      const activity = {
        type: 'tool.start',
        agent: 'claude',
        id: 'm1',
        time: clock,
        tool: 'mcp',
        label: 'mcp github list_issues',
        touches: [],
      }
      apply(state, activity)
      room.onActivity(activity)

      expect(spies.stars).toHaveLength(1)
      const nodePos = spies.satellites.mcpAnchor('github', new THREE.Vector3())
      const end = spies.stars[0].points.at(-1)
      expect(Math.hypot(end.x - nodePos.x, end.y - nodePos.y, end.z - nodePos.z)).toBeCloseTo(MCP_NODE_RADIUS, 1)

      tick(60)
      expect(spies.internet.glow()).toBe(0)
      expect(spies.traces).toHaveLength(1)
      expect(spies.traces[0].trace.color).toBe(agentColor(0))
      expect(spies.traces[0].options.duration).toBe(MCP_TRACE_SECONDS)
      tick(5)
      expect(spies.satellites.mcpNode('github').group.visible).toBe(true)

      const view = spies.agents.views.get('claude')
      expect(view.beam.visible).toBe(true)
      const liveNodePos = spies.satellites.mcpAnchor('github', new THREE.Vector3())
      const beamEnd = view.beamPath[1]
      expect(Math.hypot(beamEnd.x - liveNodePos.x, beamEnd.y - liveNodePos.y, beamEnd.z - liveNodePos.z)).toBeCloseTo(MCP_NODE_RADIUS, 1)
    } finally {
      room.dispose()
    }
  })

  it('keeps sphere clicks inspecting internet while clicks on browser or MCP nodes select nothing', async () => {
    const { room, state } = await makeRoom()
    try {
      const browserCall = {
        type: 'tool.start',
        agent: 'claude',
        id: 'b1',
        time: clock,
        tool: 'mcp',
        label: 'mcp playwright click',
        touches: [],
      }
      const mcpCall = {
        type: 'tool.start',
        agent: 'claude',
        id: 'm1',
        time: clock,
        tool: 'mcp',
        label: 'mcp github list_issues',
        touches: [],
      }
      apply(state, browserCall)
      room.onActivity(browserCall)
      apply(state, mcpCall)
      room.onActivity(mcpCall)
      tick(90)
      spies.camera.updateMatrixWorld(true)
      spies.internet.group.updateMatrixWorld(true)
      spies.satellites.group.updateMatrixWorld(true)

      function clickAtWorld(point) {
        const projected = point.clone().project(spies.camera)
        const clientX = ((projected.x + 1) / 2) * 1200
        const clientY = ((1 - projected.y) / 2) * 800
        spies.clickHandler({ clientX, clientY })
      }

      clickAtWorld(spies.satellites.browserAnchor(new THREE.Vector3()))
      expect(room.inspecting()).toBeNull()

      clickAtWorld(spies.satellites.mcpAnchor('github', new THREE.Vector3()))
      expect(room.inspecting()).toBeNull()

      clickAtWorld(INTERNET_HOME)
      expect(room.inspecting()).toEqual({ kind: 'internet', id: 'internet' })
    } finally {
      room.dispose()
    }
  })

  it('lights the internet sphere and aims at it only for internet calls', async () => {
    const { room, state } = await makeRoom()
    try {
      tick(2)
      const activity = {
        type: 'tool.start',
        agent: 'claude',
        id: 'w1',
        time: clock,
        tool: 'web',
        label: 'web fetch https://example.com',
        touches: [],
      }
      apply(state, activity)
      room.onActivity(activity)

      expect(spies.stars).toHaveLength(1)
      const end = spies.stars[0].points.at(-1)
      expect(Math.hypot(end.x - INTERNET_HOME.x, end.y - INTERNET_HOME.y, end.z - INTERNET_HOME.z)).toBeCloseTo(INTERNET_RADIUS, 1)
      expect(room.webAgents()).toEqual(['claude'])
      tick(20)
      expect(spies.internet.glow()).toBeGreaterThan(0)
    } finally {
      room.dispose()
    }
  })

  it('draws browser and MCP nodes at once with no trace under reduced motion', async () => {
    motionMatches = true
    const { room, state } = await makeRoom()
    try {
      tick(2)
      const browserCall = {
        type: 'tool.start',
        agent: 'claude',
        id: 'b1',
        time: clock,
        tool: 'mcp',
        label: 'mcp playwright click',
        touches: [],
      }
      const mcpCall = {
        type: 'tool.start',
        agent: 'claude',
        id: 'm1',
        time: clock,
        tool: 'mcp',
        label: 'mcp github list_issues',
        touches: [],
      }
      apply(state, browserCall)
      room.onActivity(browserCall)
      apply(state, mcpCall)
      room.onActivity(mcpCall)
      tick(5)

      expect(spies.stars).toHaveLength(0)
      expect(spies.traces).toHaveLength(0)
      expect(spies.satellites.browserVisible()).toBe(true)
      expect(spies.satellites.mcpNode('github').group.visible).toBe(true)

      const view = spies.agents.views.get('claude')
      expect(view.beam.visible).toBe(true)
      const liveNodePos = spies.satellites.mcpAnchor('github', new THREE.Vector3())
      const beamEnd = view.beamPath[1]
      expect(Math.hypot(beamEnd.x - liveNodePos.x, beamEnd.y - liveNodePos.y, beamEnd.z - liveNodePos.z)).toBeCloseTo(MCP_NODE_RADIUS, 1)
    } finally {
      room.dispose()
    }
  })
})
