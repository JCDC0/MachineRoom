import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SPINNER_ARC_OPACITY,
  SPINNER_ARC_SHARE,
  SPINNER_PHASE,
  SPINNER_RADIUS_SCALE,
  SPINNER_RING_OPACITY,
  SPINNER_SWEEP_SECONDS,
  THINKING_DELAY_MS,
  THINKING_IN_SECONDS,
  THINKING_OUT_SECONDS,
  THINKING_SPIN,
  agentThinking,
  createAgents,
  thinkingArc,
  thinkingDue,
  thinkingLevel,
} from '../src/engine/agents.js'
import { WHITE } from '../src/engine/sprites.js'
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

const ROSTER = [{ key: 'a', name: 'Alpha', shape: 'claude' }]

function harness() {
  const scene = new THREE.Scene()
  const agents = createAgents(scene, ROSTER, new THREE.Scene())
  const state = createState({ files: ['src/a.js'], dirs: ['src'], created: [] }, ROSTER)
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
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    links: [],
    mask: { dimmed: false, lit: new Set(), targeted: new Set() },
    side: () => 1,
    edge: (dir, file, side, out) => out.set(100, 0, 0),
  }
  return { agents, state, terminals, world }
}

function startRun(state, time = 1000) {
  apply(state, { time, type: 'run.start', agent: 'a', runId: 'r1' })
}

describe('agentThinking', () => {
  it('is true while the run is open and no tool call is open', () => {
    expect(agentThinking({ status: 'working', calls: new Map() })).toBe(true)
    expect(agentThinking({ status: 'running', calls: new Map() })).toBe(true)
    expect(agentThinking({ status: 'working', calls: new Map([['t1', []]]) })).toBe(false)
    expect(agentThinking({ status: 'working', openCalls: 0 })).toBe(true)
    expect(agentThinking({ status: 'working', openCalls: 2 })).toBe(false)
  })

  it('is false for a run that is queued, done, failed or gone', () => {
    expect(agentThinking({ status: 'queued' })).toBe(false)
    expect(agentThinking({ status: 'done' })).toBe(false)
    expect(agentThinking({ status: 'error' })).toBe(false)
    expect(agentThinking({ status: 'idle' })).toBe(false)
    expect(agentThinking({})).toBe(false)
    expect(agentThinking(null)).toBe(false)
  })
})

describe('thinkingDue', () => {
  it('waits 250 ms from the first frame of thinking', () => {
    expect(THINKING_DELAY_MS).toBe(250)
    expect(thinkingDue(1000, 1000)).toBe(false)
    expect(thinkingDue(1000, 1249)).toBe(false)
    expect(thinkingDue(1000, 1250)).toBe(true)
    expect(thinkingDue(1000, 1500)).toBe(true)
    expect(thinkingDue(1000, 1100, 100)).toBe(true)
    expect(thinkingDue(1000, 1099, 100)).toBe(false)
  })

  it('reads no start, junk and a negative delay safely', () => {
    expect(thinkingDue(0, 5000)).toBe(false)
    expect(thinkingDue(-5, 500)).toBe(false)
    expect(thinkingDue('x', 500)).toBe(false)
    expect(thinkingDue(1000, 'x')).toBe(false)
    expect(thinkingDue(1000, 1000, -50)).toBe(true)
    expect(thinkingDue(null, null)).toBe(false)
  })
})

