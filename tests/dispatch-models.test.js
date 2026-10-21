import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODELS } from '../server/models.js'
import { createMockClient } from '../src/control/mock.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import {
  ADAPTER_TO_HARNESS,
  defaultModelLabel,
  modelFits,
  modelsFor,
  resetModel,
} from '../src/ui/panels/dispatchModels.js'

const SAMPLE_MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', harness: 'agy', tier: 'small', free: false },
]

describe('ADAPTER_TO_HARNESS', () => {
  it('maps each adapter type to its harness', () => {
    expect(ADAPTER_TO_HARNESS.claude_local).toBe('claude')
    expect(ADAPTER_TO_HARNESS.hermes_local).toBe('hermes')
    expect(ADAPTER_TO_HARNESS.opencode_local).toBe('opencode')
    expect(ADAPTER_TO_HARNESS.process).toBe('agy')
  })
})

describe('defaultModelLabel', () => {
  it('returns Default model when no agent is chosen', () => {
    expect(defaultModelLabel(null)).toBe('Default model')
    expect(defaultModelLabel(undefined)).toBe('Default model')
    expect(defaultModelLabel('')).toBe('Default model')
    expect(defaultModelLabel('   ')).toBe('Default model')
  })

  it('shows Default model (MODEL) when the agent has a model', () => {
    expect(defaultModelLabel({ model: 'claude-haiku-5-5' })).toBe('Default model (claude-haiku-5-5)')
    expect(defaultModelLabel({ model: 'Gemini 3.8 Flash (High)' })).toBe('Default model (Gemini 3.8 Flash (High))')
  })

  it('shows Default model (set in the harness) when the agent has none', () => {
    expect(defaultModelLabel({ model: null })).toBe('Default model (set in the harness)')
    expect(defaultModelLabel({ model: '' })).toBe('Default model (set in the harness)')
    expect(defaultModelLabel({ model: '   ' })).toBe('Default model (set in the harness)')
    expect(defaultModelLabel({})).toBe('Default model (set in the harness)')
  })
})

