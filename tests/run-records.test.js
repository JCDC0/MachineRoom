import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRunRecords } from '../server/runs.js'
import { appendRunRecord } from '../scripts/run-lane.mjs'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

it('keeps the next record separate from a torn tail', () => {
  const root = makeTempDir('mr-records-')
  try {
    const file = join(root, 'runs.jsonl')
    writeFileSync(file, '{"lane":"torn"')
    expect(appendRunRecord({ lane: 'next' }, { file })).toBe(true)
    expect(readFileSync(file, 'utf8').split('\n')).toEqual(['{"lane":"torn"', '{"lane":"next"}', ''])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.each(['--list', '--stats'])('%s counts a lost run once and leaves the live run alone', (first) => {
  const root = makeTempDir('mr-records-lost-')
  const file = join(root, 'runs.jsonl')
  const command = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
  const run = (arg) => {
    const result = spawnSync(process.execPath, [command, arg], {
      env: { ...process.env, MACHINEROOM_RUNS: root }, encoding: 'utf8', windowsHide: true, timeout: 15000,
    })
    expect(result.status, result.error?.message ?? result.stderr).toBe(0)
    return result.stdout
  }
  try {
    const name = 'lost-P1-20261118-131340'
    const live = 'live-P2-20261118-131340'
    for (const [lane, runName, brief] of [['lost', name, 'P1'], ['live', live, 'P2']]) {
      writeFileSync(join(root, `${runName}.log`), '')
      writeFileSync(join(root, `${runName}.meta.json`), JSON.stringify({ lane, briefs: [brief], branch: '', model: 'fake/model' }))
    }
    writeFileSync(join(root, 'live.lock'), laneLockText({ pid: process.pid }))
    const outputs = {
      [first]: run(first),
      [first === '--list' ? '--stats' : '--list']: run(first === '--list' ? '--stats' : '--list'),
    }
    expect(outputs['--list']).toContain('exit none (lost)')
    expect(outputs['--stats']).toContain('lost | fake/model | 1 run | 0 finished, 1 killed, 0 failed')
    expect(run('--outcomes')).toContain('lost  fake/model  runs 1,')
    const record = { log: join(root, `${name}.log`), lane: 'lost', stopReason: 'lost', finishedAt: null }
    expect(appendRunRecord(record, { file })).toBe(true)
    expect(readRunRecords(file)).toEqual([expect.objectContaining(record)])
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 45000)

it('lists and counts unsaved lost runs without waiting for the append lock', () => {
  const root = makeTempDir('mr-records-blocked-')
  const command = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
  try {
    mkdirSync(join(root, '.runs-append.lock'))
    for (const name of ['lost-P1-20261118-131340', 'lost-P1-20261118-131341']) {
      writeFileSync(join(root, `${name}.log`), '')
      writeFileSync(join(root, `${name}.meta.json`), JSON.stringify({ lane: 'lost', briefs: ['P1'], model: 'fake/model' }))
    }
    for (const [arg, expected] of [['--list', 'exit none (lost)'], ['--stats', 'lost | fake/model | 2 runs']]) {
      const result = spawnSync(process.execPath, [command, arg], {
        env: { ...process.env, MACHINEROOM_RUNS: root }, encoding: 'utf8', windowsHide: true, timeout: 4000,
      })
      expect(result.status, result.error?.message ?? result.stderr).toBe(0)
      expect(result.stdout).toContain(expected)
      expect(result.stdout.match(/were not all saved/g)).toHaveLength(1)
    }
    expect(existsSync(join(root, 'runs.jsonl'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 12000)
