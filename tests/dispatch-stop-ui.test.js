import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local', role: null },
]

function makeStopClient({ running, recent = [], onStop, includeStop = true }) {
  let currentRunning = [...running]
  let currentRecent = [...recent]
  const stopCalls = []
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => AGENTS,
    runs: async () => ({ running: currentRunning, recent: currentRecent, project: 'C:\\work\\demo' }),
    ...(includeStop
      ? {
          stopRun: async (payload) => {
            stopCalls.push(payload)
            if (onStop) return onStop(payload, { setRuns: (next) => { currentRunning = next.running; currentRecent = next.recent } })
            const index = currentRunning.findIndex((item) => item.lane === payload.lane)
            const [stopped] = currentRunning.splice(index, 1)
            if (stopped) {
              currentRecent.unshift({
                lane: stopped.lane,
                briefs: stopped.briefs ?? [],
                startedAt: stopped.startedAt,
                minutes: 0,
                exitCode: 1,
                killed: true,
                note: 'stopped by the owner',
              })
            }
            return { ok: true, lane: payload.lane, startedAt: payload.startedAt, output: `stopped: ${payload.lane}` }
          },
        }
      : {}),
  }
  return { client, stopCalls }
}

describe('DispatchPanel running row Stop action', () => {
  it('shows Stop, opens a confirm card naming the lane, work and start time, and sends them on confirm', async () => {
    const firstStart = '2026-10-24T12:00:00.000Z'
    const secondStart = '2026-10-24T12:05:00.000Z'
    const { client, stopCalls } = makeStopClient({
      running: [
        { lane: 'opencode', briefs: ['B6', 'U4'], startedAt: firstStart, lastLines: [] },
        { lane: 'opencode2', briefs: [], task: 'Fix the panel badge.', startedAt: secondStart, lastLines: [] },
      ],
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settle(15)

      const rows = container.querySelectorAll('.runs-entry.is-running')
      expect(rows).toHaveLength(2)
      expect(rows[1].textContent).toContain('Fix the panel badge.')

      const firstStop = buttonWithText(rows[0], 'Stop')
      expect(firstStop).not.toBeNull()
      await click(root, firstStop)
      await settle(10)

      let card = rows[0].querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('Lane: opencode')
      expect(card.textContent).toContain('Briefs: B6 U4')
      expect(card.textContent).toContain(firstStart)
      expect(stopCalls).toEqual([])

      await click(root, buttonWithText(card, 'Cancel'))
      await settle(10)
      expect(rows[0].querySelector('.brief-confirm-card')).toBeNull()
      expect(stopCalls).toEqual([])

      const refreshedRows = container.querySelectorAll('.runs-entry.is-running')
      const secondStop = buttonWithText(refreshedRows[1], 'Stop')
      expect(secondStop).not.toBeNull()
      await click(root, secondStop)
      await settle(10)

      card = refreshedRows[1].querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('Lane: opencode2')
      expect(card.textContent).toContain('Task: Fix the panel badge.')
      expect(card.textContent).toContain(secondStart)

      await click(root, buttonWithText(card, 'Confirm'))
      await settle(15)

      expect(stopCalls).toEqual([
        { lane: 'opencode2', startedAt: secondStart, confirmed: true },
      ])
      expect(container.querySelectorAll('.runs-entry.is-running')).toHaveLength(1)
      expect(container.querySelector('.runs-entry.is-running').textContent).toContain('opencode')
      expect(container.querySelector('.runs-entry.is-recent').textContent).toContain('opencode2')
      expect(container.querySelector('.runs-entry.is-recent').textContent).toContain('stopped')
    })
  })

  it('shows a refusal error on the card and hides Stop when stopRun is unavailable', async () => {
    const start = '2026-10-24T12:10:00.000Z'
    const failing = makeStopClient({
      running: [{ lane: 'opencode', briefs: ['B6'], startedAt: start, lastLines: [] }],
      onStop: async () => {
        throw new Error('That start time does not match the running run.')
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client: failing.client, initialAgents: AGENTS }))
      })
      await settle(15)

      const row = container.querySelector('.runs-entry.is-running')
      await click(root, buttonWithText(row, 'Stop'))
      await settle(10)
      const card = row.querySelector('.brief-confirm-card')
      await click(root, buttonWithText(card, 'Confirm'))
      await settle(15)

      expect(card.querySelector('[role="alert"]').textContent).toBe('That start time does not match the running run.')
    })

    const readOnly = makeStopClient({
      running: [{ lane: 'opencode', briefs: ['B6'], startedAt: start, lastLines: [] }],
      includeStop: false,
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client: readOnly.client, initialAgents: AGENTS }))
      })
      await settle(15)

      const row = container.querySelector('.runs-entry.is-running')
      expect(row).not.toBeNull()
      expect(buttonWithText(row, 'Stop')).toBeNull()
    })
  })
})
