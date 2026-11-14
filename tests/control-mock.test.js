import { describe, expect, it } from 'vitest'
import { AGENT_REFUSAL, CLIENT_METHODS, LANE_TASK_REFUSAL, createMockClient } from '../src/control/mock.js'
import { TIERS } from '../src/policy/route.js'

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
      for (const key of [
        'id',
        'key',
        'name',
        'adapterType',
        'role',
        'status',
        'budgetMonthlyCents',
        'spentMonthlyCents',
        'reasoningEffort',
        'maxTurnsPerRun',
        'timeoutSec',
        'subagentsAllowed',
        'subagentDepth',
        'instructions',
        'reportsToAgentId',
      ]) {
        expect(agent, `${agent.name} ${key}`).toHaveProperty(key)
      }
    }
  })

  it('filters issues by status', async () => {
    const todo = await fast().issues({ status: 'todo' })
    expect(todo.length).toBeGreaterThan(0)
    expect(todo.every((issue) => issue.status === 'todo')).toBe(true)
  })

  it('refuses to post a comment with the bridge refusal', async () => {
    const client = fast()
    await expect(client.postComment('issue-18', 'Looks good.')).rejects.toThrow(LANE_TASK_REFUSAL)
  })

  it('refuses to decide an approval with the bridge refusal', async () => {
    const client = fast()
    await expect(client.decideApproval('approval-1', 'approve')).rejects.toThrow('That approval no longer exists.')
  })

  it('reports lane costs in dollars with no quota windows', async () => {
    const { quota, summary, byAgent } = await fast().costs()
    expect(summary).toEqual({ spendCents: 490, budgetCents: 0, utilizationPercent: 0 })
    expect(byAgent.length).toBeGreaterThan(0)
    expect(quota).toEqual([])
    expect(byAgent.map((item) => item.agentName)).toEqual(['Claude Code', 'OpenCode', 'OpenCode 2', 'OpenCode 3'])
  })

  it('refuses to set an agent budget with the bridge refusal', async () => {
    const client = fast()
    await expect(client.setAgentBudget('agent-claude', 250)).rejects.toThrow(AGENT_REFUSAL)
  })

  it('lists models in tiers and marks the free one', async () => {
    const models = await fast().models()
    expect(new Set(models.map((model) => model.tier))).toEqual(new Set(TIERS))
    expect(models.filter((model) => model.free).map((model) => model.id)).toContain('opencode/deepseek-v4.1-flash-free')
  })

  it('fails the next call once when told to', async () => {
    const client = fast()
    client.failNext('agents', 'The bridge is not answering.')
    await expect(client.agents()).rejects.toThrow('The bridge is not answering.')
    await expect(client.agents()).resolves.toBeTruthy()
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
    expect(list[0].lanes).toEqual(['claude', 'hermes', 'opencode', 'opencode4'])
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

  it('manages active lanes and refuses inactive lane runs in mock', async () => {
    const client = fast()
    const initial = await client.lanes()
    expect(initial.chosen).toBe(false)
    expect(initial.lanes.every((l) => l.active)).toBe(true)

    await client.setActiveLanes({ lanes: ['opencode', 'claude'], confirmed: true })
    const after = await client.lanes()
    expect(after.chosen).toBe(true)
    expect(after.lanes.find((l) => l.key === 'opencode').active).toBe(true)
    expect(after.lanes.find((l) => l.key === 'opencode2').active).toBe(false)

    const agents = await client.agents()
    const agentKeys = agents.map((a) => a.key)
    expect(agentKeys).toContain('opencode')
    expect(agentKeys).toContain('claude')
    expect(agentKeys).not.toContain('opencode2')

    await expect(client.startRun('opencode2', ['B6'])).rejects.toThrow(
      'The lane opencode2 is not active. Add it in Agents first.'
    )
  })

  it('sets orchestrator harness and lists harnesses on orchestrators in mock', async () => {
    const client = fast()
    const list = await client.orchestrators()
    expect(list[0].harnesses.length).toBeGreaterThan(0)
    expect(list[0].harnesses.some((h) => h.key === 'claude')).toBe(true)

    await expect(client.setOrchestratorHarness({ harness: 'opencode', model: 'opencode-go/qwen3.8-flash', confirmed: false })).rejects.toThrow(
      'Confirm the harness change first.'
    )
    await expect(client.setOrchestratorHarness({ harness: 'missing-harness', model: 'opencode-go/qwen3.8-flash', confirmed: true })).rejects.toThrow(
      'The harness missing-harness is not available on this computer.'
    )
    await expect(client.setOrchestratorHarness({ harness: 'opencode', model: 'claude-opus-5-5', confirmed: true })).rejects.toThrow(
      'The model claude-opus-5-5 is not available for opencode.'
    )

    const updated = await client.setOrchestratorHarness({ harness: 'opencode', model: 'opencode-go/qwen3.8-flash', confirmed: true })
    expect(updated).toMatchObject({
      id: 'orchestrator',
      harness: 'opencode',
      model: 'opencode-go/qwen3.8-flash',
      contextWindow: 200000,
      mode: 'auto',
    })

    const updatedList = await client.orchestrators()
    expect(updatedList[0].harness).toBe('opencode')
    expect(updatedList[0].model).toBe('opencode-go/qwen3.8-flash')
  })

  it('sets an orchestrator mode and lists the modes its harness offers', async () => {
    const client = fast()
    const main = await client.orchestrator()
    expect(main.mode).toBe('bypass')
    expect(main.modes.map((mode) => mode.id)).toEqual(['plan', 'ask', 'edits', 'auto', 'bypass'])
    expect((await client.orchestrator('frontend')).mode).toBe('auto')
    expect((await client.orchestrator('frontend')).modes.map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto'])

    await expect(client.setOrchestratorMode({ mode: 'plan', confirmed: false })).rejects.toThrow('Confirm the mode change first.')
    await expect(client.setOrchestratorMode({ mode: 'bogus', confirmed: true })).rejects.toThrow(
      'Choose a permission mode listed for this harness.'
    )
    const asked = await client.setOrchestratorMode({ mode: 'ask', confirmed: true })
    expect(asked).toMatchObject({ id: 'orchestrator', mode: 'ask' })
    const saved = await client.setOrchestratorMode({ mode: 'plan', confirmed: true })
    expect(saved).toMatchObject({ id: 'orchestrator', mode: 'plan' })
    expect((await client.orchestrator()).mode).toBe('plan')
    expect((await client.orchestrators())[0].mode).toBe('plan')
  })

  it('answers gitState with changes and changeCount', async () => {
    const state = await fast().gitState()
    expect(state.git).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.changes).toEqual([])
    expect(state.changeCount).toBe(0)
  })
})

describe('mock check command', () => {
  it('counts commands split by carriage returns and refuses five', async () => {
    const client = fast()
    expect(await client.saveProjectSettings({ checkCommand: 'npm test\rnpm run check' })).toEqual({
      checkCommand: 'npm test\rnpm run check',
      hasTestScript: true,
    })
    await expect(client.saveProjectSettings({ checkCommand: 'one\rtwo\rthree\rfour\rfive' }))
      .rejects.toThrow('A check holds at most 4 commands, one per line.')
  })
})
