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

  it('reports quota windows, including one that could not be read', async () => {
    const { quota, summary, byAgent } = await fast().costs()
    expect(summary.budgetCents).toBeGreaterThan(0)
    expect(byAgent.length).toBeGreaterThan(0)
    expect(quota.find((item) => item.ok).windows.some((window) => window.usedPercent === null)).toBe(true)
    expect(quota.find((item) => !item.ok).error).toBeTruthy()
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
    client.failNext('agents', 'Paperclip is not reachable.')
    await expect(client.agents()).rejects.toThrow('Paperclip is not reachable.')
    await expect(client.agents()).resolves.toBeTruthy()
  })

  it('hands out copies, so a panel cannot change the stored data', async () => {
    const client = fast()
    const agents = await client.agents()
    agents[0].name = 'Changed'
    expect((await client.agents())[0].name).toBe('Claude Code')
  })
})
