import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AgentDock from '../src/ui/AgentDock.jsx'
import Hud from '../src/ui/Hud.jsx'
import { agentContext } from '../src/ui/agentContext.js'

const lane = {
  id: 'agent-opencode',
  key: 'opencode',
  name: 'OpenCode',
  adapterType: 'opencode_local',
  harness: 'opencode',
  model: 'opencode-go/deepseek-v4.1-flash',
  status: 'idle',
}

const orchestrator = {
  id: 'agent-orchestrator',
  key: 'orchestrator',
  name: 'Orchestrator',
  adapterType: 'claude_local',
  harness: 'claude',
  model: 'opus',
  status: 'idle',
}

function board(rows) {
  return {
    summary: { spendCents: 1234, budgetCents: 0, percent: null, over: false },
    rows,
    quota: [],
  }
}

const costRow = {
  key: 'opencode',
  agentId: 'agent-opencode',
  name: 'OpenCode',
  costCents: 1234,
  inputTokens: 1200,
  outputTokens: 300,
  reported: true,
  share: 1,
}

describe('agentContext', () => {
  it('an idle lane', () => {
    const result = agentContext({
      agent: lane,
      lanes: [lane, orchestrator],
      costs: board([costRow]),
      liveRuns: [],
      tasks: [],
      log: [],
    })

    expect(result.isOrchestrator).toBe(false)
    expect(result.key).toBe('opencode')
    expect(result.name).toBe('OpenCode')
    expect(result.harness).toBe('opencode')
    expect(result.model).toBe('opencode-go/deepseek-v4.1-flash')
    expect(result.status).toBe('idle')
    expect(result.task).toBe('none')
    expect(result.command).toBe('none')
    expect(result.cost).toBe('$12.34')
    expect(result.tokens).toBe('1.2k in / 300 out')
    expect(result.context).toBeNull()
    expect(result.log).toEqual([])
  })

  it('a working lane with a task', () => {
    const task = { id: 'opencode-I2-20261024-120000', identifier: 'I2' }
    const result = agentContext({
      agent: lane,
      lanes: [lane, orchestrator],
      costs: board([costRow]),
      liveRuns: [
        { runId: 'run-I2', agentId: 'agent-opencode', agentName: 'OpenCode', status: 'running', issueId: task.id },
      ],
      tasks: [task],
      log: [
        { agent: 'Orchestrator', text: 'started a turn', tone: 'dim' },
        { agent: 'OpenCode', text: 'read src/ui/Hud.jsx', tone: 'normal' },
        { agent: 'opencode', text: 'npm test', tone: 'normal' },
      ],
    })

    expect(result.status).toBe('working')
    expect(result.task).toBe('I2')
    expect(result.command).toBe('npm test')
    expect(result.log.map((line) => line.text)).toEqual(['read src/ui/Hud.jsx', 'npm test'])
  })

  it('a room lane without an id takes its task from its run', () => {
    const roomLane = { key: 'opencode', name: 'OpenCode', status: 'working', runs: 1 }
    const result = agentContext({
      agent: roomLane,
      lanes: [roomLane],
      costs: board([costRow]),
      liveRuns: [
        {
          runId: 'run-JC-19',
          agentId: 'agent-opencode',
          agentName: 'OpenCode',
          status: 'running',
          issueId: 'issue-19',
        },
      ],
      tasks: [{ id: 'issue-19', identifier: 'JC-19' }],
      log: [],
    })

    expect(result.status).toBe('working')
    expect(result.cost).toBe('$12.34')
    expect(result.tokens).toBe('1.2k in / 300 out')
    expect(result.task).toBe('JC-19')
  })

  it('a lane with no cost row', () => {
    const result = agentContext({
      agent: lane,
      lanes: [lane],
      costs: board([]),
      liveRuns: [],
      tasks: [],
      log: [],
    })

    expect(result.cost).toBe('not reported')
    expect(result.tokens).toBe('not reported')
    expect(result.costCents).toBeNull()
    expect(result.inputTokens).toBeNull()
    expect(result.outputTokens).toBeNull()
  })

  it('the orchestrator with context data', () => {
    const withContext = {
      ...orchestrator,
      status: 'working',
      contextTokens: 120000,
      contextWindow: 200000,
    }
    const result = agentContext({
      agent: null,
      lanes: [lane, withContext],
      costs: board([]),
      liveRuns: [],
      tasks: [],
      log: [],
    })

    expect(result.isOrchestrator).toBe(true)
    expect(result.key).toBe('orchestrator')
    expect(result.name).toBe('Orchestrator')
    expect(result.harness).toBe('claude')
    expect(result.model).toBe('opus')
    expect(result.status).toBe('working')
    expect(result.context).toEqual({
      tokens: 120000,
      window: 200000,
      share: 0.6,
      percent: 60,
      label: '60%',
    })
  })

  it('the orchestrator without context data', () => {
    const result = agentContext({
      agent: null,
      lanes: [lane, orchestrator],
      costs: board([]),
      liveRuns: [],
      tasks: [],
      log: [],
    })

    expect(result.isOrchestrator).toBe(true)
    expect(result.context).toBeNull()
  })

  it('the orchestrator with context and autocompact from the chat route', () => {
    const result = agentContext({
      agent: null,
      lanes: [lane, orchestrator],
      costs: board([]),
      liveRuns: [],
      tasks: [],
      log: [],
      orchestrator: { id: 'orchestrator', contextTokens: 170000, contextWindow: 200000, autocompact: false },
    })

    expect(result.isOrchestrator).toBe(true)
    expect(result.context).toEqual({
      tokens: 170000,
      window: 200000,
      share: 0.85,
      percent: 85,
      label: '85%',
    })
    expect(result.autocompact).toBe(false)
  })

  it('the log cut to 12 lines', () => {
    const log = []
    for (let index = 1; index <= 20; index += 1) {
      log.push({ agent: 'OpenCode', text: `line ${index}`, tone: 'normal' })
    }
    log.splice(10, 0, { agent: 'Orchestrator', text: 'other agent', tone: 'normal' })

    const result = agentContext({
      agent: lane,
      lanes: [lane],
      costs: board([costRow]),
      liveRuns: [],
      tasks: [],
      log,
    })

    expect(result.log).toHaveLength(12)
    expect(result.log[0].text).toBe('line 9')
    expect(result.log[11].text).toBe('line 20')
    expect(result.command).toBe('line 20')
  })
})