describe('thinkingLevel', () => {
  it('eases in over 0.3 seconds and clamps at 1', () => {
    expect(thinkingLevel(0, true, 0.15)).toBeCloseTo(0.5, 10)
    expect(thinkingLevel(0.5, true, 0.15)).toBe(1)
    expect(thinkingLevel(1, true, 0.5)).toBe(1)
    expect(THINKING_IN_SECONDS).toBe(0.3)
  })

  it('eases out over 0.6 seconds and clamps at 0', () => {
    expect(thinkingLevel(1, false, THINKING_OUT_SECONDS / 2)).toBeCloseTo(0.5, 10)
    expect(thinkingLevel(0.5, false, 0.3)).toBe(0)
    expect(thinkingLevel(0, false, 0.3)).toBe(0)
    expect(THINKING_OUT_SECONDS).toBe(0.6)
  })

  it('jumps to its target under reduced motion and reads junk as 0', () => {
    expect(thinkingLevel(0.4, true, 0, true)).toBe(1)
    expect(thinkingLevel(0.4, false, 0, true)).toBe(0)
    expect(thinkingLevel('x', true, 0.1)).toBeCloseTo(0.333333, 5)
    expect(thinkingLevel(-2, true, 0.1)).toBeCloseTo(0.333333, 5)
    expect(thinkingLevel(4, false, 0.1)).toBeCloseTo(1 - 0.1 / 0.6, 10)
    expect(thinkingLevel(0.2, true, -1)).toBe(0.2)
  })
})

describe('thinkingArc', () => {
  it('sweeps once a second and wraps', () => {
    expect(SPINNER_SWEEP_SECONDS).toBe(1)
    expect(thinkingArc(0)).toBe(0)
    expect(thinkingArc(250)).toBeCloseTo(Math.PI / 2, 10)
    expect(thinkingArc(500)).toBeCloseTo(Math.PI, 10)
    expect(thinkingArc(750)).toBeCloseTo((Math.PI * 3) / 2, 10)
    expect(thinkingArc(1000)).toBeCloseTo(0, 10)
    expect(thinkingArc(1250)).toBeCloseTo(Math.PI / 2, 10)
  })

  it('holds a phase apart and rests at 0 under reduced motion', () => {
    expect(SPINNER_PHASE).toBe(Math.PI)
    expect(thinkingArc(0, SPINNER_PHASE)).toBeCloseTo(Math.PI, 10)
    expect(thinkingArc(250, SPINNER_PHASE)).toBeCloseTo((Math.PI * 3) / 2, 10)
    expect(thinkingArc(1234, SPINNER_PHASE, SPINNER_SWEEP_SECONDS, true)).toBe(0)
  })

  it('reads junk as time 0 on the default sweep', () => {
    expect(thinkingArc('x')).toBe(0)
    expect(thinkingArc(250, 'x')).toBeCloseTo(Math.PI / 2, 10)
    expect(thinkingArc(250, 0, 0)).toBeCloseTo(Math.PI / 2, 10)
    expect(thinkingArc(2000, 0, 2)).toBeCloseTo(0, 10)
  })
})

