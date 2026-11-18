import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import HarnessesSettings, { LaneSettingsFields } from '../src/ui/HarnessesSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, click, settle, type, withDom, openTab } from './helpers/uiDom.js'

function rowFor(container, key) {
  return container.querySelector(`[data-harness="${key}"]`)
}

function fakeHarnessClient(overrides = {}) {
  const rows = overrides.rows ?? [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      ready: true,
      enabled: true,
      program: 'claude',
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
    {
      key: 'copilot',
      name: 'GitHub Copilot',
      available: false,
      ready: false,
      enabled: false,
      program: '',
      version: '',
      reason: '',
      models: [],
      efforts: [],
    },
    {
      key: 'machineroom',
      name: 'MachineRoom',
      available: false,
      ready: false,
      enabled: true,
      program: '',
      version: '',
      reason: 'No key is saved.',
      models: [],
      efforts: [],
    },
  ]
  return {
    harnesses: vi.fn().mockResolvedValue(rows),
    checkHarnesses: vi.fn().mockResolvedValue(rows),
    harnessSettings: vi.fn().mockImplementation(async ({ key, program, enabled }) => {
      const target = rows.find((item) => item.key === key)
      if (!target) throw new Error('Unknown harness.')
      if (program !== undefined) target.program = program
      if (enabled !== undefined) target.enabled = enabled
      return { harness: { ...target }, harnesses: rows.map((item) => ({ ...item })) }
    }),
    keys: vi.fn().mockResolvedValue([{ name: 'OPENAI_API_KEY' }]),
    endpoints: vi.fn().mockResolvedValue([
      { id: 'ollama', name: 'Local Ollama', ready: true },
      { id: 'openrouter', name: 'OpenRouter Work', ready: false },
    ]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
}

describe('mock harnesses client calls', () => {
  test('mock lists the sample harness states required by P356', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const list = await client.harnesses()
    const byKey = Object.fromEntries(list.map((entry) => [entry.key, entry]))

    expect(byKey.claude.ready).toBe(true)
    expect(byKey.claude.enabled).toBe(true)
    expect(byKey.opencode.ready).toBe(true)
    expect(byKey.opencode.enabled).toBe(true)
    expect(byKey.agy.ready).toBe(true)
    expect(byKey.agy.enabled).toBe(true)
    expect(byKey.codex.ready).toBe(false)
    expect(byKey.codex.enabled).toBe(true)
    expect(byKey.codex.reason).toBeTruthy()
    expect(byKey.copilot.enabled).toBe(false)
    expect(byKey.machineroom.ready).toBe(false)
    expect(byKey.machineroom.enabled).toBe(true)
  })

  test('mock checkHarnesses redraws and harnessSettings updates program and enabled state', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const checked = await client.checkHarnesses({ confirmed: true })
    expect(Array.isArray(checked)).toBe(true)

    const customProgram = 'C:\\Tools\\codex\\codex.exe'
    await client.harnessSettings({ key: 'codex', program: customProgram, confirmed: true })
    await client.harnessSettings({ key: 'claude', enabled: false, confirmed: true })

    const updated = await client.harnesses()
    const codex = updated.find((entry) => entry.key === 'codex')
    const claude = updated.find((entry) => entry.key === 'claude')
    expect(codex.program).toBe(customProgram)
    expect(claude.enabled).toBe(false)

    await expect(
      client.harnessSettings({ key: 'codex', program: './relative/codex', confirmed: true })
    ).rejects.toThrow()
    await expect(
      client.harnessSettings({ key: 'claude', enabled: false, confirmed: false })
    ).rejects.toThrow()
  })
})

