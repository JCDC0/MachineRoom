import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PACKET_DURATION, PACKET_POOL, createAgents, packetSpots, stripPoints } from '../src/engine/agents.js'
import { apply, createState } from '../src/model/state.js'
import {
  AUTOCOMPACT_MAX,
  AUTOCOMPACT_MIN,
  DEFAULT_AUTOCOMPACT_PERCENT,
  STRIP_LOG_LIMIT,
  agentChoices,
  autocompactPercent,
  clampAutocompactPercent,
  contextLine,
  formatCount,
  harnessKey,
  laneLine,
  modelChoices,
  orchestratorId,
  statusTone,
  stripLogLines,
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

  it('maps a status to the dot tone', () => {
    expect(statusTone('working')).toBe('working')
    expect(statusTone('running')).toBe('working')
    expect(statusTone('queued')).toBe('queued')
    expect(statusTone('failed')).toBe('error')
    expect(statusTone('error')).toBe('error')
    expect(statusTone('finished')).toBe('done')
    expect(statusTone('done')).toBe('done')
    expect(statusTone('idle')).toBe('idle')
    expect(statusTone('')).toBe('idle')
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

describe('the lane line', () => {
  it('shows this month of tokens and cost for a lane', () => {
    expect(laneLine({ tokens: '1.2k in / 300 out', cost: '$12.34' })).toBe(
      'Tokens 1.2k in / 300 out, $12.34 this month'
    )
  })

  it('says when a lane reports nothing', () => {
    expect(laneLine({ tokens: 'not reported', cost: 'not reported' })).toBe(
      'Tokens not reported, cost not reported this month'
    )
    expect(laneLine(null)).toBe('')
  })
})

describe('the three log lines', () => {
  it('keeps the newest three and puts them last, each with a chevron', () => {
    const log = [
      { text: 'read a.js', tone: 'normal' },
      { text: 'write b.js', tone: 'normal' },
      { text: 'failed c.js', tone: 'error' },
      { text: 'read d.js', tone: 'normal' },
    ]
    expect(STRIP_LOG_LIMIT).toBe(3)
    expect(stripLogLines(log)).toEqual([
      { text: '> write b.js', tone: 'normal' },
      { text: '> failed c.js', tone: 'error' },
      { text: '> read d.js', tone: 'normal' },
    ])
  })

  it('takes plain strings and drops empty lines', () => {
    expect(stripLogLines(['one', '', 'two', '  ', 'three', 'four'])).toEqual([
      { text: '> two', tone: 'normal' },
      { text: '> three', tone: 'normal' },
      { text: '> four', tone: 'normal' },
    ])
    expect(stripLogLines(null)).toEqual([])
  })

  it('honours another limit', () => {
    expect(stripLogLines(['one', 'two'], 1)).toEqual([{ text: '> two', tone: 'normal' }])
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

describe('the agent choices', () => {
  it('lists the top-level agents, idle ones included', () => {
    const choices = agentChoices([
      { key: 'orchestrator', name: 'Orchestrator', status: 'idle' },
      { key: 'opencode', name: 'OpenCode', status: 'working' },
      { key: 'claude', name: 'Claude', status: 'idle' },
      { key: 'child', name: 'Child', parent: 'opencode', status: 'working' },
    ])
    expect(choices).toEqual([
      { key: 'orchestrator', name: 'Orchestrator', status: 'idle' },
      { key: 'opencode', name: 'OpenCode', status: 'working' },
      { key: 'claude', name: 'Claude', status: 'idle' },
    ])
  })

  it('copes with a missing roster', () => {
    expect(agentChoices(null)).toEqual([])
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
