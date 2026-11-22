import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { addAgents, apply, createState, latestOpenCall } from '../src/model/state.js'

const tree = makeTree({ root: 'demo', files: ['src/a.js'] })
const agents = [{ key: 'opencode', name: 'OpenCode' }]

const queued = (runId, time) => ({ type: 'run.queued', agent: 'opencode', runId, time, order: time })

const start = (runId, time) => ({ type: 'run.start', agent: 'opencode', runId, time, order: time })

const tool = (runId, time, path) => ({
  type: 'tool.start',
  agent: 'opencode',
  runId,
  id: `t-${time}`,
  tool: 'read',
  label: `read ${path}`,
  touches: [{ path, mode: 'read', kind: 'file' }],
  time,
  order: time,
})

const spawn = (runId, child, time) => ({
  type: 'agent.spawn',
  agent: 'opencode',
  child,
  name: child,
  label: '',
  runId,
  time,
  order: time,
})

const runEnd = (runId, ok, time) => ({ type: 'run.end', agent: 'opencode', runId, ok, error: ok ? null : 'failed', time, order: time })

describe('two runs of one agent', () => {
  it('ignores the end of an older run and still ends the children of that run', () => {
    const state = createState(tree, agents)
    apply(state, start('r1', 1))
    apply(state, spawn('r1', 'opencode~1', 2))
    apply(state, start('r2', 3))
    apply(state, spawn('r2', 'opencode~2', 4))
    apply(state, tool('r2', 5, 'src/a.js'))
    apply(state, runEnd('r1', true, 6))

    const agent = state.agents.get('opencode')
    expect(agent).toMatchObject({ status: 'working', runId: 'r2', endedAt: 0 })
    expect(agent.calls.size).toBe(1)
    expect(agent.focus).toEqual(['src/a.js'])
    expect(agent.runWrites.size).toBe(0)
    expect(state.agents.get('opencode~1')).toMatchObject({ status: 'done', endedAt: 6 })
    expect(state.agents.get('opencode~2')).toMatchObject({ status: 'working', endedAt: 0 })
  })

  it('keeps the older run failed without marking the agent', () => {
    const state = createState(tree, agents)
    apply(state, start('r1', 1))
    apply(state, start('r2', 2))
    apply(state, runEnd('r1', false, 3))

    expect(state.agents.get('opencode')).toMatchObject({ status: 'working', runId: 'r2', error: null })
  })

  it('ends the agent and its children when the run ids match', () => {
    const state = createState(tree, agents)
    apply(state, start('r2', 1))
    apply(state, spawn('r2', 'opencode~2', 2))
    apply(state, runEnd('r2', true, 3))

    expect(state.agents.get('opencode')).toMatchObject({ status: 'done', endedAt: 3 })
    expect(state.agents.get('opencode~2')).toMatchObject({ status: 'done', endedAt: 3 })
  })

  it('still ends a run that never started on the agent', () => {
    const state = createState(tree, [{ key: 'opencode', name: 'OpenCode' }])
    apply(state, runEnd('r9', false, 4))

    expect(state.agents.get('opencode')).toMatchObject({ status: 'error', endedAt: 4, error: 'failed' })
  })

  it('keeps the end label and error of a failed tool call on the agent', () => {
    const state = createState(tree, agents)
    apply(state, start('r1', 1))
    apply(state, tool('r1', 2, 'src/a.js'))
    apply(state, {
      type: 'tool.end',
      agent: 'opencode',
      runId: 'r1',
      id: 't-2',
      ok: false,
      label: 'read src/a.js: permission denied',
      error: 'permission denied',
      time: 3,
      order: 3,
    })

    const agent = state.agents.get('opencode')
    expect(agent).toMatchObject({
      status: 'working',
      label: 'read src/a.js: permission denied',
      error: 'permission denied',
    })
    expect(agent.lines[agent.lines.length - 1]).toEqual({
      text: 'failed read src/a.js: permission denied',
      tone: 'error',
    })
  })

  it('clears the last label on run.queued and run.start', () => {
    const state = createState(tree, agents)
    apply(state, start('r1', 1))
    apply(state, tool('r1', 2, 'src/a.js'))
    apply(state, runEnd('r1', true, 3))
    expect(state.agents.get('opencode')).toMatchObject({ status: 'done', label: 'done' })

    apply(state, queued('r2', 4))
    expect(state.agents.get('opencode')).toMatchObject({ status: 'queued', label: '' })

    apply(state, start('r2', 5))
    expect(state.agents.get('opencode')).toMatchObject({ status: 'working', label: '' })

    apply(state, tool('r2', 6, 'src/a.js'))
    apply(state, runEnd('r2', false, 7))
    expect(state.agents.get('opencode')).toMatchObject({ status: 'error', label: 'read src/a.js' })

    apply(state, start('r3', 8))
    expect(state.agents.get('opencode')).toMatchObject({ status: 'working', label: '' })
  })

  it('tracks openCalls across tool.start, tool.end, run.start, run.end and child finish while keeping calls', () => {
    const state = createState(tree, agents)
    const agent = state.agents.get('opencode')
    expect(agent.openCalls).toBeInstanceOf(Map)
    expect([...agent.openCalls.keys()]).toEqual([])

    apply(state, start('r1', 1))
    apply(state, tool('r1', 2, 'src/a.js'))
    expect([...agent.openCalls.keys()]).toEqual(['t-2'])
    expect(agent.openCalls.get('t-2')).toEqual({
      tool: 'read',
      label: 'read src/a.js',
      touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
    })
    expect(agent.calls.size).toBe(1)

    apply(state, { type: 'tool.end', agent: 'opencode', runId: 'r1', id: 't-2', ok: true, time: 3, order: 3 })
    expect([...agent.openCalls.keys()]).toEqual([])
    expect(agent.calls.size).toBe(1)

    apply(state, tool('r1', 4, 'src/a.js'))
    apply(state, spawn('r1', 'opencode~1', 5))
    apply(state, {
      type: 'tool.start',
      agent: 'opencode~1',
      runId: 'r1',
      id: 'child-t1',
      tool: 'read',
      label: 'read src/a.js',
      touches: [{ path: 'src/a.js', mode: 'read', kind: 'file' }],
      time: 6,
      order: 6,
    })
    expect([...agent.openCalls.keys()]).toEqual(['t-4'])
    expect([...state.agents.get('opencode~1').openCalls.keys()]).toEqual(['child-t1'])

    apply(state, runEnd('r1', true, 7))
    expect([...agent.openCalls.keys()]).toEqual([])
    expect([...state.agents.get('opencode~1').openCalls.keys()]).toEqual([])

    apply(state, start('r2', 8))
    apply(state, tool('r2', 9, 'src/a.js'))
    expect([...agent.openCalls.keys()]).toEqual(['t-9'])
    apply(state, start('r3', 10))
    expect([...agent.openCalls.keys()]).toEqual([])
  })

  it('restores agent.label to the newest remaining open call on tool.end and leaves it when none is open', () => {
    const state = createState(tree, agents)
    const agent = state.agents.get('opencode')
    const touchA = { path: 'src/a.js', mode: 'read', kind: 'file' }

    apply(state, start('r1', 1))
    apply(state, { type: 'tool.start', agent: 'opencode', runId: 'r1', id: 't1', tool: 'shell', label: 'npm run dev', touches: [], time: 2, order: 2 })
    apply(state, { type: 'tool.start', agent: 'opencode', runId: 'r1', id: 't2', tool: 'read', label: 'read src/a.js', touches: [touchA], time: 3, order: 3 })
    expect(agent.openCalls.size).toBe(2)
    expect(agent.label).toBe('read src/a.js')
    expect(latestOpenCall(agent)).toEqual({ tool: 'read', label: 'read src/a.js', touches: [touchA] })

    apply(state, { type: 'tool.end', agent: 'opencode', runId: 'r1', id: 't2', ok: true, time: 4, order: 4 })
    expect([...agent.openCalls.keys()]).toEqual(['t1'])
    expect(agent.label).toBe('npm run dev')
    expect(latestOpenCall(agent)).toEqual({ tool: 'shell', label: 'npm run dev', touches: [] })

    apply(state, { type: 'tool.end', agent: 'opencode', runId: 'r1', id: 't1', ok: true, time: 5, order: 5 })
    expect(agent.openCalls.size).toBe(0)
    expect(latestOpenCall(agent)).toBeNull()
    expect(agent.label).toBe('npm run dev')

    apply(state, { type: 'tool.start', agent: 'opencode', runId: 'r1', id: 't3', tool: 'shell', label: 'npm run dev', touches: [], time: 6, order: 6 })
    apply(state, { type: 'tool.start', agent: 'opencode', runId: 'r1', id: 't4', tool: 'read', label: 'read src/a.js', touches: [touchA], time: 7, order: 7 })
    apply(state, { type: 'tool.end', agent: 'opencode', runId: 'r1', id: 't3', ok: false, time: 8, order: 8 })
    expect([...agent.openCalls.keys()]).toEqual(['t4'])
    expect(agent.label).toBe('read src/a.js')
    expect(agent.lines.at(-1)).toEqual({ text: 'failed npm run dev', tone: 'error' })

    apply(state, { type: 'tool.end', agent: 'opencode', runId: 'r1', id: 't4', ok: false, time: 9, order: 9 })
    expect(agent.openCalls.size).toBe(0)
    expect(latestOpenCall(agent)).toBeNull()
    expect(agent.status).toBe('working')
    expect(agent.label).toBe('read src/a.js')
    expect(state.files.get('src/a.js').failed).toBe(true)
    expect(agent.lines.at(-1)).toEqual({ text: 'failed read src/a.js', tone: 'error' })
  })
})