describe('HarnessesSettings UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders rows and state words with colours from the mock client', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle(20)

      const claudeRow = rowFor(container, 'claude')
      const opencodeRow = rowFor(container, 'opencode')
      const agyRow = rowFor(container, 'agy')
      const codexRow = rowFor(container, 'codex')
      const copilotRow = rowFor(container, 'copilot')
      const nativeRow = rowFor(container, 'machineroom')

      expect(claudeRow).not.toBeNull()
      expect(opencodeRow).not.toBeNull()
      expect(agyRow).not.toBeNull()
      expect(codexRow).not.toBeNull()
      expect(copilotRow).not.toBeNull()
      expect(nativeRow).not.toBeNull()

      const claudeState = claudeRow.querySelector('[data-harness-state]')
      expect(claudeState.textContent.trim()).toBe('Ready')
      expect(claudeState.style.color).toBe('#2aff80')
      expect(claudeRow.textContent).toContain('Claude Code')
      expect(claudeRow.textContent).toContain('2.1.0')
      expect(claudeRow.textContent).toContain('C:\\Tools\\claude\\claude.exe')

      const codexState = codexRow.querySelector('[data-harness-state]')
      expect(codexState.textContent.trim()).toBe('Not ready')
      expect(codexState.style.color).toBe('#ff2a2a')
      expect(codexRow.textContent).toContain('Program not found on PATH.')

      const copilotState = copilotRow.querySelector('[data-harness-state]')
      expect(copilotState.textContent.trim()).toBe('Off')
      expect(copilotState.style.color).toBe('rgb(255 255 255 / 0.5)')

      expect(agyRow.querySelector('[data-harness-state]').textContent.trim()).toBe('Ready')
    })
  })

  test('Offer in forms sends { key, enabled: false } only after confirmation', async () => {
    const client = fakeHarnessClient()
    await withDom(async ({ container, root, window }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const claudeRow = rowFor(container, 'claude')
      const toggle = claudeRow.querySelector('button[role="switch"]')
      expect(toggle).not.toBeNull()
      expect(toggle.getAttribute('aria-checked')).toBe('true')

      await click(root, toggle)
      expect(client.harnessSettings).not.toHaveBeenCalled()

      const dialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      expect(dialog).not.toBeNull()

      await click(root, buttonWithText(dialog, 'Cancel'))
      expect(client.harnessSettings).not.toHaveBeenCalled()
      expect(container.querySelector('.mr-side-confirm')).toBeNull()

      await click(root, toggle)
      const secondDialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      expect(secondDialog).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-side-confirm')).toBeNull()
      expect(client.harnessSettings).not.toHaveBeenCalled()

      await click(root, toggle)
      const confirmDialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      const confirmButton = confirmDialog.querySelector('.mr-side-confirm-btn.is-danger')
      await click(root, confirmButton)
      await settle()

      expect(client.harnessSettings).toHaveBeenCalledTimes(1)
      expect(client.harnessSettings.mock.calls[0][0]).toMatchObject({
        key: 'claude',
        enabled: false,
      })

      const copilotRow = rowFor(container, 'copilot')
      const copilotToggle = copilotRow.querySelector('button[role="switch"]')
      await click(root, copilotToggle)
      await settle()
      expect(client.harnessSettings).toHaveBeenCalledTimes(2)
      expect(client.harnessSettings.mock.calls[1][0]).toMatchObject({
        key: 'copilot',
        enabled: true,
      })
    })
  })

  test('Save sends the program after confirmation and Clear clears it', async () => {
    const client = fakeHarnessClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const codexRow = rowFor(container, 'codex')
      const input = codexRow.querySelector('input')
      expect(input).not.toBeNull()
      expect(input.type).toBe('text')

      const targetProgram = 'C:\\Tools\\codex\\codex.exe'
      await type(root, input, targetProgram)
      await click(root, buttonWithText(codexRow, 'Save'))
      expect(client.harnessSettings).not.toHaveBeenCalled()

      const dialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      expect(dialog).not.toBeNull()
      const confirmButton = dialog.querySelector('.mr-side-confirm-btn.is-primary')
      await click(root, confirmButton)
      await settle()

      expect(client.harnessSettings).toHaveBeenCalledWith({
        key: 'codex',
        program: targetProgram,
        confirmed: true,
      })

      await click(root, buttonWithText(codexRow, 'Clear'))
      await settle()
      expect(client.harnessSettings).toHaveBeenCalledWith({
        key: 'codex',
        program: '',
        confirmed: true,
      })
    })
  })

  test('shows bridge refusal under the row in red', async () => {
    const client = fakeHarnessClient({
      harnessSettings: vi.fn().mockRejectedValue(new Error('Give a full program path, not a relative path.')),
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const claudeRow = rowFor(container, 'claude')
      const input = claudeRow.querySelector('input')
      await type(root, input, './relative/claude')
      await click(root, buttonWithText(claudeRow, 'Save'))

      const dialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      const confirmButton = dialog.querySelector('.mr-side-confirm-btn.is-primary')
      await click(root, confirmButton)
      await settle()

      const errorNode = claudeRow.querySelector('.endpoints-error')
      expect(errorNode).not.toBeNull()
      expect(errorNode.textContent).toContain('Give a full program path, not a relative path.')
    })
  })

  test('Direct API row has no Program input and shows saved key and endpoint counts', async () => {
    const client = fakeHarnessClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const nativeRow = rowFor(container, 'machineroom')
      expect(nativeRow).not.toBeNull()
      expect(nativeRow.textContent).toContain('Direct API')
      expect(nativeRow.querySelector('input')).toBeNull()
      expect(buttonWithText(nativeRow, 'Save')).toBeNull()
      expect(buttonWithText(nativeRow, 'Clear')).toBeNull()
      expect(nativeRow.textContent).toContain('1 key')
      expect(nativeRow.textContent).toContain('2 endpoints')
      expect(nativeRow.textContent).toContain('Direct API')
    })
  })

  test('Check again posts to checkHarnesses and redraws rows', async () => {
    const updatedRows = [
      {
        key: 'claude',
        name: 'Claude Code',
        available: true,
        ready: true,
        enabled: true,
        program: 'C:\\Tools\\claude\\claude.exe',
        version: '2.2.0',
        reason: '',
        models: [],
        efforts: [],
      },
    ]
    const client = fakeHarnessClient({
      checkHarnesses: vi.fn().mockResolvedValue(updatedRows),
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const checkButton = buttonWithText(container, 'Check again')
      expect(checkButton).not.toBeNull()
      await click(root, checkButton)
      await settle()

      expect(client.checkHarnesses).toHaveBeenCalledTimes(1)
      expect(rowFor(container, 'claude').textContent).toContain('2.2.0')
    })
  })

  test('shows live message when no bridge client is available', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client: null }))
      })
      await settle()

      expect(container.textContent).toContain('Harnesses are listed when the room runs live.')
    })
  })

  test('Settings opens on Harnesses and shows Direct API on its own tab', async () => {
    const client = fakeHarnessClient({
      rows: [],
      projectSettings: vi.fn().mockResolvedValue({ checkCommand: '' }),
      agentsDepth: vi.fn().mockResolvedValue({ maxDepth: 2 }),
      lanes: vi.fn().mockResolvedValue([]),
      mcpServers: vi.fn().mockResolvedValue([]),
      searchSettings: vi.fn().mockResolvedValue({ provider: 'duckduckgo' }),
      storageRoots: vi.fn().mockResolvedValue({ roots: [] }),
    })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { client, open: true, onClose: () => {} }))
      })
      await settle()

      const shown = (node) => {
        for (let n = node; n; n = n.parentNode) if (n.hidden === true || (n.attributes && 'hidden' in n.attributes)) return false
        return Boolean(node)
      }
      expect(shown(container.querySelector('[aria-label="Harnesses"]'))).toBe(true)
      expect(shown(container.querySelector('#settings-direct-api'))).toBe(false)
      await openTab(root, container, 'Direct API')
      await settle()
      expect(shown(container.querySelector('[aria-label="Harnesses"]'))).toBe(false)
      expect(shown(container.querySelector('#settings-direct-api'))).toBe(true)
    })
  })

  test('retries the first lane settings read and keeps a typed draft', async () => {
    const client = {
      harnesses: vi.fn()
        .mockRejectedValueOnce(new Error('Lane settings unavailable.'))
        .mockResolvedValue([{ worktreeSetup: 'npm ci', laneReplies: 'interrupt' }]),
      harnessSettings: vi.fn().mockResolvedValue({}),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(LaneSettingsFields, { client })))
      const setup = container.querySelector('#harness-worktree-setup')
      const replies = container.querySelector('#harness-lane-replies')
      const saves = container.querySelectorAll('button').filter((button) => button.textContent.trim() === 'Save')
      expect(container.querySelector('[role="alert"]').textContent).toContain('Lane settings unavailable.')
      expect(saves).toHaveLength(2)
      expect(saves.every((button) => button.hasAttribute('disabled'))).toBe(true)
      expect(replies.hasAttribute('disabled')).toBe(true)
      await type(root, setup, 'npm install')
      const retry = buttonWithText(container, 'Retry')
      expect(retry).not.toBeNull()
      await click(root, retry)
      expect(client.harnesses).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(buttonWithText(container, 'Retry')).toBeNull()
      expect(saves.every((button) => !button.hasAttribute('disabled'))).toBe(true)
      expect(replies.hasAttribute('disabled')).toBe(false)
      expect(setup.value).toBe('npm install')
    })
  })

  test('lane settings cannot be saved until their first read has succeeded', async () => {
    let release
    const client = {
      harnesses: vi.fn().mockImplementation(() => new Promise((resolve) => { release = () => resolve([{ key: 'claude', laneReplies: 'next-turn' }]) })),
      harnessSettings: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockImplementation(() => () => {}),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(LaneSettingsFields, { client }))
      })
      await settle()
      const saves = () => container.querySelectorAll('button').filter((b) => b.textContent.trim() === 'Save')
      expect(saves().length).toBe(2)
      expect(saves().every((b) => b.getAttribute('disabled') !== null)).toBe(true)
      await act(async () => {
        release()
      })
      await settle()
      expect(saves().every((b) => b.getAttribute('disabled') === null)).toBe(true)
    })
  })

  test('keeps the Retry answer when older lane settings reads settle last', async () => {
    const pending = []
    let notice
    const client = {
      harnesses: vi.fn()
        .mockRejectedValueOnce(new Error('Lane settings unavailable.'))
        .mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))),
      subscribe: (fn) => { notice = fn; return () => {} },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(LaneSettingsFields, { client })))
      await act(async () => {
        notice({ topic: 'harnesses' })
        notice({ topic: 'harnesses' })
      })
      await click(root, buttonWithText(container, 'Retry'))
      await act(async () => pending[2].resolve([{ laneReplies: 'interrupt', worktreeSetup: 'npm ci' }]))
      const setup = container.querySelector('#harness-worktree-setup')
      expect(setup.value).toBe('npm ci')
      await act(async () => pending[0].resolve([{ laneReplies: 'next-turn', worktreeSetup: 'npm install' }]))
      await act(async () => pending[1].reject(new Error('Old read failed.')))
      expect(setup.value).toBe('npm ci')
      expect(container.querySelector('[role="alert"]')).toBeNull()
    })
  })
})
