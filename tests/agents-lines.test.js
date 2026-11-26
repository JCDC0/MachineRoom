import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATOR_LINK_OPACITY,
  SUB_ORCHESTRATOR_LINK_OPACITY,
  createAgents,
  lineParentKey,
  starOriginKey,
} from '../src/engine/agents.js'
import { HUB_RADIUS, HUB_Y, ORCHESTRATOR_HOME, PARK_LIFT, READER_RADIUS, RING_LEVEL_MAX, SUB_STAND_LIFT, ringDrop } from '../src/engine/hub.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { LANE_START_TOP_MS } from '../src/model/laneStarter.js'
import { apply, createState } from '../src/model/state.js'

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude'] },
    { id: 'backend', name: 'Backend', lanes: ['hermes'] },
  ],
}

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'sub-backend', name: 'Backend', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
  { key: 'hermes', name: 'Hermes' },
]

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  letterSpacing: '',
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

function harness(roster = ROSTER) {
  const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
  const state = createState({ files: [], dirs: [], created: [] }, roster)
  const terminals = {
    ensure() {},
    remove() {},
    setFade() {},
    setOpen() {},
    setVisible() {},
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

function lineEnds(line) {
  const array = line.geometry.attributes.position.array
  return {
    start: { x: array[0], y: array[1], z: array[2] },
    end: { x: array[3], y: array[4], z: array[5] },
  }
}

function expectAt(point, place) {
  expect(point.x).toBeCloseTo(place.x, 2)
  expect(point.y).toBeCloseTo(place.y, 2)
  expect(point.z).toBeCloseTo(place.z, 2)
}

describe('lineParentKey', () => {
  it('sends every lane to the main with no ladder', () => {
    expect(lineParentKey('opencode', null)).toBe('orchestrator')
    expect(lineParentKey('opencode', undefined)).toBe('orchestrator')
    expect(lineParentKey('opencode', { subs: [] })).toBe('orchestrator')
  })

  it('sends a lane in a sub to that sub', () => {
    expect(lineParentKey('opencode', LADDER)).toBe('sub-frontend')
    expect(lineParentKey('claude', LADDER)).toBe('sub-frontend')
    expect(lineParentKey('hermes', LADDER)).toBe('sub-backend')
  })

  it('keeps a lane in no sub on the main', () => {
    expect(lineParentKey('agy', LADDER)).toBe('orchestrator')
  })

  it('answers the main for an unknown key or the main itself', () => {
    expect(lineParentKey('nobody', LADDER)).toBe('orchestrator')
    expect(lineParentKey('', LADDER)).toBe('orchestrator')
    expect(lineParentKey(null, LADDER)).toBe('orchestrator')
    expect(lineParentKey('orchestrator', LADDER)).toBe('orchestrator')
    expect(lineParentKey('sub-frontend', LADDER)).toBe('orchestrator')
  })
})

describe('the lane line with a ladder', () => {
  it('ends a lane line on its sub and keeps the sub line on the main', () => {
    const { agents, state, terminals, world } = harness()
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const sub = agents.views.get('sub-frontend')
    const main = agents.views.get('orchestrator')

    const laneEnds = lineEnds(lane.orchestratorLink)
    expectAt(laneEnds.start, sub.group.position)
    expectAt(laneEnds.end, lane.group.position)
    expect(lane.orchestratorLink.material.color.getHex()).toBe(0xffffff)
    expect(lane.orchestratorLink.material.opacity).toBe(ORCHESTRATOR_LINK_OPACITY)

    const subEnds = lineEnds(sub.orchestratorLink)
    expectAt(subEnds.start, main.group.position)
    expectAt(subEnds.end, sub.group.position)
    expect(sub.orchestratorLink.material.opacity).toBe(SUB_ORCHESTRATOR_LINK_OPACITY)
    agents.dispose()
  })

  it('falls back to the main when the sub has no view yet', () => {
    const roster = ROSTER.filter((agent) => agent.key !== 'sub-frontend')
    const { agents, state, terminals, world } = harness(roster)
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const main = agents.views.get('orchestrator')
    expect(agents.views.has('sub-frontend')).toBe(false)
    expectAt(lineEnds(lane.orchestratorLink).start, main.group.position)
    agents.dispose()
  })

  it('re-aims the lines in place when the ladder changes', () => {
    const { agents, state, terminals, world } = harness()
    agents.setLadder(LADDER)
    agents.update(state, 0.016, 0, world, terminals)
    const lane = agents.views.get('opencode')
    const sub = agents.views.get('sub-frontend')
    const main = agents.views.get('orchestrator')
    expectAt(lineEnds(lane.orchestratorLink).start, sub.group.position)

    const count = agents.views.size
    agents.setLadder(null)
    expect(agents.views.size).toBe(count)
    expect(agents.views.get('opencode')).toBe(lane)
    expectAt(lineEnds(lane.orchestratorLink).start, main.group.position)
    agents.dispose()
  })
})

describe('the chosen top', () => {
  const ROSTER_WITH_SESSION = [...ROSTER, { key: 'claude-session', name: 'Claude Code session', parser: 'claude' }]

  it('puts the chosen session above the hub with no lane run of its own', () => {
    const { agents, terminals, state, world } = harness(ROSTER_WITH_SESSION)
    expect(agents.topKey()).toBe('orchestrator')
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    const session = agents.views.get('claude-session')
    const main = agents.views.get('orchestrator')
    expect(agents.topKey()).toBe('claude-session')
    expectAt(session.group.position, ORCHESTRATOR_HOME)
    expectAt(main.group.position, new THREE.Vector3(ORCHESTRATOR_HOME.x, HUB_Y + PARK_LIFT, ORCHESTRATOR_HOME.z))
    expect(lineEnds(agents.views.get('opencode').orchestratorLink).start).toEqual(
      expect.objectContaining({ x: expect.closeTo(session.group.position.x, 2) })
    )
    agents.dispose()
  })

  it('keeps the old rule when the chosen key has no view', () => {
    const { agents, terminals, state, world } = harness(ROSTER)
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('orchestrator')
    expectAt(agents.views.get('orchestrator').group.position, ORCHESTRATOR_HOME)
    agents.dispose()
  })

  it('keeps the session at the top when a lane run ends and the Orchestrator turns', () => {
    const { agents, terminals, state, world } = harness(ROSTER_WITH_SESSION)
    agents.setChosenTop('claude-session')
    apply(state, { type: 'run.start', agent: 'orchestrator', runId: 'orchestrator:1', time: 2000 })
    agents.update(state, 0.016, 0, world, terminals)
    expect(agents.topKey()).toBe('claude-session')
    agents.dispose()
  })

  it('gives up the position for the Orchestrator when the chosen top is set back to it', () => {
    const { agents, terminals, state, world } = harness(ROSTER_WITH_SESSION)
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    agents.setChosenTop('orchestrator')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('orchestrator')
    expectAt(agents.views.get('orchestrator').group.position, ORCHESTRATOR_HOME)
    agents.dispose()
  })

  it('orbits more than two top agents outside the lane ring', () => {
    const roster = [...ROSTER_WITH_SESSION, { key: 'opencode-session', name: 'OpenCode session', parser: 'opencode' }]
    const { agents, terminals, state, world } = harness(roster)
    apply(state, { time: 0, type: 'run.start', agent: 'opencode-session', runId: 'o1' })
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    const session = agents.views.get('claude-session')
    const main = agents.views.get('orchestrator')
    const other = agents.views.get('opencode-session')
    expect(agents.topKey()).toBe('claude-session')
    expect(Math.hypot(main.group.position.x, main.group.position.z)).toBeCloseTo(READER_RADIUS)
    expect(Math.hypot(other.group.position.x, other.group.position.z)).toBeCloseTo(READER_RADIUS)
    expect(session.group.position.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    agents.dispose()
  })

  it('spreads the orbiting top agents and the parked lanes over their own places', () => {
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'opencode', name: 'OpenCode' },
      { key: 'claude', name: 'Claude' },
      { key: 'hermes', name: 'Hermes' },
      { key: 'claude-session', name: 'Claude Code session', parser: 'claude' },
      { key: 'opencode-session', name: 'OpenCode session', parser: 'opencode' },
    ]
    const { agents, terminals, state, world } = harness(roster)
    apply(state, { time: 0, type: 'run.start', agent: 'claude-session', runId: 'c1' })
    apply(state, { time: 0, type: 'run.start', agent: 'opencode-session', runId: 'o1' })
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    const views = [...agents.views.values()].filter((view) => !view.parentKey)
    views.forEach((view, index) => {
      for (const other of views.slice(index + 1)) {
        const apart = view.home.distanceTo(other.home)
        expect(apart, `${view.key} and ${other.key}`).toBeGreaterThan(1)
      }
    })
    const orbiting = ['claude-session', 'orchestrator', 'opencode-session'].map((key) => agents.views.get(key))
    for (const view of orbiting) {
      expect(Math.hypot(view.home.x, view.home.z), view.key).toBeCloseTo(READER_RADIUS)
      expect(view.home.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    }
    for (const key of ['opencode', 'claude', 'hermes']) {
      expect(Math.hypot(agents.views.get(key).home.x, agents.views.get(key).home.z), key).toBeCloseTo(HUB_RADIUS)
    }
    agents.dispose()
  })

  it('stands a chosen top alone above the hub when no Orchestrator is drawn and the other reader has not run', () => {
    const roster = [{ key: 'claude-session', name: 'Claude session', parser: 'claude' }, { key: 'opencode-session', name: 'OpenCode session', parser: 'opencode' }, { key: 'agy2', name: 'agy2', parser: 'agy' }]
    const { agents, terminals, state, world } = harness(roster)
    apply(state, { time: 0, type: 'run.start', agent: 'claude-session', runId: 's1' })
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('claude-session')
    expect(agents.views.get('claude-session').group.position.toArray()).toEqual(ORCHESTRATOR_HOME.toArray())
    expect(agents.views.get('agy2').group.position.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    agents.dispose()
  })
})

describe('the drawn park rings', () => {
  const ladder = {
    subs: [
      { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
      { id: 'deep', name: 'Deep', parent: 'frontend', lanes: ['claude'] },
      { id: 'deeper', name: 'Deeper', parent: 'deep', lanes: ['hermes'] },
    ],
  }

  it('draws four levels until setDepth caps them lower', () => {
    const roster = [...ROSTER, { key: 'sub-deep', name: 'Deep', subOrchestrator: true }, { key: 'sub-deeper', name: 'Deeper', subOrchestrator: true }]
    const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
    expect(agents.depth()).toBe(RING_LEVEL_MAX)
    agents.setLadder(ladder)
    const deep = agents.views.get('sub-deeper')
    expect(deep.home.y).toBeCloseTo(HUB_Y - 3 * ringDrop(3) + SUB_STAND_LIFT)
    expect(agents.setDepth(1)).toBe(1)
    expect(agents.depth()).toBe(1)
    expect(deep.home.y).toBeCloseTo(HUB_Y - ringDrop(1) + SUB_STAND_LIFT)
    expect(agents.setDepth(4)).toBe(4)
    expect(agents.depth()).toBe(4)
    expect(deep.home.y).toBeCloseTo(HUB_Y - 3 * ringDrop(3) + SUB_STAND_LIFT)
    agents.dispose()
  })
})

describe('starOriginKey', () => {
  it('takes the lane-start star from the session at the top', () => {
    expect(starOriginKey('orchestrator', 'claude-session')).toBe('claude-session')
    expect(starOriginKey('orchestrator', 'orchestrator')).toBe('orchestrator')
    expect(starOriginKey('orchestrator', '')).toBe('orchestrator')
    expect(starOriginKey('sub-frontend', 'claude-session')).toBe('sub-frontend')
    expect(starOriginKey('', 'claude-session')).toBe('')
  })
})

describe('an outside session that leads subagents takes the top', () => {
  const ROSTER_WITH_SESSIONS = [
    ...ROSTER,
    { key: 'antigravity-session', name: 'Antigravity session', parser: 'agy' },
    { key: 'claude-session', name: 'Claude Code session', parser: 'claude' },
  ]

  function spawn(state, session, child, time) {
    apply(state, { type: 'run.start', agent: session, runId: `${session}:1`, time })
    apply(state, { type: 'agent.spawn', agent: session, child, name: child, time })
  }

  it('seats the session whose children work in the orchestrator place', () => {
    const { agents, state, terminals, world } = harness(ROSTER_WITH_SESSIONS)
    spawn(state, 'antigravity-session', 'antigravity-session~1', 1000)
    apply(state, { type: 'agent.spawn', agent: 'antigravity-session', child: 'antigravity-session~2', name: 'second', time: 1200 })
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    const session = agents.views.get('antigravity-session')
    const main = agents.views.get('orchestrator')
    expect(agents.topKey()).toBe('antigravity-session')
    expectAt(session.group.position, ORCHESTRATOR_HOME)
    expectAt(main.group.position, new THREE.Vector3(ORCHESTRATOR_HOME.x, HUB_Y + PARK_LIFT, ORCHESTRATOR_HOME.z))
    agents.dispose()
  })

  it('keeps the seat for a watch-only room with no orchestrator agent', () => {
    const roster = [
      { key: 'antigravity-session', name: 'Antigravity session', parser: 'agy' },
      { key: 'opencode', name: 'OpenCode' },
    ]
    const { agents, state, terminals, world } = harness(roster)
    spawn(state, 'antigravity-session', 'antigravity-session~1', 1000)
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('antigravity-session')
    expectAt(agents.views.get('antigravity-session').group.position, ORCHESTRATOR_HOME)
    agents.dispose()
  })

  it('keeps a chosen top on another drawn session', () => {
    const roster = [...ROSTER_WITH_SESSIONS.filter((agent) => agent.key !== 'orchestrator')]
    const { agents, state, terminals, world } = harness(roster)
    spawn(state, 'antigravity-session', 'antigravity-session~1', 1000)
    apply(state, { type: 'run.start', agent: 'claude-session', runId: 'claude-session:1', time: 1100 })
    agents.setChosenTop('claude-session')
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('claude-session')
    expectAt(agents.views.get('claude-session').group.position, ORCHESTRATOR_HOME)
    expect(agents.views.get('antigravity-session').group.position.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    agents.dispose()
  })

  it('keeps the seat for the room orchestrator while it works', () => {
    const { agents, state, terminals, world } = harness(ROSTER_WITH_SESSIONS)
    spawn(state, 'antigravity-session', 'antigravity-session~1', 1000)
    apply(state, { type: 'run.start', agent: 'orchestrator', runId: 'orchestrator:1', time: 2000 })
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('orchestrator')
    expectAt(agents.views.get('orchestrator').group.position, ORCHESTRATOR_HOME)
    agents.dispose()
  })

  it('gives the seat back once the children ended and the window has passed', () => {
    const { agents, terminals, world } = harness(ROSTER_WITH_SESSIONS)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const player = createLivePlayer({ tree: { files: [], dirs: [], created: [] }, agents: ROSTER_WITH_SESSIONS })
      const session = 'antigravity-session'
      const child = 'antigravity-session~1'
      player.push([
        { type: 'run.start', agent: session, runId: 'run', time: 1000 },
        { type: 'agent.spawn', agent: session, child, name: 'Worker', runId: 'run', time: 1000 },
        { type: 'agent.end', agent: child, ok: true, time: 2000 },
      ])
      agents.update(player.state, 0.016, 0, world, terminals)
      expect(agents.topKey()).toBe(session)

      clock.mockReturnValue(LANE_START_TOP_MS)
      agents.update(player.state, 0.016, LANE_START_TOP_MS, world, terminals)
      expect(agents.topKey()).toBe(session)
      clock.mockReturnValue(LANE_START_TOP_MS + 1)
      agents.update(player.state, 0.016, LANE_START_TOP_MS + 1, world, terminals)
      agents.snap(player.state, world)
      expect(player.state.latest).toBe(2000)
      expect(agents.topKey()).toBe('orchestrator')
      expectAt(agents.views.get('orchestrator').group.position, ORCHESTRATOR_HOME)
    } finally {
      clock.mockRestore()
      agents.dispose()
    }
  })
})

describe('the session that starts a lane sits at the top', () => {
  const ROSTER_WITH_SESSION = [...ROSTER, { key: 'claude-session', name: 'Claude Code session', parser: 'claude' }]

  it('moves the session to the orchestrator place and gives it back on a turn', () => {
    const { agents, state, terminals, world } = harness(ROSTER_WITH_SESSION)
    apply(state, { type: 'run.start', agent: 'claude-session', runId: 's1:1', time: 1000, session: 's1' })
    apply(state, {
      type: 'run.start',
      agent: 'opencode',
      runId: 'run-opencode',
      time: 1000,
      startedBy: { harness: 'claude', session: 's1' },
    })
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    const session = agents.views.get('claude-session')
    const main = agents.views.get('orchestrator')
    const lane = agents.views.get('opencode')
    expect(agents.topKey()).toBe('claude-session')
    expectAt(session.group.position, ORCHESTRATOR_HOME)
    expectAt(main.group.position, new THREE.Vector3(ORCHESTRATOR_HOME.x, HUB_Y + PARK_LIFT, ORCHESTRATOR_HOME.z))
    expectAt(lineEnds(lane.orchestratorLink).start, session.group.position)

    apply(state, { type: 'run.start', agent: 'orchestrator', runId: 'orchestrator:1', time: 2000 })
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    agents.update(state, 0.016, 0, world, terminals)
    agents.snap(state, world)
    expect(agents.topKey()).toBe('orchestrator')
    expectAt(main.group.position, ORCHESTRATOR_HOME)
    expectAt(lineEnds(lane.orchestratorLink).start, main.group.position)
    agents.dispose()
  })
})
