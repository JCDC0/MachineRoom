import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import { runClock } from '../src/ui/laneConversation.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

afterEach(() => vi.useRealTimers())

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

  it('selects the new run after an accepted start', async () => {
    const lane = 'codex'
    const old = { lane, startedAt: '2026-11-17T11:00:00.000Z', exitCode: 0 }
    const fresh = { lane, startedAt: '2026-11-17T12:00:00.000Z' }
    let history = { recent: [old] }
    let notice
    const client = {
      runs: async () => history,
      subscribe: (fn) => { notice = fn; return () => {} },
      runConversation: async () => ({ entries: [] }),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(LaneConversation, {
        client, lane, onRecipientSend: async () => ({ ok: true }),
      })))
      await settle(5)
      await type(root, container.querySelector('textarea'), 'go')
      await act(async () => container.querySelector('.mr-composer-box').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true }))
      await settle(5)
      history = { running: [fresh], recent: [old] }
      await act(async () => notice({ topic: 'runs' }))
      expect(container.querySelector('.ui-chip-value').textContent).toBe(runClock(fresh.startedAt))
    })
  })

  it('recomputes run dates when the picker opens after midnight', async () => {
    const lane = 'codex'
    const startedAt = new Date(2026, 10, 18, 23, 55, 0).toISOString()
    const client = { runs: async () => ({ recent: [{ lane, startedAt, exitCode: 0 }] }), runConversation: async () => ({ entries: [] }) }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 18, 23, 58, 0))
    try {
      await withDom(async ({ container, root }) => {
        await act(async () => root.render(createElement(LaneConversation, { client, lane })))
        const option = () => container.querySelector('[aria-label="Run"] option').textContent
        expect(option()).toContain('23:55:00')
        expect(option()).not.toContain('11-18')
        vi.setSystemTime(new Date(2026, 10, 19, 0, 1, 0))
        await act(async () => container.querySelector('[aria-label="Run"]').dispatchEvent({ type: 'mousedown', bubbles: true, cancelable: true }))
        expect(option()).toContain('11-18 23:55:00')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
