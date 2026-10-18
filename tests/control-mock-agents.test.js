import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'

const fast = (options = {}) => createMockClient({ latencyMs: 0, now: () => Date.parse('2026-10-19T00:00:00Z'), ...options })
const planner = { name: 'Planner', adapterType: 'claude_local', model: 'claude-sonnet-5-5', maxTurnsPerRun: 14 }
const byKey = async (client, key) => (await client.agents()).find((agent) => agent.key === key)

describe('agents carry the builder settings', () => {
  it('lists the new fields on every agent', async () => {
    for (const agent of await fast().agents()) {
      for (const key of ['reasoningEffort', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed', 'subagentDepth', 'instructions', 'reportsToAgentId']) expect(agent, `${agent.name} ${key}`).toHaveProperty(key)
    }
    expect(await byKey(fast(), 'claude-code')).toMatchObject({ maxTurnsPerRun: 14, timeoutSec: 420, subagentsAllowed: false })
  })
})

describe('hireAgent with approval required', () => {
  it('creates a waiting agent and a pending hire approval', async () => {
    const client = fast()
    const { agent, approval } = await client.hireAgent(planner)
    expect(agent).toMatchObject({ id: 'agent-planner', key: 'planner', name: 'Planner', status: 'pending_approval', spentMonthlyCents: 0, role: 'engineer', subagentsAllowed: false })
    expect(approval).toMatchObject({ type: 'hire_agent', status: 'pending', agentId: 'agent-planner', summary: 'Hire "Planner" (claude_local, claude-sonnet-5-5, 14 turns, subagents off).' })
    expect((await client.agents()).at(-1).id).toBe('agent-planner')
    expect((await client.approvals())[0].id).toBe(approval.id)
  })

  it('makes the agent ready when the approval is approved', async () => {
    const client = fast()
    const { approval } = await client.hireAgent(planner)
    await client.decideApproval(approval.id, 'approve')
    expect((await byKey(client, 'planner')).status).toBe('idle')
  })

  it('terminates the agent when the approval is rejected, and keeps it waiting for a revision request', async () => {
    const client = fast()
    const first = await client.hireAgent(planner)
    const second = await client.hireAgent({ ...planner, name: 'Scout' })
    await client.decideApproval(first.approval.id, 'reject')
    await client.decideApproval(second.approval.id, 'request-revision')
    expect((await byKey(client, 'planner')).status).toBe('terminated')
    expect((await byKey(client, 'scout')).status).toBe('pending_approval')
  })

  it('does not let a waiting or terminated agent take a task', async () => {
    const client = fast()
    const { agent, approval } = await client.hireAgent(planner)
    await expect(client.createIssue({ title: 'Do it', assigneeAgentId: agent.id })).rejects.toThrow('That agent cannot take tasks yet.')
    await client.decideApproval(approval.id, 'reject')
    await expect(client.createIssue({ title: 'Do it', assigneeAgentId: agent.id })).rejects.toThrow('That agent cannot take tasks yet.')
  })

  it('lets an approved agent take a task', async () => {
    const client = fast()
    const { agent, approval } = await client.hireAgent(planner)
    await client.decideApproval(approval.id, 'approve')
    await expect(client.createIssue({ title: 'Do it', assigneeAgentId: agent.id })).resolves.toMatchObject({ assigneeAgentId: 'agent-planner' })
  })

  it('still decides the hire approval that has no agent behind it', async () => {
    const client = fast()
    await expect(client.decideApproval('approval-2', 'approve')).resolves.toMatchObject({ status: 'approved' })
  })
})

describe('hireAgent without approval', () => {
  it('makes the agent ready at once and returns no approval', async () => {
    const client = fast({ requireApproval: false })
    const { agent, approval } = await client.hireAgent({ ...planner, subagentsAllowed: true })
    expect(agent).toMatchObject({ status: 'idle', subagentsAllowed: true, subagentDepth: 1 })
    expect(approval).toBeNull()
    expect((await client.approvals()).length).toBe(3)
  })
})

describe('hireAgent refusals', () => {
  it('refuses a bad draft in plain words and a name that is taken', async () => {
    const client = fast()
    await expect(client.hireAgent({ name: '', adapterType: 'claude_local' })).rejects.toThrow(/name/i)
    await expect(client.hireAgent({ name: 'Planner' })).rejects.toThrow('Choose a harness.')
    await expect(client.hireAgent({ name: 'Hermes', adapterType: 'hermes_local' })).rejects.toThrow('An agent with that name already exists.')
    await expect(client.hireAgent({ name: '!!!', adapterType: 'process' })).rejects.toThrow('The name needs letters or numbers.')
    await expect(client.hireAgent({ ...planner, reportsToAgentId: 'agent-ghost' })).rejects.toThrow('The agent it reports to no longer exists.')
    expect((await client.agents()).length).toBe(5)
  })

  it('does not change the stored agents when a draft is refused', async () => {
    const client = fast()
    await expect(client.hireAgent({ ...planner, maxTurnsPerRun: 0 })).rejects.toThrow(/1 to 200/)
    expect((await client.agents()).length).toBe(5)
    expect((await client.approvals()).length).toBe(3)
  })
})

describe('updateAgent', () => {
  it('changes the settings that were given and returns the agent', async () => {
    const client = fast()
    const agent = await client.updateAgent('agent-hermes', { model: 'deepseek/deepseek-v4.1-flash-1017', reasoningEffort: 'high', maxTurnsPerRun: 20, timeoutSec: 600, instructions: 'Be brief.' })
    expect(agent).toMatchObject({ model: 'deepseek/deepseek-v4.1-flash-1017', reasoningEffort: 'high', maxTurnsPerRun: 20, timeoutSec: 600, instructions: 'Be brief.' })
    expect(await byKey(client, 'hermes')).toMatchObject({ maxTurnsPerRun: 20 })
  })

  it('turns subagents on with a depth of one, sets a depth, and resets it when they are turned off', async () => {
    const client = fast()
    expect(await client.updateAgent('agent-agy', { subagentsAllowed: true })).toMatchObject({ subagentsAllowed: true, subagentDepth: 1 })
    expect(await client.updateAgent('agent-agy', { subagentDepth: 3 })).toMatchObject({ subagentDepth: 3 })
    expect(await client.updateAgent('agent-agy', { subagentsAllowed: false })).toMatchObject({ subagentsAllowed: false, subagentDepth: 0 })
    await expect(client.updateAgent('agent-agy', { subagentDepth: 2 })).rejects.toThrow('Turn subagents on to set a depth.')
  })

  it('pauses and resumes', async () => {
    const client = fast()
    expect((await client.updateAgent('agent-hermes', { status: 'paused' })).status).toBe('paused')
    expect((await client.updateAgent('agent-hermes', { status: 'active' })).status).toBe('idle')
  })

  it('changes the budget and tells panels that costs changed too', async () => {
    const client = fast()
    const seen = []
    client.subscribe((event) => seen.push(event.topic))
    expect((await client.updateAgent('agent-hermes', { budgetMonthlyCents: 250 })).budgetMonthlyCents).toBe(250)
    expect(seen).toEqual(['agents', 'costs'])
  })

  it('tells panels only that agents changed for other settings', async () => {
    const client = fast()
    const seen = []
    client.subscribe((event) => seen.push(event.topic))
    await client.updateAgent('agent-hermes', { model: 'm' })
    expect(seen).toEqual(['agents'])
  })

  it('sends a notice for a hire and for its approval', async () => {
    const client = fast()
    const seen = []
    client.subscribe((event) => seen.push(event.topic))
    await client.hireAgent(planner)
    expect(seen).toEqual(['approvals', 'agents'])
  })

  it('refuses unknown agents, waiting and terminated agents, and nonsense', async () => {
    const client = fast()
    await expect(client.updateAgent('agent-ghost', { model: 'm' })).rejects.toThrow('That agent no longer exists.')
    const { agent, approval } = await client.hireAgent(planner)
    await expect(client.updateAgent(agent.id, { model: 'm' })).rejects.toThrow('Approve the hire first.')
    await client.decideApproval(approval.id, 'reject')
    await expect(client.updateAgent(agent.id, { model: 'm' })).rejects.toThrow('That agent was terminated.')
    await expect(client.updateAgent('agent-hermes', {})).rejects.toThrow('Change at least one setting.')
    await expect(client.updateAgent('agent-hermes', { adapterType: 'process' })).rejects.toThrow('The harness cannot be changed. Hire a new agent.')
    await expect(client.updateAgent('agent-hermes', { reportsToAgentId: 'agent-hermes' })).rejects.toThrow('An agent cannot report to itself.')
    await expect(client.updateAgent('agent-hermes', { reportsToAgentId: 'agent-ghost' })).rejects.toThrow('The agent it reports to no longer exists.')
    await expect(client.updateAgent('agent-hermes', { name: 'agy' })).rejects.toThrow('An agent with that name already exists.')
  })

  it('does not change anything when part of a patch is refused', async () => {
    const client = fast()
    await expect(client.updateAgent('agent-hermes', { model: 'm', timeoutSec: 1 })).rejects.toThrow(/10 to 7200/)
    expect((await byKey(client, 'hermes')).model).toBeNull()
  })

  it('can rename an agent without changing its key', async () => {
    const client = fast()
    const agent = await client.updateAgent('agent-hermes', { name: 'Hermes Prime' })
    expect(agent).toMatchObject({ key: 'hermes', name: 'Hermes Prime' })
  })

  it('can be told to fail once like every other method', async () => {
    const client = fast()
    client.failNext('hireAgent', 'Paperclip is not reachable.')
    await expect(client.hireAgent(planner)).rejects.toThrow('Paperclip is not reachable.')
    await expect(client.hireAgent(planner)).resolves.toBeTruthy()
    client.failNext('updateAgent', 'Paperclip is not reachable.')
    await expect(client.updateAgent('agent-hermes', { model: 'm' })).rejects.toThrow('Paperclip is not reachable.')
  })
})
