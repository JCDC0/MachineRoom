import { appendFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cachedRunRecords as cachedRunRecordsLaneCosts } from '../server/lane-costs.js'
import { cachedRunRecords, clearRunsCache, readAllRunRecords } from '../server/runs.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  clearRunsCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix = 'mr-runs-cache-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

describe('shared runs.jsonl cache', () => {
  it('reads incrementally by byte offset as new lines are appended', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    const first = { lane: 'opencode', startedAt: '2026-11-03T10:00:00.000Z', exitCode: 0 }
    writeFileSync(file, `${JSON.stringify(first)}\n`)

    const initial = readAllRunRecords(file)
    expect(initial).toEqual([first])

    const second = { lane: 'opencode2', startedAt: '2026-11-03T11:00:00.000Z', exitCode: 0 }
    appendFileSync(file, `${JSON.stringify(second)}\n`)

    const updated = readAllRunRecords(file)
    expect(updated).toEqual([first, second])
  })

  it('starts again from 0 when the file shrinks', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    const rec1 = { lane: 'opencode', note: 'long record with lots of extra text to make it large' }
    const rec2 = { lane: 'opencode2', note: 'another long record that will be truncated' }
    writeFileSync(file, `${JSON.stringify(rec1)}\n${JSON.stringify(rec2)}\n`)

    const initial = readAllRunRecords(file)
    expect(initial.length).toBe(2)

    const small = { lane: 'agy', note: 'short' }
    writeFileSync(file, `${JSON.stringify(small)}\n`)

    const afterShrink = readAllRunRecords(file)
    expect(afterShrink).toEqual([small])
  })

  it('starts again from 0 when file mtime goes back', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    const rec1 = { lane: 'opencode', step: 1 }
    writeFileSync(file, `${JSON.stringify(rec1)}\n`)

    const initial = readAllRunRecords(file)
    expect(initial).toEqual([rec1])

    const rec2 = { lane: 'opencode', step: 2 }
    writeFileSync(file, `${JSON.stringify(rec2)}\n`)
    const past = new Date(Date.now() - 60000)
    utimesSync(file, past, past)

    const afterMtimeBack = readAllRunRecords(file)
    expect(afterMtimeBack).toEqual([rec2])
  })

  it('gives each caller its own array so mutations do not change cached records', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    const rec = { lane: 'opencode', costUsd: 1 }
    writeFileSync(file, `${JSON.stringify(rec)}\n`)

    const callerOne = readAllRunRecords(file)
    expect(callerOne).toEqual([rec])

    callerOne.push({ lane: 'rogue', costUsd: 999 })
    callerOne.reverse()

    const callerTwo = readAllRunRecords(file)
    expect(callerTwo).toEqual([rec])
    expect(callerTwo).not.toBe(callerOne)
  })

  it('shares the same cache between readAllRunRecords and lane costs cachedRunRecords', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    const rec = { lane: 'opencode', costUsd: 0.5 }
    writeFileSync(file, `${JSON.stringify(rec)}\n`)

    const fromRuns = readAllRunRecords(file)
    const fromLaneCosts = cachedRunRecordsLaneCosts(file)

    expect(fromRuns).toEqual([rec])
    expect(fromLaneCosts).toEqual([rec])
    expect(fromRuns).not.toBe(fromLaneCosts)

    const rec2 = { lane: 'opencode2', costUsd: 0.25 }
    appendFileSync(file, `${JSON.stringify(rec2)}\n`)

    const updatedFromLaneCosts = cachedRunRecordsLaneCosts(file)
    expect(updatedFromLaneCosts).toEqual([rec, rec2])
  })
})