describe('the thinking spinner on an agent', () => {
  it('builds once as two faint white rings at right angles with a bright quarter arc each', () => {    const { agents, state, terminals, world } = harness()
    startRun(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const spinner = view.spinner
    expect(spinner.group.children).toHaveLength(2)
    expect(spinner.group.visible).toBe(false)
    expect(spinner.rings).toHaveLength(2)
    expect(spinner.arcs).toHaveLength(2)
    expect(spinner.rings[1].parent.rotation.x).toBeCloseTo(Math.PI / 2, 10)
    expect(spinner.ringMaterial.color.getHex()).toBe(WHITE)
    expect(spinner.arcMaterial.color.getHex()).toBe(WHITE)
    expect(SPINNER_RING_OPACITY).toBeLessThan(SPINNER_ARC_OPACITY)

    const radius = view.shellRadius * SPINNER_RADIUS_SCALE
    for (const ring of spinner.rings) {
      const positions = ring.geometry.getAttribute('position')
      const point = new THREE.Vector3().fromBufferAttribute(positions, 0)
      expect(point.length()).toBeCloseTo(radius, 5)
    }
    for (const arc of spinner.arcs) {
      const positions = arc.geometry.getAttribute('position')
      const first = new THREE.Vector3().fromBufferAttribute(positions, 0)
      const last = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1)
      expect(Math.atan2(last.y, last.x)).toBeCloseTo(SPINNER_ARC_SHARE * Math.PI * 2, 5)
      expect(first.x).toBeCloseTo(radius, 5)
    }
    expect(SPINNER_ARC_SHARE).toBe(0.25)

    agents.update(state, 0.4, 1400, world, terminals)
    expect(view.spinner).toBe(spinner)
    expect(agents.views.get('a').spinner.group.children).toHaveLength(2)
    agents.dispose()
  })

  it('waits 250 ms, then eases in, and its arcs sweep once a second out of phase', () => {
    const { agents, state, terminals, world } = harness()
    startRun(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(false)

    agents.update(state, 0.2, 1200, world, terminals)
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(false)

    agents.update(state, 0.049, 1249, world, terminals)
    expect(view.thinking).toBe(0)

    agents.update(state, 0.001, 1250, world, terminals)
    expect(view.thinking).toBeCloseTo(0.001 / THINKING_IN_SECONDS, 10)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.opacity).toBeCloseTo(SPINNER_RING_OPACITY * view.thinking, 10)
    expect(view.spinner.arcMaterial.opacity).toBeCloseTo(SPINNER_ARC_OPACITY * view.thinking, 10)

    const firstArc = view.spinner.arcs[0].rotation.z
    const secondArc = view.spinner.arcs[1].rotation.z
    expect(secondArc - firstArc).toBeCloseTo(SPINNER_PHASE, 10)
    agents.update(state, 0.25, 1500, world, terminals)
    expect(view.spinner.arcs[0].rotation.z - firstArc).toBeCloseTo(Math.PI / 2, 5)
    expect(view.spinner.arcs[1].rotation.z - secondArc).toBeCloseTo(Math.PI / 2, 5)
    agents.dispose()
  })

  it('turns the shape one turn in 4 seconds while it thinks', () => {
    const { agents, state, terminals, world } = harness()
    startRun(state)
    let now = 1000
    for (let step = 0; step < 40; step += 1) {
      now += 16
      agents.update(state, 0.016, now, world, terminals)
    }
    const view = agents.views.get('a')
    expect(view.thinking).toBe(1)
    const before = view.shape.rotation.y
    agents.update(state, 0.1, now + 100, world, terminals)
    expect(view.shape.rotation.y - before).toBeCloseTo(0.1 * THINKING_SPIN, 6)
    expect(THINKING_SPIN * 4).toBeCloseTo(Math.PI * 2, 10)
    agents.dispose()
  })

  it('eases out over 0.6 seconds when a tool call opens or the run ends', () => {
    const { agents, state, terminals, world } = harness()
    startRun(state)
    let now = 1000
    for (let step = 0; step < 40; step += 1) {
      now += 16
      agents.update(state, 0.016, now, world, terminals)
    }
    const view = agents.views.get('a')
    expect(view.thinking).toBe(1)

    apply(state, {
      time: now,
      type: 'tool.start',
      agent: 'a',
      id: 't1',
      label: 'read src/a.js',
      touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
    })
    now += 300
    agents.update(state, 0.3, now, world, terminals)
    expect(view.thinking).toBeCloseTo(0.5, 10)
    expect(view.spinner.group.visible).toBe(true)
    now += 300
    agents.update(state, 0.3, now, world, terminals)
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(false)

    apply(state, { time: now, type: 'run.end', agent: 'a', ok: true })
    agents.update(state, 0.016, now + 16, world, terminals)
    expect(view.spinner.group.visible).toBe(false)
    agents.dispose()
  })

  it('never shows the spinner for a run of tool calls shorter than the delay', () => {
    const { agents, state, terminals, world } = harness()
    startRun(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const first = {
      time: 1100,
      type: 'tool.start',
      agent: 'a',
      id: 't1',
      label: 'read src/a.js',
      touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
    }
    apply(state, first)
    agents.update(state, 0.016, 1116, world, terminals)
    apply(state, { time: 1120, type: 'tool.end', agent: 'a', id: 't1', ok: true })
    agents.update(state, 0.016, 1132, world, terminals)
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(false)
    agents.dispose()
  })
})
