import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { RING_LEVEL_MAX } from '../src/engine/hub.js'
import { makeTree } from '../src/model/paths.js'
import { createState } from '../src/model/state.js'

const fakeGit = vi.hoisted(() => ({ states: [], changed: true }))
const fakeHub = vi.hoisted(() => ({ depths: [] }))

vi.mock('../src/engine/gitTree.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createGitTree: (scene) => {
      const tree = actual.createGitTree(scene)
      const setState = tree.setState
      tree.setState = (state) => {
        fakeGit.states.push(state)
        setState(state)
        return fakeGit.changed
      }
      return tree
    },
  }
})

vi.mock('../src/engine/hub.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createHub: (...args) => {
      const hub = actual.createHub(...args)
      const setDepth = hub.setDepth
      hub.setDepth = (value) => {
        const next = setDepth(value)
        fakeHub.depths.push(next)
        return next
      }
      return hub
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

describe('the room and its git tree', () => {
  it('hands the git state to the git tree and returns its answer', async () => {
    const { room } = await makeRoom()
    try {
      const git = { git: true, branch: 'main', detached: false, head: 'c1', dirty: false, branches: [], commits: [], truncated: false }
      fakeGit.states.length = 0
      fakeGit.changed = true
      expect(room.setGitState(git)).toBe(true)
      expect(fakeGit.states).toEqual([git])
      fakeGit.changed = false
      expect(room.setGitState(git)).toBe(false)
    } finally {
      room.dispose()
    }
  })
})

describe('the room takes the chosen top and the depth', () => {
  function tick(times = 1) {
    for (let index = 0; index < times; index += 1) roomFrame?.(1000 + index * 16)
  }

  it('keeps the room running when it is handed the chosen top', async () => {
    const { room } = await makeRoom(['src/a.js'], ['orchestrator', 'claude', 'claude-session'])
    try {
      expect(room.setChosenTop('claude-session')).toBe('claude-session')
      tick()
      expect(room.setChosenTop('orchestrator')).toBe('orchestrator')
      tick()
      expect(room.setChosenTop('not-a-view')).toBe('orchestrator')
      tick()
    } finally {
      room.dispose()
    }
  })

  it('answers the drawn park ring cap and keeps it between 1 and 4', async () => {
    const { room } = await makeRoom()
    try {
      expect(room.setDepth(2)).toBe(2)
      expect(room.setDepth(9)).toBe(RING_LEVEL_MAX)
      expect(room.setDepth(0)).toBe(1)
      expect(room.setDepth(undefined)).toBe(RING_LEVEL_MAX)
      tick()
    } finally {
      room.dispose()
    }
  })

  it('reads the depth limit from the state and caps the drawn rings', async () => {
    const { room, state } = await makeRoom()
    try {
      fakeHub.depths.length = 0
      state.depthLimit = 2
      tick()
      expect(fakeHub.depths.at(-1)).toBe(2)
      state.depthLimit = 1
      tick()
      expect(fakeHub.depths.at(-1)).toBe(1)
    } finally {
      room.dispose()
    }
  })

  it('passes folderContents and openOnTouch through room.setOptions', async () => {
    const { room } = await makeRoom(['src/a.js', 'docs/b.md'])
    try {
      const srcCard = () => createdNodes.findLast((node) => node.dataset?.path === 'src')
      tick()
      expect(srcCard().className).not.toContain('is-collapsed')
      room.setOptions({ folderContents: false, openOnTouch: false })
      tick()
      expect(srcCard().className).toContain('is-collapsed')
      room.setOptions({ folderContents: true })
      tick()
      expect(srcCard().className).not.toContain('is-collapsed')
    } finally {
      room.dispose()
    }
  })
})
