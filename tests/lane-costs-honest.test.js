import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mapCosts } from '../server/control.js'
import { laneCosts } from '../server/lane-costs.js'
import { createMockClient } from '../src/control/mock.js'
import MetersPanel from '../src/ui/panels/MetersPanel.jsx'

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime()

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode' },
  { id: 'agent-agy', key: 'agy', name: 'agy' },
]

function record(lane, startedAt, costUsd, extra = {}) {
  return { lane, startedAt, costUsd, ...extra }
}

function localIso(hour, minute) {
  return new Date(2026, 9, 24, hour, minute, 0).toISOString()
}

function panelHtml(costs) {
  return renderToString(
    createElement(MetersPanel, {
      client: createMockClient({ latencyMs: 0 }),
      initialCosts: costs,
    })
  )
}

const RECORDS = [
  record('opencode', localIso(9, 0), 0.5, { exitCode: 0 }),
  record('opencode', localIso(10, 0), 0.25, { exitCode: 1 }),
  record('opencode', localIso(11, 0), 0.1, { exitCode: null }),
  record('opencode', localIso(12, 0), null, { exitCode: 0 }),
  record('opencode', localIso(13, 0), null, { killed: true }),
  record('agy', localIso(14, 0), 0.4, { killed: true }),
  record('agy', localIso(15, 0), null, { startFailed: true }),
]

const QUOTA_AT = localIso(11, 30)
const QUOTA_RESETS = localIso(18, 0)

const RECORDS_WITH_QUOTA = [
  ...RECORDS,
  record('codex', localIso(11, 25), 0, {
    quota: {
      at: QUOTA_AT,
      windows: [{ label: 'primary', usedPercent: 95, resetsAt: QUOTA_RESETS }],
    },
  }),
]

const PANEL_COSTS = {
  summary: { spendCents: 125, budgetCents: 0, utilizationPercent: null },
  byAgent: [
    {
      agentId: 'agent-opencode',
      agentName: 'OpenCode',
      costCents: 85,
      todayCents: 85,
      inputTokens: 1200,
      outputTokens: 300,
      missingCostRuns: 2,
      failedCost: 25,
    },
    {
      agentId: 'agent-agy',
      agentName: 'agy',
      costCents: 40,
      todayCents: 0,
      inputTokens: null,
      outputTokens: null,
      missingCostRuns: 1,
      failedCost: 40,
    },
    {
      agentId: 'agent-clean',
      agentName: 'Clean lane',
      costCents: 0,
      todayCents: 0,
      inputTokens: 0,
      outputTokens: 0,
      missingCostRuns: 0,
      failedCost: 0,
    },
  ],
  quota: [
    {
      provider: 'codex',
      at: QUOTA_AT,
      windows: [{ label: 'primary', usedPercent: 95, resetsAt: QUOTA_RESETS }],
    },
  ],
}

describe('laneCosts honesty', () => {
  it('counts the runs with no cost and the spend of the runs that failed or were stopped', () => {
    const costs = laneCosts({ records: RECORDS, agents: AGENTS, now: NOW })

    const opencode = costs.byAgent.find((row) => row.agentId === 'agent-opencode')
    expect(opencode).toMatchObject({ costCents: 85, missingCostRuns: 2, failedCost: 25 })

    const agy = costs.byAgent.find((row) => row.agentId === 'agent-agy')
    expect(agy).toMatchObject({ costCents: 40, missingCostRuns: 1, failedCost: 40 })
  })

  it('leaves a run with no outcome out of the failed or stopped spend', () => {
    const costs = laneCosts({
      records: [record('opencode', localIso(9, 0), 0.3, { exitCode: null })],
      agents: AGENTS,
      now: NOW,
    })

    expect(costs.byAgent[0]).toMatchObject({ costCents: 30, missingCostRuns: 0, failedCost: 0 })
  })

  it('keeps the counts and the quota in the answer the page reads', () => {
    const answer = mapCosts(laneCosts({ records: RECORDS_WITH_QUOTA, agents: AGENTS, now: NOW }))

    expect(answer.byAgent.find((row) => row.agentId === 'agent-opencode')).toMatchObject({
      missingCostRuns: 2,
      failedCost: 25,
    })
    expect(answer.quota).toEqual([
      {
        provider: 'codex',
        at: QUOTA_AT,
        windows: [{ label: 'primary', usedPercent: 95, resetsAt: QUOTA_RESETS }],
      },
    ])
  })

  it('labels a lane total with its unreported runs and shows failed or stopped spend', () => {
    const html = panelHtml(PANEL_COSTS)

    expect(html).toContain('(2 runs not reported)')
    expect(html).toContain('(1 run not reported)')
    expect(html).not.toContain('(0 runs not reported)')
    expect(html).toContain('Failed or stopped: $0.25')
    expect(html).toContain('Failed or stopped: $0.40')
  })

  it('shows when the quota window was seen and when it resets', () => {
    const html = panelHtml(PANEL_COSTS)

    expect(html).toContain('seen 11:30')
    expect(html).toContain('resets 18:00')
    expect(html).toContain('primary 95%')
  })

  it('shows cache share from reporting runs only and hides the line with no cache data', () => {
    const costs = mapCosts(
      laneCosts({
        records: [
          record('opencode', localIso(9, 0), 0.2, {
            inputTokens: 1000,
            outputTokens: 50,
            cacheReadTokens: 400,
            cacheWriteTokens: 100,
          }),
          record('opencode', localIso(10, 0), 0.3, {
            inputTokens: 1000,
            outputTokens: 60,
            cacheReadTokens: 600,
            cacheWriteTokens: 50,
          }),
          record('opencode', localIso(11, 0), 0.1, {
            inputTokens: 8000,
            outputTokens: 20,
          }),
          record('agy', localIso(11, 30), 0.1, {
            inputTokens: 500,
            outputTokens: 20,
          }),
        ],
        agents: AGENTS,
        now: NOW,
      })
    )
    const html = panelHtml(costs)

    expect(html).toContain('Cache: 50% of input read from cache (2 of 3 runs reported)')
    expect(html.slice(html.indexOf('>agy<'))).not.toContain('Cache:')
    expect(panelHtml(PANEL_COSTS)).not.toContain('Cache:')
  })
})
