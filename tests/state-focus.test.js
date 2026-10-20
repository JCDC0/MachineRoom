import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { RECENT_LIMIT, apply, createState } from '../src/model/state.js'

const tree = makeTree({ root: 'demo', files: ['src/a.js', 'src/b.js', 'docs/notes.md'] })
const agents = [{ key: 'hermes', name: 'Hermes' }, { key: 'agy', name: 'agy' }]
const call = (agent, id, touches, time = 1) => ({ type: 'tool.start', agent, runId: 'r1', time, order: time, id, tool: 'read', label: 'read', touches })
const touch = (path, kind = 'file', mode = 'read') => ({ path, kind, mode })

describe('agent focus and recent paths', () => {
  it('keeps the paths of the latest call as the agent focus', () => {
    const state = createState(tree, agents)
    apply(state, { type: 'run.start', agent: 'hermes', runId: 'r1', time: 0, order: 0 })
    apply(state, call('hermes', 'c1', [touch('src/a.js')]))
    apply(state, call('hermes', 'c2', [touch('docs/notes.md'), touch('src', 'dir', 'list')], 2))
    expect(state.agents.get('hermes').focus).toEqual(['docs/notes.md', 'src'])
    expect(state.agents.get('agy').focus).toEqual([])
  })

  it('keeps the focus through a call with no touches and clears it when the run ends', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')]))
    apply(state, call('hermes', 'c2', [], 2))
    expect(state.agents.get('hermes').focus).toEqual(['src/a.js'])
    apply(state, { type: 'run.end', agent: 'hermes', runId: 'r1', time: 3, order: 3, ok: true })
    expect(state.agents.get('hermes').focus).toEqual([])
  })

  it('remembers the last touched paths across agents, newest last, without repeats', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')]))
    apply(state, call('agy', 'c2', [touch('docs/notes.md')], 2))
    apply(state, call('hermes', 'c3', [touch('src/a.js')], 3))
    expect(state.recent).toEqual(['docs/notes.md', 'src/a.js'])
    for (let i = 0; i < RECENT_LIMIT + 3; i++) apply(state, call('agy', `x${i}`, [touch(`gen/f${i}.js`)], 10 + i))
    expect(state.recent).toHaveLength(RECENT_LIMIT)
    expect(state.recent.at(-1)).toBe(`gen/f${RECENT_LIMIT + 2}.js`)
  })
})
