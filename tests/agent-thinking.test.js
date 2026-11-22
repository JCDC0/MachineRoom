import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SPINNER_ARC_OPACITY,
  SPINNER_ARC_SHARE,
  SPINNER_PHASE,
  SPINNER_RADIUS_SCALE,
  SPINNER_RING_BRIGHT_MAX,
  SPINNER_RING_OPACITY,
  SPINNER_SWEEP_SECONDS,
  THINKING_DELAY_MS,
  THINKING_IN_SECONDS,
  THINKING_LOOP_SECONDS,
  THINKING_OUT_SECONDS,
  THINKING_SPIN,
  agentThinking,
  createAgents,
  thinkingArc,
  thinkingDue,
  thinkingLevel,
  thinkingPhase,
  thinkingRingPose,
} from '../src/engine/agents.js'
import { GREEN, RED, WHITE, YELLOW, disposeStill } from '../src/engine/sprites.js'
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
    expect(agentThinking({ status: 'working', openCalls: new Map(), calls: new Map([['t1', []]]) })).toBe(true)
    expect(agentThinking({ status: 'working', openCalls: new Map([['t1', { tool: 'read', label: 'read src/a.js', touches: [] }]]), calls: new Map() })).toBe(false)
    expect(agentThinking({ status: 'working', openCalls: new Set(), calls: new Map([['t1', []]]) })).toBe(true)
    expect(agentThinking({ status: 'working', openCalls: new Set(['t1']), calls: new Map() })).toBe(false)
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

