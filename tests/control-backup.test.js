import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'

const NOW = Date.parse('2026-10-20T08:00:00.000Z')

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
