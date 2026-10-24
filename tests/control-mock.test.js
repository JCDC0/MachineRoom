import { describe, expect, it } from 'vitest'
import { CLIENT_METHODS, createMockClient } from '../src/control/mock.js'

const fast = () => createMockClient({ latencyMs: 0, now: () => Date.parse('2026-10-18T00:00:00Z') })

describe('mock control client', () => {
  it('has every method of the contract', () => {
    const client = fast()
    for (const name of CLIENT_METHODS) expect(typeof client[name], name).toBe('function')
  })

  it('lists agents with the contract fields', async () => {
    const agents = await fast().agents()
    expect(agents.length).toBeGreaterThan(3)
    for (const agent of agents) {
      for (const key of ['id', 'key', 'name', 'adapterType', 'role', 'status', 'budgetMonthlyCents', 'spentMonthlyCents']) {
        expect(agent, `${agent.name} ${key}`).toHaveProperty(key)
      }
    }
  })

  it('filters issues by status', async () => {
    const todo = await fast().issues({ status: 'todo' })
    expect(todo.length).toBeGreaterThan(0)
    expect(todo.every((issue) => issue.status === 'todo')).toBe(true)
  })

  it('creates an issue with the next identifier and puts it first', async () => {
    const client = fast()
    const before = await client.issues()
    const issue = await client.createIssue({ title: '  Add a test  ', assigneeAgentId: 'agent-opencode', model: 'opencode/deepseek-v4.1-flash-free' })
    expect(issue.title).toBe('Add a test')
    expect(issue.status).toBe('todo')
    expect(issue.identifier).toBe('JC-23')
    const after = await client.issues()
    expect(after).toHaveLength(before.length + 1)
    expect(after[0].id).toBe(issue.id)
  })

  it('refuses an issue with no title or an unknown agent', async () => {
    const client = fast()
    await expect(client.createIssue({ title: ' ', assigneeAgentId: 'agent-opencode' })).rejects.toThrow(/title/i)
    await expect(client.createIssue({ title: 'x', assigneeAgentId: 'nobody' })).rejects.toThrow(/agent/i)
  })

  it('adds a comment to the end of the thread', async () => {
    const client = fast()
    const comment = await client.postComment('issue-18', 'Looks good.')
    expect(comment.authorName).toBe('You')
    const thread = await client.comments('issue-18')
    expect(thread.at(-1).body).toBe('Looks good.')
  })

  it('refuses an empty comment and a comment on a missing task', async () => {
    const client = fast()
    await expect(client.postComment('issue-18', '  ')).rejects.toThrow(/comment/i)
    await expect(client.postComment('issue-99', 'hi')).rejects.toThrow(/exist/i)
  })

  it('decides an approval once', async () => {
    const client = fast()
    const done = await client.decideApproval('approval-1', 'approve', 'ok')
    expect(done.status).toBe('approved')
    expect(done.decisionNote).toBe('ok')
    await expect(client.decideApproval('approval-1', 'reject')).rejects.toThrow(/already/i)
  })

  it('maps each decision to a status', async () => {
    const client = fast()
    expect((await client.decideApproval('approval-2', 'request-revision')).status).toBe('revision_requested')
  })

  it('reports lane costs in dollars with no quota windows', async () => {
    const { quota, summary, byAgent } = await fast().costs()
    expect(summary).toEqual({ spendCents: 490, budgetCents: 0, utilizationPercent: 0 })
    expect(byAgent.length).toBeGreaterThan(0)
    expect(quota).toEqual([])
    expect(byAgent.map((item) => item.agentName)).toEqual(['Claude Code', 'OpenCode', 'OpenCode 2', 'OpenCode 3'])
  })

  it('sets a budget and refuses a bad one', async () => {
    const client = fast()
    expect((await client.setAgentBudget('agent-claude', 250)).budgetMonthlyCents).toBe(250)
    await expect(client.setAgentBudget('agent-claude', -1)).rejects.toThrow(/cents/i)
    await expect(client.setAgentBudget('nobody', 10)).rejects.toThrow(/agent/i)
  })

  it('lists models in tiers and marks the free one', async () => {
    const models = await fast().models()
    expect(new Set(models.map((model) => model.tier))).toEqual(new Set(['small', 'medium', 'large']))
    expect(models.filter((model) => model.free).map((model) => model.id)).toContain('opencode/deepseek-v4.1-flash-free')
  })

  it('fails the next call once when told to', async () => {
    const client = fast()
    client.failNext('agents', 'The bridge is not answering.')
    await expect(client.agents()).rejects.toThrow('The bridge is not answering.')
    await expect(client.agents()).resolves.toBeTruthy()
  })

  it('keeps the dispatch overrides on the issue and drops empty ones', async () => {
    const client = fast()
    const withLimits = await client.createIssue({ title: 'A', assigneeAgentId: 'agent-opencode', model: 'opencode/deepseek-v4.1-flash-free', maxTurnsPerRun: 8, timeoutSec: 300, subagentsAllowed: false })
    expect(withLimits.overrides).toEqual({ model: 'opencode/deepseek-v4.1-flash-free', maxTurnsPerRun: 8, timeoutSec: 300, subagentsAllowed: false })
    const plain = await client.createIssue({ title: 'B', assigneeAgentId: 'agent-opencode', model: '' })
    expect(plain.overrides).toBeNull()
  })

  it('tells subscribers what changed after a write', async () => {
    const client = fast()
    const seen = []
    const stop = client.subscribe((event) => seen.push(event))
    await client.createIssue({ title: 'C', assigneeAgentId: 'agent-opencode4' })
    await client.postComment('issue-18', 'Thanks.')
    await client.decideApproval('approval-1', 'approve')
    await client.setAgentBudget('agent-claude', 100)
    expect(seen).toEqual([
      { topic: 'issues' },
      { topic: 'comments', id: 'issue-18' },
      { topic: 'approvals' },
      { topic: 'agents' },
      { topic: 'costs' },
    ])
    stop()
    await client.createIssue({ title: 'D', assigneeAgentId: 'agent-opencode4' })
    expect(seen).toHaveLength(5)
  })

  it('does not tell subscribers about a write that failed', async () => {
    const client = fast()
    const seen = []
    client.subscribe((event) => seen.push(event))
    await expect(client.createIssue({ title: ' ', assigneeAgentId: 'agent-opencode4' })).rejects.toThrow()
    expect(seen).toEqual([])
  })

  it('lets a test send a change by hand', () => {
    const client = fast()
    const seen = []
    client.subscribe((event) => seen.push(event))
    client.emit({ topic: 'agents' })
    expect(seen).toEqual([{ topic: 'agents' }])
  })

  it('hands out copies, so a panel cannot change the stored data', async () => {
    const client = fast()
    const agents = await client.agents()
    agents[0].name = 'Changed'
    expect((await client.agents())[0].name).toBe('Claude Code')
  })
})

