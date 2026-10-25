import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORCHESTRATOR_LINK_OPACITY, PACKET_DURATION, PACKET_POOL, SUB_ORCHESTRATOR_LINK_OPACITY, createAgents, orchestratorLineEnds, packetSpots, stripPoints } from '../src/engine/agents.js'
import { apply, createState } from '../src/model/state.js'
import {
  AUTOCOMPACT_MAX,
  AUTOCOMPACT_MIN,
  DEFAULT_AUTOCOMPACT_PERCENT,
  autocompactPercent,
  clampAutocompactPercent,
  contextLine,
  effortLabel,
  effortLevels,
  formatCount,
  harnessKey,
  modelChoices,
  orchestratorEffort,
  orchestratorId,
  wideLayout,
} from '../src/ui/agentStrip.js'

const from = { x: 0, y: 290, z: 300 }
const to = { x: 620, y: 460, z: -80 }

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
  const roster = [{ key: 'a', name: 'Alpha', shape: 'claude' }]
  const agents = createAgents(scene, roster, new THREE.Scene())
  const state = createState({ files: ['src/a.js'], dirs: ['src'], created: [] }, roster)
  const terminals = {
    ensure() {},
    setVisible() {},
    setFade() {},
    setOpen() {},
    remove() {},
    edgePoint: (key, side, out) => out.set(100, 290, 0),
  }
  const edge = { x: 500, y: 400, z: 0 }
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(edge.x, edge.y, edge.z),
  }
  return { agents, state, terminals, world, edge }
}

function startWrite(state, time, runId = 'r1') {
  apply(state, { time: time - 10, type: 'run.start', agent: 'a', runId })
  apply(state, {
    time,
    type: 'tool.start',
    agent: 'a',
    id: 't1',
    label: 'write a.js',
    touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
  })
}

describe('stripPoints', () => {
  it('gives one straight segment from the agent to the target', () => {
    const points = stripPoints(from, to)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual(from)
    expect(points[1]).toEqual(to)
  })

  it('returns copies, not its inputs', () => {
    const points = stripPoints(from, to)
    expect(points[0]).not.toBe(from)
    expect(points[1]).not.toBe(to)
  })

  it('gives the same points every time and leaves its inputs alone', () => {
    const first = stripPoints(from, to)
    const second = stripPoints(from, to)
    expect(second).toEqual(first)
    expect(from).toEqual({ x: 0, y: 290, z: 300 })
    expect(to).toEqual({ x: 620, y: 460, z: -80 })
  })

  it('writes into a pair of points it is given', () => {
    const out = [{}, {}]
    const points = stripPoints(from, to, out)
    expect(points[0]).toBe(out[0])
    expect(points[1]).toBe(out[1])
    expect(points).toEqual([from, to])
  })
})

describe('orchestratorLineEnds', () => {
  it('gives one straight segment from the agent to the main orchestrator', () => {
    const orchestrator = { x: 0, y: 560, z: 0 }
    const points = orchestratorLineEnds(orchestrator, from)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual(orchestrator)
    expect(points[1]).toEqual(from)
  })

  it('returns copies, not its inputs, and writes into a pair it is given', () => {
    const orchestrator = { x: 0, y: 560, z: 0 }
    const out = [{}, {}]
    const points = orchestratorLineEnds(orchestrator, from, out)
    expect(points[0]).toBe(out[0])
    expect(points[1]).toBe(out[1])
    expect(points).toEqual([orchestrator, from])
    expect(points[0]).not.toBe(orchestrator)
    expect(points[1]).not.toBe(from)
  })

  it('keeps the two opacities apart, the lane fainter than a folder string', () => {
    expect(ORCHESTRATOR_LINK_OPACITY).toBeLessThan(0.22)
    expect(SUB_ORCHESTRATOR_LINK_OPACITY).toBe(0.3)
  })
})

