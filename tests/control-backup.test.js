import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'

const NOW = Date.parse('2026-10-20T08:00:00.000Z')

describe('mock run totals', () => {
  it('sums the finished fake runs and refuses a bad day', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 5 })
    expect(await client.runStats()).toMatchObject({ rows: [], total: { runs: 0 } })
    await client.startRun('hermes', ['P5'])
    const deadline = Date.now() + 3000
    let stats = await client.runStats()
    while (stats.total.runs === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      stats = await client.runStats()
    }
    expect(stats.rows).toHaveLength(1)
    expect(stats.rows[0]).toMatchObject({ lane: 'hermes', runs: 1, finished: 1 })
    await expect(client.runStats({ since: '2026-02-30' })).rejects.toThrow('--since needs a date like 2026-10-19.')
  })
})

describe('mock decide', () => {
  it('answers like a bridge with no key', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await expect(client.decide({ state: 'x', questions: {} })).rejects.toThrow('Send at least one question.')
    await expect(client.decide({ state: 'x', questions: { tier: {} } })).rejects.toThrow('No key is set for the decision model.')
  })
})

describe('mock backup methods', () => {
  it('reports a stale backup until one is made', async () => {
    let clock = NOW
    const client = createMockClient({ latencyMs: 0, now: () => clock })

    const before = await client.backupStatus()
    expect(before).toMatchObject({ enabled: true, status: 'warning', ageHours: 49.5, warnings: ['database_backup_stale'] })
    expect(Date.parse(before.latestAt)).toBe(NOW - 49.5 * 3600000)

    const result = await client.backupNow()
    expect(result).toMatchObject({ ok: true, sizeBytes: 796653, prunedCount: 0, finishedAt: new Date(NOW).toISOString() })
    expect(result.name).toMatch(/^paperclip-\d{8}-\d{6}\.sql\.gz$/)
    expect(result.name).not.toMatch(/[\\/]/)

    clock = NOW + 2 * 3600000
    const after = await client.backupStatus()
    expect(after).toMatchObject({ status: 'ok', ageHours: 2, warnings: [] })
  })

  it('refuses a second backup while one runs', async () => {
    const client = createMockClient({ latencyMs: 20, now: () => NOW })
    const first = client.backupNow()
    await expect(client.backupNow()).rejects.toThrow('A backup is already running.')
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(client.backupNow()).resolves.toMatchObject({ ok: true })
  })

  it('fails once when told to', async () => {
    const client = createMockClient({ latencyMs: 0, now: () => NOW })
    client.failNext('backupNow', 'Paperclip could not make a backup.')
    await expect(client.backupNow()).rejects.toThrow('Paperclip could not make a backup.')
    await expect(client.backupNow()).resolves.toMatchObject({ ok: true })
  })
})
