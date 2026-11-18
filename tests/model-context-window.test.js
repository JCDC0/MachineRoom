import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEndpointsApi, readEndpoints, saveEndpoints } from '../server/endpoints.js'
import { resolveContextWindow } from '../server/model-list.js'
import { createOrchestrator } from '../server/orchestrator.js'
import { createOrchestrators } from '../server/orchestrators.js'
import { claudeContextWindow } from '../src/harnesses/claude.js'
import { contextLine } from '../src/ui/agentStrip.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

describe('resolveContextWindow', () => {
  it('gives DeepSeek on OpenRouter the saved contextLength of 1048576', () => {
    const details = [
      {
        name: 'OpenRouter',
        modelDetails: [
          { id: 'deepseek/deepseek-v4.1-flash-1017', contextLength: 1048576 },
        ],
      },
    ]
    expect(
      resolveContextWindow('OpenRouter/deepseek/deepseek-v4.1-flash-1017', 'machineroom', 0, details)
    ).toBe(1048576)
    expect(
      resolveContextWindow('deepseek/deepseek-v4.1-flash-1017', 'machineroom', 0, details)
    ).toBe(1048576)
  })

  it('lets the lane own window win over model details and listed models', () => {
    const details = [
      {
        name: 'OpenRouter',
        modelDetails: [
          { id: 'deepseek/deepseek-v4.1-flash-1017', contextLength: 1048576 },
        ],
      },
    ]
    expect(
      resolveContextWindow('OpenRouter/deepseek/deepseek-v4.1-flash-1017', 'machineroom', 64000, details)
    ).toBe(64000)
    expect(
      resolveContextWindow('claude-haiku-5-5', 'claude', 32000, details)
    ).toBe(32000)
  })

  it('shows only tokens when a model has no details', () => {
    expect(resolveContextWindow('unknown/model', 'machineroom', 0, [])).toBe(null)
    expect(contextLine({ context: { tokens: 16500, window: null } })).toBe(
      'Context size 16.5k'
    )
    expect(contextLine({ context: { tokens: 16500, window: 1048576 } })).toBe(
      'Context size 16.5k / 1M'
    )
  })

  it('reads the window from the named endpoint and takes an unnamed suffix only when it is unique', () => {
    const details = [
      { name: 'first', modelDetails: [{ id: 'model', contextLength: 1000000 }] },
      { name: 'second', modelDetails: [{ id: 'model', contextLength: 32000 }] },
    ]
    expect(resolveContextWindow('first/model', 'machineroom', 0, details)).toBe(1000000)
    expect(resolveContextWindow('second/model', 'machineroom', 0, details)).toBe(32000)
    expect(resolveContextWindow('vendor/model', 'machineroom', 0, details)).toBe(null)
    expect(
      resolveContextWindow('vendor/model', 'machineroom', 0, [
        { name: 'only', modelDetails: [{ id: 'model', contextLength: 32000 }] },
      ])
    ).toBe(32000)
  })
})

