import { describe, expect, it } from 'vitest'
import { laneCosts } from '../server/lane-costs.js'

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime()

describe('laneCosts removed lanes', () => {
  it('keeps a removed lane whose cost is unknown and marks spend partial', () => {
    const records = [
      { lane: 'gone', startedAt: new Date(2026, 9, 24, 9, 0, 0).toISOString(), inputTokens: 100, exitCode: 0 },
    ]
    const costs = laneCosts({ records, agents: [], now: NOW })
    expect(costs.byAgent).toHaveLength(1)
    expect(costs.byAgent[0]).toMatchObject({
      agentId: 'removed-lanes',
      costCents: null,
      inputTokens: 100,
      missingCostRuns: 1,
    })
    expect(costs.summary.spendCents).toBe(0)
    expect(costs.summary.partial).toBe(true)
  })
})
