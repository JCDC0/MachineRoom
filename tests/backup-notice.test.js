import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { backupNotice, formatBytes } from '../src/ui/panels/backup.js'
import MetersPanel from '../src/ui/panels/MetersPanel.jsx'

describe('backupNotice', () => {
  it('returns null for junk input', () => {
    expect(backupNotice()).toBeNull()
    expect(backupNotice(null)).toBeNull()
    expect(backupNotice(undefined)).toBeNull()
    expect(backupNotice(123)).toBeNull()
    expect(backupNotice('junk')).toBeNull()
    expect(backupNotice([])).toBeNull()
    expect(backupNotice({})).toBeNull()
    expect(backupNotice({ foo: 'bar' })).toBeNull()
    expect(backupNotice({ enabled: 'yes' })).toBeNull()
    expect(backupNotice({ enabled: true, latestAt: 'not-a-date', ageHours: null })).toBeNull()
  })

  it('reports when automatic backups are off', () => {
    const notice = backupNotice({ enabled: false })
    expect(notice).toEqual({
      tone: 'yellow',
      title: 'Automatic backups are off',
      lines: ["Turn them on in Paperclip's instance settings."],
    })
  })

  it('reports when there is no latest backup yet', () => {
    const noLatest = backupNotice({ enabled: true })
    expect(noLatest).toEqual({
      tone: 'red',
      title: 'No backup yet',
      lines: [],
    })

    const nullLatest = backupNotice({ enabled: true, latestAt: null })
    expect(nullLatest).toEqual({
      tone: 'red',
      title: 'No backup yet',
      lines: [],
    })

    const withWarning = backupNotice({
      enabled: true,
      latestAt: null,
      warnings: ['database_backup_missing'],
    })
    expect(withWarning).toEqual({
      tone: 'red',
      title: 'No backup yet',
      lines: ['Paperclip found no backup file.'],
    })
  })

  it('formats hours and days wording correctly', () => {
    const lessThanHour = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 0.5,
    })
    expect(lessThanHour?.title).toBe('Newest backup less than an hour ago')

    const zeroHour = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 0,
    })
    expect(zeroHour?.title).toBe('Newest backup less than an hour ago')

    const oneHour = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 1,
    })
    expect(oneHour?.title).toBe('Newest backup 1 hour ago')

    const onePointFiveHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 1.5,
    })
    expect(onePointFiveHours?.title).toBe('Newest backup 1 hour ago')

    const twoHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 2.1,
    })
    expect(twoHours?.title).toBe('Newest backup 2 hours ago')

    const fortySevenHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 47.9,
    })
    expect(fortySevenHours?.title).toBe('Newest backup 47 hours ago')

    const fortyEightHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 48,
    })
    expect(fortyEightHours?.title).toBe('Newest backup 2 days ago')

    const staleMockHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 49.5,
      warnings: ['database_backup_stale'],
    })
    expect(staleMockHours?.title).toBe('Newest backup 2 days ago')

    const seventyTwoHours = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 72,
    })
    expect(seventyTwoHours?.title).toBe('Newest backup 3 days ago')
  })

  it('calculates age from latestAt when ageHours is omitted', () => {
    const now = Date.parse('2026-10-20T12:00:00.000Z')
    const twoHoursAgo = new Date(now - 2 * 3600000).toISOString()
    const notice = backupNotice({ enabled: true, latestAt: twoHoursAgo }, { now })
    expect(notice?.title).toBe('Newest backup 2 hours ago')
  })

  it('assigns tone and maps warning lines in words', () => {
    const okNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 2,
      warnings: [],
    })
    expect(okNotice).toEqual({
      tone: 'ok',
      title: 'Newest backup 2 hours ago',
      lines: [],
    })

    const staleNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 30,
      warnings: ['database_backup_stale'],
    })
    expect(staleNotice?.tone).toBe('red')
    expect(staleNotice?.lines).toEqual(["Older than Paperclip's limit."])

    const missingNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 5,
      warnings: ['database_backup_missing'],
    })
    expect(missingNotice?.tone).toBe('red')
    expect(missingNotice?.lines).toEqual(['Paperclip found no backup file.'])

    const failNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 5,
      warnings: ['database_backup_last_failure'],
    })
    expect(failNotice?.tone).toBe('red')
    expect(failNotice?.lines).toEqual(['The last backup failed.'])

    const checkFailNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 5,
      warnings: ['database_backup_check_failed'],
    })
    expect(checkFailNotice?.tone).toBe('yellow')
    expect(checkFailNotice?.lines).toEqual(['Paperclip could not check its backups.'])

    const mixedNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 5,
      warnings: ['database_backup_check_failed', 'database_backup_stale'],
    })
    expect(mixedNotice?.tone).toBe('red')
    expect(mixedNotice?.lines).toEqual([
      'Paperclip could not check its backups.',
      "Older than Paperclip's limit.",
    ])

    const objectWarningsNotice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 5,
      warnings: [{ code: 'database_backup_last_failure' }],
    })
    expect(objectWarningsNotice?.tone).toBe('red')
    expect(objectWarningsNotice?.lines).toEqual(['The last backup failed.'])
  })

  it('shows an unknown warning code as it is with yellow tone', () => {
    const notice = backupNotice({
      enabled: true,
      latestAt: '2026-10-20T12:00:00.000Z',
      ageHours: 3,
      warnings: ['custom_storage_alert'],
    })
    expect(notice).toEqual({
      tone: 'yellow',
      title: 'Newest backup 3 hours ago',
      lines: ['custom_storage_alert'],
    })
  })
})

