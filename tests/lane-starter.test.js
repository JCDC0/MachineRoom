import { describe, expect, it } from 'vitest'
import { LANE_START_TOP_MS, cleanStartedBy, delegatingSessionTop, isSessionTopKey, laneStarterTop, sessionKeyFor, topKeyFor } from '../src/model/laneStarter.js'
import { CHILD_LIFE_MS, apply, createState } from '../src/model/state.js'

const HOUR = 60 * 60 * 1000

function agent(fields = {}) {
  return {
    status: 'idle',
    startedAt: 0,
    endedAt: 0,
    startedBy: null,
    sessions: null,
    ...fields,
  }
}

function room({ orchestrator = {}, session = {}, lane = {} } = {}) {
  return new Map([
    ['orchestrator', agent(orchestrator)],
    ['claude-session', agent(session)],
    ['opencode', agent(lane)],
  ])
}

describe('laneStarter', () => {
  it('reads only a harness and a session', () => {
    expect(cleanStartedBy({ harness: 'claude', session: 's1' })).toEqual({ harness: 'claude', session: 's1' })
    expect(cleanStartedBy({ harness: 'claude' })).toBe(null)
    expect(cleanStartedBy('claude')).toBe(null)
    expect(cleanStartedBy(null)).toBe(null)
    expect(sessionKeyFor({ harness: 'claude', session: 's1' })).toBe('claude-session')
    expect(sessionKeyFor({ harness: 'opencode', session: 's1' })).toBe('opencode-session')
    expect(sessionKeyFor({ harness: 'codex', session: 's1' })).toBe('')
  })

  it.each([['agy', 'antigravity-session'], ['hermes', 'hermes-session']])('seats a %s session that started a lane', (harness, key) => {
    const agents = new Map([
      ['orchestrator', agent()],
      [key, agent({ key, sessions: new Set(['s1']) })],
      ['codex', agent({ key: 'codex', status: 'working', startedAt: 1000, startedBy: { harness, session: 's1' } })],
    ])
    expect(sessionKeyFor({ harness, session: 's1' })).toBe(key)
    expect(laneStarterTop({ agents, at: 1000 })).toBe(key)
    expect(topKeyFor({ chosenTop: key, viewKeys: new Set(agents.keys()) })).toBe(key)
  })

  it('seats a lane starter even without an orchestrator', () => {
    const agents = room({ lane: { status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 's1' } } })
    agents.delete('orchestrator')
    expect(laneStarterTop({ agents, at: 1000 })).toBe('claude-session')
  })

  it('puts the session that started an open lane run at the top while the orchestrator is idle', () => {
    const agents = room({
      lane: { status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 's1' } },
      session: { sessions: new Set(['s1']) },
    })
    expect(laneStarterTop({ agents, at: 1000 })).toBe('claude-session')
  })

  it.each(['working', 'queued'])('gives the top back when the orchestrator is %s', (status) => {
    const agents = room({
      orchestrator: { status, startedAt: 2000 },
      lane: { status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 's1' } },
      session: { sessions: new Set(['s1']) },
    })
    expect(laneStarterTop({ agents, at: 2000 })).toBe('')
  })

  it('keeps a session at the side when its lane run ended more than 10 minutes ago', () => {
    const agents = room({
      lane: { status: 'done', startedAt: 1000, endedAt: 2000, startedBy: { harness: 'claude', session: 's1' } },
      session: { sessions: new Set(['s1']) },
    })
    expect(laneStarterTop({ agents, at: 2000 + LANE_START_TOP_MS + 1 })).toBe('')
    expect(laneStarterTop({ agents, at: 2000 + LANE_START_TOP_MS })).toBe('claude-session')
  })

  it('keeps the top for an open run whatever its age', () => {
    const agents = room({
      lane: { status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 's1' } },
      session: { sessions: new Set(['s1']) },
    })
    expect(laneStarterTop({ agents, at: 1000 + HOUR })).toBe('claude-session')
  })

  it('does not move a session that never saw the session id', () => {
    const agents = room({
      lane: { status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 'other' } },
      session: { sessions: new Set(['s1']) },
    })
    expect(laneStarterTop({ agents, at: 1000 })).toBe('')
  })

  it('wants a session agent and a startedBy to move anything', () => {
    const agents = room({ lane: { status: 'working', startedAt: 1000 } })
    expect(laneStarterTop({ agents, at: 1000 })).toBe('')
    const noSession = new Map([['orchestrator', agent()], ['opencode', agent({ status: 'working', startedAt: 1000, startedBy: { harness: 'claude', session: 's1' } })]])
    expect(laneStarterTop({ agents: noSession, at: 1000 })).toBe('')
    expect(laneStarterTop({ agents: null, at: 1000 })).toBe('')
  })

  it('prefers an open run over a newer ended one', () => {
    const agents = room({
      lane: { status: 'done', startedAt: 5000, endedAt: 6000, startedBy: { harness: 'claude', session: 's1' } },
      session: { sessions: new Set(['s1']) },
    })
    agents.set('opencode2', agent({ status: 'working', startedAt: 1000, startedBy: { harness: 'opencode', session: 's2' } }))
    agents.set('opencode-session', agent({ sessions: new Set(['s2']) }))
    expect(laneStarterTop({ agents, at: 6000 })).toBe('opencode-session')
  })
})

