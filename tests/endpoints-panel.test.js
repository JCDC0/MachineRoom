import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../server/endpoints.js'
import { MOCK_PROVIDERS, createMockClient } from '../src/control/mock.js'
import EndpointsPanel, {
  ENDPOINT_BASE_URL_PROBLEM,
  ENDPOINT_KEY_PROBLEM,
  ENDPOINT_KEY_NAME_PROBLEM,
  ENDPOINT_MODELS_PROBLEM,
  ENDPOINT_NAME_PROBLEM,
  QUICK_KEY_PROBLEM,
  QUICK_PROVIDER_PROBLEM,
  baseUrlForProvider,
  endpointDraftProblem,
  modelsFromText,
  quickConfirmText,
  quickKeyProblem,
  quickProviders,
  quickSavedText,
} from '../src/ui/EndpointsPanel.jsx'
import { settle, withDom } from './helpers/uiDom.js'

const ENDPOINTS = [
  {
    name: 'Local Ollama',
    provider: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyName: '',
    models: ['llama3.3', 'qwen3'],
  },
  {
    name: 'OpenRouter Work',
    provider: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyName: 'openrouter',
    models: ['deepseek/deepseek-v4.1-flash-1017'],
  },
]

function renderPanel(props = {}) {
  return renderToString(
    createElement(EndpointsPanel, {
      client: createMockClient({ latencyMs: 0 }),
      initialEndpoints: ENDPOINTS,
      initialProviders: PROVIDERS,
      ...props,
    }),
  )
}

describe('endpoint form helpers', () => {
  it('fills the base URL from the provider preset', () => {
    expect(baseUrlForProvider(PROVIDERS, 'OpenRouter')).toBe('https://openrouter.ai/api/v1')
    expect(baseUrlForProvider(PROVIDERS, 'Ollama')).toBe('http://127.0.0.1:11434/v1')
    expect(baseUrlForProvider(PROVIDERS, 'Custom')).toBe('')
  })

  it('reads one model per line and drops blank and repeated lines', () => {
    expect(modelsFromText(' alpha\n\nbeta \nalpha\n')).toEqual(['alpha', 'beta'])
    expect(modelsFromText('')).toEqual([])
  })

  it('refuses a bad name, a remote http URL, a remote endpoint with no key and too many models', () => {
    const base = {
      name: 'Work',
      provider: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyName: 'openrouter',
      models: ['alpha'],
    }
    expect(endpointDraftProblem({ ...base, name: 'Work/one' }, PROVIDERS)).toBe(ENDPOINT_NAME_PROBLEM)
    expect(endpointDraftProblem({ ...base, baseUrl: 'http://192.168.1.4/v1' }, PROVIDERS)).toBe(ENDPOINT_BASE_URL_PROBLEM)
    expect(endpointDraftProblem({ ...base, keyName: '' }, PROVIDERS)).toBe(ENDPOINT_KEY_PROBLEM)
    expect(endpointDraftProblem({ ...base, keyName: 'bad/slot' }, PROVIDERS)).toBe(ENDPOINT_KEY_NAME_PROBLEM)
    expect(endpointDraftProblem({ ...base, models: Array.from({ length: 1001 }, (_, index) => `m-${index}`) }, PROVIDERS)).toBe(
      ENDPOINT_MODELS_PROBLEM,
    )
    expect(endpointDraftProblem(base, PROVIDERS)).toBeNull()
  })
})