describe('modelsFor', () => {
  it('lists only Default model when no agent is chosen', () => {
    const listNull = modelsFor(null, SAMPLE_MODELS)
    expect(listNull).toEqual([{ id: '', label: 'Default model' }])

    const listUndefined = modelsFor(undefined, SAMPLE_MODELS)
    expect(listUndefined).toEqual([{ id: '', label: 'Default model' }])

    const listEmptyString = modelsFor('', SAMPLE_MODELS)
    expect(listEmptyString).toEqual([{ id: '', label: 'Default model' }])

    const listWhitespace = modelsFor('   ', SAMPLE_MODELS)
    expect(listWhitespace).toEqual([{ id: '', label: 'Default model' }])
  })

  it('offers the models the Hermes and OpenCode lanes run, each to its own harness only', () => {
    const hermes = modelsFor({ adapterType: 'hermes_local', model: null }, MODELS).map((item) => item.id)
    const opencode = modelsFor({ adapterType: 'opencode_local', model: null }, MODELS).map((item) => item.id)
    expect(hermes).toEqual(['', 'xiaomi/mimo-v2.6-pro', 'deepseek/deepseek-v4.1-flash-1017'])
    expect(opencode).toContain('opencode-go/deepseek-v4.1-flash')
    expect(opencode).not.toContain('deepseek/deepseek-v4.1-flash-1017')
    expect(hermes).not.toContain('opencode-go/deepseek-v4.1-flash')
  })

  it('lists only claude models for claude_local', () => {
    const agent = { adapterType: 'claude_local', model: 'claude-haiku-5-5' }
    const list = modelsFor(agent, SAMPLE_MODELS)
    expect(list[0]).toEqual({ id: '', label: 'Default model (claude-haiku-5-5)' })
    const rest = list.slice(1)
    expect(rest.length).toBe(3)
    expect(rest.every((item) => item.harness === 'claude')).toBe(true)
    expect(rest.map((item) => item.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
  })

  it('lists only hermes models for hermes_local', () => {
    const agent = { adapterType: 'hermes_local', model: null }
    const list = modelsFor(agent, SAMPLE_MODELS)
    expect(list[0]).toEqual({ id: '', label: 'Default model (set in the harness)' })
    const rest = list.slice(1)
    expect(rest.length).toBe(1)
    expect(rest[0].id).toBe('xiaomi/mimo-v2.6-pro')
    expect(rest[0].harness).toBe('hermes')
  })

  it('lists only opencode models for opencode_local', () => {
    const agent = { adapterType: 'opencode_local', model: 'opencode-go/qwen3.8-flash' }
    const list = modelsFor(agent, SAMPLE_MODELS)
    expect(list[0]).toEqual({ id: '', label: 'Default model (opencode-go/qwen3.8-flash)' })
    const rest = list.slice(1)
    expect(rest.length).toBe(2)
    expect(rest.every((item) => item.harness === 'opencode')).toBe(true)
  })

  it('lists only agy models for process', () => {
    const agent = { adapterType: 'process', model: null }
    const list = modelsFor(agent, SAMPLE_MODELS)
    expect(list[0]).toEqual({ id: '', label: 'Default model (set in the harness)' })
    const rest = list.slice(1)
    expect(rest.length).toBe(1)
    expect(rest[0].id).toBe('gemini-3.8-flash')
    expect(rest[0].harness).toBe('agy')
  })

  it('lists only the default model for an unknown adapter', () => {
    const unknownWithModel = { adapterType: 'docker_local', model: 'my-custom-model' }
    expect(modelsFor(unknownWithModel, SAMPLE_MODELS)).toEqual([
      { id: '', label: 'Default model (my-custom-model)' },
    ])

    const unknownWithoutModel = { adapterType: 'docker_local', model: null }
    expect(modelsFor(unknownWithoutModel, SAMPLE_MODELS)).toEqual([
      { id: '', label: 'Default model (set in the harness)' },
    ])
  })

  it('handles string adapter names and empty options safely', () => {
    expect(modelsFor('claude_local', SAMPLE_MODELS)[0]).toEqual({
      id: '',
      label: 'Default model (set in the harness)',
    })
    expect(modelsFor({ adapterType: 'claude_local' }, [])).toEqual([
      { id: '', label: 'Default model (set in the harness)' },
    ])
    expect(modelsFor({ adapterType: 'claude_local' }, null)).toEqual([
      { id: '', label: 'Default model (set in the harness)' },
    ])
  })
})

describe('resetModel and modelFits', () => {
  const claudeAgent = { id: 'agent-claude', adapterType: 'claude_local', model: 'claude-haiku-5-5' }
  const hermesAgent = { id: 'agent-hermes', adapterType: 'hermes_local', model: null }
  const opencodeAgent = { id: 'agent-opencode', adapterType: 'opencode_local', model: null }

  it('keeps the model when it fits the chosen agent', () => {
    expect(modelFits(claudeAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe(true)
    expect(resetModel(claudeAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe('claude-sonnet-5-5')
  })

  it('resets to default model when the chosen agent changes and the model no longer fits', () => {
    expect(modelFits(hermesAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe(false)
    expect(resetModel(hermesAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe('')

    expect(modelFits(opencodeAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe(false)
    expect(resetModel(opencodeAgent, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe('')
  })

  it('resets to default model when switching to no agent chosen or unknown adapter', () => {
    expect(resetModel(null, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe('')
    expect(resetModel({ adapterType: 'unknown' }, 'claude-sonnet-5-5', SAMPLE_MODELS)).toBe('')
  })

  it('keeps empty model as default model', () => {
    expect(modelFits(hermesAgent, '', SAMPLE_MODELS)).toBe(true)
    expect(resetModel(hermesAgent, '', SAMPLE_MODELS)).toBe('')
    expect(resetModel(null, '', SAMPLE_MODELS)).toBe('')
  })
})

describe('DispatchPanel model rendering', () => {
  const agents = [
    { id: 'agent-claude', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer', model: 'claude-haiku-5-5' },
    { id: 'agent-hermes', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer', model: null },
    { id: 'agent-opencode', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer', model: 'opencode-go/qwen3.8-flash' },
    { id: 'agent-agy', name: 'agy', adapterType: 'process', role: 'designer', model: null },
    { id: 'agent-unknown', name: 'Custom Runner', adapterType: 'docker_local', role: 'devops', model: null },
  ]

  it('renders Loading dispatch options when client is loading', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(createElement(DispatchPanel, { client }))
    expect(html).toContain('Loading dispatch options...')
  })

  it('renders only Default model when no agent is selected', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS,
      })
    )
    expect(html).toContain('id="dispatch-model"')
    expect(html).toContain('Default model')
    expect(html).not.toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('MiMo v2.6 Pro')
  })

  it('renders only hermes models and harness default label when Hermes is selected', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS,
        initialAssigneeAgentId: 'agent-hermes',
      })
    )
    expect(html).toContain('Default model (set in the harness)')
    expect(html).toContain('MiMo v2.6 Pro')
    expect(html).not.toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('DeepSeek v4.1 Flash')
  })

  it('renders only claude models and agent model default label when Claude Code is selected', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS,
        initialAssigneeAgentId: 'agent-claude',
      })
    )
    expect(html).toContain('Default model (claude-haiku-5-5)')
    expect(html).toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('MiMo v2.6 Pro')
    expect(html).not.toContain('DeepSeek v4.1 Flash')
  })

  it('renders only opencode models and agent model default label when OpenCode Go is selected', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS,
        initialAssigneeAgentId: 'agent-opencode',
      })
    )
    expect(html).toContain('Default model (opencode-go/qwen3.8-flash)')
    expect(html).toContain('DeepSeek v4.1 Flash')
    expect(html).toContain('Qwen 3.8 Flash')
    expect(html).not.toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('MiMo v2.6 Pro')
  })

  it('renders only default model for agy when no agy models exist', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS.filter((m) => m.harness !== 'agy'),
        initialAssigneeAgentId: 'agent-agy',
      })
    )
    expect(html).toContain('Default model (set in the harness)')
    expect(html).not.toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('MiMo v2.6 Pro')
  })

  it('renders only default model for an unknown adapter in DispatchPanel', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(DispatchPanel, {
        client,
        initialAgents: agents,
        initialModels: SAMPLE_MODELS,
        initialAssigneeAgentId: 'agent-unknown',
      })
    )
    expect(html).toContain('Default model (set in the harness)')
    expect(html).not.toContain('Claude Sonnet 5.5')
    expect(html).not.toContain('MiMo v2.6 Pro')
  })
})