describe('mock orchestrators and the ladder', () => {
  it('lists the main orchestrator first and each sub with its sector', async () => {
    const list = await fast().orchestrators()
    expect(list.map((entry) => entry.id)).toEqual(['orchestrator', 'frontend'])
    expect(list[0]).toMatchObject({
      name: 'Orchestrator',
      harness: 'claude',
      state: 'idle',
      scope: [],
      restricted: false,
      setBy: 'owner',
    })
    expect(list[0].lanes).toEqual(['claude', 'hermes', 'opencode', 'opencode4', 'agy'])
    expect(list[1]).toMatchObject({
      id: 'frontend',
      name: 'Frontend',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      lanes: ['opencode2', 'opencode3'],
      scope: ['src/ui/**', 'src/styles.css'],
      restricted: true,
      setBy: 'owner',
    })
  })

  it('keeps one chat per orchestrator', async () => {
    const client = fast()
    const main = await client.orchestrator()
    const sub = await client.orchestrator('frontend')
    expect(main.messages.map((message) => message.text)).toContain('What is running?')
    expect(sub).toMatchObject({ id: 'frontend', name: 'Frontend', state: 'idle', messages: [] })

    await client.sendOrchestrator('Plan the UI.', { id: 'frontend' })
    const after = await client.orchestrator('frontend')
    expect(after.messages).toHaveLength(2)
    expect(after.messages[0]).toMatchObject({ from: 'owner', text: 'Plan the UI.' })
    expect(after.messages[1].text).toContain('main orchestrator')
    expect((await client.orchestrator()).messages).toHaveLength(3)

    await client.stopOrchestrator({ confirmed: true, id: 'frontend' })
    expect(await client.orchestrators()).toContainEqual(expect.objectContaining({ id: 'frontend', state: 'paused' }))
    expect(await client.orchestrator()).toMatchObject({ state: 'idle' })
  })

  it('refuses a bad sub message and an unknown orchestrator', async () => {
    const client = fast()
    await expect(client.sendOrchestrator('   ', { id: 'frontend' })).rejects.toThrow(/message/i)
    await expect(client.orchestrator('nobody')).rejects.toThrow(/exist/i)
    await expect(client.stopOrchestrator({ confirmed: true, id: 'nobody' })).rejects.toThrow(/exist/i)
  })

  it('adds a sub through setLadder and starts its chat', async () => {
    const client = fast()
    const before = await client.orchestrators()
    const saved = await client.setLadder({
      subs: [
        ...before.filter((entry) => entry.id !== 'orchestrator').map(({ state, ...sub }) => sub),
        {
          id: 'bridge',
          name: 'Bridge',
          harness: 'claude',
          model: 'sonnet',
          lanes: ['opencode4'],
          scope: ['server/**'],
          restricted: false,
          setBy: 'owner',
        },
      ],
    })
    expect(saved.ladder.subs.map((sub) => sub.id)).toEqual(['frontend', 'bridge'])
    const after = await client.orchestrators()
    expect(after.map((entry) => entry.id)).toEqual(['orchestrator', 'frontend', 'bridge'])
    expect(after[0].lanes).not.toContain('opencode4')
    expect(await client.orchestrator('bridge')).toMatchObject({ id: 'bridge', state: 'idle', messages: [] })
  })

  it('shows the problems readLadder finds', async () => {
    const client = fast()
    const before = await client.orchestrators()
    const frontend = before.find((entry) => entry.id === 'frontend')
    const { state, ...frontendSub } = frontend
    const failure = await client
      .setLadder({
        subs: [
          frontendSub,
          {
            id: 'bridge',
            name: 'Bridge',
            harness: 'claude',
            model: 'sonnet',
            lanes: ['opencode2'],
            scope: ['server/**'],
            restricted: true,
            setBy: 'owner',
          },
        ],
      })
      .catch((error) => error)
    expect(failure.problems).toContain('The lane "opencode2" already belongs to sub "frontend".')
    expect(failure.message).toContain('already belongs')

    const empty = await client.setLadder({ subs: [{ id: 'plain', name: 'Plain', lanes: [], scope: [] }] }).catch((error) => error)
    expect(empty.problems).toContain('Sub "plain" has no scope.')
  })

  it('removes a sub, its chat and its lane claims through setLadder', async () => {
    const client = fast()
    const saved = await client.setLadder({ subs: [] })
    expect(saved.ladder.subs).toEqual([])
    const list = await client.orchestrators()
    expect(list.map((entry) => entry.id)).toEqual(['orchestrator'])
    expect(list[0].lanes).toContain('opencode2')
    await expect(client.orchestrator('frontend')).rejects.toThrow(/exist/i)
  })
})
