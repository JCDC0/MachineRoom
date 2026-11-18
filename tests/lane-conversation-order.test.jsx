import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

describe('Lane conversation read order', () => {
  it('drops a pending Open after a failed history read or a manual run choice', async () => {
    const lane = 'codex'
    const failed = { lane, startedAt: '2026-11-17T11:00:00.000Z', exitCode: 1 }
    const live = { lane, startedAt: '2026-11-17T12:00:00.000Z' }
    for (const readFails of [true, false]) {
      const calls = []
      let finishHistory
      let rejectHistory
      let notice
      const history = { running: [live], recent: [failed] }
      const client = {
        runs: () => finishHistory
          ? Promise.resolve(history)
          : new Promise((resolve, reject) => {
            finishHistory = () => resolve(history)
            rejectHistory = reject
          }),
        subscribe: (fn) => { notice = fn; return () => {} },
        runConversation: async ({ startedAt }) => {
          calls.push(startedAt)
          return { entries: [] }
        },
      }
      await withDom(async ({ container, root }) => {
        await act(async () => root.render(createElement(LaneConversation, {
          client, lane, initialStartedAt: failed.startedAt, liveRuns: [live],
        })))
        if (readFails) {
          await act(async () => rejectHistory(new Error('History unavailable.')))
          await act(async () => notice({ topic: 'runs' }))
        } else {
          const picker = container.querySelector('[aria-label="Run"]')
          await act(async () => {
            picker.value = live.startedAt
            picker.dispatchEvent({ type: 'change' })
          })
          await act(async () => finishHistory())
        }
        expect(calls.at(-1), readFails ? 'failed read' : 'manual choice').toBe(live.startedAt)
      })
    }
  })

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

  it('reports a failed history read and retries without reopening the pending run', async () => {
    const lane = 'codex'
    const requested = '2026-11-17T11:00:00.000Z'
    const newest = '2026-11-17T12:00:00.000Z'
    const calls = []
    let reads = 0
    const client = {
      runs: async () => {
        if (++reads === 1) throw new Error('History unavailable.')
        return { recent: [newest, requested].map((startedAt) => ({ lane, startedAt })) }
      },
      runConversation: async ({ startedAt }) => {
        calls.push(startedAt)
        return { entries: [] }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(LaneConversation, { client, lane, initialStartedAt: requested })))
      expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain('Could not read run history.')
      expect(container.querySelector('[aria-label="Run"]').textContent).not.toContain('No runs')
      expect(container.textContent).not.toContain('No runs yet.')
      await click(root, buttonWithText(container, 'Retry'))
      expect(reads).toBe(2)
      expect(buttonWithText(container, 'Retry')).toBeNull()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(calls).toEqual([requested, newest])
    })
  })
})