describe('packetSpots', () => {
  it('moves a packet from the agent to the file in 0.45 seconds', () => {
    const sends = [1000]
    expect(packetSpots(1000, sends, PACKET_DURATION)).toEqual([0])
    expect(packetSpots(1200, sends, PACKET_DURATION)[0]).toBeCloseTo(0.2 / 0.45, 10)
    expect(packetSpots(1450, sends, PACKET_DURATION)).toEqual([1])
    expect(packetSpots(1451, sends, PACKET_DURATION)).toEqual([])
  })

  it('keeps a burst of five packets in flight together', () => {
    const sends = [2000, 2000, 2000, 2000, 2000]
    const spots = packetSpots(2090, sends, PACKET_DURATION)
    expect(spots).toHaveLength(5)
    spots.forEach((spot) => expect(spot).toBeCloseTo(0.09 / 0.45, 10))
  })

  it('caps the pool at 24 and keeps the newest packets', () => {
    const sends = Array.from({ length: 30 }, (_, index) => index * 10)
    const spots = packetSpots(290, sends, PACKET_DURATION)
    expect(spots).toHaveLength(PACKET_POOL)
    expect(spots[0]).toBeCloseTo(0.23 / 0.45, 10)
    expect(spots[PACKET_POOL - 1]).toBe(0)
  })

  it('moves nothing under reduced motion', () => {
    expect(packetSpots(1200, [1000], PACKET_DURATION, true)).toEqual([])
    expect(packetSpots(1000, [1000], PACKET_DURATION, true)).toEqual([])
  })
})

describe('the line to the main orchestrator', () => {
  it('gives each lane a faint line that stays the same while the agent works', () => {
    const { agents, state, terminals, world } = harness()
    const view = agents.views.get('a')
    expect(view.orchestratorLink).toBeTruthy()
    expect(view.orchestratorLink.material.opacity).toBe(ORCHESTRATOR_LINK_OPACITY)
    startWrite(state, 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    expect(view.orchestratorLink.material.opacity).toBe(ORCHESTRATOR_LINK_OPACITY)
    expect(view.orchestratorLink.material.color.getHex()).toBe(0xffffff)
    expect(view.orchestratorLink.visible).toBe(true)
    agents.dispose()
  })

  it('keeps a sub orchestrator line thin and white', () => {
    const scene = new THREE.Scene()
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator', role: 'ceo', shape: 'armillary' },
      { key: 'sub-ui', name: 'UI', shape: 'armillary', subOrchestrator: true },
    ]
    const agents = createAgents(scene, roster)
    const view = agents.views.get('sub-ui')
    expect(view.orchestratorLink).toBeTruthy()
    expect(view.orchestratorLink.material.opacity).toBe(SUB_ORCHESTRATOR_LINK_OPACITY)
    expect(view.orchestratorLink.material.color.getHex()).toBe(0xffffff)
    agents.dispose()
  })
})

describe('packets on the tunnel', () => {
  it('starts at the agent centre and keeps every speck on the yellow line', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state, 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const packets = view.packets.geometry.attributes.position.array
    expect(view.packets.geometry.drawRange.count).toBe(1)
    expect(packets[0]).toBeCloseTo(view.group.position.x, 6)
    expect(packets[1]).toBeCloseTo(view.group.position.y, 6)
    expect(packets[2]).toBeCloseTo(view.group.position.z, 6)

    agents.update(state, 0.016, 1225, world, terminals)
    const strip = view.strip.geometry.attributes.position.array
    const start = { x: strip[0], y: strip[1], z: strip[2] }
    const end = { x: strip[3], y: strip[4], z: strip[5] }
    const span = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
    const count = view.packets.geometry.drawRange.count
    expect(count).toBeGreaterThan(1)
    for (let i = 0; i < count; i += 1) {
      const offset = { x: packets[i * 3] - start.x, y: packets[i * 3 + 1] - start.y, z: packets[i * 3 + 2] - start.z }
      const cross = {
        x: offset.y * span.z - offset.z * span.y,
        y: offset.z * span.x - offset.x * span.z,
        z: offset.x * span.y - offset.y * span.x,
      }
      expect(Math.hypot(cross.x, cross.y, cross.z)).toBeLessThan(1e-6)
    }
    agents.dispose()
  })
})

