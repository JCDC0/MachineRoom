import { describe, expect, it } from 'vitest'
import { PACKET_POOL, childPlace, packetSpots, stripPoints } from '../src/engine/agents.js'
import { cardPlan } from '../src/engine/cards.js'
import { HUB_CENTER, ORCHESTRATOR_HOME, slotPoint } from '../src/engine/hub.js'
import { isOrchestrator } from '../src/engine/shapes.js'
import { RING_CENTER, RING_FRONT, ROOT_DROP } from '../src/engine/ring.js'
import { dirname } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { loadScenario } from './helpers.js'

function distance(point) {
  return Math.hypot(point.x - RING_CENTER.x, point.y - RING_CENTER.y, point.z - RING_CENTER.z)
}

function checkPoint(point, label) {
  expect(Number.isFinite(point?.x), `${label} x`).toBe(true)
  expect(Number.isFinite(point?.y), `${label} y`).toBe(true)
  expect(Number.isFinite(point?.z), `${label} z`).toBe(true)
}

function layoutRoom(state, homes) {
  const layout = cardPlan(state, { alwaysDepth: 2, previous: homes })
  for (const [path, spot] of layout.placed) {
    const size = layout.entries.find((entry) => entry.path === path)
    homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height, slot: spot.slot })
  }
  return { drawn: layout.drawn, placed: layout.placed }
}

function nearestDrawnParent(path, paths) {
  let at = dirname(path)
  while (at !== '') {
    if (paths.has(at)) return at
    at = dirname(at)
  }
  return paths.has('') ? '' : null
}

function runRoom(frames, agents, tree) {
  const pipeline = createPipeline({ agents, tree })
  const state = createState(tree, agents)
  const homes = new Map()
  const activities = []
  const layouts = []
  const sends = new Map()
  let largest = 0
  const parked = new Map()
  const roster = agents.filter((agent) => !isOrchestrator(agent))
  roster.forEach((agent, index) => parked.set(agent.key, slotPoint(index, roster.length)))

  function step(activity) {
    apply(state, activity)
    activities.push(activity)
    const { drawn, placed } = layoutRoom(state, homes)
    largest = Math.max(largest, placed.size)

    const signature = []
    for (const path of [...placed.keys()].sort()) {
      const spot = placed.get(path)
      checkPoint(spot, `card ${path || 'root'}`)
      expect(Number.isFinite(spot.width), `card ${path || 'root'} width`).toBe(true)
      expect(Number.isFinite(spot.height), `card ${path || 'root'} height`).toBe(true)
      signature.push([path, spot.x, spot.y, spot.z, spot.width, spot.height])
    }
    layouts.push(JSON.stringify(signature))

    const root = placed.get('')
    expect(root, 'the root is drawn').toBeTruthy()
    expect(root.y, 'the root sits just below the hub plane').toBe(HUB_CENTER.y - ROOT_DROP)
    expect((root.x - HUB_CENTER.x) * RING_FRONT.x + (root.z - HUB_CENTER.z) * RING_FRONT.z).toBeGreaterThan(0)

    const drawnPaths = new Set(drawn.keys())
    for (const path of drawnPaths) {
      if (path === '' || path.split('/').length > 1) continue
      const spot = placed.get(path)
      expect(distance(spot), `${path} sits outside the root`).toBeGreaterThan(distance(root))
    }

    for (const agent of state.agents.values()) {
      if (agent.status !== 'working') continue
      const list = sends.get(agent.key) ?? []
      list.push(activity.time)
      if (list.length > PACKET_POOL * 4) list.shift()
      sends.set(agent.key, list)
      const spots = packetSpots(activity.time, list)
      expect(spots.length, `${agent.key} packets`).toBeLessThanOrEqual(PACKET_POOL)
      for (const fraction of spots) expect(Number.isFinite(fraction)).toBe(true)

      const focus = agent.focus ?? []
      for (const path of focus) {
        const dir = state.files.has(path) ? dirname(path) : path
        checkPoint(placed.get(dir), `touch ${dir || 'root'}`)
        let at = dir
        while (at !== '') {
          expect(drawnPaths.has(at), `${agent.key} chain folder ${at} is drawn`).toBe(true)
          const parent = dirname(at)
          expect(drawnPaths.has(parent), `${agent.key} chain parent ${parent || 'root'} is drawn`).toBe(true)
          const childSpot = placed.get(at)
          const parentSpot = placed.get(parent)
          expect(childSpot, `${at} is placed`).toBeTruthy()
          expect(parentSpot, `${parent || 'root'} is placed`).toBeTruthy()
          expect(distance(childSpot), `${at} sits outside ${parent || 'root'}`).toBeGreaterThan(distance(parentSpot))
          at = parent
        }
      }

      const touch = focus[0]
      if (touch === undefined) continue
      const dir = state.files.has(touch) ? dirname(touch) : touch
      const parentHome = agent.parent ? parked.get(agent.parent) ?? ORCHESTRATOR_HOME : null
      const slot = Number(String(agent.key).split('~').at(-1))
      const home = agent.parent
        ? childPlace(parentHome, Number.isFinite(slot) ? slot - 1 : 0)
        : parked.get(agent.key) ?? ORCHESTRATOR_HOME
      const [start, end] = stripPoints(home, placed.get(dir) ?? HUB_CENTER)
      checkPoint(start, `${agent.key} strip start`)
      checkPoint(end, `${agent.key} strip end`)
    }
  }

  for (const frame of frames) {
    for (const activity of pipeline.push(frame)) step(activity)
  }
  for (const activity of pipeline.flush()) step(activity)
  return { state, activities, layouts, largest }
}

