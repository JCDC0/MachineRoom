import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import {
  formatCost,
  formatMinutes,
  formatRecordLine,
  recordLine,
  resultWord,
  runResultWord,
  runningLine,
  timeSince,
  timeSinceStart,
} from '../src/ui/panels/runs.js'

describe('resultWord', () => {
  it('returns finished when exitCode is 0 and killed is false', () => {
    expect(resultWord({ exitCode: 0, killed: false })).toBe('finished')
    expect(resultWord({ exitCode: 0 })).toBe('finished')
    expect(runResultWord({ exitCode: 0 })).toBe('finished')
  })

  it('returns stopped when killed is true', () => {
    expect(resultWord({ exitCode: 0, killed: true })).toBe('stopped')
    expect(resultWord({ exitCode: 1, killed: true })).toBe('stopped')
    expect(resultWord({ exitCode: null, killed: true })).toBe('stopped')
    expect(resultWord({ killed: true })).toBe('stopped')
  })

  it('returns failed when exitCode is non-zero or null without killed', () => {
    expect(resultWord({ exitCode: 1, killed: false })).toBe('failed')
    expect(resultWord({ exitCode: 2 })).toBe('failed')
    expect(resultWord({ exitCode: null, killed: false })).toBe('failed')
    expect(resultWord({})).toBe('failed')
    expect(resultWord(null)).toBe('failed')
    expect(resultWord(undefined)).toBe('failed')
  })
})

describe('timeSinceStart', () => {
  const base = Date.parse('2026-10-19T20:00:00.000Z')

  it('returns time unknown for invalid or missing timestamps', () => {
    expect(timeSinceStart(null)).toBe('time unknown')
    expect(timeSinceStart(undefined)).toBe('time unknown')
    expect(timeSinceStart('')).toBe('time unknown')
    expect(timeSinceStart('not-a-date')).toBe('time unknown')
  })

  it('returns just now when difference is less than 60 seconds', () => {
    expect(timeSinceStart(base, base + 10000)).toBe('just now')
    expect(timeSinceStart(base, base + 59000)).toBe('just now')
    expect(timeSince(base, base + 5000)).toBe('just now')
  })

  it('returns minutes ago when under an hour', () => {
    expect(timeSinceStart(base, base + 60000)).toBe('1 min ago')
    expect(timeSinceStart(base, base + 5 * 60000)).toBe('5 min ago')
    expect(timeSinceStart(base, base + 59 * 60000)).toBe('59 min ago')
  })

  it('returns hours ago when under a day', () => {
    expect(timeSinceStart(base, base + 60 * 60000)).toBe('1 h ago')
    expect(timeSinceStart(base, base + 3 * 3600000)).toBe('3 h ago')
    expect(timeSinceStart(base, base + 23 * 3600000)).toBe('23 h ago')
  })

  it('returns days ago for 24 hours or more', () => {
    expect(timeSinceStart(base, base + 24 * 3600000)).toBe('1 d ago')
    expect(timeSinceStart(base, base + 48 * 3600000)).toBe('2 d ago')
  })

  it('accepts ISO strings, numbers, or objects with startedAt', () => {
    const iso = '2026-10-19T20:00:00.000Z'
    expect(timeSinceStart(iso, base + 120000)).toBe('2 min ago')
    expect(timeSinceStart({ startedAt: iso }, base + 120000)).toBe('2 min ago')
  })
})

describe('formatCost', () => {
  it('returns cost unknown for null, undefined, or non-finite values', () => {
    expect(formatCost(null)).toBe('cost unknown')
    expect(formatCost(undefined)).toBe('cost unknown')
    expect(formatCost(Number.NaN)).toBe('cost unknown')
    expect(formatCost('free')).toBe('cost unknown')
  })

  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats numbers with up to four decimals', () => {
    expect(formatCost(0.0123)).toBe('$0.0123')
    expect(formatCost(0.5)).toBe('$0.5000')
  })
})