describe('packets after a run ends', () => {
  it('keeps the burst at a touch and queues no packet once the status is done', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state, 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const beforeBurst = view.packetSends.length

    agents.aimAt('a', 'src', 'src/a.js', 1100)
    expect(view.packetSends).toHaveLength(beforeBurst + 5)
    agents.update(state, 0.016, 1100, world, terminals)
    expect(view.packetSends.slice(beforeBurst, beforeBurst + 5)).toEqual([1100, 1130, 1160, 1190, 1220])
    const queuedDuringWork = view.packetSends.length

    apply(state, { time: 1200, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 1210, world, terminals)
    expect(state.agents.get('a').status).toBe('done')
    expect(view.packetSends).toHaveLength(queuedDuringWork)

    agents.update(state, 0.016, 1700, world, terminals)
    expect(view.packetSends).toHaveLength(queuedDuringWork)
    expect(view.packets.geometry.drawRange.count).toBe(0)
    agents.dispose()
  })
})

describe('agent strip layout', () => {
  it('turns the wide layout on at 900 pixels', () => {
    expect(wideLayout(899)).toBe(false)
    expect(wideLayout(900)).toBe(true)
    expect(wideLayout(1600)).toBe(true)
    expect(wideLayout(0)).toBe(false)
    expect(wideLayout('1200')).toBe(true)
    expect(wideLayout('wide')).toBe(false)
  })
})

describe('the context line', () => {
  it('gives the used tokens and the window', () => {
    expect(contextLine({ context: { tokens: 128400, window: 200000 } })).toBe(
      'Context size 128.4k / 200.0k'
    )
    expect(contextLine({ context: { tokens: 900, window: 2000 } })).toBe('Context size 900 / 2.0k')
  })

  it('says so when the bridge has no context numbers', () => {
    expect(contextLine({ context: null })).toBe('')
    expect(contextLine({})).toBe('')
    expect(contextLine(null)).toBe('')
    expect(contextLine({ context: { tokens: null, window: 200000 } })).toBe(
      'Context size not reported'
    )
    expect(contextLine({ context: { tokens: 20, window: 0 } })).toBe('Context size not reported')
  })

  it('formats small and large counts the way the dock does', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('1.0k')
    expect(formatCount(200000)).toBe('200.0k')
    expect(formatCount(null)).toBe('?')
  })
})

