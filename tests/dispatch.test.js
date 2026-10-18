import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { createDispatcher } from '../src/assistant/dispatch.js'
import { context } from './probes/context.js'

function makeHost(overrides = {}) {
  const calls = []
  const record = (name) => (...args) => {
    calls.push([name, ...args])
  }
  const host = {
    calls,
    client: null,
    context: () => context,
    agentName: (key) => context.agents.find((agent) => agent.key === key)?.name ?? key,
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
    expect((await dispatcher.run({ type: 'open_config', agent: 'agy', section: 'model' })).message).toMatch(/C3d/)
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

  it('refuses every write that was not confirmed', async () => {
    const client = fast()
    const host = makeHost({ client })
    const dispatcher = createDispatcher(host)
    const writes = [
      { type: 'propose_dispatch', assignee: 'opencode-go', title: 'Fix the typo' },
      { type: 'propose_budget', agent: 'hermes', cents: 500 },
      { type: 'propose_subagents', agent: 'agy', allowed: true },
    ]
    for (const action of writes) {
      const result = await dispatcher.run(action)
      expect(result).toEqual({ ok: false, message: 'That needs your confirmation first.' })
    }
    expect((await client.issues()).length).toBe(5)
    expect((await client.agents()).find((agent) => agent.key === 'hermes').budgetMonthlyCents).toBe(0)
  })
})

describe('confirmed writes', () => {
  it('creates a task for the named agent and opens its thread', async () => {
    const client = fast()
    const host = makeHost({ client })
    const result = await createDispatcher(host).run({ type: 'propose_dispatch', assignee: 'opencode-go', title: 'Fix the typo in README' }, { confirmed: true })
    expect(result).toEqual({ ok: true, message: 'Created JC-23 for OpenCode Go.' })
    const issues = await client.issues()
    expect(issues[0]).toMatchObject({ title: 'Fix the typo in README', assigneeAgentId: 'agent-opencode' })
    expect(host.calls).toEqual([['openPanel', 'tasks', 'JC-23']])
  })

  it('sets a budget in cents and says it in dollars', async () => {
    const client = fast()
    const result = await createDispatcher(makeHost({ client })).run({ type: 'propose_budget', agent: 'hermes', cents: 250 }, { confirmed: true })
    expect(result).toEqual({ ok: true, message: 'The budget of Hermes is now $2.50 a month.' })
    expect((await client.agents()).find((agent) => agent.key === 'hermes').budgetMonthlyCents).toBe(250)
  })

  it('says plainly that subagent settings are not available until the update call exists', async () => {
    const result = await createDispatcher(makeHost({ client: fast() })).run({ type: 'propose_subagents', agent: 'agy', allowed: true }, { confirmed: true })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/C3c/)
  })

  it('uses the update call when the client has one', async () => {
    const client = { ...fast(), updateAgent: async (id, patch) => ({ id, ...patch }) }
    const seen = []
    client.updateAgent = async (id, patch) => {
      seen.push([id, patch])
      return {}
    }
    const allow = await createDispatcher(makeHost({ client })).run({ type: 'propose_subagents', agent: 'agy', allowed: true }, { confirmed: true })
    const forbid = await createDispatcher(makeHost({ client })).run({ type: 'propose_subagents', agent: 'hermes', allowed: false }, { confirmed: true })
    expect(allow.message).toBe('agy may start subagents.')
    expect(forbid.message).toBe('Hermes may not start subagents.')
    expect(seen).toEqual([['agent-agy', { subagentsAllowed: true }], ['agent-hermes', { subagentsAllowed: false }]])
  })

  it('explains that there is no control connection when the client is missing', async () => {
    const result = await createDispatcher(makeHost()).run({ type: 'propose_budget', agent: 'hermes', cents: 100 }, { confirmed: true })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/No control connection/)
  })

  it('finds the agent by the id the room holds, then by key, then by name', async () => {
    const client = fast()
    const byId = makeHost({ client, agentId: (key) => (key === 'opencode' ? 'agent-opencode' : undefined), context: () => ({ agents: [{ key: 'opencode', name: 'Some other label' }], paths: [] }), agentName: () => 'Some other label' })
    expect((await createDispatcher(byId).run({ type: 'propose_budget', agent: 'opencode', cents: 100 }, { confirmed: true })).message).toMatch(/OpenCode Go is now \$1.00/)
    const byKey = makeHost({ client, context: () => ({ agents: [{ key: 'hermes', name: 'x' }], paths: [] }), agentName: () => 'x' })
    expect((await createDispatcher(byKey).run({ type: 'propose_budget', agent: 'hermes', cents: 200 }, { confirmed: true })).message).toMatch(/Hermes is now \$2.00/)
    const byName = makeHost({ client, context: () => ({ agents: [{ key: 'opencode', name: 'OpenCode Go' }], paths: [] }), agentName: () => 'OpenCode Go' })
    expect((await createDispatcher(byName).run({ type: 'propose_budget', agent: 'opencode', cents: 300 }, { confirmed: true })).message).toMatch(/OpenCode Go is now \$3.00/)
  })

  it('names an agent the control plane does not know', async () => {
    const host = makeHost({ client: fast(), context: () => ({ agents: [{ key: 'stranger', name: 'Stranger' }], paths: [] }), agentName: () => 'Stranger' })
    const result = await createDispatcher(host).run({ type: 'propose_budget', agent: 'stranger', cents: 100 }, { confirmed: true })
    expect(result).toEqual({ ok: false, message: 'Stranger is not known to the control plane.' })
  })

  it('shows the error message of a failed call in plain words', async () => {
    const client = fast()
    client.failNext('createIssue', 'Paperclip is not reachable.')
    const result = await createDispatcher(makeHost({ client })).run({ type: 'propose_dispatch', assignee: 'agy', title: 'Anything' }, { confirmed: true })
    expect(result).toEqual({ ok: false, message: 'Paperclip is not reachable.' })
  })
})
