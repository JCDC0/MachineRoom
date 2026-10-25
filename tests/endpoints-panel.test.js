import { createElement } from 'react'
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
  baseUrlForProvider,
  endpointDraftProblem,
  modelsFromText,
} from '../src/ui/EndpointsPanel.jsx'

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
    expect(endpointDraftProblem({ ...base, models: Array.from({ length: 51 }, (_, index) => `m-${index}`) }, PROVIDERS)).toBe(
      ENDPOINT_MODELS_PROBLEM,
    )
    expect(endpointDraftProblem(base, PROVIDERS)).toBeNull()
  })
})

describe('EndpointsPanel', () => {
  it('lists the saved endpoints with their provider, URL, models and key slot', () => {
    const html = renderPanel()
    expect(html).toContain('Providers')
    expect(html).toContain('Add endpoint')
    expect(html).toContain('Local Ollama')
    expect(html).toContain('http://127.0.0.1:11434/v1')
    expect(html).toContain('2 models')
    expect(html).toContain('OpenRouter Work')
    expect(html).toContain('key slot openrouter')
    expect(html).toContain('Refresh models')
    expect(html).toContain('Delete')
  })

  it('shows the Add endpoint form with the provider preset, key slot picker and refresh button', () => {
    const html = renderPanel({ initialOpen: true, initialKeys: ['openrouter', 'local'] })
    expect(html).toContain('id="endpoints-provider"')
    expect(html).toContain('https://openrouter.ai/api/v1')
    expect(html).toContain('No key (local server)')
    expect(html).toContain('>openrouter<')
    expect(html).toContain('id="endpoints-models"')
    expect(html).toContain('>Save<')
    expect(html).not.toContain('brief-confirm-card')
  })

  it('does not show a saved key value', () => {
    const html = renderPanel({ initialOpen: true, initialKeys: ['openrouter'] })
    expect(html).not.toContain('slot-secret')
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
})
