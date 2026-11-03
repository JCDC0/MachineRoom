import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Transport, {
  LanePillsContext,
  OrchestratorsContext,
  TransportCostsContext,
} from '../src/ui/Transport.jsx'
import {
  COSTS_DRAWER_SELECTOR,
  COSTS_ENTRY_SELECTOR,
  money,
  openCostsDrawer,
  spendText,
  spendTotals,
} from '../src/ui/transportSpend.js'

const LIVE = { live: true, position: 65000, duration: 0, playing: true, speed: 1 }
const MAIN = { id: 'orchestrator', name: 'Orchestrator', state: 'working' }
const NOW = Date.parse('2026-11-03T12:00:00.000Z')

function board(rows) {
  return { summary: { spendCents: 0, budgetCents: 0, percent: null, over: false }, rows, quota: [] }
}

function row(key, costCents, todayCents, reported = true) {
  return { key, agentId: `agent-${key}`, name: key, costCents, todayCents, reported }
}

describe('the spend text', () => {
  it('writes dollars and cents for today and the month', () => {
    expect(money(0)).toBe('$0.00')
    expect(money(125)).toBe('$1.25')
    expect(money(123456)).toBe('$1234.56')
    expect(money(-5)).toBe('$0.00')
    expect(money(null)).toBe('$0.00')
  })

  it('sums the lanes that report a cost', () => {
    const totals = spendTotals(
      board([row('opencode', 350, 125), row('opencode2', 0, 0, false), row('agy', 25, null)])
    )
    expect(totals).toEqual({ todayCents: 125, monthCents: 375, reported: true })
    expect(spendText(board([row('opencode', 350, 125), row('agy', 25, null)]))).toBe(
      '$1.25 today · $3.75 mo'
    )
  })

  it('shows nothing when no lane reports a cost', () => {
    expect(spendText(null)).toBeNull()
    expect(spendText(undefined)).toBeNull()
    expect(spendText(board([]))).toBeNull()
    expect(spendText(board([row('opencode', 0, 0, false)]))).toBeNull()
    expect(spendText({ rows: 'none' })).toBeNull()
  })
})

describe('the spend click', () => {
  it('opens the Costs drawer and brings it into view', () => {
    const calls = []
    const documentStub = {
      querySelector(selector) {
        if (selector === COSTS_ENTRY_SELECTOR) return { click: () => calls.push('click') }
        if (selector === COSTS_DRAWER_SELECTOR) return { scrollIntoView: (options) => calls.push(options) }
        return null
      },
    }
    expect(openCostsDrawer(documentStub)).toBe(true)
    expect(calls[0]).toBe('click')
    expect(calls[1]).toMatchObject({ block: 'center' })
  })

  it('does nothing without a document or the Overview entry', () => {
    expect(openCostsDrawer(null)).toBe(false)
    expect(openCostsDrawer({})).toBe(false)
    expect(openCostsDrawer({ querySelector: () => null })).toBe(false)
  })
})

describe('the transport with lanes and spend', () => {
  function renderTransport() {
    return renderToString(
      createElement(
        OrchestratorsContext.Provider,
        { value: [{ id: 'orchestrator', state: 'working' }] },
        createElement(
          LanePillsContext.Provider,
          {
            value: {
              agents: [
                { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
                { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local', role: null },
              ],
              liveRuns: [
                {
                  agentId: 'agent-opencode',
                  status: 'running',
                  issueId: 'opencode-U120-1',
                  startedAt: new Date(NOW - 12 * 60000).toISOString(),
                },
              ],
              issues: [{ id: 'opencode-U120-1', identifier: 'U120', title: 'Lane pills' }],
              records: { running: [], recent: [] },
              labels: null,
              now: NOW,
            },
          },
          createElement(
            TransportCostsContext.Provider,
            { value: board([row('opencode', 350, 125)]) },
            createElement(Transport, { snapshot: LIVE, speeds: [1], orchestrator: MAIN })
          )
        )
      )
    )
  }

  it('shows one pill per lane and the spend just left of the ring', () => {
    const html = renderTransport()
    expect(html).toContain('transport-lanes')
    expect(html).toContain('transport-lane is-working')
    expect(html).toContain('OpenCode')
    expect(html).toContain('U120')
    expect(html).toContain('OpenCode · U120 · working · 12 min')
    expect(html).toContain('transport-spend')
    expect(html).toContain('$1.25 today · $3.50 mo')
  })

  it('shows no spend without a cost and no pill without a live or failed lane', () => {
    const html = renderToString(
      createElement(
        OrchestratorsContext.Provider,
        { value: [] },
        createElement(
          LanePillsContext.Provider,
          { value: { agents: [], liveRuns: [], issues: [], records: null } },
          createElement(
            TransportCostsContext.Provider,
            { value: null },
            createElement(Transport, { snapshot: LIVE, speeds: [1], orchestrator: MAIN })
          )
        )
      )
    )
    expect(html).not.toContain('transport-lane')
    expect(html).not.toContain('transport-spend')
  })
})
