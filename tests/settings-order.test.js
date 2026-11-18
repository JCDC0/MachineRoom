import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, settle, withDom, openTab } from './helpers/uiDom.js'

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

const TAB_LABELS = [
  'Harnesses',
  'Direct API',
  'Keys',
  'Lanes',
  'Screen effects',
  'Replay',
  'Sound',
  'Subagents',
  'MCP tools',
  'Web search',
  'Storage',
]

function tabLabels(container) {
  return container.querySelectorAll('[role="tab"]').map((tab) => tab.textContent.trim())
}

function selectedTab(container) {
  return container.querySelectorAll('[role="tab"]').filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.textContent.trim())
}

async function mountSettings(root, client = fakeClient()) {
  await act(async () => {
    root.render(createElement(Settings, { client, open: true, onClose: () => {} }))
  })
  await settle()
}

function shown(node) {
  if (!node) return false
  for (let n = node; n; n = n.parentNode) if (n.hidden === true || (n.attributes && 'hidden' in n.attributes)) return false
  return true
}

describe('Settings tabs', () => {
  it('lists one tab per section in a tablist and opens on Harnesses', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      expect(container.querySelector('[role="tablist"]')).not.toBeNull()
      expect(tabLabels(container)).toEqual(TAB_LABELS)
      expect(selectedTab(container)).toEqual(['Harnesses'])
      expect(container.querySelector('[aria-label="Harnesses"]')).not.toBeNull()
    })
  })

  it('shows one section at a time', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      await openTab(root, container, 'Replay')
      expect(shown(container.querySelector('[aria-label="Record time in minutes"]'))).toBe(true)
      expect(shown(container.querySelector('[aria-label="Harnesses"]'))).toBe(false)
      expect(shown(container.querySelector('#settings-direct-api'))).toBe(false)
      expect(shown(container.querySelector('[aria-label="Beeps"]'))).toBe(false)
      expect(selectedTab(container)).toEqual(['Replay'])
    })
  })

  it('moves between tabs with the arrow keys and wraps', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      const press = async (key) => {
        const current = container.querySelectorAll('[role="tab"]').find((tab) => tab.getAttribute('aria-selected') === 'true')
        await act(async () => {
          current.dispatchEvent({ type: 'keydown', key, bubbles: true, cancelable: true })
        })
      }
      await press('ArrowRight')
      expect(selectedTab(container)).toEqual(['Direct API'])
      await press('ArrowLeft')
      await press('ArrowLeft')
      expect(selectedTab(container)).toEqual(['Storage'])
      await press('Home')
      expect(selectedTab(container)).toEqual(['Harnesses'])
    })
  })

  it('remembers the open section and ignores an unknown saved one', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      await openTab(root, container, 'Sound')
      expect(window.localStorage.getItem('machineroom.settingsTab')).toBe('sound')
      await act(async () => {
        root.render(createElement('div'))
      })
      await mountSettings(root)
      expect(selectedTab(container)).toEqual(['Sound'])

      await act(async () => {
        root.render(createElement('div'))
      })
      window.localStorage.setItem('machineroom.settingsTab', 'nowhere')
      await mountSettings(root)
      expect(selectedTab(container)).toEqual(['Harnesses'])
    })
  })

  it('shows the four lane settings under Lanes and not under Harnesses', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      for (const id of ['#harness-lane-replies', '#harness-lane-count-warning', '#harness-worktree-setup', '#harness-worktree-copies']) {
        expect(shown(container.querySelector(id))).toBe(false)
      }
      await openTab(root, container, 'Lanes')
      await settle()
      for (const id of ['#harness-lane-replies', '#harness-lane-count-warning', '#harness-worktree-setup', '#harness-worktree-copies']) {
        expect(shown(container.querySelector(id))).toBe(true)
      }
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