describe('the room, played from a recorded lane run', () => {
  it('lays out every activity and plays the same frames twice', () => {
    const { frames, agents, tree } = loadScenario('scenario-e')
    expect(agents.map((agent) => agent.key)).toEqual(['claude', 'hermes', 'opencode', 'orchestrator'])
    expect(tree.files.length).toBeGreaterThan(0)

    const first = runRoom(frames, agents, tree)
    const second = runRoom(frames, agents, tree)
    expect(second.layouts).toEqual(first.layouts)
    expect(second.largest).toBe(first.largest)
    expect(first.activities.length).toBeGreaterThan(0)

    for (const key of ['claude', 'hermes', 'opencode', 'orchestrator']) {
      const agent = first.state.agents.get(key)
      expect(agent, `${key} ends in the state`).toBeTruthy()
      expect(agent.runs, `${key} runs`).toBe(1)
      const mine = first.activities.filter((activity) => activity.agent === key)
      expect(mine[0]?.type, `${key} starts queued`).toBe('run.queued')
      expect(mine.some((activity) => activity.type === 'run.start'), `${key} starts`).toBe(true)
      expect(mine.at(-1), `${key} ends`).toMatchObject({ type: 'run.end' })
    }

    expect(first.state.agents.get('claude').status).toBe('error')
    expect(first.state.agents.get('opencode').status).toBe('done')

    const spawns = first.activities.filter((activity) => activity.type === 'agent.spawn' && activity.agent === 'opencode')
    expect(spawns.map((activity) => activity.child)).toEqual(['opencode~1', 'opencode~2'])
    expect(spawns.map((activity) => activity.name)).toEqual(['Count the exported functions', 'Check the test names'])
    for (const key of ['opencode~1', 'opencode~2']) {
      const child = first.state.agents.get(key)
      expect(child, `${key} is in the state`).toBeTruthy()
      expect(child).toMatchObject({ parent: 'opencode', status: 'done' })
    }

    const flood = Array.from({ length: PACKET_POOL * 3 }, (_, index) => first.state.latest - index * 4)
    expect(packetSpots(first.state.latest, flood)).toHaveLength(PACKET_POOL)
  })
})