describe('the effort levels', () => {
  it('lists the levels each harness accepts', () => {
    expect(effortLevels('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(effortLevels('opencode_local')).toEqual(['low', 'medium', 'high', 'max'])
    expect(effortLevels('hermes')).toEqual([])
    expect(effortLevels('')).toEqual([])
  })

  it('labels an unset effort as default', () => {
    expect(effortLabel('', 'claude')).toBe('default')
    expect(effortLabel('xhigh', 'claude')).toBe('xhigh')
    expect(effortLabel('xhigh', 'opencode')).toBe('default')
  })

  it('reads the effort from the orchestrator answer', () => {
    const rows = [
      { id: 'orchestrator', effort: 'high' },
      { id: 'sub-ui', effort: 'max' },
    ]
    expect(orchestratorEffort(rows, 'orchestrator')).toBe('high')
    expect(orchestratorEffort({ orchestrators: rows }, 'ui')).toBe('max')
    expect(orchestratorEffort(rows, 'missing')).toBe('')
  })
})

describe('the model choices', () => {
  const models = [
    { id: 'opencode/free', label: 'Free', harness: 'opencode' },
    { id: 'opencode-go/flash', label: 'Flash', harness: 'opencode' },
    { id: 'claude-opus', label: 'Opus', harness: 'claude' },
    { id: 'opencode/free', label: 'Free again', harness: 'opencode' },
    { id: 'no-harness', label: 'Loose', harness: null },
  ]

  it('keeps only the models for the harness', () => {
    expect(modelChoices(models, 'opencode')).toEqual([
      { id: 'opencode/free', label: 'Free' },
      { id: 'opencode-go/flash', label: 'Flash' },
    ])
    expect(modelChoices(models, 'claude')).toEqual([{ id: 'claude-opus', label: 'Opus' }])
  })

  it('reads an adapter name as its harness', () => {
    expect(harnessKey('opencode_local')).toBe('opencode')
    expect(harnessKey('claude_local')).toBe('claude')
    expect(harnessKey('not reported')).toBe('')
    expect(modelChoices(models, 'claude_local')).toEqual([{ id: 'claude-opus', label: 'Opus' }])
  })

  it('lists every model when the harness is unknown', () => {
    expect(modelChoices(models, '')).toHaveLength(4)
    expect(modelChoices(models, 'not reported')).toHaveLength(4)
  })

  it('reads a list wrapped in an object and fills a missing label', () => {
    expect(modelChoices({ models: [{ id: 'a' }, { id: 'b', label: 'B' }] }, '')).toEqual([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'B' },
    ])
    expect(modelChoices(null, 'opencode')).toEqual([])
  })
})

describe('the autocompact percent', () => {
  it('keeps the percent between 50 and 95', () => {
    expect(AUTOCOMPACT_MIN).toBe(50)
    expect(AUTOCOMPACT_MAX).toBe(95)
    expect(clampAutocompactPercent(49)).toBe(50)
    expect(clampAutocompactPercent(80)).toBe(80)
    expect(clampAutocompactPercent(96)).toBe(95)
    expect(clampAutocompactPercent(80.6)).toBe(81)
    expect(clampAutocompactPercent('72')).toBe(72)
    expect(clampAutocompactPercent('x')).toBe(DEFAULT_AUTOCOMPACT_PERCENT)
  })

  it('reads the saved percent from the orchestrator answer', () => {
    expect(autocompactPercent({ autocompactPercent: 65 })).toBe(65)
    expect(autocompactPercent({ autocompactPercent: 10 })).toBe(50)
    expect(autocompactPercent({ autocompactPercent: 99 })).toBe(95)
    expect(autocompactPercent({})).toBe(DEFAULT_AUTOCOMPACT_PERCENT)
    expect(autocompactPercent(null)).toBe(DEFAULT_AUTOCOMPACT_PERCENT)
  })
})

describe('the orchestrator id', () => {
  it('drops the sub prefix and keeps the main id', () => {
    expect(orchestratorId('orchestrator')).toBe('orchestrator')
    expect(orchestratorId('sub-ui')).toBe('ui')
    expect(orchestratorId('')).toBe('')
  })
})

describe('a strip with still ends', () => {
  it('leaves the tunnel geometry alone while its ends stay put, and moves it when the file moves', () => {
    const { agents, state, terminals, world, edge } = harness()
    startWrite(state, 1000)
    agents.aimAt('a', 'src', 'src/a.js', 1000)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('a')
    const positionVersion = view.strip.geometry.attributes.position.version
    expect(view.strip.visible).toBe(true)

    agents.update(state, 0.016, 1016, world, terminals)
    expect(view.strip.geometry.attributes.position.version).toBe(positionVersion)

    edge.x += 60
    agents.update(state, 0.016, 1032, world, terminals)
    expect(view.strip.geometry.attributes.position.version).toBeGreaterThan(positionVersion)
    const array = view.strip.geometry.attributes.position.array
    expect(array[0]).toBeCloseTo(view.group.position.x, 3)
    expect(array[1]).toBeCloseTo(view.group.position.y, 3)
    expect(array[2]).toBeCloseTo(view.group.position.z, 3)
    agents.dispose()
  })
})