describe('orchestrator context window and autocompact', () => {
  it('fetches missing details on creation and on model and harness changes', async () => {
    const temp = makeTempDir('mr-test-refresh-window-')
    cleanups.push(() => removeTempDir(temp))
    const endpoint = {
      name: 'test', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
      keyName: 'test', models: ['first', 'second'],
    }
    saveEndpoints(temp, [endpoint])
    const notice = vi.fn()
    const refresh = vi.fn(async (model) => {
      await Promise.resolve()
      const id = model.split('/')[1]
      saveEndpoints(temp, [{ ...endpoint, modelDetails: [{ id, contextLength: id === 'first' ? 100000 : 200000 }] }])
      return true
    })
    const orch = createOrchestrator({
      projectRoot: join(temp, 'project'), runsFolder: temp,
      harness: 'machineroom', model: 'test/first', refreshModelDetails: refresh, onNotice: notice,
    })
    cleanups.push(() => orch.close())

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(orch.answer().contextWindow).toBeNull()
    await vi.waitFor(() => expect(orch.answer().contextWindow).toBe(100000))
    expect(notice).toHaveBeenCalledWith({ topic: 'orchestrator' })
    expect(orch.answer().state).toBe('idle')

    notice.mockClear()
    expect(orch.setModel({ model: 'test/second', confirmed: true }).status).toBe(200)
    expect(refresh).toHaveBeenLastCalledWith('test/second', undefined)
    expect(orch.answer().contextWindow).toBeNull()
    notice.mockClear()
    await vi.waitFor(() => expect(orch.answer().contextWindow).toBe(200000))
    expect(notice).toHaveBeenCalledWith({ topic: 'orchestrator' })

    expect(orch.setHarness({ harness: 'machineroom', model: 'test/first', confirmed: true }).status).toBe(200)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenLastCalledWith('test/first', undefined)
    await vi.waitFor(() => expect(orch.answer().contextWindow).toBe(100000))
  })

  it('reads the context window from endpoints in the runs folder and lets lane window win', () => {
    const temp1 = makeTempDir('mr-test-context-1-')
    cleanups.push(() => removeTempDir(temp1))

    saveEndpoints(temp1, [
      {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['deepseek/deepseek-v4.1-flash-1017'],
        modelDetails: [
          {
            id: 'deepseek/deepseek-v4.1-flash-1017',
            name: 'DeepSeek v4.1 Flash',
            contextLength: 1048576,
          },
        ],
      },
    ])

    const orch = createOrchestrator({
      id: 'orchestrator',
      projectRoot: join(temp1, 'project'),
      runsFolder: temp1,
      model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017',
      harness: 'machineroom',
      lanes: {
        orchestrator: {
          name: 'Orchestrator',
          harness: 'MachineRoom',
          cli: { harness: 'machineroom', model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017' },
        },
      },
    })
    cleanups.push(() => orch.stop())

    expect(orch.answer().contextWindow).toBe(1048576)

    const temp2 = makeTempDir('mr-test-context-2-')
    cleanups.push(() => removeTempDir(temp2))

    saveEndpoints(temp2, [
      {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['deepseek/deepseek-v4.1-flash-1017'],
        modelDetails: [
          {
            id: 'deepseek/deepseek-v4.1-flash-1017',
            name: 'DeepSeek v4.1 Flash',
            contextLength: 1048576,
          },
        ],
      },
    ])

    const orchWithLaneWindow = createOrchestrator({
      id: 'orchestrator',
      projectRoot: join(temp2, 'project'),
      runsFolder: temp2,
      model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017',
      harness: 'machineroom',
      lanes: {
        orchestrator: {
          name: 'Orchestrator',
          harness: 'MachineRoom',
          cli: {
            harness: 'machineroom',
            model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017',
            contextWindow: 50000,
          },
        },
      },
    })
    cleanups.push(() => orchWithLaneWindow.stop())

    expect(orchWithLaneWindow.answer().contextWindow).toBe(50000)
  })

  it('fires autocompact at the percent of the resolved window', () => {
    const temp = makeTempDir('mr-test-autocompact-')
    cleanups.push(() => removeTempDir(temp))

    saveEndpoints(temp, [
      {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['deepseek/deepseek-v4.1-flash-1017'],
        modelDetails: [
          {
            id: 'deepseek/deepseek-v4.1-flash-1017',
            name: 'DeepSeek v4.1 Flash',
            contextLength: 1048576,
          },
        ],
      },
    ])

    const orch = createOrchestrator({
      id: 'orchestrator',
      projectRoot: join(temp, 'project'),
      runsFolder: temp,
      model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017',
      harness: 'machineroom',
      lanes: {
        orchestrator: {
          name: 'Orchestrator',
          harness: 'MachineRoom',
          cli: { harness: 'machineroom', model: 'OpenRouter/deepseek/deepseek-v4.1-flash-1017' },
        },
      },
    })
    cleanups.push(() => orch.stop())

    expect(orch.answer().contextWindow).toBe(1048576)
    expect(orch.answer().autocompactMode).toBe('percent')
    expect(orch.answer().autocompactPercent).toBe(80)

    orch.setAutocompact({ on: true, mode: 'percent', value: 80, confirmed: true })
    expect(orch.answer().autocompactPercent).toBe(80)
  })

  it('updates the context window and follows the window on model change', () => {
    const temp = makeTempDir('mr-test-change-')
    cleanups.push(() => removeTempDir(temp))

    saveEndpoints(temp, [
      {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['deepseek/deepseek-v4.1-flash-1017'],
        modelDetails: [
          {
            id: 'deepseek/deepseek-v4.1-flash-1017',
            name: 'DeepSeek v4.1 Flash',
            contextLength: 1048576,
          },
        ],
      },
    ])

    const orch = createOrchestrator({
      id: 'orchestrator',
      projectRoot: join(temp, 'project'),
      runsFolder: temp,
      model: 'claude-sonnet-5-5',
      harness: 'claude',
      lanes: {
        orchestrator: {
          name: 'Orchestrator',
          harness: 'Claude Code',
          cli: { harness: 'claude', model: 'claude-sonnet-5-5' },
        },
      },
    })
    cleanups.push(() => orch.stop())

    expect(orch.answer().contextWindow).toBeNull()
    expect(orch.answer().autocompactPercent).toBe(80)

    orch.setModel({ model: 'claude-opus-5-5', confirmed: true })
    expect(orch.answer().contextWindow).toBeNull()
    expect(orch.answer().autocompactPercent).toBe(80)
  })
})

describe('a sub orchestrator context window', () => {
  const ORCHESTRATOR_LANES = {
    orchestrator: {
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: 'claude', model: 'opus', contextWindow: 50000 },
    },
  }

  function saveTwoEndpoints(temp) {
    saveEndpoints(temp, [
      {
        name: 'first',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['model'],
        modelDetails: [{ id: 'model', contextLength: 1000000 }],
      },
      {
        name: 'second',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['model'],
        modelDetails: [{ id: 'model', contextLength: 32000 }],
      },
    ])
  }

  function makeSub(model) {
    return {
      id: 'frontend',
      name: 'Frontend',
      harness: 'machineroom',
      model,
      lanes: [],
      scope: ['src/ui/**'],
      restricted: false,
      setBy: 'owner',
    }
  }

  function makeRegistry(temp, lanes) {
    const registry = createOrchestrators({
      projectRoot: join(temp, 'project'),
      runsFolder: temp,
      lanes,
      promptFile: join(temp, 'prompt.md'),
      bridgeUrl: () => 'http://127.0.0.1:5999',
      onNotice: () => {},
    })
    cleanups.push(() => registry.close())
    return registry
  }

  it('reads its own model from the right endpoint and follows a model change', () => {
    const temp = makeTempDir('mr-test-sub-window-')
    cleanups.push(() => removeTempDir(temp))
    saveTwoEndpoints(temp)
    const registry = makeRegistry(temp, ORCHESTRATOR_LANES)

    const added = registry.ladderChange(
      { ladder: { subs: [makeSub('first/model')] }, by: 'owner', confirmed: true },
      true
    )
    expect(added.status).toBe(200)
    expect(registry.find('frontend').answer().contextWindow).toBe(1000000)

    const moved = registry.find('frontend').setModel({ model: 'second/model', confirmed: true })
    expect(moved.status).toBe(200)
    expect(registry.find('frontend').answer().contextWindow).toBe(32000)
  })

  it('keeps a lane own override over the endpoint details', () => {
    const temp = makeTempDir('mr-test-sub-lane-window-')
    cleanups.push(() => removeTempDir(temp))
    saveTwoEndpoints(temp)
    const lanes = {
      ...ORCHESTRATOR_LANES,
      endpoint: {
        name: 'Endpoint',
        harness: 'MachineRoom',
        cli: { harness: 'machineroom', bin: 'machineroom', model: 'second/model', contextWindow: 64000 },
      },
    }
    const registry = makeRegistry(temp, lanes)

    const added = registry.ladderChange(
      { ladder: { subs: [makeSub('second/model')] }, by: 'owner', confirmed: true },
      true
    )
    expect(added.status).toBe(200)
    expect(registry.find('frontend').answer().contextWindow).toBe(64000)
  })
})