describe('AgentDock', () => {
  it('draws the orchestrator rows with Open chat', () => {
    const withContext = { ...orchestrator, contextTokens: 120000, contextWindow: 200000 }
    const html = renderToString(
      createElement(AgentDock, {
        agent: null,
        lanes: [lane, withContext],
        costs: board([]),
        liveRuns: [],
        tasks: [],
        log: [],
      })
    )

    expect(html).toContain('Orchestrator')
    expect(html).toContain('Focus')
    expect(html).toContain('Log')
    expect(html).toContain('Open chat')
    expect(html).toContain('60% of 200000 tokens')
  })

  it('draws the Autocompact switch for the orchestrator', () => {
    const html = renderToString(
      createElement(AgentDock, {
        agent: null,
        lanes: [lane, orchestrator],
        costs: board([]),
        liveRuns: [],
        tasks: [],
        log: [],
        orchestrator: { id: 'orchestrator', contextTokens: 170000, contextWindow: 200000, autocompact: true },
      })
    )

    expect(html).toContain('Autocompact')
    expect(html).toContain('85% of 200000 tokens')
    expect(html).toContain('role="switch"')
    expect(html).toContain('checked')
  })

  it('leaves Open chat off a lane', () => {
    const html = renderToString(
      createElement(AgentDock, {
        agent: lane,
        lanes: [lane, orchestrator],
        costs: board([costRow]),
        liveRuns: [],
        tasks: [],
        log: [],
      })
    )

    expect(html).toContain('OpenCode')
    expect(html).toContain('Status')
    expect(html).toContain('$12.34')
    expect(html).toContain('Focus')
    expect(html).not.toContain('Open chat')
    expect(html).not.toContain('Autocompact')
  })
})

describe('Hud dock', () => {
  it('gives the selected lane its cost, tokens and task', () => {
    const roomLane = { key: 'opencode', name: 'OpenCode', status: 'working', runs: 1 }
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        snapshot: {
          position: 0,
          duration: 60,
          playing: false,
          speed: 1,
          agents: [roomLane],
          log: [],
        },
        speeds: [1, 2, 4],
        focused: 'opencode',
        costs: board([costRow]),
        liveRuns: [
          {
            runId: 'run-JC-19',
            agentId: 'agent-opencode',
            agentName: 'OpenCode',
            status: 'running',
            issueId: 'issue-19',
          },
        ],
        tasks: [{ id: 'issue-19', identifier: 'JC-19' }],
        log: [],
      })
    )

    expect(html).toContain('$12.34')
    expect(html).toContain('1.2k in / 300 out')
    expect(html).toContain('JC-19')
  })
})
