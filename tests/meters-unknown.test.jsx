import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import MetersPanel from '../src/ui/panels/MetersPanel.jsx'

const COSTS = {
  summary: { spendCents: 0, budgetCents: 0, utilizationPercent: null, partial: true },
  byAgent: [{ agentId: 'gone', agentName: 'Gone lane', costCents: null, missingCostRuns: 2, inputTokens: 100, outputTokens: 0 }],
  quota: [],
}

describe('MetersPanel unknown costs', () => {
  it('shows ? for a null cost and marks the summary partial', () => {
    const html = renderToString(
      createElement(MetersPanel, { client: createMockClient({ latencyMs: 0 }), initialCosts: COSTS }),
    )
    expect(html).toContain('>?<')
    expect(html).toContain('not reported')
    expect(html).toContain('(partial)')
    const row = html.slice(html.indexOf('meter-agent-row'))
    expect(row.slice(0, row.indexOf('meter-label-dim'))).not.toContain('$0.00')
  })
})
