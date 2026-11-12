import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveEndpoints } from '../server/endpoints.js'
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from '../server/model-list.js'
import { createOrchestrator } from '../server/orchestrator.js'
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

  it('gives the default window and assumed label when a model has no details', () => {
    expect(resolveContextWindow('unknown/model', 'machineroom', 0, [])).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(contextLine({ context: { tokens: 16500, window: DEFAULT_CONTEXT_WINDOW } })).toBe(
      'Context size 16.5k / 200.0k (assumed)'
    )
    expect(contextLine({ context: { tokens: 16500, window: 1048576 } })).toBe(
      'Context size 16.5k / 1048.6k'
    )
  })
})

describe('orchestrator context window and autocompact', () => {
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

    expect(orch.answer().contextWindow).toBe(1000000)
    expect(orch.answer().autocompactPercent).toBe(80)

    orch.setModel({ model: 'claude-opus-5-5', confirmed: true })
    expect(orch.answer().contextWindow).toBe(1000000)
    expect(orch.answer().autocompactPercent).toBe(80)
  })
})
