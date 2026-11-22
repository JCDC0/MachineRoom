import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFollowFocus, createLater, createWorkingMaskCache, followAfterSeek, inspectorNamesPath, noteTouch, TOUCH_ENTRY_LIMIT, TOUCH_PATH_LIMIT, workingMask } from '../src/engine/room.js'
import { agentColors } from '../src/engine/sprites.js'
import { makeTree } from '../src/model/paths.js'
import { apply, createState } from '../src/model/state.js'

function state(status, focus, recent = []) {
  return {
    files: new Map([['src/engine/room.js', { path: 'src/engine/room.js', exists: true }]]),
    agents: new Map([['opencode', { key: 'opencode', status, focus }]]),
    recent,
  }
}

describe('followAfterSeek', () => {
  it('clears the followed card and the pending path, then aims at the card touched after the seek', () => {
    const working = state('working', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(working, 'wide')).toEqual({
      followCard: null,
      pendingFollow: null,
      path: 'src/engine',
    })
    expect(followAfterSeek(working, 'close').path).toBe('src/engine')
  })

  it('keeps the follow target empty when nobody works in the new state', () => {
    const idle = state('done', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(idle, 'wide')).toEqual({
      followCard: null,
      pendingFollow: null,
      path: null,
    })
  })

  it('clears both fields when follow mode is off', () => {
    const working = state('working', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(working, false)).toEqual({
      followCard: null,
      pendingFollow: null,
      path: null,
    })
  })
})

describe('the working mask', () => {
  const openMap = (has = true) => (has ? new Map([['t1', { tool: 'read', label: 'read', touches: [] }]]) : new Map())
  const working = (focus, status = 'working', latest = 10, openCalls = openMap(true)) => ({
    latest,
    files: new Map([['src/a.js', { path: 'src/a.js', exists: true }]]),
    agents: new Map([['hermes', { key: 'hermes', status, focus, openCalls }]]),
  })

  it('builds once over idle frames and again when an agent, a focus, openCalls or the activity changes', () => {
    const cache = createWorkingMaskCache()
    const state = working(['src/a.js'])
    const mask = cache.of(state)
    expect(mask).toEqual({
      dimmed: true,
      lit: new Set(['', 'src']),
      targeted: new Set(['src']),
      dirColors: new Map(),
      fileColors: new Map(),
      targetVersion: 0,
    })
    for (let frame = 0; frame < 5; frame += 1) expect(cache.of(state)).toBe(mask)
    expect(cache.builds()).toBe(1)
    state.latest = 11
    expect(cache.of(state)).not.toBe(mask)
    expect(cache.builds()).toBe(2)
    state.agents.get('hermes').focus = ['docs/b.md']
    cache.of(state)
    expect(cache.builds()).toBe(3)
    state.agents.get('hermes').openCalls.clear()
    const thinking = cache.of(state)
    expect(thinking.dimmed).toBe(false)
    expect(thinking.targeted.size).toBe(0)
    expect(cache.builds()).toBe(4)
    state.agents.get('hermes').status = 'done'
    const idle = cache.of(state)
    expect(idle.dimmed).toBe(false)
    expect(cache.builds()).toBe(5)
    for (let frame = 0; frame < 5; frame += 1) expect(cache.of(state)).toBe(idle)
    expect(cache.builds()).toBe(5)
  })

  it('lights a working path with an open call only, not a thinking agent, recent touch or idle agent', () => {
    const cache = createWorkingMaskCache()
    const state = working(['src/a.js'])
    state.recent = ['docs/b.md']
    state.agents.set('claude', { key: 'claude', status: 'done', focus: ['docs/b.md'], openCalls: openMap(true) })
    state.agents.set('agy', { key: 'agy', status: 'working', focus: ['docs/b.md'], openCalls: openMap(false) })
    const mask = cache.of(state)
    expect(mask.lit).toEqual(new Set(['', 'src']))
    expect(mask.lit.has('docs')).toBe(false)
    expect(mask.targeted).toEqual(new Set(['src']))
  })

  it('clears the mask while thinking, during a non-file tool, on error, and shifts to the remaining open call', () => {
    const state = createState(makeTree({ root: 'demo', files: ['src/a.js', 'docs/b.md'] }), [{ key: 'claude', name: 'Claude' }])
    const colourOf = () => 0xffb347
    apply(state, { type: 'run.start', agent: 'claude', runId: 'r1', time: 1 })
    apply(state, {
      type: 'tool.start',
      agent: 'claude',
      runId: 'r1',
      time: 2,
      id: 'o1',
      tool: 'read',
      label: 'read src/a.js',
      touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }],
    })
    let mask = workingMask(state, colourOf)
    expect(mask.dimmed).toBe(true)
    expect(mask.targeted).toEqual(new Set(['src']))
    expect(mask.fileColors).toEqual(new Map([['src/a.js', '#ffb347']]))

    apply(state, {
      type: 'tool.start',
      agent: 'claude',
      runId: 'r1',
      time: 3,
      id: 'o2',
      tool: 'read',
      label: 'read docs/b.md',
      touches: [{ kind: 'file', path: 'docs/b.md', mode: 'read' }],
    })
    mask = workingMask(state, colourOf)
    expect(mask.targeted).toEqual(new Set(['src', 'docs']))

    apply(state, { type: 'tool.end', agent: 'claude', runId: 'r1', time: 4, id: 'o2', ok: true })
    mask = workingMask(state, colourOf)
    expect(mask.targeted).toEqual(new Set(['src']))
    expect(mask.fileColors).toEqual(new Map([['src/a.js', '#ffb347']]))

    apply(state, { type: 'tool.end', agent: 'claude', runId: 'r1', time: 5, id: 'o1', ok: true })
    mask = workingMask(state, colourOf)
    expect(mask.dimmed).toBe(false)
    expect(mask.targeted.size).toBe(0)
    expect(mask.fileColors.size).toBe(0)

    apply(state, { type: 'tool.start', agent: 'claude', runId: 'r1', time: 6, id: 'sh1', tool: 'shell', label: 'npm test', touches: [] })
    mask = workingMask(state, colourOf)
    expect(mask.dimmed).toBe(false)
    expect(mask.targeted.size).toBe(0)

    apply(state, {
      type: 'tool.start',
      agent: 'claude',
      runId: 'r1',
      time: 7,
      id: 'o3',
      tool: 'read',
      label: 'read src/a.js',
      touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }],
    })
    expect(workingMask(state, colourOf).dimmed).toBe(true)
    apply(state, { type: 'error', agent: 'claude', runId: 'r1', time: 8, text: 'failed' })
    mask = workingMask(state, colourOf)
    expect(mask.dimmed).toBe(false)
    expect(mask.targeted.size).toBe(0)
    expect(mask.fileColors.size).toBe(0)
  })
})

