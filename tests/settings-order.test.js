import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

function harnessRows() {
  return [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      ready: true,
      enabled: true,
      program: 'C:\\Tools\\claude\\claude.exe',
      version: '2.1.0',
      reason: '',
      models: [],
      efforts: [],
    },
    {
      key: 'codex',
      name: 'Codex',
      available: false,
      ready: false,
      enabled: true,
      program: '',
      version: '',
      reason: 'Program not found on PATH.',
      models: [],
      efforts: [],
    },
  ]
}

function fakeClient(rows = harnessRows()) {
  return {
    harnesses: vi.fn().mockResolvedValue(rows),
    checkHarnesses: vi.fn().mockResolvedValue(rows),
    harnessSettings: vi.fn().mockResolvedValue({ harnesses: rows }),
    keys: vi.fn().mockResolvedValue([]),
    deleteKey: vi.fn().mockResolvedValue({}),
    endpoints: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    agentDepth: vi.fn().mockResolvedValue({ limit: 2, unlocked: false }),
    setAgentDepth: vi.fn().mockResolvedValue({ limit: 2, unlocked: false }),
    lanes: vi.fn().mockResolvedValue([]),
    showLane: vi.fn().mockResolvedValue({}),
    deleteLane: vi.fn().mockResolvedValue({}),
    mcpServers: vi.fn().mockResolvedValue([]),
    mcpTools: vi.fn().mockResolvedValue([]),
    searchProvider: vi.fn().mockResolvedValue({ provider: 'duckduckgo' }),
    storage: vi.fn().mockResolvedValue({ kinds: {} }),
  }
}

function sectionNames(container) {
  return [...container.querySelectorAll('.hud-settings-section')].map((section) => {
    const label = section.getAttribute('aria-label')
    if (label) return label
    if (section.id === 'settings-direct-api') return 'Direct API'
    const title = section.querySelector('.hud-settings-section-title')
    if (title) return title.textContent.trim()
    const first = section.querySelector('.hud-settings-label')
    return first ? first.textContent.trim() : ''
  })
}

describe('Settings section order', () => {
  it('shows Harnesses, Direct API, Keys and Lanes first, then the other sections as before', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { client: fakeClient(), open: true, onClose: () => {} }))
      })
      await settle()

      expect(sectionNames(container)).toEqual([
        'Harnesses',
        'Direct API',
        'Keys',
        'Lanes',
        'Folder depth',
        'Screen effects',
        'Replay',
        'Sound',
        'Subagents',
        'MCP tools',
        'Web search',
        'Storage',
      ])
    })
  })
})

describe('harness program details', () => {
  it('folds a Ready row and keeps a Not ready row open', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client: fakeClient() }))
      })
      await settle()

      const ready = container.querySelector('[data-harness="claude"]')
      const readyState = ready.querySelector('[data-harness-state]')
      expect(readyState.textContent.trim()).toBe('Ready')
      expect(ready.textContent).toContain('Claude Code')

      const details = ready.querySelector('details')
      expect(details).not.toBeNull()
      expect(details.hasAttribute('open')).toBe(false)
      expect(details.querySelector('summary').textContent.trim()).toBe('Program details')
      expect(details.textContent).toContain('2.1.0')
      expect(details.textContent).toContain('C:\\Tools\\claude\\claude.exe')
      expect(details.querySelector('input')).not.toBeNull()
      expect(buttonWithText(details, 'Save')).not.toBeNull()
      expect(buttonWithText(details, 'Clear')).not.toBeNull()
      expect(details.textContent).not.toContain('Offer in forms')
      expect(buttonWithText(ready, 'Offer in forms')).not.toBeNull()

      const notReady = container.querySelector('[data-harness="codex"]')
      expect(notReady.querySelector('[data-harness-state]').textContent.trim()).toBe('Not ready')
      expect(notReady.querySelector('details')).toBeNull()
      expect(notReady.querySelector('input')).not.toBeNull()
      expect(buttonWithText(notReady, 'Save')).not.toBeNull()
      expect(buttonWithText(notReady, 'Clear')).not.toBeNull()
      expect(notReady.textContent).toContain('Program not found on PATH.')
    })
  })
})
