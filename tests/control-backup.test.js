import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'

const NOW = Date.parse('2026-10-20T08:00:00.000Z')

describe('mock run totals', () => {
  it('sums the finished fake runs and refuses a bad day', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 5 })
    expect(await client.runStats()).toMatchObject({ rows: [], total: { runs: 0 } })
    await client.startRun('opencode', ['P5'])
    const deadline = Date.now() + 3000
    let stats = await client.runStats()
    while (stats.total.runs === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      stats = await client.runStats()
    }
    expect(stats.rows).toHaveLength(1)
    expect(stats.rows[0]).toMatchObject({ lane: 'opencode', runs: 1, finished: 1 })
    await expect(client.runStats({ since: '2026-02-30' })).rejects.toThrow('--since needs a date like 2026-10-19.')
  })
})

describe('mock decide', () => {
  it('answers like a bridge with no key', async () => {
    const client = createMockClient({ latencyMs: 0, now: () => NOW })
    await expect(client.decide({ state: 'x', questions: {} })).rejects.toThrow('Send at least one question.')
    await expect(client.decide({ state: 'x', questions: { tier: {} } })).rejects.toThrow('No key is set for the decision model.')
  })
})
