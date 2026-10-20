import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import { CALL_LIMIT, RECENT_KEEP_MS, RECENT_LIMIT, apply, createState, freshRecent } from '../src/model/state.js'

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

describe('fresh recent paths', () => {
  const later = (state, time) => apply(state, { type: 'run.end', agent: 'hermes', runId: 'r1', time, order: time, ok: true })

  it('starts a new state with latest 0 and an empty map', () => {
    const state = createState(tree, agents)
    expect(state.latest).toBe(0)
    expect(state.recentAt.size).toBe(0)
    expect(freshRecent(state)).toEqual([])
  })

  it('drops an old touch once a later activity moves latest past the window', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')], 1000))
    later(state, 1000 + RECENT_KEEP_MS + 1)
    expect(state.latest).toBe(1000 + RECENT_KEEP_MS + 1)
    expect(state.recent).toEqual(['src/a.js'])
    expect(freshRecent(state)).toEqual([])
  })

  it('keeps a touch exactly at the edge of the window', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')], 1000))
    later(state, 1000 + RECENT_KEEP_MS)
    expect(freshRecent(state)).toEqual(['src/a.js'])
  })

  it('refreshes the time of a repeated touch', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')], 1000))
    apply(state, call('agy', 'c2', [touch('src/a.js')], 5000))
    later(state, 5000 + RECENT_KEEP_MS)
    expect(state.recentAt.get('src/a.js')).toBe(5000)
    expect(freshRecent(state)).toEqual(['src/a.js'])
  })

  it('holds exactly the paths of recent in the map', () => {
    const state = createState(tree, agents)
    for (let i = 0; i < RECENT_LIMIT + 3; i++) apply(state, call('agy', `x${i}`, [touch(`gen/f${i}.js`)], 10 + i))
    expect(state.recentAt.size).toBe(RECENT_LIMIT)
    expect([...state.recentAt.keys()].sort()).toEqual([...state.recent].sort())
  })

  it('keeps only the touches at latest when keepMs is 0', () => {
    const state = createState(tree, agents)
    apply(state, call('hermes', 'c1', [touch('src/a.js')], 1000))
    apply(state, call('hermes', 'c2', [touch('src/b.js'), touch('docs/notes.md')], 2000))
    expect(freshRecent(state, 0)).toEqual(['src/b.js', 'docs/notes.md'])
  })
})

describe('tool calls in a long run', () => {
  it('keeps only the newest calls, so a failure of a recent call still marks its file', () => {
    const state = createState(tree, agents)
    apply(state, { type: 'run.start', agent: 'hermes', runId: 'r1', time: 0, order: 0 })
    for (let index = 0; index < 5000; index += 1) apply(state, call('hermes', `c${index}`, [touch('src/a.js')], index + 1))
    apply(state, call('hermes', 'last', [touch('src/b.js')], 6000))
    const calls = state.agents.get('hermes').calls
    expect(calls.size).toBe(CALL_LIMIT)
    expect(calls.has('c0')).toBe(false)
    apply(state, { type: 'tool.end', agent: 'hermes', runId: 'r1', time: 6001, order: 6001, id: 'last', ok: false })
    expect(state.files.get('src/b.js').failed).toBe(true)
  })
})
