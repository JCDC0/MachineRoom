import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

const tree = makeTree({ root: 'demo', files: ['src/a.js'] })
const agents = [{ key: 'opencode', name: 'OpenCode' }]

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
})
