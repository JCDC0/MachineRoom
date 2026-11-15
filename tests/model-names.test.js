import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { MODELS } from '../server/model-list.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { childDetail, familyMeta } from '../src/ui/family.js'
import { modelChoiceText, modelName } from '../src/ui/modelRefresh.js'
import { click, withDom } from './helpers/uiDom.js'

const OPENCODE_GO = 'opencode-go/deepseek-v4.1-flash'
const OPENROUTER = 'deepseek/deepseek-v4.1-flash-1017'
const OPENCODE_FREE = 'opencode/deepseek-v4.1-flash-free'

function listOf() {
  return [{ id: 'orchestrator', name: 'Orchestrator', harness: 'opencode', model: OPENCODE_GO, state: 'idle' }]
}

function menuClient(choices) {
  return {
    orchestrator: async () => ({ state: 'idle', model: OPENCODE_GO, messages: [] }),
    orchestrators: async () => listOf(),
    orchestratorCommands: async () => [],
    models: async () => choices,
    subscribe: () => () => {},
  }
}

function chatFor(client) {
  return createElement(OrchestratorChat, {
    client,
    inline: true,
    orchestrators: listOf(),
    initialOrchestrators: listOf(),
    initialSelected: 'orchestrator',
    initialChat: { state: 'idle', model: OPENCODE_GO, messages: [] },
  })
}

describe('a model name', () => {
  it('drops the provider path from the three DeepSeek routes', () => {
    expect(modelName(OPENCODE_FREE, MODELS)).toBe('DeepSeek v4.1 Flash (free)')
    expect(modelName(OPENROUTER, MODELS)).toBe('DeepSeek v4.1 Flash')
    expect(modelName(OPENCODE_GO, MODELS)).toBe('DeepSeek v4.1 Flash')
    for (const id of [OPENCODE_FREE, OPENROUTER, OPENCODE_GO]) {
      const name = modelName(id, MODELS)
      expect(name).not.toContain('/')
      expect(name).not.toContain('OpenRouter')
      expect(name).not.toContain('(Go)')
      expect(name).not.toContain('opencode')
    }
  })

  it('keeps the free price in the label and leaves the route out', () => {
    const free = MODELS.find((row) => row.id === OPENCODE_FREE && row.harness === 'opencode')
    const openrouter = MODELS.find((row) => row.id === OPENROUTER && row.harness === 'machineroom')
    const go = MODELS.find((row) => row.id === OPENCODE_GO && row.harness === 'opencode')
    expect(free.label).toBe('DeepSeek v4.1 Flash (free)')
    expect(openrouter.label).toBe('DeepSeek v4.1 Flash')
    expect(go.label).toBe('DeepSeek v4.1 Flash')
  })

  it('uses the last segment when no choice carries the id', () => {
    expect(modelName(OPENCODE_GO, [])).toBe('deepseek-v4.1-flash')
    expect(modelName('sonnet', [])).toBe('sonnet')
    expect(modelName('', [])).toBe('Harness default')
    expect(modelName('   ', MODELS)).toBe('Harness default')
  })

  it('writes the name alone for one native option', () => {
    expect(modelChoiceText({ id: OPENCODE_GO, label: 'DeepSeek v4.1 Flash' })).toBe(
      'DeepSeek v4.1 Flash'
    )
    expect(modelChoiceText({ id: 'bare' })).toBe('bare')
  })

  it('shows the name in a family row and the child form line', () => {
    expect(familyMeta({ harness: 'opencode', model: OPENCODE_GO, effort: 'max' })).toBe(
      'opencode · deepseek-v4.1-flash · max'
    )
    expect(familyMeta({})).toBe('harness unknown · Harness default · default')
    expect(
      childDetail(
        { label: 'Writer', harness: 'opencode', model: OPENCODE_GO, effort: 'max' },
        {
          harnesses: [
            {
              key: 'opencode',
              name: 'OpenCode',
              available: true,
              models: [{ id: OPENCODE_GO, label: 'DeepSeek v4.1 Flash' }],
              efforts: ['max'],
            },
          ],
        }
      )
    ).toBe('OpenCode · DeepSeek v4.1 Flash · max')
  })
})

describe('the chat model menu', () => {
  it('adds the first id segment to the two names that repeat, and only those', async () => {
    const choices = [
      { id: OPENCODE_GO, label: 'DeepSeek v4.1 Flash', harness: 'opencode' },
      { id: OPENROUTER, label: 'DeepSeek v4.1 Flash', harness: 'opencode' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', harness: 'opencode' },
    ]
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(chatFor(menuClient(choices)))
      })
      await act(async () => {})
      await click(root, container.querySelector('.mr-picker-trigger'))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const pop = container.querySelector('.mr-picker-pop')
      const buttons = pop ? pop.querySelectorAll('.mr-picker-pick') : []
      const byTitle = (id) => buttons.find((button) => button.getAttribute('title') === id)
      const go = byTitle(OPENCODE_GO)
      const openrouter = byTitle(OPENROUTER)
      const unique = byTitle('gpt-6.1-sol')
      expect(go).toBeTruthy()
      expect(openrouter).toBeTruthy()
      expect(unique).toBeTruthy()
      expect(go.textContent).toContain('DeepSeek v4.1 Flash')
      expect(go.querySelector('.mr-picker-id').textContent.trim()).toBe('opencode-go')
      expect(openrouter.querySelector('.mr-picker-id').textContent.trim()).toBe('deepseek')
      expect(go.textContent).not.toContain('opencode-go/deepseek-v4.1-flash')
      expect(unique.textContent).toBe('GPT-6.1 Sol')
      expect(unique.querySelector('.mr-picker-id')).toBeNull()
    })
  })
})
