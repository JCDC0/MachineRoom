import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CALLOUT_CROWD_LIMIT,
  CALLOUT_OUT,
  CALLOUT_RECENT_KEEP,
  CALLOUT_RISE,
  ORCHESTRATOR_NAME_LIFT,
  calloutEdgePoint,
  calloutPoint,
  createAgents,
  fullCalloutKeys,
} from '../src/engine/agents.js'
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

  it('counts a working agent with no label toward the crowd limit', () => {
    const { agents, state, terminals, world } = harness(5)
    const tasks = new Map()
    for (let index = 0; index < 5; index += 1) {
      tasks.set(`a${index}`, `task ${index}`)
      const time = 1000 + index * 100
      if (index === 4) {
        apply(state, { time, type: 'run.start', agent: 'a4', runId: 'r4' })
      } else {
        apply(state, { time, type: 'tool.start', agent: `a${index}`, id: `t${index}`, label: `work ${index}`, touches: [] })
      }
      agents.update(state, 0.016, time, world, terminals, { focus: null, hover: null })
    }
    agents.setTasks(tasks)
    agents.update(state, 0.016, 5000, world, terminals, { focus: 'a0', hover: null })

    expect(agents.views.get('a0').callout.task.style.display).not.toBe('none')
    expect(agents.views.get('a1').callout.task.style.display).toBe('none')
    expect(agents.views.get('a2').callout.task.style.display).toBe('none')
    expect(agents.views.get('a3').callout.task.style.display).not.toBe('none')
    agents.dispose()
  })

  it('keeps the console rows and address link visible on a compact callout while its console is live', () => {
    const cssScene = new THREE.Scene()
    const roster = Array.from({ length: 5 }, (_, index) => ({ key: `a${index}`, name: `Agent ${index}`, shape: 'claude' }))
    const agents = createAgents(new THREE.Scene(), roster, cssScene)
    const terminals = createTerminals(cssScene, roster)
    const state = createState({ files: ['src/a.js'], dirs: ['src'], created: [] }, roster)
    const world = {
      right: new THREE.Vector3(1, 0, 0),
      back: new THREE.Vector3(0, 0, 1),
      side: () => 1,
      edge: (dir, file, side, out) => out.set(500, 400, 0),
    }

    const tasks = new Map()
    for (let index = 0; index < 5; index += 1) {
      const key = `a${index}`
      const time = 1000 + index * 100
      tasks.set(key, `task ${index}`)
      const activity = {
        time,
        type: 'tool.start',
        agent: key,
        id: `t${index}`,
        tool: index === 0 ? 'shell' : 'read',
        label: index === 0 ? 'npm run dev' : `read ${index}`,
        touches: [],
      }
      apply(state, activity)
      terminals.note(activity, time)
      if (index === 0) {
        const entry = state.agents.get('a0')
        entry.lines.push({ text: 'Local: http://localhost:5173/', tone: 'done' })
        entry.version += 1
      }
      agents.update(state, 0.016, time, world, terminals, { focus: null, hover: null })
    }
    agents.setTasks(tasks)
    agents.update(state, 0.016, 2000, world, terminals, { focus: null, hover: null })

    const view = agents.views.get('a0')
    expect(view.callout.task.style.display).toBe('none')
    expect(view.callout.cmd.style.display).toBe('none')
    expect(view.callout.consoleBlock.hidden).toBe(false)
    expect(view.callout.consoleBlock.style.display).toBe('')
    expect(view.callout.consoleLines.map((row) => row.textContent)).toEqual([
      'npm run dev',
      'Local: http://localhost:5173/',
    ])
    expect(view.callout.consoleLink.hidden).toBe(false)
    expect(view.callout.consoleLink.style.display).toBe('')
    expect(view.callout.consoleLink.href).toBe('http://localhost:5173/')
    expect(view.callout.consoleLink.textContent).toBe('http://localhost:5173/')
    expect(view.callout.element.className).toBe('mr-callout is-working is-address')

    agents.dispose()
    terminals.dispose()
  })
})

