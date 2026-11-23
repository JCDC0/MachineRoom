import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { RING_LEVEL_MAX } from '../src/engine/hub.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const fakeGit = vi.hoisted(() => ({ states: [], changed: true }))
const fakeHub = vi.hoisted(() => ({ depths: [] }))
const fakeCss = vi.hoisted(() => ({ renderers: [], renders: [] }))

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
    closest: (selector) => {
      if (selector === '.mr-callout[data-agent]') {
        let current = node
        while (current) {
          if (typeof current.className === 'string' && /(?:^|\s)mr-callout(?:\s|$)/.test(current.className) && current.dataset?.agent) {
            return current
          }
          current = current.parentElement ?? current.parentNode ?? null
        }
      }
      return null
    },
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
      this.sizes = []
      this.renders = []
      fakeCss.renderers.push(this)
    }
    setSize(width, height) {
      this.sizes.push({ width, height })
    }
    render(scene, camera) {
      const entry = { renderer: this, scene, camera }
      this.renders.push(entry)
      fakeCss.renders.push(entry)
    }
  }
  return { ...actual, CSS3DRenderer: FakeCSS3DRenderer }
})

let savedWindow
let savedDocument
let savedRaf
let savedCancel
let savedResize
let roomFrame = null
let resizeCallback = null
let roomSurface
let roomGl
let roomCss
let motionMatches = false
const windowListeners = new Map()

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
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = windowListeners.get(type)
      if (!list) return
      const index = list.indexOf(fn)
      if (index !== -1) list.splice(index, 1)
    },
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
    constructor(callback) {
      resizeCallback = callback
    }
    observe() {}
    disconnect() {
      resizeCallback = null
    }
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
async function makeRoom(files = ['src/a.js'], agents = ['claude'], css = roomCss) {
  const { createRoom } = await import('../src/engine/room.js')
  const roster = agents.map((key) => ({ key, name: key }))
  const state = createState(makeTree({ root: 'demo', files }), roster)
  let current = state
  const room = createRoom({
    surface: roomSurface,
    gl: roomGl,
    css,
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
  let clock = 1000
  function tick(times = 1) {
    for (let index = 0; index < times; index += 1) {
      clock += 16
      roomFrame?.(clock)
    }
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
      let now = performance.now() + 1000
      const step = (frames = 1, ms = 100) => {
        for (let index = 0; index < frames; index += 1) {
          now += ms
          roomFrame?.(now)
        }
      }
      const srcCard = () => createdNodes.findLast((node) => node.dataset?.path === 'src')
      const docsCard = () => createdNodes.findLast((node) => node.dataset?.path === 'docs')
      const touch = (id) => ({
        type: 'tool.start',
        agent: 'claude',
        id,
        tool: 'read',
        label: 'read src/a.js',
        touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }],
      })

      step(1)
      expect(srcCard().className).not.toContain('is-collapsed')

      room.setOptions({ folderContents: false, openOnTouch: false })
      step(1)
      expect(srcCard().className).not.toContain('is-collapsed')
      step(3)
      expect(srcCard().className).toContain('is-collapsed')

      room.onActivity(touch('c1'))
      for (let frame = 0; frame < 13; frame += 1) {
        step(1)
        expect(srcCard().className).toContain('is-collapsed')
      }

      room.setOptions({ openOnTouch: true })
      step(1)
      expect(srcCard().className).toContain('is-collapsed')

      room.onActivity(touch('c2'))
      step(13)
      expect(srcCard().className).not.toContain('is-collapsed')
      expect(docsCard().className).toContain('is-collapsed')

      room.setOptions({ folderContents: true })
      step(10)
      expect(docsCard().className).not.toContain('is-collapsed')
      expect(srcCard().className).not.toContain('is-collapsed')
    } finally {
      room.dispose()
    }
  })

  it('opens a folder touched just before run.end at 8x even when the end cancels the star', async () => {
    const { room, state } = await makeRoom(['src/a.js', 'docs/b.md'])
    try {
      let now = performance.now() + 1000
      const step = (frames = 1, ms = 16) => {
        for (let index = 0; index < frames; index += 1) {
          now += ms
          roomFrame?.(now)
        }
      }
      const cardOf = (path) => createdNodes.findLast((node) => node.dataset?.path === path)
      const itemsOf = (card) => card.children[1].children[1]
      const send = (activity) => {
        apply(state, activity)
        room.onActivity(activity)
      }

      room.setOptions({ folderContents: false, openOnTouch: true })
      room.setSpeed(8)
      step(60)
      const src = cardOf('src')
      const docs = cardOf('docs')
      expect(src.className).toContain('is-collapsed')
      expect(docs.className).toContain('is-collapsed')

      send({ type: 'run.start', agent: 'claude', runId: 'r1', time: 500 })
      send({
        type: 'tool.start',
        agent: 'claude',
        runId: 'r1',
        id: 'c1',
        time: 1000,
        tool: 'read',
        label: 'read src/a.js',
        touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }],
      })
      step(2)
      send({ type: 'run.end', agent: 'claude', runId: 'r1', time: 1300, ok: true })
      step(16)
      expect(src.className).not.toContain('is-collapsed')
      expect(itemsOf(src).hidden).toBe(false)
      expect(itemsOf(src).className).toBe('mr-card-items')
      expect(itemsOf(src).children).toHaveLength(1)
      expect(docs.className).toContain('is-collapsed')

      step(80)
      expect(src.className).toContain('is-collapsed')
      expect(itemsOf(src).hidden).toBe(true)

      send({ type: 'run.start', agent: 'claude', runId: 'r2', time: 3000 })
      send({
        type: 'tool.start',
        agent: 'claude',
        runId: 'r2',
        id: 'c2',
        time: 3100,
        tool: 'read',
        label: 'read docs/b.md',
        touches: [{ kind: 'file', path: 'docs/b.md', mode: 'read' }],
      })
      send({ type: 'run.end', agent: 'claude', runId: 'r2', time: 3150, ok: true })
      step(16)
      expect(docs.className).not.toContain('is-collapsed')
      expect(itemsOf(docs).hidden).toBe(false)
      expect(itemsOf(docs).className).toBe('mr-card-items')
      expect(itemsOf(docs).children).toHaveLength(1)
      expect(src.className).toContain('is-collapsed')

      step(80)
      expect(docs.className).toContain('is-collapsed')
      expect(itemsOf(docs).hidden).toBe(true)

      room.setOptions({ openOnTouch: false })
      send({ type: 'run.start', agent: 'claude', runId: 'r3', time: 5000 })
      send({
        type: 'tool.start',
        agent: 'claude',
        runId: 'r3',
        id: 'c3',
        time: 5100,
        tool: 'read',
        label: 'read src/a.js',
        touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }],
      })
      step(2)
      send({ type: 'run.end', agent: 'claude', runId: 'r3', time: 5300, ok: true })
      step(16)
      expect(src.className).toContain('is-collapsed')
    } finally {
      room.dispose()
    }
  })

  it('expands a compact callout when the pointer moves over .mr-callout[data-agent]', async () => {
    const keys = ['a0', 'a1', 'a2', 'a3', 'a4']
    const { room, state } = await makeRoom(['src/a.js'], keys)
    try {
      const tasks = new Map()
      keys.forEach((key, index) => {
        tasks.set(key, `task ${index}`)
        apply(state, {
          time: 1000 + index * 100,
          type: 'tool.start',
          agent: key,
          id: `t${index}`,
          tool: 'read',
          label: `read ${index}`,
          touches: [],
        })
        tick()
      })
      room.setTasks(tasks)
      tick()

      const callout = createdNodes.findLast((node) => node.dataset?.agent === 'a0' && node.className.includes('mr-callout'))
      const title = callout.children[0]
      const task = callout.children[1]
      const cmd = callout.children[2]
      expect(task.style.display).toBe('none')
      expect(cmd.style.display).toBe('none')

      for (const fn of windowListeners.get('pointermove') ?? []) fn({ target: title })
      tick()
      expect(task.style.display).toBe('')
      expect(cmd.style.display).toBe('')

      for (const fn of windowListeners.get('pointermove') ?? []) fn({ target: globalThis.document.body })
      tick()
      expect(task.style.display).toBe('none')
      expect(cmd.style.display).toBe('none')
    } finally {
      room.dispose()
    }
  })

  it('mounts, renders, resizes and disposes a second CSS3D layer for callouts after the cards', async () => {
    fakeCss.renderers.length = 0
    fakeCss.renders.length = 0
    const css = fakeElement('div')
    const { room } = await makeRoom(['src/a.js'], ['claude'], css)
    let disposed = false
    try {
      expect(fakeCss.renderers).toHaveLength(2)
      const [cardRenderer, calloutRenderer] = fakeCss.renderers
      expect(css.children).toEqual([cardRenderer.domElement, calloutRenderer.domElement])
      expect(cardRenderer.domElement.style.pointerEvents).toBe('none')
      expect(calloutRenderer.domElement.style.pointerEvents).toBe('none')
      expect(calloutRenderer.domElement.style.position).toBe('absolute')
      expect(calloutRenderer.domElement.style.top).toBe('0')
      expect(calloutRenderer.domElement.style.left).toBe('0')

      tick()
      expect(fakeCss.renders).toHaveLength(2)
      expect(fakeCss.renders[0].renderer).toBe(cardRenderer)
      expect(fakeCss.renders[1].renderer).toBe(calloutRenderer)
      expect(fakeCss.renders[0].camera).toBe(fakeCss.renders[1].camera)

      const cardScene = fakeCss.renders[0].scene
      const calloutScene = fakeCss.renders[1].scene
      expect(calloutScene).not.toBe(cardScene)

      const cardsInCardScene = cardScene.children.filter((obj) => obj.element?.className?.includes('mr-card'))
      const calloutsInCardScene = cardScene.children.filter((obj) => obj.element?.className?.includes('mr-callout'))
      const calloutsInCalloutScene = calloutScene.children.filter((obj) => obj.element?.className?.includes('mr-callout'))
      const cardsInCalloutScene = calloutScene.children.filter((obj) => obj.element?.className?.includes('mr-card'))

      expect(cardsInCardScene.length).toBeGreaterThan(0)
      expect(calloutsInCardScene).toEqual([])
      expect(calloutsInCalloutScene).toHaveLength(1)
      expect(calloutsInCalloutScene[0].parent).toBe(calloutScene)
      expect(cardsInCalloutScene).toEqual([])

      expect(cardRenderer.sizes).toEqual([{ width: 1200, height: 800 }])
      expect(calloutRenderer.sizes).toEqual([{ width: 1200, height: 800 }])

      roomSurface.clientWidth = 960
      roomSurface.clientHeight = 540
      resizeCallback?.()
      expect(cardRenderer.sizes.at(-1)).toEqual({ width: 960, height: 540 })
      expect(calloutRenderer.sizes.at(-1)).toEqual({ width: 960, height: 540 })

      room.dispose()
      disposed = true
      expect(css.children).toEqual([])
      expect(calloutScene.children).toEqual([])
      expect(calloutsInCalloutScene[0].parent).toBeNull()
    } finally {
      roomSurface.clientWidth = 1200
      roomSurface.clientHeight = 800
      if (!disposed) room.dispose()
    }
  })
})