describe('reported context windows', () => {
  it('reads the model window from the latest Claude result', () => {
    const log = JSON.stringify({ type: 'result', modelUsage: { 'claude-sonnet-5-5': { contextWindow: 1000000 } } })
    expect(claudeContextWindow(log, 'claude-sonnet-5-5')).toBe(1000000)
    expect(claudeContextWindow(log, '')).toBe(1000000)
    expect(claudeContextWindow(log, 'alias')).toBe(1000000)
  })

  it('selects the reported model among several usage entries', () => {
    const usage = { first: { contextWindow: 32000 }, second: { contextWindow: 1000000 } }
    const result = JSON.stringify({ type: 'result', modelUsage: usage })
    expect(claudeContextWindow(result, 'alias')).toBeNull()
    expect(claudeContextWindow(`${JSON.stringify({ type: 'system', subtype: 'init', model: 'second' })}\n${result}`, 'alias')).toBe(1000000)
    expect(claudeContextWindow(`${JSON.stringify({ type: 'assistant', message: { model: 'first' } })}\n${result}`, 'alias')).toBe(32000)
  })

  it('fetches and saves missing endpoint details', async () => {
    const temp = makeTempDir('mr-test-window-fetch-')
    cleanups.push(() => removeTempDir(temp))
    const id = 'deepseek/deepseek-v4.1-flash-1017'
    saveEndpoints(temp, [{ name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'slot', models: [id] }])
    const notices = []
    let calls = 0
    const api = createEndpointsApi({ runsFolder: temp, readKey: async () => 'test', notify: (notice) => notices.push(notice), fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: [{ id, context_length: 163840 }] }) } } })
    expect(await api.refreshMissing('OpenRouter/' + id)).toBe(true)
    expect(await api.refreshMissing('OpenRouter/' + id)).toBe(false)
    expect(calls).toBe(1)
    const window = resolveContextWindow('OpenRouter/' + id, 'machineroom', 0, readEndpoints(temp))
    expect(contextLine({ context: { tokens: 116800, window } })).toBe('Context size 116.8k / 163.8k')
    expect(notices).toContainEqual({ topic: 'endpoints' })
  })

  it.each([null, 0, 1.5])('retries a partial detail with context length %s after the delay', async (contextLength) => {
    const temp = makeTempDir('mr-test-window-partial-')
    cleanups.push(() => removeTempDir(temp))
    saveEndpoints(temp, [{ name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'slot', models: ['selected'], modelDetails: [{ id: 'selected', contextLength }] }])
    let time = 1000
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'selected', context_length: fetchImpl.mock.calls.length === 1 ? contextLength : 163840 }] }) }))
    const api = createEndpointsApi({ runsFolder: temp, readKey: async () => 'test', now: () => time, fetchImpl })
    await api.refreshMissing('OpenRouter/selected')
    await api.refreshMissing('OpenRouter/selected')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    time += 600000
    await api.refreshMissing('OpenRouter/selected')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(readEndpoints(temp)[0].modelDetails[0].contextLength).toBe(163840)
  })

  it('waits before retrying a model omitted from a successful response', async () => {
    const temp = makeTempDir('mr-test-window-omitted-')
    cleanups.push(() => removeTempDir(temp))
    saveEndpoints(temp, [{ name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'slot', models: ['selected'] }])
    let time = 1000
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: fetchImpl.mock.calls.length === 1 ? 'other' : 'selected', context_length: 163840 }] }) }))
    const api = createEndpointsApi({ runsFolder: temp, readKey: async () => 'test', now: () => time, fetchImpl })
    await api.refreshMissing('OpenRouter/selected')
    await api.refreshMissing('OpenRouter/selected')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    time += 600000
    await api.refreshMissing('OpenRouter/selected')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(readEndpoints(temp)[0].modelDetails[0].contextLength).toBe(163840)
  })

  it('keeps the saved model list and existing details when refreshing', async () => {
    const temp = makeTempDir('mr-test-window-models-')
    cleanups.push(() => removeTempDir(temp))
    saveEndpoints(temp, [{ name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'slot', models: ['first', 'second'], modelDetails: [{ id: 'first', contextLength: 32000 }] }])
    const api = createEndpointsApi({ runsFolder: temp, readKey: async () => 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ data: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, context_length: 163840 })) }) }) })
    expect(await api.refreshMissing('OpenRouter/second')).toBe(true)
    const [endpoint] = readEndpoints(temp)
    expect(endpoint.models).toEqual(['first', 'second'])
    expect(endpoint.modelDetails.map(({ id, contextLength }) => ({ id, contextLength }))).toEqual([{ id: 'first', contextLength: 163840 }, { id: 'second', contextLength: 163840 }])
    saveEndpoints(temp, [{ ...endpoint, modelDetails: endpoint.modelDetails.filter(({ id }) => id === 'first') }])
    const partial = createEndpointsApi({ runsFolder: temp, readKey: async () => 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'second', context_length: 64000 }] }) }) })
    expect(await partial.refreshMissing('OpenRouter/second')).toBe(true)
    expect(readEndpoints(temp)[0].modelDetails.map(({ id, contextLength }) => ({ id, contextLength }))).toEqual([{ id: 'first', contextLength: 163840 }, { id: 'second', contextLength: 64000 }])
  })
})