describe('formatMinutes', () => {
  it('formats finite numbers with min suffix', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(12)).toBe('12 min')
  })

  it('returns minutes unknown for null or non-numbers', () => {
    expect(formatMinutes(null)).toBe('minutes unknown')
    expect(formatMinutes(undefined)).toBe('minutes unknown')
  })
})

describe('recordLine', () => {
  it('formats a finished record with cost, minutes, and start time', () => {
    const record = {
      lane: 'hermes',
      briefs: ['T7'],
      startedAt: '2026-10-19T20:30:00.000Z',
      minutes: 0,
      exitCode: 0,
      killed: false,
      costUsd: null,
      log: 'C:\\private\\folder\\log.txt',
    }
    const line = recordLine(record)
    expect(line).toBe('hermes | T7 | finished | cost unknown | 0 min | 2026-10-19T20:30:00.000Z')
    expect(line).not.toContain('C:\\private\\folder')
    expect(line).not.toContain('log.txt')
    expect(formatRecordLine(record)).toBe(line)
  })

  it('formats a stopped record when killed', () => {
    const record = {
      lane: 'opencode',
      briefs: ['T5', 'T7'],
      startedAt: '2026-10-19T21:00:00.000Z',
      minutes: 4,
      exitCode: null,
      killed: true,
      costUsd: 0.025,
      log: 'C:\\Users\\jc\\AppData\\log.txt',
    }
    const line = recordLine(record)
    expect(line).toBe('opencode | T5 T7 | stopped | $0.0250 | 4 min | 2026-10-19T21:00:00.000Z')
    expect(line).not.toContain('C:\\Users\\jc')
  })

  it('formats a failed record when exitCode is non-zero', () => {
    const record = {
      lane: 'hermes',
      briefs: ['P7'],
      startedAt: '2026-10-19T21:30:00.000Z',
      minutes: 1,
      exitCode: 1,
      killed: false,
      costUsd: 0.001,
    }
    expect(recordLine(record)).toBe('hermes | P7 | failed | $0.0010 | 1 min | 2026-10-19T21:30:00.000Z')
  })

  it('handles missing or empty fields safely', () => {
    expect(recordLine({})).toBe('unknown | none | failed | cost unknown | 0 min | time unknown')
    expect(recordLine(null)).toBe('')
  })
})

describe('runningLine', () => {
  it('formats running entry with lane, briefs, and time ago', () => {
    const entry = {
      lane: 'hermes',
      briefs: ['T7'],
      startedAt: '2026-10-19T20:00:00.000Z',
    }
    const now = Date.parse('2026-10-19T20:05:00.000Z')
    expect(runningLine(entry, now)).toBe('hermes | T7 | 5 min ago')
  })

  it('handles missing fields', () => {
    expect(runningLine({})).toBe('unknown | none | time unknown')
    expect(runningLine(null)).toBe('')
  })
})

describe('mock client runs lifecycle', () => {
  it('starts a run, refuses a concurrent run on the same lane, and completes into recent', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 300 })
    const entry = await client.startRun('hermes', ['P5'])
    expect(entry.lane).toBe('hermes')
    expect(entry.briefs).toEqual(['P5'])

    const runsWhileActive = await client.runs()
    expect(runsWhileActive.running).toHaveLength(1)
    expect(runsWhileActive.running[0].lane).toBe('hermes')

    await expect(client.startRun('hermes', ['P5'])).rejects.toThrow('That lane is already running.')

    const deadline = Date.now() + 3000
    let runsAfterDone = await client.runs()
    while (runsAfterDone.running.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      runsAfterDone = await client.runs()
    }
    expect(runsAfterDone.running).toHaveLength(0)
    expect(runsAfterDone.recent).toHaveLength(1)
    expect(resultWord(runsAfterDone.recent[0])).toBe('finished')
    expect(recordLine(runsAfterDone.recent[0])).toContain('hermes | P5 | finished')
  })
})
