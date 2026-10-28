import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAgents } from '../src/engine/agents.js'
import { RED, YELLOW } from '../src/engine/sprites.js'
import { createTerminals } from '../src/engine/terminals.js'
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
  const cssScene = new THREE.Scene()
  const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
  const agents = createAgents(scene, roster, cssScene)
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
  return { agents, cssScene, roster, state, terminals, world }
}

function startWrite(state) {
  apply(state, {
    time: 1000,
    type: 'tool.start',
    agent: 'a',
    id: 't1',
    label: 'write a.js',
    touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
  })
}

describe('a failed tool call on a working agent', () => {
  it('turns the strip red as well as the callout', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    expect(view.callout.element.className).toBe('mr-callout is-working')
    expect(view.stripColor).toBe(YELLOW)

    apply(state, { time: 1100, type: 'tool.end', agent: 'a', id: 't1', ok: false })
    agents.update(state, 0.016, 1100, world, terminals)
    expect(view.callout.element.className).toBe('mr-callout is-error')
    expect(view.stripColor).toBe(RED)
    agents.dispose()
  })
})

describe('a child chip', () => {
  it('is removed with its view once the child fades', () => {
    const cssScene = new THREE.Scene()
    const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
    const agents = createAgents(new THREE.Scene(), roster, cssScene)
    const terminals = createTerminals(cssScene, roster)
    const state = createState({ files: [], dirs: [], created: [] }, roster)
    const world = {
      right: new THREE.Vector3(1, 0, 0),
      back: new THREE.Vector3(0, 0, 1),
      side: () => 1,
      edge: (dir, file, side, out) => out.set(500, 400, 0),
    }

    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    apply(state, { time: 2000, type: 'agent.end', agent: 'a~1', ok: true })
    apply(state, { time: 3000, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 2000, world, terminals)
    const chip = terminals.terminals.get('a~1')
    expect(chip).toBeTruthy()
    expect(cssScene.children).toContain(chip.object)

    agents.update(state, 0.016, 9500, world, terminals)
    expect(agents.views.has('a~1')).toBe(false)
    expect(terminals.terminals.has('a~1')).toBe(false)
    expect(chip.element.removed).toBe(true)
    expect(cssScene.children).not.toContain(chip.object)
    agents.dispose()
    terminals.dispose()
  })

  it('is removed when a sync drops its view', () => {
    const cssScene = new THREE.Scene()
    const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
    const agents = createAgents(new THREE.Scene(), roster, cssScene)
    const terminals = createTerminals(cssScene, roster)
    const state = createState({ files: [], dirs: [], created: [] }, roster)
    const world = {
      right: new THREE.Vector3(1, 0, 0),
      back: new THREE.Vector3(0, 0, 1),
      side: () => 1,
      edge: (dir, file, side, out) => out.set(500, 400, 0),
    }

    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    expect(terminals.terminals.has('a~1')).toBe(true)

    state.agents.delete('a~1')
    agents.snap(state, world)
    expect(agents.views.has('a~1')).toBe(false)
    agents.update(state, 0.016, 1016, world, terminals)
    expect(terminals.terminals.has('a~1')).toBe(false)
    agents.dispose()
    terminals.dispose()
  })
})

describe('createTerminals onPick', () => {
  it('gives the handler to roster chips and chips made later', () => {
    const picked = []
    const terminals = createTerminals(new THREE.Scene(), [{ key: 'a', name: 'Alpha' }], {
      onPick: (key) => picked.push(key),
    })
    terminals.terminals.get('a').element.listeners.get('click')()
    terminals.ensure('a~1', 'Alpha > Scout')
    terminals.terminals.get('a~1').element.listeners.get('click')()
    expect(picked).toEqual(['a', 'a~1'])
    terminals.dispose()
  })
})

describe('setEnds through a still agent', () => {
  it('writes the link and callout lines only when an end moves', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const linkVersion = view.link.geometry.attributes.position.version
    const calloutVersion = view.calloutLine.geometry.attributes.position.version
    expect(view.calloutLine.visible).toBe(true)

    agents.update(state, 0.016, 1016, world, terminals)
    expect(view.link.geometry.attributes.position.version).toBe(linkVersion)
    expect(view.calloutLine.geometry.attributes.position.version).toBe(calloutVersion)

    view.home.x += 60
    agents.update(state, 0.016, 1032, world, terminals)
    expect(view.link.geometry.attributes.position.version).toBeGreaterThan(linkVersion)
    expect(view.calloutLine.geometry.attributes.position.version).toBeGreaterThan(calloutVersion)
    agents.dispose()
  })
})

describe('owner labels', () => {
  it('titles the chip and the callout with the label', () => {
    const cssScene = new THREE.Scene()
    const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
    const agents = createAgents(new THREE.Scene(), roster, cssScene)
    const terminals = createTerminals(cssScene, roster)
    const state = createState({ files: [], dirs: [], created: [] }, roster)
    const world = {
      right: new THREE.Vector3(1, 0, 0),
      back: new THREE.Vector3(0, 0, 1),
      side: () => 1,
      edge: (dir, file, side, out) => out.set(500, 400, 0),
    }
    const labels = new Map([['a', 'Bridge Coder']])
    agents.setLabels(labels)
    terminals.setLabels(labels)
    agents.update(state, 0.016, 1000, world, terminals)
    terminals.update(state, 1000, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    expect(agents.views.get('a').callout.title.textContent).toBe('BRIDGE CODER')
    expect(terminals.terminals.get('a').title.textContent).toBe('Bridge Coder')

    agents.setLabels(new Map([['other', 'Other']]))
    terminals.setLabels(new Map([['other', 'Other']]))
    agents.update(state, 0.016, 1008, world, terminals)
    terminals.update(state, 1008, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    expect(agents.views.get('a').callout.title.textContent).toBe('A')
    expect(terminals.terminals.get('a').title.textContent).toBe('a')

    agents.setLabels(null)
    terminals.setLabels(null)
    agents.update(state, 0.016, 1016, world, terminals)
    terminals.update(state, 1016, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    expect(agents.views.get('a').callout.title.textContent).toBe('ALPHA')
    expect(terminals.terminals.get('a').title.textContent).toBe('Alpha')
    agents.dispose()
    terminals.dispose()
  })
})
