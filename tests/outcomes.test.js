import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { outcomeTable } from '../server/outcomes.js'
import { makeTempDir } from './helpers/tempRoot.js'

const ROOT = process.cwd()
const OUTCOME_SCRIPT = join(ROOT, 'scripts', 'outcome.mjs')
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function useTemp() {
  const dir = makeTempDir('mr-outcome-')
  const previous = process.env.TEMP
  process.env.TEMP = dir
  cleanups.push(() => {
    process.env.TEMP = previous
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function runsFolder(temp) {
  const folder = join(temp, 'machineroom-runs')
  mkdirSync(folder, { recursive: true })
  return folder
}

function writeRuns(temp, records) {
  const folder = runsFolder(temp)
  writeFileSync(join(folder, 'runs.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

function outcomesPath(temp) {
  return join(temp, 'machineroom-runs', 'outcomes.jsonl')
}

function runOutcome(temp, args) {
  return spawnSync(process.execPath, [OUTCOME_SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TEMP: temp },
    windowsHide: true,
  })
}

describe('outcome command', () => {
  it('refuses a branch no run made and writes nothing', () => {
    const temp = useTemp()
    writeRuns(temp, [{ lane: 'hermes', model: 'm', branch: 'feat/other', costUsd: 0.1 }])

    const result = runOutcome(temp, ['feat/missing', 'merged'])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('No lane run made the branch feat/missing.')
    expect(existsSync(outcomesPath(temp))).toBe(false)
  })

  it('refuses each bad value and writes nothing', () => {
    const temp = useTemp()
    writeRuns(temp, [{ lane: 'hermes', model: 'm', branch: 'feat/x', costUsd: 0.1 }])
    const cases = [
      { args: ['feat/x', 'maybe'], sentence: 'The outcome must be merged or rejected.' },
      { args: ['feat/x', 'merged', '--grade', 'E'], sentence: 'The grade must be A+, A, A-, B+, B, B-, C, D or F.' },
      { args: ['feat/x', 'merged', '--fixes', '1.5'], sentence: 'The fixes must be a whole number from 0 to 50.' },
      { args: ['feat/x', 'merged', '--fixes', '-1'], sentence: 'The fixes must be a whole number from 0 to 50.' },
      { args: ['feat/x', 'merged', '--fixes', '51'], sentence: 'The fixes must be a whole number from 0 to 50.' },
      { args: ['feat/x', 'merged', '--fixes', 'many'], sentence: 'The fixes must be a whole number from 0 to 50.' },
      { args: ['feat/x', 'merged', '--note', 'x'.repeat(201)], sentence: 'The note must be one line of 200 characters or less.' },
      { args: ['feat/x', 'merged', '--note', 'first\nsecond'], sentence: 'The note must be one line of 200 characters or less.' },
      { args: ['feat/x', 'merged', '--note', 'first\r\nsecond'], sentence: 'The note must be one line of 200 characters or less.' },
    ]
    for (const item of cases) {
      const result = runOutcome(temp, item.args)
      expect(result.status, item.args.join(' ')).toBe(1)
      expect(`${result.stdout}${result.stderr}`, item.args.join(' ')).toContain(item.sentence)
      expect(existsSync(outcomesPath(temp)), item.args.join(' ')).toBe(false)
    }
  })

  it('records an outcome and lets the newest outcome for a branch win', () => {
    const temp = useTemp()
    const run = { lane: 'hermes', model: 'm', branch: 'feat/x', costUsd: 0.5 }
    writeRuns(temp, [run])

    const first = runOutcome(temp, ['feat/x', 'merged', '--grade', 'A-', '--fixes', '2', '--note', 'Clean.'])
    expect(first.status).toBe(0)
    const firstLines = readFileSync(outcomesPath(temp), 'utf8').trim().split(/\r?\n/)
    expect(firstLines).toHaveLength(1)
    const firstRecord = JSON.parse(firstLines[0])
    expect(firstRecord).toMatchObject({ branch: 'feat/x', outcome: 'merged', grade: 'A-', fixes: 2, note: 'Clean.' })
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    expect(firstRecord.version).toBe(version)
    expect(Number.isNaN(Date.parse(firstRecord.recordedAt))).toBe(false)

    const second = runOutcome(temp, ['feat/x', 'rejected', '--grade', 'C', '--fixes', '0'])
    expect(second.status).toBe(0)
    const lines = readFileSync(outcomesPath(temp), 'utf8').trim().split(/\r?\n/)
    expect(lines).toHaveLength(2)
    expect(outcomeTable([run], lines.map((line) => JSON.parse(line)))).toEqual([
      {
        lane: 'hermes',
        model: 'm',
        runs: 1,
        merged: 0,
        rejected: 1,
        pending: 0,
        mergeRate: 0,
        averageFixes: null,
        costUsd: 0.5,
        decidedCostUsd: 0.5,
        costPerMerge: null,
      },
    ])
  })

  it('records empty grade, fixes and note when they are left out', () => {
    const temp = useTemp()
    writeRuns(temp, [{ lane: 'opencode', model: 'm', branch: 'feat/y', costUsd: 0 }])

    const result = runOutcome(temp, ['feat/y', 'merged'])
    expect(result.status).toBe(0)
    const record = JSON.parse(readFileSync(outcomesPath(temp), 'utf8').trim())
    expect(record).toMatchObject({ branch: 'feat/y', outcome: 'merged', grade: null, fixes: null, note: '' })
  })
})

describe('outcomeTable', () => {
  it('counts merged, rejected, pending and branchless runs and finds the newest outcome', () => {
    const runs = [
      { lane: 'hermes', model: 'deepseek/v4.1-flash-1017', branch: 'feat/a', costUsd: 0.5 },
      { lane: 'hermes', model: 'deepseek/v4.1-flash-1017', branch: 'feat/b', costUsd: 0.25 },
      { lane: 'hermes', model: 'deepseek/v4.1-flash-1017', branch: 'feat/c', costUsd: 0.25 },
      { lane: 'hermes', model: 'deepseek/v4.1-flash-1017', branch: '', costUsd: null },
      { lane: 'opencode', model: null, branch: 'feat/d', costUsd: 0.2 },
      { lane: 'opencode', model: 'other', branch: 'feat/e', costUsd: 0 },
    ]
    const outcomes = [
      { branch: 'feat/a', outcome: 'merged', fixes: 3 },
      { branch: 'feat/b', outcome: 'rejected', fixes: 9 },
      { branch: 'feat/d', outcome: 'merged', fixes: 1 },
      { branch: 'feat/e', outcome: 'rejected', fixes: 0 },
      { branch: 'feat/a', outcome: 'merged', fixes: 1 },
    ]

    expect(outcomeTable(runs, outcomes)).toEqual([
      {
        lane: 'hermes',
        model: 'deepseek/v4.1-flash-1017',
        runs: 4,
        merged: 1,
        rejected: 1,
        pending: 2,
        mergeRate: 0.5,
        averageFixes: 1,
        costUsd: 1,
        decidedCostUsd: 0.75,
        costPerMerge: 0.75,
      },
      {
        lane: 'opencode',
        model: 'model unknown',
        runs: 1,
        merged: 1,
        rejected: 0,
        pending: 0,
        mergeRate: 1,
        averageFixes: 1,
        costUsd: 0.2,
        decidedCostUsd: 0.2,
        costPerMerge: 0.2,
      },
      {
        lane: 'opencode',
        model: 'other',
        runs: 1,
        merged: 0,
        rejected: 1,
        pending: 0,
        mergeRate: 0,
        averageFixes: null,
        costUsd: 0,
        decidedCostUsd: 0,
        costPerMerge: null,
      },
    ])
  })

  it('leaves a pending run out of the decided cost and cost per merge', () => {
    const runs = [
      { lane: 'hermes', model: 'm', branch: 'feat/a', costUsd: 0.5 },
      { lane: 'hermes', model: 'm', branch: 'feat/b', costUsd: 0.25 },
      { lane: 'hermes', model: 'm', branch: 'feat/c', costUsd: 0.75 },
      { lane: 'hermes', model: 'm', branch: '', costUsd: 0.5 },
    ]
    const outcomes = [
      { branch: 'feat/a', outcome: 'merged', fixes: 2 },
      { branch: 'feat/b', outcome: 'rejected', fixes: 0 },
    ]

    expect(outcomeTable(runs, outcomes)).toEqual([
      {
        lane: 'hermes',
        model: 'm',
        runs: 4,
        merged: 1,
        rejected: 1,
        pending: 2,
        mergeRate: 0.5,
        averageFixes: 2,
        costUsd: 2,
        decidedCostUsd: 0.75,
        costPerMerge: 0.75,
      },
    ])
  })

  it('counts an outcome once per branch, on the newest run that names it', () => {
    const runs = [
      { lane: 'hermes', model: 'm', branch: 'feat/a', costUsd: 0.5 },
      { lane: 'hermes', model: 'm', branch: 'feat/b', costUsd: 1 },
      { lane: 'hermes', model: 'm', branch: 'feat/a', costUsd: 0.25 },
      { lane: 'hermes', model: 'm', branch: 'feat/a', costUsd: 0 },
    ]
    const outcomes = [
      { branch: 'feat/a', outcome: 'merged', fixes: 2 },
      { branch: 'feat/b', outcome: 'rejected', fixes: 0 },
    ]
    expect(outcomeTable(runs, outcomes)).toEqual([
      {
        lane: 'hermes',
        model: 'm',
        runs: 4,
        merged: 1,
        rejected: 1,
        pending: 0,
        mergeRate: 0.5,
        averageFixes: 2,
        costUsd: 1.75,
        decidedCostUsd: 1.75,
        costPerMerge: 1.75,
      },
    ])
  })

  it('gives the merge to the model of the newest run on the branch and the older cost to its own model', () => {
    const runs = [
      { lane: 'hermes', model: 'first', branch: 'feat/a', costUsd: 0.5 },
      { lane: 'hermes', model: 'second', branch: 'feat/a', costUsd: 0.25 },
    ]
    const rows = outcomeTable(runs, [{ branch: 'feat/a', outcome: 'merged', fixes: 1 }])
    expect(rows.map(({ model, runs: count, merged, pending, decidedCostUsd, costPerMerge }) => ({ model, count, merged, pending, decidedCostUsd, costPerMerge }))).toEqual([
      { model: 'first', count: 1, merged: 0, pending: 0, decidedCostUsd: 0.5, costPerMerge: null },
      { model: 'second', count: 1, merged: 1, pending: 0, decidedCostUsd: 0.25, costPerMerge: 0.25 },
    ])
  })

  it('answers no rows for no runs and null rates for no merged runs', () => {
    expect(outcomeTable([], [])).toEqual([])
    expect(outcomeTable([{ lane: 'hermes', branch: 'feat/x', costUsd: 1 }], [{ branch: 'feat/x', outcome: 'rejected', fixes: 2 }])).toEqual([
      {
        lane: 'hermes',
        model: 'model unknown',
        runs: 1,
        merged: 0,
        rejected: 1,
        pending: 0,
        mergeRate: 0,
        averageFixes: null,
        costUsd: 1,
        decidedCostUsd: 1,
        costPerMerge: null,
      },
    ])
  })
})

describe('outcome route', () => {
  it('answers the table from the temp runs folder and skips junk lines', async () => {
    const temp = useTemp()
    const folder = runsFolder(temp)
    writeFileSync(
      join(folder, 'runs.jsonl'),
      [
        JSON.stringify({ lane: 'hermes', model: 'm', branch: 'feat/a', costUsd: 0.4 }),
        'not json at all',
        JSON.stringify({ lane: 'opencode', model: 'o', branch: 'feat/b', costUsd: 0.2 }),
        '{ "lane": ',
      ].join('\n')
    )
    writeFileSync(
      join(folder, 'outcomes.jsonl'),
      [
        JSON.stringify({ branch: 'feat/a', outcome: 'merged', grade: 'A', fixes: 2 }),
        'not json either',
        JSON.stringify({ branch: 'feat/b', outcome: 'rejected', grade: 'C', fixes: 1 }),
      ].join('\n')
    )
    const bridge = createBridge({ paperclipUrl: 'http://127.0.0.1:9', companyId: 'comp-1', projectRoot: '', port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const res = await fetch(`${url}/api/control/runs/outcomes`)
    expect(res.status).toBe(200)
    const { rows } = await res.json()
    expect(rows).toEqual([
      {
        lane: 'hermes',
        model: 'm',
        runs: 1,
        merged: 1,
        rejected: 0,
        pending: 0,
        mergeRate: 1,
        averageFixes: 2,
        costUsd: 0.4,
        decidedCostUsd: 0.4,
        costPerMerge: 0.4,
      },
      {
        lane: 'opencode',
        model: 'o',
        runs: 1,
        merged: 0,
        rejected: 1,
        pending: 0,
        mergeRate: 0,
        averageFixes: null,
        costUsd: 0.2,
        decidedCostUsd: 0.2,
        costPerMerge: null,
      },
    ])

    rmSync(join(folder, 'outcomes.jsonl'))
    const pending = await fetch(`${url}/api/control/runs/outcomes`).then((response) => response.json())
    expect(pending.rows.map((row) => [row.lane, row.pending, row.mergeRate, row.costPerMerge])).toEqual([
      ['hermes', 1, null, null],
      ['opencode', 1, null, null],
    ])

    const wrongMethod = await fetch(`${url}/api/control/runs/outcomes`, { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
  })
})
