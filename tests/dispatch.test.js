import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { createAssistantRunner, createDispatcher } from '../src/assistant/dispatch.js'
import { context } from './probes/context.js'

const LANE_AGENTS = [
  { key: 'claude', name: 'Claude Code' },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'opencode2', name: 'OpenCode 2' },
  { key: 'opencode3', name: 'OpenCode 3' },
  { key: 'opencode4', name: 'OpenCode 4' },
]

const MOCK_CONTEXT = { ...context, agents: LANE_AGENTS }

function makeHost(overrides = {}) {
  const calls = []
  const fallback = overrides.client ? MOCK_CONTEXT : context
  const record = (name) => (...args) => {
    calls.push([name, ...args])
  }
  const host = {
    calls,
    client: null,
    context: () => fallback,
    agentName: (key) => fallback.agents.find((agent) => agent.key === key)?.name ?? key,
    focusAgent: record('focusAgent'),
    focusTerminal: (key) => {
      calls.push(['focusTerminal', key])
      return key !== 'ghost'
    },
    focusPath: (path) => {
      calls.push(['focusPath', path])
      return path !== 'missing'
    },
    overview: record('overview'),
    setFollow: record('setFollow'),
    replay: (op, value) => {
      calls.push(['replay', op, value])
      return { ok: true, message: '' }
    },
    openPanel: record('openPanel'),
    pressKey: record('pressKey'),
    ...overrides,
  }
  return host
}

const fast = () => createMockClient({ latencyMs: 0, now: () => Date.parse('2026-10-19T00:00:00Z') })

describe('reads', () => {
  const cases = [
    [{ type: 'focus_agent', agent: 'agy', view: 'close' }, ['focusAgent', 'agy', 'close']],
    [{ type: 'focus_terminal', agent: 'hermes' }, ['focusTerminal', 'hermes']],
    [{ type: 'focus_path', path: 'src/engine' }, ['focusPath', 'src/engine']],
    [{ type: 'overview' }, ['overview']],
    [{ type: 'follow', mode: 'wide' }, ['setFollow', 'wide']],
    [{ type: 'follow', mode: 'close' }, ['setFollow', 'close']],
    [{ type: 'follow', mode: 'off' }, ['setFollow', false]],
    [{ type: 'open_panel', tab: 'meters' }, ['openPanel', 'meters']],
    [{ type: 'open_issue', identifier: 'JC-19' }, ['openPanel', 'tasks', 'JC-19']],
    [{ type: 'open_log' }, ['pressKey', 'l']],
    [{ type: 'open_help' }, ['pressKey', '?']],
    [{ type: 'replay', op: 'pause' }, ['replay', 'pause', undefined]],
    [{ type: 'replay', op: 'speed', value: 4 }, ['replay', 'speed', 4]],
  ]

  for (const [action, expected] of cases) {
    it(`runs ${action.type} ${JSON.stringify(action).slice(0, 50)}`, async () => {
      const host = makeHost()
      const result = await createDispatcher(host).run(action)
      expect(result.ok).toBe(true)
      expect(host.calls).toEqual([expected])
    })
  }

  it('says nothing for a plain move, so the assistant keeps its own line', async () => {
    const result = await createDispatcher(makeHost()).run({ type: 'overview' })
    expect(result.message).toBe('')
  })

  it('reports a folder that is not in the room and a terminal that does not exist', async () => {
    const dispatcher = createDispatcher(makeHost({ context: () => ({ ...context, paths: [...context.paths, 'missing'] }) }))
    expect(await dispatcher.run({ type: 'focus_path', path: 'missing' })).toEqual({ ok: false, message: 'That folder or file is not in the room yet.' })
    const ghost = createDispatcher(makeHost({ context: () => ({ agents: [{ key: 'ghost', name: 'Ghost' }], paths: [] }) }))
    expect((await ghost.run({ type: 'focus_terminal', agent: 'ghost' })).message).toMatch(/no terminal/i)
  })

  it('passes a replay refusal on, for a live feed', async () => {
    const host = makeHost({ replay: () => ({ ok: false, message: 'Replay controls do not apply to a live feed.' }) })
    expect(await createDispatcher(host).run({ type: 'replay', op: 'play' })).toEqual({ ok: false, message: 'Replay controls do not apply to a live feed.' })
  })
})