describe('the target colours', () => {
  const colours = new Map([
    ['orchestrator', 0xffb347],
    ['opencode', 0xff5ad1],
    ['child', 0xffb347],
  ])
  const colourOf = (key) => colours.get(key)
  const stateWith = (agents, files = ['src/a.js', 'src/b.js', 'docs/c.md']) => ({
    latest: 1,
    files: new Map(files.map((path) => [path, { path, exists: true }])),
    agents: new Map(
      agents.map((agent) => [
        agent.key,
        {
          key: agent.key,
          status: agent.status ?? 'working',
          focus: agent.focus,
          openCalls: agent.openCalls ?? new Map([['t1', { tool: 'read', label: 'read', touches: [] }]]),
        },
      ]),
    ),
  })

  it('gives the folder and the file the working agent colour as hex text', () => {
    const mask = workingMask(stateWith([{ key: 'orchestrator', focus: ['src/a.js'] }]), colourOf)
    expect(mask.dirColors).toEqual(new Map([['src', '#ffb347']]))
    expect(mask.fileColors).toEqual(new Map([['src/a.js', '#ffb347']]))
  })

  it('keeps the first working agent in roster order on a folder two agents share', () => {
    const mask = workingMask(
      stateWith([
        { key: 'orchestrator', focus: ['src/a.js'] },
        { key: 'opencode', focus: ['src/b.js'] },
      ]),
      colourOf,
    )
    expect(mask.dirColors).toEqual(new Map([['src', '#ffb347']]))
    expect(mask.fileColors).toEqual(
      new Map([
        ['src/a.js', '#ffb347'],
        ['src/b.js', '#ff5ad1'],
      ]),
    )
  })

  it('takes the colour the room gives a child agent', () => {
    const mask = workingMask(
      stateWith([
        { key: 'orchestrator', focus: ['src/a.js'] },
        { key: 'child', focus: ['docs/c.md'] },
      ]),
      colourOf,
    )
    expect(mask.dirColors.get('docs')).toBe('#ffb347')
    expect(mask.fileColors.get('docs/c.md')).toBe('#ffb347')
  })

  it('ignores an idle agent and pads a short colour to six digits', () => {
    const idle = workingMask(stateWith([{ key: 'opencode', status: 'done', focus: ['src/a.js'] }]), colourOf)
    expect(idle.dirColors.size).toBe(0)
    expect(idle.fileColors.size).toBe(0)
    const short = workingMask(stateWith([{ key: 'orchestrator', focus: ['src/a.js'] }]), () => 0x0000ff)
    expect(short.dirColors.get('src')).toBe('#0000ff')
  })

  it('gives the main orchestrator the yellow brackets', () => {
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'opencode', name: 'OpenCode' },
    ]
    const colors = agentColors(roster)
    const byKey = new Map(roster.map((agent, index) => [agent.key, colors[index]]))
    const mask = workingMask(stateWith([{ key: 'orchestrator', focus: ['src/a.js'] }]), (key) => byKey.get(key))
    expect(mask.dirColors.get('src')).toBe('#e5ff00')
    expect(mask.fileColors.get('src/a.js')).toBe('#e5ff00')
  })

  it('rebuilds the cache when the roster colour changes', () => {
    const roster = new Map([['hermes', 0xffb347]])
    const cache = createWorkingMaskCache((key) => roster.get(key))
    const state = stateWith([{ key: 'hermes', focus: ['src/a.js'] }])
    const first = cache.of(state)
    expect(first.dirColors.get('src')).toBe('#ffb347')
    roster.set('hermes', 0xff5ad1)
    const second = cache.of(state)
    expect(second.dirColors.get('src')).toBe('#ff5ad1')
    expect(second.targetVersion).toBe(first.targetVersion + 1)
    expect(cache.builds()).toBe(2)
  })
})

