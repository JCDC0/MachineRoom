import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { createPlayer } from '../src/model/player.js'
import { MAX_DEPTH, MAX_DEPTH_ALLOWED, apply, createState, depthLimitOf, setDepthLimit } from '../src/model/state.js'

const tree = makeTree({ root: 'demo', files: ['src/a.js'] })
const agents = [{ key: 'opencode', name: 'OpenCode' }]

const spawn = (child, parent = 'opencode', time = 1, name = child) => ({
  type: 'agent.spawn',
  agent: parent,
  child,
  name,
  label: `subagent: ${name}`,
  runId: 'r1',
  time,
  order: time,
})

const end = (child, ok = true, time = 2) => ({ type: 'agent.end', agent: child, ok, runId: 'r1', time, order: time })

const runEnd = (ok, time, error = ok ? null : 'failed') => ({ type: 'run.end', agent: 'opencode', runId: 'r1', ok, error, time, order: time })

describe('agents a harness spawns', () => {
  it('adds a child to the roster with the fields of every agent and its parent and depth', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 10, 'Count exported functions'))
    const child = state.agents.get('opencode~1')
    expect(child).toMatchObject({
      key: 'opencode~1',
      name: 'Count exported functions',
      status: 'working',
      runId: 'r1',
      parent: 'opencode',
      depth: 1,
    })
    expect(Object.keys(child).sort()).toEqual(Object.keys(state.agents.get('opencode')).sort())
  })

  it('keeps two children of one run under their own keys', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 1, 'first'))
    apply(state, spawn('opencode~2', 'opencode', 2, 'second'))
    expect([...state.agents.keys()]).toEqual(['opencode', 'opencode~1', 'opencode~2'])
    expect(state.agents.get('opencode~1').depth).toBe(1)
    expect(state.agents.get('opencode~2').depth).toBe(1)
  })

  it('starts the same key again in the next run', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 1, 'first'))
    apply(state, end('opencode~1', true, 2))
    apply(state, { type: 'run.start', agent: 'opencode', runId: 'r2', time: 3, order: 3 })
    apply(state, { ...spawn('opencode~1', 'opencode', 4, 'second'), runId: 'r2' })
    expect(state.agents.get('opencode~1')).toMatchObject({ name: 'second', status: 'working', runId: 'r2', depth: 1 })
  })

  it('adds nothing below depth 3', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode'))
    apply(state, spawn('opencode~1~1', 'opencode~1'))
    apply(state, spawn('opencode~1~1~1', 'opencode~1~1'))
    expect(state.agents.get('opencode~1~1~1').depth).toBe(3)
    apply(state, spawn('opencode~1~1~1~1', 'opencode~1~1~1'))
    expect(state.agents.has('opencode~1~1~1~1')).toBe(false)
    expect(state.agents.size).toBe(4)
  })

  it('ends a child when the parent run ends well or fails', () => {
    const done = createState(tree, agents)
    apply(done, spawn('opencode~1', 'opencode', 1))
    apply(done, runEnd(true, 5))
    expect(done.agents.get('opencode~1')).toMatchObject({ status: 'done', endedAt: 5 })

    const failed = createState(tree, agents)
    apply(failed, spawn('opencode~1', 'opencode', 1))
    apply(failed, spawn('opencode~1~1', 'opencode~1', 2))
    apply(failed, runEnd(false, 6, 'test failed'))
    expect(failed.agents.get('opencode~1')).toMatchObject({ status: 'error', endedAt: 6, error: 'test failed' })
    expect(failed.agents.get('opencode~1~1')).toMatchObject({ status: 'error', endedAt: 6, error: 'test failed' })
  })

  it('leaves a child that already ended with its own result', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 1))
    apply(state, end('opencode~1', false, 2))
    apply(state, runEnd(true, 5))
    expect(state.agents.get('opencode~1')).toMatchObject({ status: 'error', endedAt: 2 })
  })

  it('rebuilds the children when the player seeks', () => {
    const activities = [
      { type: 'run.start', agent: 'opencode', runId: 'r1', time: 0, order: 0 },
      spawn('opencode~1', 'opencode', 1000),
      end('opencode~1', true, 2000),
      runEnd(true, 3000),
    ]
    const player = createPlayer({ activities, tree, agents })
    player.seek(1500)
    expect(player.state.agents.get('opencode~1')).toMatchObject({ status: 'working', depth: 1 })
    player.seek(0)
    expect(player.state.agents.has('opencode~1')).toBe(false)
    player.seek(player.duration)
    expect(player.state.agents.get('opencode~1').status).toBe('done')
  })

  it('gives each snapshot agent its parent and depth', () => {
    const activities = [spawn('opencode~1', 'opencode', 1000, 'first'), spawn('opencode~1~1', 'opencode~1', 1500, 'second'), runEnd(true, 3000)]
    const player = createPlayer({ activities, tree, agents })
    player.seek(player.duration)
    const byKey = new Map(player.snapshot().agents.map((agent) => [agent.key, agent]))
    expect(byKey.get('opencode')).toMatchObject({ parent: null, depth: 0 })
    expect(byKey.get('opencode~1')).toMatchObject({ parent: 'opencode', depth: 1 })
    expect(byKey.get('opencode~1~1')).toMatchObject({ parent: 'opencode~1', depth: 2 })
  })
})

