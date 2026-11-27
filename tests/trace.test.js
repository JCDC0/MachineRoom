import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentColor } from '../src/engine/sprites.js'
import {
  FILE_TRACE_SECONDS,
  FOLDER_TRACE_SECONDS,
  TRACE_FADE_SECONDS,
  TRACE_HOLD_SECONDS,
  TRACE_SEGMENTS,
  createTrace,
  createTraces,
  traceClosedOutline,
  traceDrawnLength,
  traceHeadPoint,
  traceProgress,
  traceTotalLength,
} from '../src/engine/trace.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const traceSpy = vi.hoisted(() => ({ created: [], scenes: [], cards: null }))

vi.mock('../src/engine/cards.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createCards: (...args) => {
      const cards = actual.createCards(...args)
      traceSpy.cards = cards
      return cards
    },
  }
})

vi.mock('../src/engine/trace.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTraces: (scene) => {
      traceSpy.scenes.push(scene)
      const manager = actual.createTraces(scene)
      const start = manager.start
      manager.start = (options) => {
        const trace = start(options)
        if (trace) traceSpy.created.push({ trace, options })
        return trace
      }
      return manager
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
      for (const item of items) {
        if (item && typeof item === 'object') {
          item.parentNode = node
          item.parentElement = node
        }
      }
      node.children.push(...items)
    },
    appendChild(child) {
      if (child && typeof child === 'object') {
        child.parentNode = node
        child.parentElement = node
      }
      node.children.push(child)
      return child
    },
    replaceChildren(...items) {
      node.children.length = 0
      node.append(...items)
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
  traceSpy.created.length = 0
  traceSpy.scenes.length = 0
  traceSpy.cards = null
  createdNodes.length = 0
  motionMatches = false
  clock = 1000
})