describe('calloutPoint', () => {
  it('places the box outward from the hub centre at four angles on the ring', () => {
    const radius = 300
    const y = 290
    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    for (const angle of angles) {
      const agent = { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius }
      const out = {}
      const box = calloutPoint(agent, out)
      expect(box).toBe(out)
      expect(Math.hypot(box.x, box.z)).toBeCloseTo(radius + CALLOUT_OUT, 6)
      expect(Math.hypot(box.x, box.z)).toBeGreaterThan(radius)
      expect(box.x).toBeCloseTo(Math.cos(angle) * (radius + CALLOUT_OUT), 6)
      expect(box.z).toBeCloseTo(Math.sin(angle) * (radius + CALLOUT_OUT), 6)
      expect(box.y).toBeCloseTo(y + CALLOUT_RISE, 6)
    }
  })

  it('uses an explicit distance when given', () => {
    const box = calloutPoint({ x: 300, y: 290, z: 0 }, {}, 150)
    expect(box.x).toBeCloseTo(450, 6)
    expect(box.y).toBeCloseTo(290 + CALLOUT_RISE, 6)
    expect(box.z).toBeCloseTo(0, 6)
  })

  it('keeps the side placement and orchestrator lift within 1 unit of the centre', () => {
    const plain = calloutPoint({ x: 0, y: 620, z: 0 })
    expect(plain.x).toBeCloseTo(-140, 6)
    expect(plain.y).toBeCloseTo(620 + 180, 6)
    expect(plain.z).toBeCloseTo(0, 6)

    const near = calloutPoint(
      { x: 0.5, y: 620, z: -0.5 },
      {},
      CALLOUT_OUT,
      { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, side: -1, lift: ORCHESTRATOR_NAME_LIFT }
    )
    expect(near.x).toBeCloseTo(0.5 - 140, 6)
    expect(near.y).toBeCloseTo(620 + 180 + ORCHESTRATOR_NAME_LIFT, 6)
    expect(near.z).toBeCloseTo(-0.5, 6)
  })

  it('ends the callout line at the near edge of the box', () => {
    const agent = new THREE.Vector3(300, 290, 0)
    const box = calloutPoint(agent, new THREE.Vector3())
    const edge = calloutEdgePoint(agent, box, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 90, 26, new THREE.Vector3())
    expect(edge.x).toBeCloseTo(box.x - 90, 6)
    expect(edge.distanceTo(agent)).toBeLessThan(box.distanceTo(agent))

    const { agents, state, terminals, world } = harness(1)
    apply(state, { time: 1000, type: 'tool.start', agent: 'a0', id: 't1', tool: 'read', label: 'read a.js', touches: [] })
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a0')
    const ends = view.calloutLine.geometry.attributes.position.array
    const lineEnd = new THREE.Vector3(ends[3], ends[4], ends[5])
    const boxPos = view.callout.object.position
    const agentPos = view.group.position
    expect(Math.hypot(boxPos.x, boxPos.z)).toBeGreaterThan(Math.hypot(agentPos.x, agentPos.z))
    expect(boxPos.y).toBeCloseTo(agentPos.y + CALLOUT_RISE, 4)
    expect(lineEnd.distanceTo(agentPos)).toBeLessThan(boxPos.distanceTo(agentPos))
    agents.dispose()
  })
})