describe('settings requests', () => {
  it('opens the meters for a budget and the agent for the other pages, and never stores a key', async () => {
    const host = makeHost()
    const dispatcher = createDispatcher(host)
    expect((await dispatcher.run({ type: 'open_config', agent: 'agy', section: 'budget' })).message).toMatch(/Meters/)
    expect(host.calls).toEqual([['openPanel', 'meters']])
    host.calls.length = 0
    const keys = await dispatcher.run({ type: 'open_config', agent: 'hermes', section: 'keys' })
    expect(keys.ok).toBe(true)
    expect(keys.message).toMatch(/Nothing was stored/)
    expect(host.calls).toEqual([['focusAgent', 'hermes', 'close']])
    host.calls.length = 0
    expect((await dispatcher.run({ type: 'open_config', agent: 'agy', section: 'model' })).message).toMatch(/does not offer/)
    host.calls.length = 0
    const withBuilder = makeHost({ client: fast() })
    const opened = await createDispatcher(withBuilder).run({ type: 'open_config', agent: 'opencode3', section: 'subagents' })
    expect(opened.message).toBe('Opened the Agents tab. Pick OpenCode 3 in the list to change its subagents settings.')
    expect(withBuilder.calls).toEqual([['focusAgent', 'opencode3', 'close'], ['openPanel', 'agents']])
  })

  it('opens the agents tab by name', async () => {
    const host = makeHost()
    expect((await createDispatcher(host).run({ type: 'open_panel', tab: 'agents' })).ok).toBe(true)
    expect(host.calls).toEqual([['openPanel', 'agents']])
  })
})

describe('guards', () => {
  it('refuses an action the validator does not know, and one with bad fields', async () => {
    const host = makeHost()
    const dispatcher = createDispatcher(host)
    expect((await dispatcher.run({ type: 'delete_everything' })).ok).toBe(false)
    expect((await dispatcher.run({ type: 'focus_agent', agent: 'nobody', view: 'wide' })).ok).toBe(false)
    expect((await dispatcher.run({ type: 'focus_path', path: '../secret' })).ok).toBe(false)
    expect((await dispatcher.run(null)).ok).toBe(false)
    expect(host.calls).toEqual([])
  })

  it('reads the agents and paths from the host on every call', async () => {
    let paths = ['']
    const host = makeHost({ context: () => ({ ...context, paths }) })
    const dispatcher = createDispatcher(host)
    expect((await dispatcher.run({ type: 'focus_path', path: 'src' })).ok).toBe(false)
    paths = ['', 'src']
    expect((await dispatcher.run({ type: 'focus_path', path: 'src' })).ok).toBe(true)
  })

  it('refuses actions that are not allowed', async () => {
    const dispatcher = createDispatcher(makeHost())
    const writes = [
      { type: 'propose_dispatch', assignee: 'opencode', title: 'Fix the typo' },
      { type: 'propose_budget', agent: 'opencode2', cents: 500 },
      { type: 'propose_subagents', agent: 'opencode3', allowed: true },
    ]
    for (const action of writes) {
      const result = await dispatcher.run(action)
      expect(result).toEqual({ ok: false, message: 'That request is not allowed.' })
    }
  })
})

describe('the assistant runner', () => {
  it('refuses an unknown action', async () => {
    const run = createAssistantRunner(createDispatcher(makeHost()))
    expect(await run({ type: 'propose_budget', agent: 'opencode2', cents: 500 })).toEqual({
      ok: false,
      message: 'That request is not allowed.',
    })
  })

  it('runs a read with no options', async () => {
    const host = makeHost()
    expect((await createAssistantRunner(createDispatcher(host))({ type: 'overview' })).ok).toBe(true)
    expect(host.calls).toEqual([['overview']])
  })
})
