import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CALLOUT_CROWD_LIMIT, CALLOUT_RECENT_KEEP, createAgents, fullCalloutKeys } from '../src/engine/agents.js'
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

function busy(count) {
  return Array.from({ length: count }, (_, index) => ({ key: `a${index}`, since: index + 1 }))
}

function harness(count) {
  const roster = Array.from({ length: count }, (_, index) => ({ key: `a${index}`, name: `Agent ${index}`, shape: 'claude' }))
  const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
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

function work(agents, state, terminals, world, count, last = 'a0') {
  const tasks = new Map()
  for (let index = 0; index < count; index += 1) {
    tasks.set(`a${index}`, `task ${index}`)
    const time = 1000 + index * 100
    apply(state, { time, type: 'tool.start', agent: `a${index}`, id: `t${index}`, label: `work ${index}`, touches: [] })
    agents.update(state, 0.016, time, world, terminals, { focus: null, hover: null })
  }
  agents.setTasks(tasks)
  agents.update(state, 0.016, 5000, world, terminals, { focus: last, hover: null })
}

describe('fullCalloutKeys', () => {
  it('keeps every callout with four agents at work', () => {
    const kept = fullCalloutKeys(busy(CALLOUT_CROWD_LIMIT))
    expect([...kept].sort()).toEqual(['a0', 'a1', 'a2', 'a3'])
  })

  it('keeps the two newest, the focused and the hovered agents above four', () => {
    const kept = fullCalloutKeys(busy(6), 'a0', 'a1')
    expect(CALLOUT_RECENT_KEEP).toBe(2)
    expect([...kept].sort()).toEqual(['a0', 'a1', 'a4', 'a5'])
  })

  it('ignores a focus or hover that is not at work', () => {
    const kept = fullCalloutKeys(busy(5), 'gone', 'nobody')
    expect([...kept].sort()).toEqual(['a3', 'a4'])
  })

  it('breaks a tie on the start time by key', () => {
    const tied = [
      { key: 'b', since: 7 },
      { key: 'a', since: 7 },
      { key: 'd', since: 7 },
      { key: 'c', since: 7 },
      { key: 'e', since: 7 },
    ]
    expect([...fullCalloutKeys(tied)].sort()).toEqual(['a', 'b'])
  })

  it('answers nothing when no agent works', () => {
    expect([...fullCalloutKeys([])]).toEqual([])
    expect([...fullCalloutKeys(null)]).toEqual([])
  })
})

describe('the crowded room callouts', () => {
  it('shows the name block only on the agents past the kept set', () => {
    const { agents, state, terminals, world } = harness(6)
    work(agents, state, terminals, world, 6, 'a0')

    const full = ['a0', 'a4', 'a5']
    for (let index = 0; index < 6; index += 1) {
      const callout = agents.views.get(`a${index}`).callout
      expect(callout.title.textContent).toBe(`AGENT ${index}`)
      expect(callout.task.textContent).toBe(`task ${index}`)
      expect(callout.cmd.textContent).toBe(`work ${index}`)
      if (full.includes(`a${index}`)) expect(callout.task.style.display).not.toBe('none')
      else expect(callout.task.style.display).toBe('none')
    }
    agents.dispose()
  })

  it('shows every full callout with four agents at work', () => {
    const { agents, state, terminals, world } = harness(4)
    work(agents, state, terminals, world, 4, 'a0')

    for (let index = 0; index < 4; index += 1) {
      const callout = agents.views.get(`a${index}`).callout
      expect(callout.task.style.display).not.toBe('none')
      expect(callout.cmd.style.display).not.toBe('none')
    }
    agents.dispose()
  })
})
