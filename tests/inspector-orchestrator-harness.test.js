import { describe, expect, it } from 'vitest'
import { agentContext } from '../src/ui/agentContext.js'

const orchestrator = {
  id: 'agent-orchestrator',
  key: 'orchestrator',
  name: 'Orchestrator',
  harness: 'claude',
  model: 'opus',
  status: 'idle',
}

function inspector(orchestratorRow) {
  return agentContext({
    agent: 'orchestrator',
    lanes: [orchestrator],
    costs: null,
    liveRuns: [],
    tasks: [],
    log: [],
    orchestrator: orchestratorRow,
  })
}

describe('the orchestrator harness and model in the inspector', () => {
  it('shows the live harness and Harness default for an empty live model', () => {
    const result = inspector({ id: 'orchestrator', harness: 'opencode', model: '' })

    expect(result.isOrchestrator).toBe(true)
    expect(result.harness).toBe('opencode')
    expect(result.model).toBe('Harness default')
  })

  it('shows the live model name', () => {
    const result = inspector({ id: 'orchestrator', harness: 'claude', model: 'claude-opus-5-5' })

    expect(result.harness).toBe('claude')
    expect(result.model).toBe('claude-opus-5-5')
  })

  it('keeps the lane harness and model when the live row gives no harness and no string model', () => {
    const result = inspector({ id: 'orchestrator', harness: '', model: null })

    expect(result.harness).toBe('claude')
    expect(result.model).toBe('opus')
  })

  it('keeps a lane harness and model when its name holds orchestrator', () => {
    const lane = {
      id: 'agent-codex-helper',
      key: 'codex-helper',
      name: 'Codex orchestrator helper',
      harness: 'codex',
      model: 'gpt-5-codex',
      status: 'idle',
    }
    const result = agentContext({
      agent: 'codex-helper',
      lanes: [orchestrator, lane],
      orchestrator: { id: 'orchestrator', harness: 'claude', model: 'opus' },
    })

    expect(result.harness).toBe('codex')
    expect(result.model).toBe('gpt-5-codex')
  })

  it('keeps a sub harness when its name holds orchestrator', () => {
    const sub = {
      id: 'sub-ui',
      key: 'sub-ui',
      name: 'UI orchestrator',
      harness: 'codex',
      model: 'gpt-5',
      status: 'idle',
    }
    const result = agentContext({
      agent: 'sub-ui',
      lanes: [orchestrator, sub],
      orchestrator: { id: 'orchestrator', harness: 'claude', model: 'opus' },
    })

    expect(result.harness).toBe('codex')
    expect(result.model).toBe('gpt-5')
  })

  it('shows the live harness and model for Main by its id', () => {
    const result = agentContext({
      agent: 'agent-orchestrator',
      lanes: [orchestrator],
      orchestrator: { id: 'orchestrator', harness: 'opencode', model: 'deepseek-v4.1' },
    })

    expect(result.harness).toBe('opencode')
    expect(result.model).toBe('deepseek-v4.1')
  })
})
