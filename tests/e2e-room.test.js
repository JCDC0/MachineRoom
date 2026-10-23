import { afterEach, describe, expect, it } from 'vitest'
import { PACKET_POOL, childPlace, packetSpots, stripPoints } from '../src/engine/agents.js'
import { cardSize, openChain, stackOverflow, viewInput } from '../src/engine/cards.js'
import { HUB_CENTER, ORCHESTRATOR_HOME, slotPoint } from '../src/engine/hub.js'
import { isOrchestrator } from '../src/engine/shapes.js'
import { SPHERE_CENTER, STACK_LIMIT, layoutSphere } from '../src/engine/sphere.js'
import { planFolderView } from '../src/model/folderView.js'
import { dirname } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { getJson, postJson, readFrames, roomInputs, startLoop, waitForPaperclip } from './helpers/loop.js'

const loops = []

const TOP_AGENTS = [
  ['claude', 'Claude Code'],
  ['hermes', 'Hermes'],
  ['opencode', 'OpenCode Go'],
  ['agy', 'agy'],
  ['orchestrator', 'Orchestrator'],
]

async function loop(options) {
  const started = await startLoop(options)
  loops.push(started)
  return started
}

afterEach(async () => {
  while (loops.length > 0) await loops.pop().stop()
})

function distance(point) {
  return Math.hypot(point.x - SPHERE_CENTER.x, point.y - SPHERE_CENTER.y, point.z - SPHERE_CENTER.z)
}

function checkPoint(point, label) {
  expect(Number.isFinite(point?.x), `${label} x`).toBe(true)
  expect(Number.isFinite(point?.y), `${label} y`).toBe(true)
  expect(Number.isFinite(point?.z), `${label} z`).toBe(true)
}

function layoutRoom(state, homes) {
  const input = viewInput(state)
  const plan = planFolderView({ ...input, alwaysDepth: 2 })
  const views = [...plan].sort((a, b) => a.path.length - b.path.length)
  const open = openChain(state)
  const overflow = stackOverflow(views, open)
  const drawn = new Map()
  for (const view of views) {
    if (overflow.hidden.has(view.path)) continue
    drawn.set(view.path, { ...view, back: Math.min(3, (view.back ?? 0) + (overflow.extra.get(view.path) ?? 0)) })
  }
  const entries = [...drawn.values()].map((view) => ({ path: view.path, ...cardSize(view) }))
  const placed = layoutSphere(entries, { previous: homes, open })
  const sizes = new Map(entries.map((entry) => [entry.path, entry]))
  for (const [path, spot] of placed) {
    const size = sizes.get(path)
    homes.set(path, { x: spot.x, y: spot.y, z: spot.z, width: size?.width, height: size?.height })
  }
  return { drawn, open, placed }
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
    const { drawn, open, placed } = layoutRoom(state, homes)
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
    expect(root.y, 'the root sits below the hub').toBeLessThan(SPHERE_CENTER.y)

    const drawnPaths = new Set(drawn.keys())
    const childCounts = new Map()
    for (const path of drawnPaths) {
      if (path === '') continue
      const parent = nearestDrawnParent(path, drawnPaths)
      if (parent === null) continue
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1)
    }
    for (const [path, count] of childCounts) {
      if (open.has(path)) continue
      expect(count, `${path || 'root'} stacks ${count} children`).toBeLessThanOrEqual(STACK_LIMIT)
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

function everyRunEnded(agents) {
  return (frames) =>
    agents.every((agent) =>
      frames.some(
        (frame) =>
          frame.type === 'heartbeat.run.status' &&
          frame.payload?.agentId === agent.id &&
          ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(frame.payload?.status)
      )
    )
}

describe('the room, played against the fake Paperclip', () => {
  it('lays out every activity from all five agents and plays the same frames twice', async () => {
    const { url } = await loop()
    await waitForPaperclip(url)
    const { agents, tree } = await roomInputs(url)
    expect(agents.map((agent) => agent.key)).toEqual(['claude', 'hermes', 'opencode', 'agy', 'orchestrator'])
    expect(tree.files).toContain('src/math.js')

    let opened
    const open = new Promise((resolve) => {
      opened = resolve
    })
    const reading = readFrames(url, everyRunEnded(agents), { onOpen: opened })
    await open
    const created = await Promise.all(
      TOP_AGENTS.map(([key, name]) => {
        const agent = agents.find((entry) => entry.key === key)
        return postJson(`${url}/api/control/issues`, {
          title: `Room run for ${name}`,
          assigneeAgentId: agent.id,
          confirmed: true,
        })
      })
    )
    expect(created.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201])
    const frames = await reading
    expect(frames.length).toBeGreaterThan(0)

    const first = runRoom(frames, agents, tree)
    const second = runRoom(frames, agents, tree)
    expect(second.layouts).toEqual(first.layouts)
    expect(second.largest).toBe(first.largest)

    for (const [key] of TOP_AGENTS) {
      const agent = first.state.agents.get(key)
      expect(agent, `${key} ends in the state`).toBeTruthy()
      expect(agent.status, `${key} status`).toBe('done')
      expect(agent.runs, `${key} runs`).toBe(1)
      const mine = first.activities.filter((activity) => activity.agent === key)
      expect(mine[0]?.type, `${key} starts queued`).toBe('run.queued')
      expect(mine.some((activity) => activity.type === 'run.start'), `${key} starts`).toBe(true)
      expect(mine.at(-1), `${key} ends`).toMatchObject({ type: 'run.end', ok: true })
    }

    const orchestrator = first.activities.filter((activity) => activity.agent === 'orchestrator')
    expect(orchestrator.filter((activity) => activity.type === 'run.start')).toHaveLength(1)
    expect(orchestrator.filter((activity) => activity.type === 'run.end')).toHaveLength(1)

    const spawns = first.activities.filter((activity) => activity.type === 'agent.spawn' && activity.agent === 'opencode')
    expect(spawns.map((activity) => activity.child)).toEqual(['opencode~1', 'opencode~2'])
    expect(spawns.map((activity) => activity.name)).toEqual(['Count the exported functions', 'Check the test names'])
    for (const key of ['opencode~1', 'opencode~2']) {
      const child = first.state.agents.get(key)
      expect(child, `${key} is in the state`).toBeTruthy()
      expect(child).toMatchObject({ parent: 'opencode', status: 'done' })
    }
    const ends = first.activities.filter((activity) => activity.type === 'agent.end' && activity.agent.startsWith('opencode~'))
    expect(ends.map((activity) => activity.agent)).toEqual(['opencode~1', 'opencode~2'])

    const answers = (await getJson(`${url}/api/control/issues`)).body
    expect(answers.filter((issue) => issue.status === 'done')).toHaveLength(TOP_AGENTS.length)

    const flood = Array.from({ length: PACKET_POOL * 3 }, (_, index) => first.state.latest - index * 4)
    expect(packetSpots(first.state.latest, flood)).toHaveLength(PACKET_POOL)
  })
})
