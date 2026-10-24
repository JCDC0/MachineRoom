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