describe('merged console inside the callout', () => {
  it('shows the last five shell rows and address link in the callout and creates no .mr-term-console element', () => {
    const created = []
    const previousCreate = globalThis.document.createElement
    globalThis.document.createElement = (tag) => {
      const node = previousCreate(tag)
      created.push(node)
      return node
    }
    try {
      const cssScene = new THREE.Scene()
      const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
      const picked = []
      const agents = createAgents(new THREE.Scene(), roster, cssScene)
      const terminals = createTerminals(cssScene, roster, { onPick: (key) => picked.push(key) })
      const state = createState({ files: [], dirs: [], created: [] }, roster)
      const world = {
        right: new THREE.Vector3(1, 0, 0),
        back: new THREE.Vector3(0, 0, 1),
        side: () => 1,
        edge: (dir, file, side, out) => out.set(500, 400, 0),
      }

      const start = { time: 1000, type: 'tool.start', agent: 'a', id: 'sh1', tool: 'shell', label: 'npm run dev', touches: [] }
      apply(state, start)
      terminals.note(start, 1000)
      const entry = state.agents.get('a')
      entry.lines.push(
        { text: 'line 1', tone: 'dim' },
        { text: 'line 2', tone: 'normal' },
        { text: 'line 3', tone: 'normal' },
        { text: 'Local: http://localhost:5173/', tone: 'done' },
        { text: 'ready', tone: 'normal' },
        { text: 'watching', tone: 'normal' }
      )
      entry.version += 1

      agents.update(state, 0.016, 1000, world, terminals)
      const view = agents.views.get('a')
      expect(view.callout.object.visible).toBe(true)
      expect(view.callout.consoleBlock.hidden).toBe(false)
      expect(view.callout.consoleLines.map((row) => row.textContent)).toEqual([
        'line 2',
        'line 3',
        'Local: http://localhost:5173/',
        'ready',
        'watching',
      ])
      expect(view.callout.consoleLink.className).toBe('mr-term-console-link')
      expect(view.callout.consoleLink.hidden).toBe(false)
      expect(view.callout.consoleLink.textContent).toBe('http://localhost:5173/')
      expect(view.callout.consoleLink.href).toBe('http://localhost:5173/')
      expect(view.callout.consoleLink.target).toBe('_blank')
      expect(view.callout.consoleLink.rel).toBe('noopener noreferrer')
      expect(view.callout.element.className).toBe('mr-callout is-working is-address')
      expect(view.callout.element.title).toBe('http://localhost:5173/')

      let stopped = false
      view.callout.consoleLink.onclick({ stopPropagation: () => { stopped = true } })
      expect(stopped).toBe(true)
      expect(picked).toEqual([])

      view.callout.element.listeners.get('click')()
      expect(picked).toEqual(['a'])

      let titleStopped = false
      view.callout.title.listeners.get('click')({ stopPropagation: () => { titleStopped = true } })
      expect(titleStopped).toBe(true)
      expect(picked).toEqual(['a', 'a'])

      let dblStopped = false
      view.callout.element.listeners.get('dblclick')({ stopPropagation: () => { dblStopped = true } })
      expect(dblStopped).toBe(true)

      const end = { time: 2000, type: 'tool.end', agent: 'a', id: 'sh1', ok: true }
      apply(state, end)
      terminals.note(end, 2000)
      agents.update(state, 0.016, 7999, world, terminals)
      expect(view.callout.consoleBlock.hidden).toBe(false)

      agents.update(state, 0.016, 8000, world, terminals)
      expect(view.callout.consoleBlock.hidden).toBe(true)
      expect(view.callout.element.className).toBe('mr-callout is-working')

      const consoleElements = created.filter((node) => /(?:^|\s)mr-term-console(?:\s|$)/.test(node.className || ''))
      expect(consoleElements).toEqual([])
      expect(cssScene.children).toHaveLength(2)

      agents.dispose()
      terminals.dispose()
    } finally {
      globalThis.document.createElement = previousCreate
    }
  })
})

describe('callout scene option', () => {
  it('adds and removes callouts on calloutScene when given, leaving cssScene clear', () => {
    const cssScene = new THREE.Scene()
    const calloutScene = new THREE.Scene()
    const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
    const agents = createAgents(new THREE.Scene(), roster, cssScene, { calloutScene })
    const state = createState({ files: [], dirs: [], created: [] }, roster)
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

    const initialCallout = agents.views.get('a').callout.object
    expect(initialCallout.parent).toBe(calloutScene)
    // R73-1: CSS3DObject writes an inline pointer-events: auto, which would beat the stylesheet.
    expect(agents.views.get('a').callout.element.style.pointerEvents).toBe('none')
    expect(calloutScene.children).toEqual([initialCallout])
    expect(cssScene.children).toEqual([])

    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a-sub', name: 'Child' })
    agents.update(state, 0.016, 1000, world, terminals)
    const childCallout = agents.views.get('a-sub').callout.object
    expect(childCallout.parent).toBe(calloutScene)
    expect(calloutScene.children).toContain(childCallout)
    expect(cssScene.children).toEqual([])

    agents.setRoster([
      { key: 'a', name: 'Alpha', shape: 'claude' },
      { key: 'b', name: 'Beta', shape: 'hermes' },
    ])
    const addedCallout = agents.views.get('b').callout.object
    expect(addedCallout.parent).toBe(calloutScene)
    expect(cssScene.children).toEqual([])

    agents.setRoster([{ key: 'a', name: 'Alpha', shape: 'claude' }])
    expect(addedCallout.parent).toBeNull()
    expect(calloutScene.children).not.toContain(addedCallout)

    agents.dispose()
    expect(initialCallout.parent).toBeNull()
    expect(childCallout.parent).toBeNull()
    expect(calloutScene.children).toEqual([])
  })

  it('falls back to cssScene when calloutScene is omitted', () => {
    const cssScene = new THREE.Scene()
    const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
    const agents = createAgents(new THREE.Scene(), roster, cssScene)

    const calloutObject = agents.views.get('a').callout.object
    expect(calloutObject.parent).toBe(cssScene)
    expect(cssScene.children).toEqual([calloutObject])

    agents.dispose()
    expect(calloutObject.parent).toBeNull()
    expect(cssScene.children).toEqual([])
  })
})
