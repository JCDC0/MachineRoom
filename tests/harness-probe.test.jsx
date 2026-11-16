import { act, createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

function row(key, fields) {
  return { key, name: key, available: true, ready: true, enabled: true, program: key, version: '1', reason: '', models: [], efforts: [], ...fields }
}

function clientWith(probe) {
  const rows = [
    row('claude'),
    row('codex', { ready: false, reason: 'No program was found.' }),
    row('copilot', { enabled: false }),
  ]
  return {
    harnesses: vi.fn().mockResolvedValue(rows),
    probeHarness: probe,
    subscribe: vi.fn().mockReturnValue(() => {}),
  }
}

async function render(client, run) {
  await withDom(async ({ container, root }) => {
    await act(async () => {
      root.render(createElement(HarnessesSettings, { client }))
    })
    await settle()
    await run({ container, root })
  })
}

describe('Test connection', () => {
  test('shows the button only for a ready, enabled harness and runs nothing on load', async () => {
    const probe = vi.fn()
    await render(clientWith(probe), async ({ container }) => {
      expect(buttonWithText(container.querySelector('[data-harness="claude"]'), 'Test connection')).toBeTruthy()
      expect(buttonWithText(container.querySelector('[data-harness="codex"]'), 'Test connection')).toBeFalsy()
      expect(buttonWithText(container.querySelector('[data-harness="copilot"]'), 'Test connection')).toBeFalsy()
      expect(probe).not.toHaveBeenCalled()
    })
  })

  test('asks first, and Cancel sends nothing', async () => {
    const probe = vi.fn()
    await render(clientWith(probe), async ({ container, root }) => {
      await click(root, buttonWithText(container.querySelector('[data-harness="claude"]'), 'Test connection'))
      const dialog = container.querySelector('.mr-side-confirm[role="dialog"]')
      expect(dialog.textContent).toContain('This sends one short prompt to claude, which may use a little quota.')
      await click(root, buttonWithText(dialog, 'Cancel'))
      expect(probe).not.toHaveBeenCalled()
    })
  })

  test.each([
    [{ key: 'claude', status: 'reached', line: '', seconds: 2.5 }, 'Reached in 2.5s'],
    [{ key: 'claude', status: 'failed', line: 'Please sign in.', seconds: 1 }, 'Failed: Please sign in.'],
    [{ key: 'claude', status: 'unknown', line: 'no clear reply', seconds: 60 }, 'Unknown: no clear reply in 60s'],
  ])('shows the result %#', async (answer, text) => {
    const probe = vi.fn().mockResolvedValue(answer)
    await render(clientWith(probe), async ({ container, root }) => {
      await click(root, buttonWithText(container.querySelector('[data-harness="claude"]'), 'Test connection'))
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm'), 'Test'))
      await settle()
      expect(probe).toHaveBeenCalledWith('claude')
      expect(container.querySelector('[data-harness-probe="claude"]').textContent).toBe(text)
    })
  })
})