describe('addAgents', () => {
  it('adds a new key once and leaves an existing entry as it is', () => {
    const state = createState(tree, agents)
    apply(state, start('r1', 1))
    const existing = state.agents.get('opencode')

    addAgents(state, null)
    addAgents(state, [
      null,
      {},
      { key: '', name: 'Empty' },
      { id: 'agent-opencode-new', key: 'opencode', name: 'Renamed' },
      { id: 'agent-agy2', key: 'agy2', name: 'AGY 2', harness: 'agy', model: 'gemini-4-neon-high' },
      { id: 'agent-agy2-dup', key: 'agy2', name: 'Duplicate' },
    ])

    expect(state.agents.get('opencode')).toBe(existing)
    expect(state.agents.get('opencode')).toMatchObject({ name: 'OpenCode', status: 'working', runs: 1 })
    const added = state.agents.get('agy2')
    expect(added).toMatchObject({
      key: 'agy2',
      name: 'AGY 2',
      id: 'agent-agy2',
      harness: 'agy',
      model: 'gemini-4-neon-high',
      status: 'idle',
      parent: null,
      depth: 0,
    })
    addAgents(state, [{ id: 'agent-agy2-again', key: 'agy2', name: 'Changed' }])
    expect(state.agents.get('agy2')).toBe(added)
    expect(state.agents.get('agy2').name).toBe('AGY 2')
  })
})
