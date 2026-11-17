import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

describe('Lane conversation read order', () => {
  it('keeps the final report when an older running read answers last', async () => {
    const startedAt = '2026-11-17T12:00:00.000Z'
    const run = { lane: 'codex', startedAt, exitCode: 0 }
    const pending = []
    let notice
    const client = {
      runs: async () => ({ running: [], recent: [run] }),
      subscribe: (fn) => { notice = fn; return () => {} },
      runConversation: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(LaneConversation, { client, lane: 'codex', initialStartedAt: startedAt })))
      await act(async () => pending[0].resolve({ running: true, entries: [] }))
      expect(buttonWithText(container, 'Stop')).not.toBeNull()
      await act(async () => { notice({ topic: 'runs' }); notice({ topic: 'runs' }) })
      await settle()
      expect(pending).toHaveLength(3)
      await act(async () => pending[2].resolve({ running: false, entries: [{ role: 'result', text: 'Final report' }] }))
      await act(async () => pending[1].resolve({ running: true, entries: [] }))
      expect(container.textContent).toContain('Final report')
      expect(buttonWithText(container, 'Stop')).toBeNull()
    })
  })
})