describe('trace pure helpers', () => {
  const square = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    { x: 100, y: 100, z: 0 },
    { x: 0, y: 100, z: 0 },
  ]

  it('closes an open outline without duplicating a closed one', () => {
    const closed = traceClosedOutline(square)
    expect(closed).toHaveLength(5)
    expect(closed[4]).toEqual(square[0])
    expect(traceClosedOutline(closed)).toHaveLength(5)
  })

  it('gives the drawn length and head point at a share of the time', () => {
    expect(traceTotalLength(square)).toBeCloseTo(400, 6)
    expect(traceDrawnLength(square, -1)).toBe(0)
    expect(traceDrawnLength(square, 0)).toBe(0)
    expect(traceDrawnLength(square, 0.25)).toBeCloseTo(100, 6)
    expect(traceDrawnLength(square, 0.625)).toBeCloseTo(250, 6)
    expect(traceDrawnLength(square, 1)).toBeCloseTo(400, 6)
    expect(traceDrawnLength(square, 2)).toBeCloseTo(400, 6)

    expect(traceHeadPoint(square, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(traceHeadPoint(square, 0.25)).toEqual({ x: 100, y: 0, z: 0 })
    expect(traceHeadPoint(square, 0.5)).toEqual({ x: 100, y: 100, z: 0 })
    expect(traceHeadPoint(square, 0.75)).toEqual({ x: 0, y: 100, z: 0 })
    expect(traceHeadPoint(square, 1)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('tracks draw, hold, fade and reduced motion phases on wall time', () => {
    expect(traceProgress(0, 0.6, 0.15, 0.8)).toEqual({
      share: 0,
      opacity: 1,
      drawing: true,
      holding: false,
      fading: false,
      done: false,
    })
    expect(traceProgress(0.3, 0.6, 0.15, 0.8)).toEqual({
      share: 0.5,
      opacity: 1,
      drawing: true,
      holding: false,
      fading: false,
      done: false,
    })
    expect(traceProgress(0.65, 0.6, 0.15, 0.8)).toEqual({
      share: 1,
      opacity: 1,
      drawing: false,
      holding: true,
      fading: false,
      done: false,
    })
    const fading = traceProgress(1.15, 0.6, 0.15, 0.8)
    expect(fading.share).toBe(1)
    expect(fading.opacity).toBeCloseTo(0.5, 6)
    expect(fading.fading).toBe(true)
    expect(fading.done).toBe(false)
    expect(traceProgress(1.55, 0.6, 0.15, 0.8).done).toBe(true)
    expect(traceProgress(0.1, 0.6, 0.15, 0.8, true).done).toBe(true)
  })
})

describe('createTrace and createTraces', () => {
  const outline = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    { x: 100, y: 40, z: 0 },
    { x: 0, y: 40, z: 0 },
  ]

  it('allocates geometry once per trace, draws head and fading tail, holds, fades and disposes', () => {
    const scene = new THREE.Scene()
    const trace = createTrace(scene, { points: outline, color: 0xff8c1a, duration: 0.4, hold: 0.1, fade: 0.8 })
    const initialGeometry = trace.geometry
    const geoDispose = vi.spyOn(trace.geometry, 'dispose')
    const coreDispose = vi.spyOn(trace.core.material, 'dispose')
    const sheathDispose = vi.spyOn(trace.sheath.material, 'dispose')
    const headGeoDispose = vi.spyOn(trace.head.geometry, 'dispose')
    const headMatDispose = vi.spyOn(trace.head.material, 'dispose')

    expect(trace.core.material.color.getHex()).toBe(0xff8c1a)
    expect(trace.geometry.getAttribute('instanceStart').data.count).toBe(TRACE_SEGMENTS)
    expect(trace.update(0.2)).toBe(true)
    expect(trace.geometry).toBe(initialGeometry)
    expect(trace.geometry.instanceCount).toBeGreaterThan(0)
    expect(trace.head.visible).toBe(true)
    expect(trace.head.geometry.getAttribute('position').array[0]).toBeCloseTo(100, 4)

    const colors = trace.geometry.getAttribute('instanceColorStart').data.array
    const tail = colors[0]
    const head = colors[(trace.geometry.instanceCount - 1) * 6 + 3]
    expect(head).toBeGreaterThan(tail)

    expect(trace.update(0.25)).toBe(true)
    expect(trace.head.visible).toBe(false)
    expect(trace.core.material.opacity).toBe(1)

    expect(trace.update(0.45)).toBe(true)
    expect(trace.core.material.opacity).toBeCloseTo(0.5, 5)
    expect(trace.update(0.5)).toBe(false)

    trace.dispose()
    expect(scene.children).toHaveLength(0)
    expect(geoDispose).toHaveBeenCalledOnce()
    expect(coreDispose).toHaveBeenCalledOnce()
    expect(sheathDispose).toHaveBeenCalledOnce()
    expect(headGeoDispose).toHaveBeenCalledOnce()
    expect(headMatDispose).toHaveBeenCalledOnce()
  })

  it('disposes finished traces from the manager', () => {
    const scene = new THREE.Scene()
    const traces = createTraces(scene)
    const trace = traces.start({ points: outline, color: 0xff8c1a, duration: 0.4, hold: 0.1, fade: 0.8 })
    const geoDispose = vi.spyOn(trace.geometry, 'dispose')
    expect(traces.items.size).toBe(1)
    traces.update(0.6)
    expect(traces.items.size).toBe(1)
    traces.update(0.8)
    expect(traces.items.size).toBe(0)
    expect(geoDispose).toHaveBeenCalledOnce()
    expect(scene.children).toHaveLength(0)
    traces.dispose()
  })
})

describe('traces from touch stars in the room', () => {
  async function makeRoom(files = ['src/a.js'], created = [], sound = undefined) {
    const { createRoom } = await import('../src/engine/room.js')
    const roster = [{ key: 'claude', name: 'Claude' }]
    const state = createState(makeTree({ root: 'demo', files, created }), roster)
    const room = createRoom({
      surface: roomSurface,
      gl: roomGl,
      css: roomCss,
      rootName: 'demo',
      agents: roster,
      getState: () => state,
      sound,
    })
    return { room, state }
  }

  function tick(times = 1, stepMs = 16) {
    for (let index = 0; index < times; index += 1) {
      clock += stepMs
      roomFrame?.(clock)
    }
  }

  function writeTouch(state, room, path, id = 't1', mode = 'write', kind = 'file') {
    const activity = {
      type: 'tool.start',
      agent: 'claude',
      id,
      time: clock,
      tool: kind === 'file' ? 'edit' : 'list',
      label: `${mode} ${path}`,
      touches: [{ path, mode, kind }],
    }
    apply(state, activity)
    room.onActivity(activity)
  }

  it('ends a created file star in a trace on that file row in the agent colour and fades the row in', async () => {
    const { room, state } = await makeRoom(['src/a.js', 'src/new.js'], ['src/new.js'])
    try {
      tick(2)
      writeTouch(state, room, 'src/new.js', 'c1')
      tick(1)
      const rowNode = createdNodes.find((node) => node.className.includes('mr-item') && node.children.some((c) => c.textContent === 'new.js'))
      expect(rowNode).toBeTruthy()
      expect(rowNode.style.opacity).toBe('0')
      expect(traceSpy.created).toHaveLength(0)

      tick(60)
      expect(traceSpy.created).toHaveLength(1)
      const { trace, options } = traceSpy.created[0]
      expect(options.duration).toBe(FILE_TRACE_SECONDS)
      expect(options.fade).toBe(TRACE_FADE_SECONDS)
      expect(trace.color).toBe(agentColor(0))
      expect(trace.core.material.color.getHex()).toBe(agentColor(0))
      const expectedRow = traceSpy.cards.rowOutline('src', 'src/new.js', [])
      expect(trace.outline).toHaveLength(5)
      expect(trace.outline[0].x).toBeCloseTo(expectedRow[0].x, 4)
      expect(trace.outline[0].y).toBeCloseTo(expectedRow[0].y, 4)

      const geoDispose = vi.spyOn(trace.geometry, 'dispose')
      tick(Math.ceil((FILE_TRACE_SECONDS + TRACE_HOLD_SECONDS + TRACE_FADE_SECONDS) / 0.016) + 5)
      expect(rowNode.style.opacity).toBe('')
      expect(geoDispose).toHaveBeenCalledOnce()
    } finally {
      room.dispose()
    }
  })

  it('ends a created folder star in a trace on the new card from its tab anchor in the agent colour', async () => {
    const { room, state } = await makeRoom(['src/a.js', 'newdir/b.js'], ['newdir/b.js'])
    try {
      tick(2)
      writeTouch(state, room, 'newdir/b.js', 'c2')
      tick(1)
      const cardNode = createdNodes.find((node) => node.dataset?.path === 'newdir')
      expect(cardNode).toBeTruthy()
      expect(cardNode.style.opacity).toBe('0')
      expect(traceSpy.created).toHaveLength(0)

      tick(60)
      expect(traceSpy.created).toHaveLength(1)
      const { trace, options } = traceSpy.created[0]
      expect(options.duration).toBe(FOLDER_TRACE_SECONDS)
      expect(options.fade).toBe(TRACE_FADE_SECONDS)
      expect(trace.color).toBe(agentColor(0))
      const tab = traceSpy.cards.anchor('newdir', new THREE.Vector3())
      const vectors = traceSpy.cards.vectors()
      expect(trace.outline[0].x).toBeCloseTo(tab.x + vectors.back.x * 2, 4)
      expect(trace.outline[0].y).toBeCloseTo(tab.y + vectors.back.y * 2, 4)
      expect(trace.outline[0].z).toBeCloseTo(tab.z + vectors.back.z * 2, 4)

      tick(Math.ceil(FOLDER_TRACE_SECONDS / 0.016) + 2)
      expect(Number(cardNode.style.opacity || '1')).toBeGreaterThan(0.5)
      tick(Math.ceil((TRACE_HOLD_SECONDS + TRACE_FADE_SECONDS) / 0.016) + 5)
      expect(cardNode.style.opacity).toBe('')
    } finally {
      room.dispose()
    }
  })

  it('makes no trace for a read or a write to a known file', async () => {
    const { room, state } = await makeRoom(['src/a.js'], [])
    try {
      tick(2)
      writeTouch(state, room, 'src/a.js', 'r1', 'read')
      tick(60)
      writeTouch(state, room, 'src/a.js', 'w1', 'write')
      tick(60)
      expect(traceSpy.created).toHaveLength(0)
    } finally {
      room.dispose()
    }
  })

  it('makes no trace under reduced motion and shows the card and row at once', async () => {
    motionMatches = true
    const { room, state } = await makeRoom(['src/a.js', 'src/new.js', 'newdir/b.js'], ['src/new.js', 'newdir/b.js'])
    try {
      tick(2)
      writeTouch(state, room, 'src/new.js', 'c1')
      writeTouch(state, room, 'newdir/b.js', 'c2')
      tick(2)
      expect(traceSpy.created).toHaveLength(0)
      const cardNode = createdNodes.find((node) => node.dataset?.path === 'newdir')
      expect(cardNode.style.opacity ?? '').toBe('')
      const rowNode = createdNodes.find((node) => node.className.includes('mr-item') && node.children.some((c) => c.textContent === 'new.js'))
      expect(rowNode.style.opacity ?? '').toBe('')
    } finally {
      room.dispose()
    }
  })

  it('follows a moving card and disposes active traces when the room disposes', async () => {
    const { room, state } = await makeRoom(['src/a.js', 'newdir/b.js'], ['newdir/b.js'])
    try {
      tick(2)
      writeTouch(state, room, 'newdir/b.js', 'c2')
      tick(60)
      expect(traceSpy.created).toHaveLength(1)
      const { trace } = traceSpy.created[0]
      const startX = trace.outline[0].x
      const startZ = trace.outline[0].z
      tick(10, 50)
      expect(trace.outline[0].x !== startX || trace.outline[0].z !== startZ).toBe(true)
      const tab = traceSpy.cards.anchor('newdir', new THREE.Vector3())
      const vectors = traceSpy.cards.vectors()
      expect(trace.outline[0].x).toBeCloseTo(tab.x + vectors.back.x * 2, 4)
      expect(trace.outline[0].y).toBeCloseTo(tab.y + vectors.back.y * 2, 4)
      expect(trace.outline[0].z).toBeCloseTo(tab.z + vectors.back.z * 2, 4)
      const geoDispose = vi.spyOn(trace.geometry, 'dispose')
      room.dispose()
      expect(geoDispose).toHaveBeenCalledOnce()
    } finally {
      room.dispose()
    }
  })
})