describe('delegatingSessionTop', () => {
  function room(entries) {
    const agents = new Map()
    for (const [key, fields] of entries) agents.set(key, agent({ key, ...fields }))
    return agents
  }

  it('takes the session whose children work', () => {
    const agents = room([
      ['antigravity-session', {}],
      ['worker-a', { parent: 'antigravity-session', status: 'working', startedAt: 1000 }],
      ['worker-b', { parent: 'antigravity-session', status: 'queued', startedAt: 2000 }],
    ])
    expect(delegatingSessionTop({ agents, at: 2000 })).toBe('antigravity-session')
  })

  it('keeps the session only while a child ended inside the window', () => {
    const agents = room([
      ['antigravity-session', {}],
      ['worker-a', { parent: 'antigravity-session', status: 'done', startedAt: 1000, endedAt: 2000 }],
    ])
    expect(delegatingSessionTop({ agents, at: 2000 })).toBe('antigravity-session')
    expect(delegatingSessionTop({ agents, at: 2000 + LANE_START_TOP_MS })).toBe('antigravity-session')
    expect(delegatingSessionTop({ agents, at: 2000 + LANE_START_TOP_MS + 1 })).toBe('')
  })

  it('keeps the seat until the window expires even after the worker is pruned', () => {
    const state = createState({ files: [], dirs: [], created: [] }, [{ key: 'antigravity-session' }])
    apply(state, { type: 'agent.spawn', agent: 'antigravity-session', child: 'worker', time: 1000 })
    apply(state, { type: 'agent.end', agent: 'worker', ok: true, time: 2000 })
    const at = 2000 + CHILD_LIFE_MS
    apply(state, { type: 'run.start', agent: 'antigravity-session', runId: 'next', time: at })
    expect(state.agents.has('worker')).toBe(false)
    expect(delegatingSessionTop({ agents: state.agents, at })).toBe('antigravity-session')
    expect(delegatingSessionTop({ agents: state.agents, at: 2000 + LANE_START_TOP_MS + 1 })).toBe('')
  })

  it('prefers a working child over a newer ended one', () => {
    const agents = room([
      ['antigravity-session', {}],
      ['claude-session', {}],
      ['worker-a', { parent: 'antigravity-session', status: 'working', startedAt: 1000 }],
      ['worker-b', { parent: 'claude-session', status: 'done', startedAt: 5000, endedAt: 6000 }],
    ])
    expect(delegatingSessionTop({ agents, at: 6000 })).toBe('antigravity-session')
  })

  it('takes the newest child start among sessions that both have working children', () => {
    const state = createState({ files: [], dirs: [], created: [] }, [{ key: 'antigravity-session' }, { key: 'claude-session' }])
    apply(state, { type: 'agent.spawn', agent: 'antigravity-session', child: 'worker-a', time: 1000 })
    apply(state, { type: 'agent.spawn', agent: 'claude-session', child: 'worker-b', time: 4000 })
    expect(state.agents.get('worker-b').startedAt).toBe(4000)
    expect(delegatingSessionTop({ agents: state.agents, at: 5000 })).toBe('claude-session')
  })

  it('wants a session key with no parent and a child of its own', () => {
    const agents = room([
      ['antigravity-session', {}],
      ['opencode', { status: 'working', startedAt: 1000 }],
      ['worker-a', { parent: 'opencode', status: 'working', startedAt: 1000 }],
      ['nested-session', { parent: 'opencode', status: 'working', startedAt: 1000 }],
      ['worker-b', { parent: 'nested-session', status: 'working', startedAt: 1000 }],
    ])
    expect(delegatingSessionTop({ agents, at: 1000 })).toBe('')
    expect(delegatingSessionTop({ agents: null, at: 1000 })).toBe('')
    expect(delegatingSessionTop({ agents: new Map(), at: 1000 })).toBe('')
  })
})

describe('the chosen top', () => {
  it('reads a session key only', () => {
    expect(isSessionTopKey('claude-session')).toBe(true)
    expect(isSessionTopKey('opencode-session')).toBe(true)
    expect(isSessionTopKey('orchestrator')).toBe(false)
    expect(isSessionTopKey('claude')).toBe(false)
    expect(isSessionTopKey('')).toBe(false)
    expect(isSessionTopKey(null)).toBe(false)
  })

  it('keeps the chosen session at the top over the lane starter', () => {
    expect(topKeyFor({ chosenTop: 'claude-session', laneTop: 'orchestrator', viewKeys: ['claude-session'] })).toBe('claude-session')
    expect(topKeyFor({ chosenTop: 'claude-session', laneTop: 'opencode-session', viewKeys: new Set(['claude-session']) })).toBe('claude-session')
  })

  it('keeps the old rule when the chosen session has no view', () => {
    expect(topKeyFor({ chosenTop: 'claude-session', laneTop: 'orchestrator', viewKeys: [] })).toBe('orchestrator')
    expect(topKeyFor({ chosenTop: 'claude-session', laneTop: 'opencode-session', viewKeys: ['opencode-session'] })).toBe('opencode-session')
  })

  it('keeps the old rule for the Orchestrator and an unknown key', () => {
    expect(topKeyFor({ chosenTop: 'orchestrator', laneTop: 'orchestrator', viewKeys: ['orchestrator'] })).toBe('orchestrator')
    expect(topKeyFor({ chosenTop: 'orchestrator', laneTop: 'claude-session', viewKeys: ['claude-session'] })).toBe('claude-session')
    expect(topKeyFor({ chosenTop: 'nope', laneTop: '', viewKeys: ['nope'] })).toBe('orchestrator')
    expect(topKeyFor({})).toBe('orchestrator')
  })
})
