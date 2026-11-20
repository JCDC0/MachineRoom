import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import Hud from '../src/ui/Hud.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, settle, type, withDom, openTab } from './helpers/uiDom.js'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function cssBlocks(selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, names]) => names.split(',').map((name) => name.trim()).includes(selector))
    .map(([, , body]) => body)
    .join(';')
}

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

function sectionSelect(container) {
  return container.querySelector('#hud-settings-section')
}

function tabLabels(container) {
  return (sectionSelect(container)?.querySelectorAll('option') ?? []).map((option) => option.textContent.trim())
}

function selectedTab(container) {
  const select = sectionSelect(container)
  if (!select) return []
  const option = select.querySelectorAll('option').find((item) => {
    const value = item.value !== undefined ? String(item.value) : (item.getAttribute('value') ?? '')
    return value === select.value
  })
  return option ? [option.textContent.trim()] : []
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

describe('Settings sections dropdown', () => {
  it('lists one option per section in the select and opens on Harnesses', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      expect(container.querySelector('[role="tablist"]')).toBeNull()
      const select = sectionSelect(container)
      expect(select).not.toBeNull()
      expect(select.tagName).toBe('SELECT')
      expect(tabLabels(container)).toEqual(TAB_LABELS)
      expect(selectedTab(container)).toEqual(['Harnesses'])
      const panel = container.querySelector('#hud-settings-panel')
      expect(panel.getAttribute('role')).toBeNull()
      expect(panel.getAttribute('aria-labelledby')).toBeNull()
      expect(panel.getAttribute('aria-label')).toBe('Harnesses')
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
      expect(container.querySelector('#hud-settings-panel').getAttribute('aria-label')).toBe('Replay')
    })
  })

  it('switches sections when the dropdown value changes', async () => {
    await withDom(async ({ container, root }) => {
      await mountSettings(root)
      await openTab(root, container, 'Direct API')
      expect(selectedTab(container)).toEqual(['Direct API'])
      expect(container.querySelector('#hud-settings-panel').getAttribute('aria-label')).toBe('Direct API')
      await openTab(root, container, 'Storage')
      expect(selectedTab(container)).toEqual(['Storage'])
      expect(container.querySelector('#hud-settings-panel').getAttribute('aria-label')).toBe('Storage')
      await openTab(root, container, 'Harnesses')
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

  it('saves the four lane settings through the Lanes tab', async () => {
    const client = fakeClient()
    client.harnesses.mockResolvedValue({ harnesses: harnessRows(), laneCountWarning: 2 })
    await withDom(async ({ container, root }) => {
      await mountSettings(root, client)
      await openTab(root, container, 'Lanes')
      await settle(20)
      await type(root, container.querySelector('#harness-lane-replies'), 'interrupt')
      expect(client.harnessSettings).toHaveBeenLastCalledWith({ laneReplies: 'interrupt', confirmed: true })
      await type(root, container.querySelector('#harness-lane-count-warning'), '4')
      const saves = () => container.querySelector('[aria-label="Lane settings"]').querySelectorAll('button').filter((button) => button.textContent.trim() === 'Save')
      await act(async () => {
        saves()[0].click()
      })
      await settle()
      expect(client.harnessSettings).toHaveBeenLastCalledWith({ laneCountWarning: 4, confirmed: true })
      await type(root, container.querySelector('#harness-worktree-setup'), ' npm ci ')
      await type(root, container.querySelector('#harness-worktree-copies'), '.env\n\n config/a.json ')
      await act(async () => {
        saves()[1].click()
      })
      await settle()
      expect(client.harnessSettings).toHaveBeenLastCalledWith({ worktreeSetup: 'npm ci', worktreeCopies: ['.env', 'config/a.json'], confirmed: true })
    })
  })

  it('styles the section dropdown row and select with yellow focus', () => {
    expect(cssBlocks('.hud-settings-tabs')).toBe('')
    expect(cssBlocks('.hud-settings-tab')).toBe('')
    const row = cssBlocks('label.hud-settings-section')
    expect(row).toMatch(/display:\s*flex/)
    expect(row).toMatch(/flex-direction:\s*row/)
    expect(row).toMatch(/gap:\s*var\(--space\)/)
    expect(row).toMatch(/color:\s*var\(--text-dim\)/)
    const select = cssBlocks('.hud-settings-select')
    expect(select).toMatch(/background:\s*var\(--black\)/)
    expect(select).toMatch(/border:\s*1px solid rgb\(255 255 255 \/ 0\.35\)/)
    expect(select).toMatch(/color:\s*var\(--white\)/)
    expect(select).toMatch(/font-family:\s*var\(--mono\)/)
    expect(select).toMatch(/font-size:\s*12px/)
    expect(select).toMatch(/padding:\s*4px 8px/)
    expect(cssBlocks('.hud-settings-select:focus')).toMatch(/border-color:\s*var\(--yellow\)/)
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

  it('consumes the Direct API request so resizing and the menu use the saved tab', async () => {
    const props = {
      snapshot: { agents: [], status: 'live', position: 0 },
      project: 'MachineRoom',
      client: fakeClient(),
      mode: 'live',
      liveRuns: [],
      log: [],
      health: { ok: true, orchestrator: true },
      focused: null,
      speeds: [1],
      markers: [],
    }
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1280
      globalThis.document.getElementById = () => null
      await act(async () => {
        root.render(createElement(Hud, { ...props, settingsRequest: 0 }))
      })
      await settle()
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.CustomEvent('machineroom:open-settings'))
      })
      await settle()
      const settingsTab = () => selectedTab(container.querySelector('#hud-settings'))
      expect(settingsTab()).toEqual(['Direct API'])
      await openTab(root, container, 'Lanes')
      for (const width of [899, 900]) {
        await act(async () => {
          dom.window.innerWidth = width
          dom.window.dispatchEvent({ type: 'resize' })
        })
        expect(settingsTab()).toEqual(['Lanes'])
      }
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.CustomEvent('machineroom:open-settings'))
      })
      expect(settingsTab()).toEqual(['Direct API'])
      await openTab(root, container, 'Harnesses')
      await act(async () => {
        buttonWithText(container, 'Close').click()
      })
      await settle()
      expect(container.querySelector('#hud-settings-section')).toBeNull()
      await act(async () => {
        root.render(createElement(Hud, { ...props, settingsRequest: 1 }))
      })
      await settle()
      expect(settingsTab()).toEqual(['Harnesses'])
    })
  })

  it('gives each Direct API link click one focus request across a close and reopen', async () => {
    const props = {
      snapshot: { agents: [], status: 'live', position: 0 },
      project: 'MachineRoom',
      client: fakeClient(),
      mode: 'live',
      liveRuns: [],
      log: [],
      health: { ok: true, orchestrator: true },
      focused: null,
      speeds: [1],
      markers: [],
    }
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem('machineroom.guide', '1')
      dom.window.innerWidth = 1280
      globalThis.document.getElementById = () => null
      await act(async () => {
        root.render(createElement(Hud, { ...props, settingsRequest: 0 }))
      })
      await settle()
      const settingsTab = () => selectedTab(container.querySelector('#hud-settings'))
      const openFromLink = async () => {
        await act(async () => {
          dom.window.dispatchEvent(new dom.window.CustomEvent('machineroom:open-settings'))
        })
        await settle()
      }
      for (let round = 0; round < 2; round += 1) {
        await openFromLink()
        expect(settingsTab()).toEqual(['Direct API'])
        await openTab(root, container, 'Lanes')
        await act(async () => {
          buttonWithText(container, 'Close').click()
        })
        await settle()
        expect(container.querySelector('#hud-settings')).toBeNull()
      }
      await act(async () => {
        root.render(createElement(Hud, { ...props, settingsRequest: 1 }))
      })
      await settle()
      expect(settingsTab()).toEqual(['Lanes'])
    })
  })
})
