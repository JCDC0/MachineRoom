import { act, createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { click, settle, type, withDom } from './helpers/uiDom.js'

function row(key, fields) {
  return { key, name: key, available: true, ready: true, enabled: true, program: key, version: '1', reason: '', models: [], efforts: [], ...fields }
}

describe('Harnesses drafts', () => {
  test('offer switches keep an unsaved program', async () => {
    let enabled = false
    const rows = () => [row('acp1', { enabled, ready: false, program: '' })]
    const client = {
      harnesses: vi.fn().mockImplementation(async () => rows()),
      harnessSettings: vi.fn().mockImplementation(async (payload) => {
        enabled = payload.enabled
        return rows()
      }),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(HarnessesSettings, { client })))
      await settle()
      await type(root, container.querySelector('#harness-program-acp1'), 'my-prog')
      await click(root, container.querySelector('[role="switch"]'))
      await settle()
      expect(container.querySelector('#harness-program-acp1').value).toBe('my-prog')
      await click(root, container.querySelector('[role="switch"]'))
      await settle()
      await click(root, container.querySelector('[role="dialog"]').querySelectorAll('button').find((button) => button.textContent.trim() === 'Turn off'))
      await settle()
      expect(container.querySelector('#harness-program-acp1').value).toBe('my-prog')
      expect(client.harnessSettings.mock.calls.map(([payload]) => payload.enabled)).toEqual([true, false])
    })
  })

  test('a family notice keeps unsaved edits and a save clears only its own field', async () => {
    let notify
    const rows = () => [
      row('claude', { worktreeSetup: 'old', worktreeCopies: ['a.txt'] }),
      row('acp1', { ready: false, reason: 'No program was found.' }),
    ]
    const client = {
      harnesses: vi.fn().mockImplementation(async () => rows()),
      harnessSettings: vi.fn().mockResolvedValue(rows().map((r) => ({ ...r, worktreeSetup: 'npm ci' }))),
      subscribe: vi.fn().mockImplementation((fn) => {
        notify = fn
        return () => {}
      }),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()
      const setup = container.querySelector('#harness-worktree-setup')
      const copies = container.querySelector('#harness-worktree-copies')
      await type(root, setup, 'npm ci')
      await type(root, copies, 'b.txt')
      await act(async () => {
        notify({ topic: 'family' })
      })
      await settle()
      expect(container.querySelector('#harness-worktree-setup').value).toBe('npm ci')
      expect(container.querySelector('#harness-worktree-copies').value).toBe('b.txt')
      const program = container.querySelector('#harness-program-acp1')
      expect(program).toBeTruthy()
      {
        await type(root, program, 'my-prog')
        await click(root, container.querySelectorAll('button').filter((b) => b.textContent.trim() === 'Save').at(-1))
        await settle()
        expect(container.querySelector('#harness-program-acp1').value).toBe('my-prog')
      }
      expect(container.querySelector('#harness-worktree-setup').value).toBe('npm ci')
    })
  })
})