describe('the follow focus', () => {
  it('clears the focused agent when focus names no agent view', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    room.focus(null, false)
    expect(room.focused()).toBeNull()
  })

  it('keeps the focused agent when follow is off', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    expect(room.following()).toBe(false)
    expect(room.focused()).toBe('agent3')
  })
})

describe('the touch log', () => {
  const touch = (key = 'a') => ({ key, mode: 'read', time: 1 })

  it('keeps at most the path limit and drops the least recently touched path', () => {
    const log = new Map()
    for (let index = 0; index < TOUCH_PATH_LIMIT; index += 1) noteTouch(log, `src/f${index}.js`, touch())
    expect(log.size).toBe(TOUCH_PATH_LIMIT)
    noteTouch(log, 'src/f0.js', touch())
    noteTouch(log, 'src/fresh.js', touch())
    expect(log.size).toBe(TOUCH_PATH_LIMIT)
    expect(log.has('src/f1.js')).toBe(false)
    expect(log.has('src/f0.js')).toBe(true)
    expect(log.has('src/fresh.js')).toBe(true)
  })

  it('keeps the newest entries for one path', () => {
    const log = new Map()
    for (let index = 0; index < TOUCH_ENTRY_LIMIT + 10; index += 1) {
      noteTouch(log, 'src/a.js', { key: 'a', mode: 'read', time: index })
    }
    const list = log.get('src/a.js')
    expect(list).toHaveLength(TOUCH_ENTRY_LIMIT)
    expect(list[0].time).toBe(10)
    expect(list.at(-1).time).toBe(TOUCH_ENTRY_LIMIT + 9)
  })

  it('takes its own limits for a small test log', () => {
    const log = new Map()
    noteTouch(log, 'a', touch(), 2, 2)
    noteTouch(log, 'b', touch(), 2, 2)
    noteTouch(log, 'a', touch(), 2, 2)
    noteTouch(log, 'c', touch(), 2, 2)
    expect([...log.keys()]).toEqual(['a', 'c'])
  })
})

describe('inspectorNamesPath', () => {
  it('names the card itself, a folder below it and a file on it', () => {
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a/c' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'file', id: 'lib/a/x.js' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a' }, 'lib')).toBe(true)
  })

  it('leaves a sibling, a lookalike name and another kind alone', () => {
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/b' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'file', id: 'lib/ax.js' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'agent', id: 'claude' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'internet', id: 'internet' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath(null, 'lib/a')).toBe(false)
  })
})

describe('createLater', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a scheduled label when a seek clears the pending timers', () => {
    vi.useFakeTimers()
    const calls = []
    const timers = createLater()
    timers.later(() => calls.push('old label'))
    vi.advanceTimersByTime(250)
    expect(calls).toEqual(['old label'])
    timers.later(() => calls.push('stale label'))
    timers.clear()
    vi.advanceTimersByTime(250)
    expect(calls).toEqual(['old label'])
  })
})
