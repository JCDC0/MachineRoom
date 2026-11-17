import { act, createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { click, settle, type, withDom } from './helpers/uiDom.js'

function row(key, fields) {
  return { key, name: key, available: true, ready: true, enabled: true, program: key, version: '1', reason: '', models: [], efforts: [], ...fields }
}

describe('Harnesses drafts', () => {
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