describe('formatBytes', () => {
  it('formats bytes according to the specification examples', () => {
    expect(formatBytes(796653)).toBe('778 kB')
    expect(formatBytes(1258291)).toBe('1.2 MB')
  })

  it('returns size unknown for null and invalid values', () => {
    expect(formatBytes(null)).toBe('size unknown')
    expect(formatBytes(undefined)).toBe('size unknown')
    expect(formatBytes(NaN)).toBe('size unknown')
    expect(formatBytes(-1)).toBe('size unknown')
    expect(formatBytes('junk')).toBe('size unknown')
  })

  it('formats small kB and exact MB', () => {
    expect(formatBytes(0)).toBe('0 kB')
    expect(formatBytes(512)).toBe('1 kB')
    expect(formatBytes(1024)).toBe('1 kB')
    expect(formatBytes(1048000)).toBe('1023 kB')
    expect(formatBytes(1048500)).toBe('1.0 MB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(5242880)).toBe('5.0 MB')
  })
})

describe('MetersPanel Backups heading', () => {
  it('renders with renderToString and mock client showing the Backups heading', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(React.createElement(MetersPanel, { client }))
    expect(html).toContain('Backups')
    expect(html).toContain('Back up now')
    expect(html).toContain('meters-section backup-section')
  })

  it('renders preloaded backupNotice and status in SSR', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      React.createElement(MetersPanel, {
        client,
        initialBackupStatus: {
          enabled: true,
          latestAt: '2026-10-18T10:30:00.000Z',
          ageHours: 49.5,
          warnings: ['database_backup_stale'],
        },
      })
    )
    expect(html).toContain('Backups')
    expect(html).toContain('Newest backup 2 days ago')
    expect(html).toContain("Older than Paperclip&#x27;s limit.")
    expect(html).toContain('Back up now')
  })

  it('renders disabled backups state in SSR', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      React.createElement(MetersPanel, {
        client,
        initialBackupStatus: { enabled: false },
      })
    )
    expect(html).toContain('Automatic backups are off')
    expect(html).toContain("Turn them on in Paperclip&#x27;s instance settings.")
    expect(html).toContain('Back up now')
  })

  it('renders missing latest backup in SSR', () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      React.createElement(MetersPanel, {
        client,
        initialBackupStatus: {
          enabled: true,
          latestAt: null,
          warnings: ['database_backup_missing'],
        },
      })
    )
    expect(html).toContain('No backup yet')
    expect(html).toContain('Paperclip found no backup file.')
    expect(html).toContain('Back up now')
  })
})
