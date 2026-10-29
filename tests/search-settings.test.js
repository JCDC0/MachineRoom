import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CLIENT_METHODS, createMockClient } from '../src/control/mock.js'
import SearchSettings, {
  SEARCH_PROVIDERS,
  keyNamesFrom,
  keySaveProblem,
  keySlotName,
  providerLabel,
  searchChoiceFrom,
  searchChoiceProblem,
  searchChoiceSummary,
} from '../src/ui/SearchSettings.jsx'
import Settings from '../src/ui/Settings.jsx'

describe('the web search settings helpers', () => {
  it('reads a saved choice and falls back to off', () => {
    expect(searchChoiceFrom({ provider: 'searxng', url: ' https://search.example ', keyName: 'X' })).toEqual({
      provider: 'searxng',
      url: 'https://search.example',
      keyName: 'X',
    })
    expect(searchChoiceFrom({ provider: 'other', url: 7, keyName: null })).toEqual({
      provider: '',
      url: '',
      keyName: '',
    })
  })

  it('names each provider', () => {
    expect(providerLabel('searxng')).toBe('SearXNG')
    expect(providerLabel('tavily')).toBe('Tavily')
    expect(providerLabel('brave')).toBe('Brave')
    expect(providerLabel('duckduckgo')).toBe('DuckDuckGo')
    expect(providerLabel('')).toBe('Off')
    expect(SEARCH_PROVIDERS.map((item) => item.key)).toEqual(['searxng', 'tavily', 'brave', 'duckduckgo'])
  })

  it('reads key slot names from an answer or a list', () => {
    expect(keyNamesFrom({ keys: [{ name: 'TAVILY_API_KEY' }, { name: 'BRAVE_API_KEY' }, { name: 'TAVILY_API_KEY' }] })).toEqual([
      'TAVILY_API_KEY',
      'BRAVE_API_KEY',
    ])
    expect(keyNamesFrom(['A', ' B ', 3])).toEqual(['A', 'B'])
    expect(keyNamesFrom(null)).toEqual([])
  })

  it('checks the SearXNG address', () => {
    expect(searchChoiceProblem({ provider: '', url: '', keyName: '' })).toBe('')
    expect(searchChoiceProblem({ provider: 'searxng', url: '' })).toBe('Add the SearXNG address.')
    expect(searchChoiceProblem({ provider: 'searxng', url: 'ftp://x' })).toContain('http')
    expect(searchChoiceProblem({ provider: 'searxng', url: 'not a url' })).toContain('http')
    expect(searchChoiceProblem({ provider: 'searxng', url: 'https://search.example' })).toBe('')
    expect(searchChoiceProblem({ provider: 'elsewhere' })).toBe('Pick a search provider.')
  })

  it('sums the choice for the confirm card', () => {
    expect(searchChoiceSummary({ provider: '', url: '', keyName: '' })).toBe('Off')
    expect(searchChoiceSummary({ provider: 'searxng', url: 'https://search.example', keyName: '' })).toBe('SearXNG, https://search.example')
    expect(searchChoiceSummary({ provider: 'brave', url: '', keyName: 'BRAVE_API_KEY' })).toBe('Brave, key slot BRAVE_API_KEY')
  })

  it('names the key slot after the provider that uses one', () => {
    expect(keySlotName('tavily')).toBe('Tavily')
    expect(keySlotName('brave')).toBe('Brave')
    expect(keySlotName('searxng')).toBe('')
    expect(keySlotName('duckduckgo')).toBe('')
    expect(keySlotName('')).toBe('')
  })

  it('checks a web search key', () => {
    expect(keySaveProblem('')).toBe('Write the key.')
    expect(keySaveProblem('x'.repeat(501))).toBe('Keep the key to 500 characters.')
    expect(keySaveProblem('tvly-test')).toBe('')
  })
})

describe('the mock web search provider', () => {
  it('starts off and saves a choice behind a confirmation', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect(await client.searchProvider()).toEqual({ provider: '', url: '', keyName: '' })
    await expect(client.setSearchProvider({ provider: 'searxng', url: '', confirmed: true })).rejects.toThrow('The SearXNG address')
    await expect(client.setSearchProvider({ provider: 'elsewhere', confirmed: true })).rejects.toThrow('Pick SearXNG')
    await expect(client.setSearchProvider({ provider: 'duckduckgo', confirmed: false })).rejects.toThrow('Confirm web search first.')
    const saved = await client.setSearchProvider({ provider: 'searxng', url: 'https://search.example', confirmed: true })
    expect(saved).toEqual({ provider: 'searxng', url: 'https://search.example', keyName: '' })
    expect(await client.searchProvider()).toEqual(saved)
  })

  it('keeps a key slot name only for Tavily and Brave', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const saved = await client.setSearchProvider({ provider: 'tavily', url: '', keyName: 'TAVILY_API_KEY', confirmed: true })
    expect(saved).toEqual({ provider: 'tavily', url: '', keyName: 'TAVILY_API_KEY' })
    const brave = await client.setSearchProvider({ provider: 'brave', url: '', keyName: 'BRAVE_API_KEY', confirmed: true })
    expect(brave.keyName).toBe('BRAVE_API_KEY')
    const duck = await client.setSearchProvider({ provider: 'duckduckgo', url: '', keyName: 'IGNORED', confirmed: true })
    expect(duck.keyName).toBe('')
  })

  it('is part of the client contract', () => {
    expect(CLIENT_METHODS).toContain('searchProvider')
    expect(CLIENT_METHODS).toContain('setSearchProvider')
    expect(CLIENT_METHODS).toContain('quickEndpoint')
  })

  it('saves a provider-named key slot for Tavily and Brave', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect(await client.setKey({ name: 'Tavily', value: 'tvly-test', confirmed: true })).toEqual({
      ok: true,
      name: 'Tavily',
    })
    expect(await client.setKey({ name: 'Brave', value: 'brave-test', confirmed: true })).toEqual({
      ok: true,
      name: 'Brave',
    })
    expect((await client.keys()).map((entry) => entry.name)).toEqual(['Brave', 'Tavily'])
    await expect(client.setKey({ name: 'Tavily', value: 'tvly-test', confirmed: false })).rejects.toThrow(
      'Confirm setting the key first.'
    )
  })
})

describe('the web search section', () => {
  it('mounts in Settings', () => {
    const html = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(html).toContain('Web search')
    expect(html).toContain('DuckDuckGo')
    expect(html).toContain('Save')
  })

  it('renders its own provider picker', () => {
    const html = renderToString(
      createElement(SearchSettings, {
        client: {
          searchProvider: async () => ({ provider: '', url: '', keyName: '' }),
          keys: async () => ({ keys: [] }),
          setSearchProvider: async () => ({ provider: '', url: '', keyName: '' }),
        },
      })
    )
    expect(html).toContain('SearXNG')
    expect(html).toContain('Tavily')
    expect(html).toContain('Brave')
    expect(html).toContain('DuckDuckGo')
  })
})