describe('the saved agent depth', () => {
  it('stays at 3 without a setting and reads at most 4', () => {
    expect(MAX_DEPTH).toBe(3)
    expect(MAX_DEPTH_ALLOWED).toBe(4)
    expect(depthLimitOf(undefined)).toBe(3)
    expect(depthLimitOf(null)).toBe(3)
    expect(depthLimitOf('two')).toBe(3)
    expect(depthLimitOf(1)).toBe(1)
    expect(depthLimitOf(4)).toBe(4)
    expect(depthLimitOf(9)).toBe(4)
    expect(depthLimitOf(-2)).toBe(0)
    expect(depthLimitOf({ depth: 2 })).toBe(2)
    expect(depthLimitOf({ limit: 4 })).toBe(4)
  })

  it('draws children only to the limit on the state', () => {
    const state = createState(tree, agents)
    expect(setDepthLimit(state, 1)).toBe(1)
    apply(state, spawn('opencode~1', 'opencode'))
    apply(state, spawn('opencode~1~1', 'opencode~1'))
    expect(state.agents.has('opencode~1')).toBe(true)
    expect(state.agents.has('opencode~1~1')).toBe(false)
  })

  it('allows a fourth depth when the saved limit is 4', () => {
    const state = createState(tree, agents)
    setDepthLimit(state, 4)
    apply(state, spawn('opencode~1', 'opencode'))
    apply(state, spawn('opencode~1~1', 'opencode~1'))
    apply(state, spawn('opencode~1~1~1', 'opencode~1~1'))
    apply(state, spawn('opencode~1~1~1~1', 'opencode~1~1~1'))
    apply(state, spawn('opencode~1~1~1~1~1', 'opencode~1~1~1~1'))
    expect(state.agents.get('opencode~1~1~1~1').depth).toBe(4)
    expect(state.agents.has('opencode~1~1~1~1~1')).toBe(false)
  })
})

describe('a finished child leaves the state on replay time', () => {
  it('keeps it for 7,499 ms after its end and drops it at 7,500', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 1000))
    apply(state, end('opencode~1', true, 2000))
    apply(state, { type: 'run.start', agent: 'opencode', runId: 'r2', time: 9499, order: 9499 })
    expect(state.agents.has('opencode~1')).toBe(true)
    apply(state, { type: 'run.start', agent: 'opencode', runId: 'r3', time: 9500, order: 9500 })
    expect(state.agents.has('opencode~1')).toBe(false)
  })

  it('keeps a finished parent until its children have left', () => {
    const state = createState(tree, agents)
    apply(state, spawn('opencode~1', 'opencode', 1000))
    apply(state, spawn('opencode~1~1', 'opencode~1', 1500))
    apply(state, runEnd(true, 2000))
    apply(state, { type: 'run.start', agent: 'opencode', runId: 'r2', time: 10000, order: 10000 })
    expect(state.agents.has('opencode~1~1')).toBe(false)
    expect(state.agents.has('opencode~1')).toBe(true)
    apply(state, { type: 'run.start', agent: 'opencode', runId: 'r3', time: 10001, order: 10001 })
    expect(state.agents.has('opencode~1')).toBe(false)
  })

  it('draws the same agents after a seek and after a play', () => {
    const activities = [
      { type: 'run.start', agent: 'opencode', runId: 'r1', time: 0, order: 0 },
      spawn('opencode~1', 'opencode', 1000),
      end('opencode~1', true, 2000),
      { type: 'run.start', agent: 'opencode', runId: 'r2', time: 10000, order: 10000 },
    ]
    const sought = createPlayer({ activities, tree, agents })
    sought.seek(sought.duration)
    const afterSeek = [...sought.state.agents.keys()].sort()

    const played = createPlayer({ activities, tree, agents })
    played.play()
    played.tick(1000000)
    const afterPlay = [...played.state.agents.keys()].sort()

    expect(afterPlay).toEqual(afterSeek)
    expect(afterSeek).toEqual(['opencode'])
  })
})
