import { describe, expect, it } from 'vitest'
import { mergeCommitsFromLog, outcomeTable } from '../server/outcomes.js'
import { formatOutcomes, runRecord } from '../src/briefs/run.js'

const MERGE = '0.1.402: Merge P460, finish times and repair runs'

function mergeAt(committedAt, subject = MERGE) {
  return { hash: 'a'.repeat(40), committedAt, subject }
}

describe('run record finish time', () => {
  it('adds the time the run finished', () => {
    const finishedAt = '2026-11-16T12:30:00.000Z'
    const record = runRecord({
      lane: 'opencode',
      briefs: ['P460'],
      startedAt: '2026-11-16T12:00:00.000Z',
      minutes: 30,
      finishedAt,
    })

    expect(record.finishedAt).toBe(finishedAt)
    expect(Number.isNaN(Date.parse(runRecord({ lane: 'opencode' }).finishedAt))).toBe(false)
  })
})

describe('merge commit times', () => {
  it('reads the hash, the commit time and the subject from one line', () => {
    const hash = 'a'.repeat(40)
    const line = `${hash} 2026-11-16T11:20:00+08:00 ${MERGE}`

    expect(mergeCommitsFromLog(line)).toEqual([
      { hash, committedAt: '2026-11-16T11:20:00+08:00', subject: MERGE },
    ])
  })
})

describe('repair runs and review wait', () => {
  it('counts a second plain run before a merge as one repair run', () => {
    const runs = [
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', startedAt: '2026-11-16T10:00:00.000Z', finishedAt: '2026-11-16T10:20:00.000Z' },
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', startedAt: '2026-11-16T10:30:00.000Z', finishedAt: '2026-11-16T10:50:00.000Z' },
    ]

    const [row] = outcomeTable(runs, [], [mergeAt('2026-11-16T11:20:00.000Z')])

    expect(row.merged).toBe(1)
    expect(row.repairRuns).toBe(1)
    expect(row.reviewWaitMinutes).toBe(30)
  })

  it('does not count a failover or a continuation as a repair run', () => {
    const runs = [
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T10:20:00.000Z', failover: { kind: 'quota', to: 'backup' } },
      { lane: 'backup', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T10:40:00.000Z', failoverFrom: { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z' } },
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T11:00:00.000Z', continues: 'opencode-1' },
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T11:10:00.000Z' },
    ]

    const row = outcomeTable(runs, [], [mergeAt('2026-11-16T11:40:00.000Z')]).find((item) => item.lane === 'opencode')

    expect(row.repairRuns).toBe(1)
    expect(row.reviewWaitMinutes).toBe(30)
  })

  it('takes the median wait when a row holds two merged briefs', () => {
    const runs = [
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T10:20:00.000Z' },
      { lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460', finishedAt: '2026-11-16T10:50:00.000Z' },
      { lane: 'opencode', model: 'm', briefs: ['P461'], branch: 'feat/p461', finishedAt: '2026-11-16T10:30:00.000Z' },
    ]
    const merges = [
      mergeAt('2026-11-16T11:00:00.000Z', '0.1.402: Merge P460, finish times'),
      mergeAt('2026-11-16T11:00:00.000Z', '0.1.402: Merge P461, repair runs'),
    ]

    const [row] = outcomeTable(runs, [], merges)

    expect(row.repairRuns).toBe(1)
    expect(row.reviewWaitMinutes).toBe(20)
  })

  it('leaves a wait null and prints a question mark when a time is missing', () => {
    const runs = [{ lane: 'opencode', model: 'm', briefs: ['P460'], branch: 'feat/p460' }]

    const [withoutFinish] = outcomeTable(runs, [], [mergeAt('2026-11-16T11:20:00.000Z')])
    expect(withoutFinish.reviewWaitMinutes).toBeNull()
    expect(formatOutcomes([withoutFinish])[0]).toContain('review wait ?')

    const [withoutMergeTime] = outcomeTable(
      [{ ...runs[0], finishedAt: '2026-11-16T10:50:00.000Z' }],
      [],
      ['0.1.402: Merge P460, finish times and repair runs']
    )
    expect(withoutMergeTime.reviewWaitMinutes).toBeNull()
    expect(formatOutcomes([withoutMergeTime])[0]).toContain('review wait ?')
  })
})
