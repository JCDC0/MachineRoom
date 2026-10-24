import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { profileFromBrief } from '../src/policy/profile.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { agentForLane, routeFields } from '../src/ui/panels/route.js'

const SAMPLE_AGENTS = [
  { id: 'agent-claude', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer' },
  { id: 'agent-hermes', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer' },
  { id: 'agent-opencode', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer' },
  { id: 'agent-agy', name: 'agy', adapterType: 'process', role: 'designer' },
  { id: 'agent-worker', name: 'Worker', adapterType: 'process', role: 'engineer' },
]

const SAMPLE_MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon (Medium)', harness: 'agy', tier: 'large', free: false },
]

const SAMPLE_BRIEFS = [
  { id: 'B6', title: 'Late join replay', owners: ['opencode'] },
  { id: 'C3e', title: 'HUD polish', owners: ['agy'] },
  { id: 'P5', title: 'Recover cut and redacted tool lines', owners: ['hermes'] },
]

describe('agentForLane', () => {
  it('maps hermes to hermes_local', () => {
    const agent = agentForLane('hermes', SAMPLE_AGENTS)
    expect(agent).toEqual(SAMPLE_AGENTS[1])
    expect(agent?.adapterType).toBe('hermes_local')
  })

  it('maps opencode to opencode_local', () => {
    const agent = agentForLane('opencode', SAMPLE_AGENTS)
    expect(agent).toEqual(SAMPLE_AGENTS[2])
    expect(agent?.adapterType).toBe('opencode_local')
  })

  it('maps opencode2 to the OpenCode agent', () => {
    const agent = agentForLane('opencode2', SAMPLE_AGENTS)
    expect(agent).toEqual(SAMPLE_AGENTS[2])
    expect(agent?.adapterType).toBe('opencode_local')
    expect(agentForLane('opencode3', SAMPLE_AGENTS)).toEqual(SAMPLE_AGENTS[2])
    expect(agentForLane('opencodex', SAMPLE_AGENTS)).toBeNull()
  })

  it('maps agy to a process agent named agy', () => {
    const agent = agentForLane('agy', SAMPLE_AGENTS)
    expect(agent).toEqual(SAMPLE_AGENTS[3])
    expect(agent?.adapterType).toBe('process')
    expect(agent?.name).toBe('agy')
  })

  it('ignores a process agent whose name is not agy', () => {
    const agentsWithoutAgy = [SAMPLE_AGENTS[0], SAMPLE_AGENTS[4]]
    expect(agentForLane('agy', agentsWithoutAgy)).toBeNull()
  })

  it('returns null when no agent runs the lane', () => {
    expect(agentForLane('hermes', [SAMPLE_AGENTS[0]])).toBeNull()
    expect(agentForLane('opencode', [SAMPLE_AGENTS[0]])).toBeNull()
    expect(agentForLane('agy', [SAMPLE_AGENTS[0]])).toBeNull()
  })

  it('maps claude to claude_local and leaves an unmapped lane null', () => {
    expect(agentForLane('claude', SAMPLE_AGENTS)).toEqual(SAMPLE_AGENTS[0])
    expect(agentForLane('owner', SAMPLE_AGENTS)).toBeNull()
    expect(agentForLane('unknown', SAMPLE_AGENTS)).toBeNull()
    expect(agentForLane('', SAMPLE_AGENTS)).toBeNull()
    expect(agentForLane(null, SAMPLE_AGENTS)).toBeNull()
    expect(agentForLane('hermes', null)).toBeNull()
    expect(agentForLane('hermes', undefined)).toBeNull()
  })
})

describe('small brief route from the mock policy', () => {
  it('routes a small brief to opencode2', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const brief = {
      id: 'C4f',
      owners: ['opencode2'],
      text: 'Change `docs/agents/policy.json` and `tests/policy.test.js`. Files: `docs/agents/policy.json`, `tests/policy.test.js`. Tests in `tests/policy.test.js`.',
    }
    const route = await client.suggestRoute(profileFromBrief(brief))
    expect(route.tier).toBe('small')
    expect(route.choice.lane).toBe('opencode2')
    expect(route.choice.model).toBe('opencode-go/deepseek-v4.1-flash')
    expect(route.choice.reasoning).toBe('max')
  })
})

describe('routeFields', () => {
  it('returns missing agent note when no agent runs the lane', () => {
    const choice = {
      lane: 'hermes',
      model: 'xiaomi/mimo-v2.6-pro',
      reasoning: 'high',
      provider: 'openrouter',
    }
    const result = routeFields(choice, [SAMPLE_AGENTS[0], SAMPLE_AGENTS[2]], SAMPLE_MODELS)
    expect(result).toEqual({
      agentId: null,
      model: null,
      note: 'The hermes lane is not in docs/agents/lanes.json.',
    })
  })

  it('returns unlisted model note when the agent does not list the model', () => {
    const choice = {
      lane: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      reasoning: 'max',
      provider: 'opencode',
    }
    const result = routeFields(choice, SAMPLE_AGENTS, SAMPLE_MODELS)
    expect(result).toEqual({
      agentId: 'agent-opencode',
      model: '',
      note: 'This agent does not list opencode-go/deepseek-v4.1-flash, so its default model stays.',
    })
  })

  it('returns agent and model with no note when the agent lists the model', () => {
    const choice = {
      lane: 'opencode',
      model: 'opencode-go/qwen3.8-flash',
      reasoning: 'medium',
      provider: 'opencode',
    }
    const result = routeFields(choice, SAMPLE_AGENTS, SAMPLE_MODELS)
    expect(result).toEqual({
      agentId: 'agent-opencode',
      model: 'opencode-go/qwen3.8-flash',
      note: null,
    })
  })

  it('answers nulls and no note for the owner choice', () => {
    const choice = {
      lane: 'owner',
      model: null,
      reasoning: null,
      provider: null,
    }
    const result = routeFields(choice, SAMPLE_AGENTS, SAMPLE_MODELS)
    expect(result).toEqual({
      agentId: null,
      model: null,
      note: null,
    })
  })

  it('answers nulls for null or invalid choice', () => {
    expect(routeFields(null, SAMPLE_AGENTS, SAMPLE_MODELS)).toEqual({
      agentId: null,
      model: null,
      note: null,
    })
    expect(routeFields(undefined, SAMPLE_AGENTS, SAMPLE_MODELS)).toEqual({
      agentId: null,
      model: null,
      note: null,
    })
  })
})

describe('DispatchPanel Route row rendering with mock client', () => {
  it('renders without Route row when no brief is chosen', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
      })
    )
    expect(html).not.toContain('dispatch-route-row')
    expect(html).not.toContain('Reading the policy.')
  })

  it('renders Reading the policy while waiting for route', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteLoading: true,
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('Reading the policy.')
  })

  it('renders the reason with a Use button for an agent choice', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteAnswer: {
          tier: 'medium',
          choice: { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
          reason: 'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.',
        },
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.')
    expect(html).toContain('dispatch-route-use-btn')
    expect(html).toContain('Use</button>')
  })

  it('renders the reason alone without Use button when choice.lane is owner', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteAnswer: {
          tier: 'large',
          choice: { lane: 'owner', model: null, reasoning: null, provider: null },
          reason: 'The large tier asks the owner.',
        },
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('The large tier asks the owner.')
    expect(html).not.toContain('dispatch-route-use-btn')
  })

  it('renders error sentence in red when choice is null', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteAnswer: {
          tier: 'large',
          choice: null,
          reason: 'Every choice for the large tier is above its quota.',
        },
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('dispatch-route-error')
    expect(html).toContain('Every choice for the large tier is above its quota.')
    expect(html).not.toContain('dispatch-route-use-btn')
  })

  it('renders call error sentence in red when route suggestion fails', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteError: 'The policy file is missing.',
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('dispatch-route-error')
    expect(html).toContain('The policy file is missing.')
    expect(html).not.toContain('dispatch-route-use-btn')
  })

  it('renders routeNote when set', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: SAMPLE_AGENTS,
        initialModels: SAMPLE_MODELS,
        initialBriefs: SAMPLE_BRIEFS,
        initialSelectedBriefId: 'B6',
        initialRouteAnswer: {
          tier: 'large',
          choice: { lane: 'agy', model: 'Gemini 4 Argon (Medium)', reasoning: 'medium', provider: 'antigravity' },
          reason: 'The large tier runs agy on Gemini 4 Argon (Medium) at medium.',
        },
        initialRouteNote: 'This agent does not list Gemini 4 Argon (Medium), so its default model stays.',
      })
    )
    expect(html).toContain('dispatch-route-row')
    expect(html).toContain('dispatch-route-note')
    expect(html).toContain('This agent does not list Gemini 4 Argon (Medium), so its default model stays.')
  })
})