describe('the quick direct API form', () => {
  it('puts OpenRouter first and leaves out a provider with no base URL', () => {
    const providers = [
      { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      { name: 'Custom', baseUrl: '' },
      { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
      { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    ]
    expect(quickProviders(providers).map((entry) => entry.name)).toEqual(['OpenRouter', 'OpenAI'])
  })

  it('asks before it saves the key and counts the models it loaded', () => {
    expect(quickConfirmText('OpenRouter')).toBe('Save the OpenRouter key and load its models?')
    expect(quickSavedText({ endpoint: { models: 3 } }, 'OpenRouter')).toBe('Saved OpenRouter, 3 models.')
    expect(quickSavedText({ endpoint: { models: 1 } }, 'Brave')).toBe('Saved Brave, 1 model.')
    expect(quickSavedText({ endpoint: { models: 3 }, error: 'The endpoint did not answer its model list.' }, 'OpenRouter')).toBe(
      'The endpoint did not answer its model list.',
    )
  })

  it('checks the provider and the key', () => {
    expect(quickKeyProblem('', 'sk-test')).toBe(QUICK_PROVIDER_PROBLEM)
    expect(quickKeyProblem('OpenRouter', '')).toBe(QUICK_KEY_PROBLEM)
    expect(quickKeyProblem('OpenRouter', 'x'.repeat(501))).toBe('Keep the key to 500 characters.')
    expect(quickKeyProblem('OpenRouter', 'sk-test')).toBeNull()
  })
})

describe('EndpointsPanel', () => {
  it('lists the saved endpoints with their name, provider and model count', () => {
    const html = renderPanel()
    expect(html).toContain('Direct API')
    expect(html).toContain('Save key')
    expect(html).toContain('id="endpoints-quick-provider"')
    expect(html).toContain('id="endpoints-quick-key"')
    expect(html).toContain('Local Ollama')
    expect(html).toContain('Ollama')
    expect(html).toContain('2 models')
    expect(html).toContain('OpenRouter Work')
    expect(html).toContain('Refresh models')
    expect(html).toContain('Replace key')
    expect(html).toContain('Delete')
    expect(html).not.toContain('http://127.0.0.1:11434/v1')
  })

  it('keeps the custom endpoint form folded until it opens', () => {
    const folded = renderPanel()
    expect(folded).toContain('Custom endpoint')
    expect(folded).not.toContain('id="endpoints-name"')
    const open = renderPanel({ initialOpen: true, initialKeys: ['openrouter', 'local'] })
    expect(open).toContain('id="endpoints-provider"')
    expect(open).toContain('https://openrouter.ai/api/v1')
    expect(open).toContain('No key (local server)')
    expect(open).toContain('>openrouter<')
    expect(open).toContain('id="endpoints-models"')
    expect(open).toContain('>Save<')
  })

  it('does not show a saved key value', async () => {
    const client = {
      providers: async () => PROVIDERS,
      endpoints: async () => [],
      keys: async () => [{ name: 'openrouter', value: 'slot-secret' }],
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(EndpointsPanel, {
            client,
            initialProviders: PROVIDERS,
            initialEndpoints: [],
            initialOpen: true,
          })
        )
      })
      await settle()

      const slots = container.querySelector('#endpoints-key').querySelectorAll('option')
      expect(slots.map((option) => option.getAttribute('value'))).toEqual(['', 'openrouter'])
      expect(container.textContent).not.toContain('slot-secret')
    })
  })
})

describe('endpoint mock methods', () => {
  it('keeps its provider list the same as the bridge presets', () => {
    expect(MOCK_PROVIDERS).toEqual(PROVIDERS)
  })

  it('answers providers, endpoints, save, models and delete', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect(await client.providers()).toEqual(PROVIDERS)
    expect((await client.endpoints()).map((entry) => entry.name)).toEqual(['Local Ollama', 'OpenRouter Work'])
    expect(await client.endpointModels('Local Ollama')).toEqual(['llama3.3', 'qwen3'])
    const saved = await client.saveEndpoint({
      name: 'Groq Work',
      provider: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyName: 'groq',
      models: ['llama-3.3-70b'],
      confirmed: true,
    })
    expect(saved.endpoint).toMatchObject({ name: 'Groq Work', models: ['llama-3.3-70b'] })
    expect((await client.endpoints()).some((entry) => entry.name === 'Groq Work')).toBe(true)
    await client.deleteEndpoint({ name: 'Groq Work', confirmed: true })
    expect((await client.endpoints()).some((entry) => entry.name === 'Groq Work')).toBe(false)
    await expect(client.saveEndpoint({ name: 'No', confirmed: false })).rejects.toThrow('Confirm saving the endpoint first.')
  })

  it('saves the quick key, endpoint and three models without the key', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await expect(client.quickEndpoint({ provider: 'OpenRouter', key: 'sk-test', confirmed: false })).rejects.toThrow(
      'Confirm saving the key first.',
    )
    await expect(client.quickEndpoint({ provider: 'Custom', key: 'sk-test', confirmed: true })).rejects.toThrow(
      'Choose a provider from the list.',
    )
    const answer = await client.quickEndpoint({ provider: 'OpenRouter', key: 'sk-test', confirmed: true })
    expect(answer.endpoint).toMatchObject({
      name: 'OpenRouter',
      provider: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyName: 'OpenRouter',
      models: 3,
    })
    expect(JSON.stringify(answer)).not.toContain('sk-test')
    const endpoint = (await client.endpoints()).find((entry) => entry.name === 'OpenRouter')
    expect(endpoint.models).toHaveLength(3)
    const direct = await client.harnessModels({ harness: 'machineroom' })
    expect(direct.models.some((model) => model.id === 'OpenRouter/flash')).toBe(true)
    expect(direct.models.some((model) => model.label === 'flash (OpenRouter)')).toBe(true)
  })
})