describe('thinkingPhase', () => {
  it('hashes an agent key into a stable fraction in [0, 1) and separates distinct keys', () => {
    const keys = ['a', 'b', 'claude', 'opencode', 'agy', 'orchestrator']
    const phases = keys.map((key) => thinkingPhase(key))
    for (const value of phases) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(thinkingPhase('claude')).toBe(thinkingPhase('claude'))
    expect(new Set(phases).size).toBe(keys.length)
  })

  it('handles empty and non-string keys safely', () => {
    for (const key of ['', null, undefined, 42]) {
      const value = thinkingPhase(key)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('thinkingRingPose', () => {
  it('places each segment start, midpoint and end across the 8-second loop', () => {
    expect(THINKING_LOOP_SECONDS).toBe(8)
    expect(SPINNER_RING_BRIGHT_MAX).toBe(1.5)

    const at0 = thinkingRingPose(0, 0)
    expect(at0.a).toEqual({ x: 0, y: 0, z: 0 })
    expect(at0.b.x).toBeCloseTo(Math.PI / 2, 10)
    expect(at0.b.y).toBe(0)
    expect(at0.b.z).toBe(0)
    expect(at0.scale).toBe(1)
    expect(at0.bright).toBe(1)

    const atLag = thinkingRingPose(0.08, 0)
    expect(atLag.a.x).toBeGreaterThan(0.2)
    expect(atLag.b.x).toBeCloseTo(Math.PI / 2, 10)

    const flipPeakA = thinkingRingPose(0.252, 0)
    expect(flipPeakA.a.x).toBeGreaterThan(Math.PI / 2)
    expect(flipPeakA.bright).toBeGreaterThan(1)
    expect(flipPeakA.bright).toBeLessThanOrEqual(SPINNER_RING_BRIGHT_MAX)

    const flipPeakB = thinkingRingPose(0.332, 0)
    expect(flipPeakB.b.x - Math.PI / 2).toBeCloseTo(flipPeakA.a.x, 10)

    const atDriftStart = thinkingRingPose(0.5, 0)
    expect(atDriftStart.a.x).toBeCloseTo(Math.PI / 2, 10)
    expect(atDriftStart.a.y).toBeCloseTo(0, 10)
    expect(atDriftStart.b.x).toBeCloseTo(Math.PI, 10)
    expect(atDriftStart.b.y).toBeCloseTo(0, 10)
    expect(atDriftStart.bright).toBe(1)

    const wobbleRad = (6 * Math.PI) / 180
    const atDriftQuarter = thinkingRingPose(1.0, 0)
    expect(atDriftQuarter.a.x).toBeCloseTo(Math.PI / 2 + wobbleRad, 10)
    expect(atDriftQuarter.b.x).toBeCloseTo(Math.PI - wobbleRad, 10)

    const atDriftThreeQuarter = thinkingRingPose(2.0, 0)
    expect(atDriftThreeQuarter.a.x).toBeCloseTo(Math.PI / 2 - wobbleRad, 10)
    expect(atDriftThreeQuarter.b.x).toBeCloseTo(Math.PI + wobbleRad, 10)

    const atRiseStart = thinkingRingPose(2.5, 0)
    expect(atRiseStart.a.x).toBeCloseTo(Math.PI / 2, 10)
    expect(atRiseStart.a.y).toBeCloseTo(Math.PI / 2, 10)
    expect(atRiseStart.b.x).toBeCloseTo(Math.PI, 10)
    expect(atRiseStart.b.y).toBeCloseTo(Math.PI / 2, 10)

    const atGyroStart = thinkingRingPose(3.0, 0)
    expect(atGyroStart.a.x).toBeCloseTo(0, 10)
    expect(atGyroStart.a.y).toBeCloseTo((Math.PI * 3) / 4, 10)
    expect(atGyroStart.b.x).toBeCloseTo(Math.PI / 2, 10)
    expect(atGyroStart.b.y).toBeCloseTo(Math.PI / 4, 10)

    const tiltRad = (20 * Math.PI) / 180
    const atGyroMid = thinkingRingPose(4.0, 0)
    expect(atGyroMid.a.x).toBeCloseTo(tiltRad, 10)
    expect(atGyroMid.b.x).toBeCloseTo(Math.PI / 2 + tiltRad, 10)
    expect(atGyroMid.a.y - atGyroMid.b.y).toBeCloseTo(Math.PI, 10)

    const atBurstStart = thinkingRingPose(5.0, 0)
    expect(atBurstStart.a.x).toBeCloseTo(0, 10)
    expect(atBurstStart.a.z).toBeCloseTo(0, 10)
    expect(atBurstStart.b.x).toBeCloseTo(Math.PI / 2, 10)
    expect(Math.abs(atBurstStart.a.y - atGyroStart.a.y)).toBeCloseTo(Math.PI * 2, 10)
    expect(Math.abs(atBurstStart.b.y - atGyroStart.b.y)).toBeCloseTo(Math.PI * 2, 10)

    const atBurstMid = thinkingRingPose(5.2, 0)
    expect(atBurstMid.bright).toBeCloseTo(SPINNER_RING_BRIGHT_MAX, 10)
    expect(atBurstMid.a.z).toBeGreaterThan((Math.PI * 2) / 6)
    expect(atBurstMid.b.x - Math.PI / 2).toBeGreaterThan((Math.PI * 2) / 6)

    const burstRad = (120 * Math.PI) / 180
    const atSettleStart = thinkingRingPose(5.4, 0)
    expect(atSettleStart.a.z).toBeCloseTo(burstRad, 10)
    expect(atSettleStart.b.x).toBeCloseTo(Math.PI / 2 + burstRad, 10)
    expect(atSettleStart.bright).toBe(1)
    expect(atSettleStart.scale).toBe(1)

    const atSettleMid = thinkingRingPose(6.7, 0)
    expect(atSettleMid.scale).toBeCloseTo(1.06, 10)

    const atWrap = thinkingRingPose(8.0, 0)
    expect(atWrap.a).toEqual(at0.a)
    expect(atWrap.b).toEqual(at0.b)
    expect(atWrap.scale).toBe(1)
    expect(atWrap.bright).toBe(1)
  })

  it('is continuous in 1 ms steps across every segment edge and the loop wrap', () => {
    const prev = thinkingRingPose(0, 0)
    const next = { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, scale: 1, bright: 1 }
    let maxAngleStep = 0
    let maxScaleStep = 0
    let maxBrightStep = 0
    for (let ms = 1; ms <= THINKING_LOOP_SECONDS * 1000; ms += 1) {
      thinkingRingPose(ms / 1000, 0, next)
      for (const ring of ['a', 'b']) {
        for (const axis of ['x', 'y', 'z']) {
          const jump = Math.abs(next[ring][axis] - prev[ring][axis])
          if (jump > maxAngleStep) maxAngleStep = jump
        }
      }
      maxScaleStep = Math.max(maxScaleStep, Math.abs(next.scale - prev.scale))
      maxBrightStep = Math.max(maxBrightStep, Math.abs(next.bright - prev.bright))
      prev.a.x = next.a.x
      prev.a.y = next.a.y
      prev.a.z = next.a.z
      prev.b.x = next.b.x
      prev.b.y = next.b.y
      prev.b.z = next.b.z
      prev.scale = next.scale
      prev.bright = next.bright
    }
    expect(maxAngleStep).toBeLessThan(0.02)
    expect(maxScaleStep).toBeLessThan(0.001)
    expect(maxBrightStep).toBeLessThan(0.01)

    for (const edge of [0, 0.5, 2.5, 3.0, 5.0, 5.4, 8.0]) {
      const before = thinkingRingPose(edge - 0.001, 0)
      const at = thinkingRingPose(edge, 0)
      const after = thinkingRingPose(edge + 0.001, 0)
      for (const ring of ['a', 'b']) {
        for (const axis of ['x', 'y', 'z']) {
          expect(Math.abs(at[ring][axis] - before[ring][axis])).toBeLessThan(0.02)
          expect(Math.abs(after[ring][axis] - at[ring][axis])).toBeLessThan(0.02)
        }
      }
    }
  })

  it('wraps every 8 seconds, shifts by phase, reuses out and handles invalid inputs', () => {
    const base = thinkingRingPose(1.75, 0.3)
    const later = thinkingRingPose(1.75 + THINKING_LOOP_SECONDS * 3, 0.3)
    const earlier = thinkingRingPose(1.75 - THINKING_LOOP_SECONDS * 2, 0.3)
    for (const ring of ['a', 'b']) {
      for (const axis of ['x', 'y', 'z']) {
        expect(later[ring][axis]).toBeCloseTo(base[ring][axis], 10)
        expect(earlier[ring][axis]).toBeCloseTo(base[ring][axis], 10)
      }
    }
    expect(later.scale).toBeCloseTo(base.scale, 10)
    expect(earlier.scale).toBeCloseTo(base.scale, 10)

    const shifted = thinkingRingPose(0, 0.25)
    const direct = thinkingRingPose(2, 0)
    expect(shifted.a.x).toBeCloseTo(direct.a.x, 10)
    expect(shifted.a.y).toBeCloseTo(direct.a.y, 10)
    expect(shifted.b.x).toBeCloseTo(direct.b.x, 10)
    expect(shifted.b.y).toBeCloseTo(direct.b.y, 10)

    const out = {}
    const first = thinkingRingPose(1, 0, out)
    const aRef = first.a
    const bRef = first.b
    const second = thinkingRingPose(4, 0, out)
    expect(first).toBe(out)
    expect(second).toBe(out)
    expect(second.a).toBe(aRef)
    expect(second.b).toBe(bRef)

    const fallback = thinkingRingPose('bad', 'bad')
    expect(fallback.a).toEqual({ x: 0, y: 0, z: 0 })
    expect(fallback.b.x).toBeCloseTo(Math.PI / 2, 10)
    expect(fallback.scale).toBe(1)
    expect(fallback.bright).toBe(1)
  })
})

describe('the thinking spinner on an agent', () => {
  it('builds once as two faint white rings at right angles with a bright quarter arc each', () => {
    const { agents, state, terminals, world } = harness()
    startRun(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const spinner = view.spinner
    expect(spinner.group.children).toHaveLength(2)
    expect(spinner.group.visible).toBe(true)
    expect(spinner.rings).toHaveLength(2)
    expect(spinner.arcs).toHaveLength(2)
    expect(spinner.arcs.every((arc) => !arc.visible)).toBe(true)
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
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    agents.update(state, 0.2, 1200, world, terminals)
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    agents.update(state, 0.049, 1249, world, terminals)
    expect(view.thinking).toBe(0)

    agents.update(state, 0.001, 1250, world, terminals)
    expect(view.thinking).toBeCloseTo(0.001 / THINKING_IN_SECONDS, 10)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => arc.visible)).toBe(true)
    expect(view.spinner.ringMaterial.opacity).toBeCloseTo(SPINNER_RING_OPACITY, 10)
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
    expect(view.spinner.arcs.every((arc) => arc.visible)).toBe(true)
    now += 300
    agents.update(state, 0.3, now, world, terminals)
    expect(view.thinking).toBe(0)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    apply(state, { time: now, type: 'run.end', agent: 'a', ok: true })
    agents.update(state, 0.016, now + 16, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
    agents.dispose()
  })

  it('never shows the spinner arcs for a run of tool calls shorter than the delay', () => {
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
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
    agents.dispose()
  })

  it('keeps the spinner ring visible in every status and shows its arcs only while thinking', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')

    agents.update(state, 0.016, 1000, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.rings.every((ring) => ring.visible)).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(WHITE)
    expect(view.spinner.ringMaterial.opacity).toBeGreaterThan(0)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
    expect(view.spinner.arcMaterial.opacity).toBe(0)

    apply(state, { time: 1100, type: 'run.queued', agent: 'a' })
    agents.update(state, 1, 2100, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(WHITE)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    apply(state, { time: 2200, type: 'run.start', agent: 'a', runId: 'r1' })
    agents.update(state, 0.016, 2200, world, terminals)
    agents.update(state, 0.4, 2600, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(WHITE)
    expect(view.spinner.arcs.every((arc) => arc.visible)).toBe(true)
    expect(view.spinner.arcMaterial.opacity).toBeGreaterThan(0)

    apply(state, {
      time: 2700,
      type: 'tool.start',
      agent: 'a',
      id: 't1',
      label: 'read src/a.js',
      touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
    })
    agents.update(state, 0.7, 3400, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(YELLOW)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
    expect(view.spinner.arcMaterial.opacity).toBe(0)

    apply(state, { time: 3420, type: 'tool.end', agent: 'a', id: 't1', ok: true })
    agents.update(state, 0.016, 3420, world, terminals)
    agents.update(state, 0.4, 3720, world, terminals)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(WHITE)
    expect(view.spinner.arcs.every((arc) => arc.visible)).toBe(true)
    expect(view.spinner.arcMaterial.opacity).toBeGreaterThan(0)

    apply(state, {
      time: 3750,
      type: 'tool.start',
      agent: 'a',
      id: 't2',
      label: 'write src/a.js',
      touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
    })
    agents.update(state, 0.7, 4450, world, terminals)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(YELLOW)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    apply(state, { time: 4500, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 4500, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(GREEN)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    apply(state, { time: 4600, type: 'run.start', agent: 'a', runId: 'r2' })
    apply(state, { time: 4700, type: 'run.end', agent: 'a', runId: 'r2', ok: false, error: 'boom' })
    agents.update(state, 0.016, 4700, world, terminals)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.ringMaterial.color.getHex()).toBe(RED)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

    agents.snap(state, world)
    expect(view.spinner.group.visible).toBe(true)
    expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
    agents.dispose()
  })

  it('holds the thinking arcs still under reduced motion while keeping the status ring visible', () => {
    const savedWindow = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    disposeStill()
    try {
      const { agents, state, terminals, world } = harness()
      startRun(state, 1000)
      agents.update(state, 0.016, 1000, world, terminals)
      const view = agents.views.get('a')
      expect(view.spinner.group.visible).toBe(true)
      expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)

      agents.update(state, 0.016, 1300, world, terminals)
      expect(view.spinner.group.visible).toBe(true)
      expect(view.spinner.arcs.every((arc) => arc.visible)).toBe(true)
      const first = view.spinner.arcs[0].rotation.z
      const second = view.spinner.arcs[1].rotation.z
      expect(first).toBe(0)
      expect(second).toBeCloseTo(SPINNER_PHASE, 10)

      agents.update(state, 0.25, 1550, world, terminals)
      expect(view.spinner.arcs[0].rotation.z).toBe(first)
      expect(view.spinner.arcs[1].rotation.z).toBe(second)

      apply(state, {
        time: 1600,
        type: 'tool.start',
        agent: 'a',
        id: 't1',
        label: 'read src/a.js',
        touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
      })
      agents.update(state, 0.016, 1600, world, terminals)
      expect(view.spinner.group.visible).toBe(true)
      expect(view.spinner.ringMaterial.color.getHex()).toBe(YELLOW)
      expect(view.spinner.arcs.every((arc) => !arc.visible)).toBe(true)
      agents.dispose()
    } finally {
      globalThis.window = savedWindow
      disposeStill()
    }
  })
})
