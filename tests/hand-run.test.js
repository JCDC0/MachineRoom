import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handRun } from '../scripts/hand-run.mjs'
import { parseBriefs } from '../src/briefs/briefs.js'
import { outcomeTable } from '../server/outcomes.js'
import { readAllRunRecords, readOutcomeRecords } from '../server/runs.js'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const ROOT = process.cwd()
const HAND_SCRIPT = join(ROOT, 'scripts', 'hand-run.mjs')
const OUTCOME_SCRIPT = join(ROOT, 'scripts', 'outcome.mjs')
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

const BRIEFS = parseBriefs([
  '**T1b. A HUD task (AGY).** Do the thing. Files: src/ui/a.jsx',
  '**C3e. A bridge task (OpenCode).** Do the other thing. Files: server/a.js',
  '**T1c. An old task (AGY, merged as 0.1.1).** Done.',
].join('\n'))

function tempFolder() {
  const dir = makeTempDir('mr-hand-run-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function runsPathFor(temp) {
  return join(temp, 'machineroom-runs', 'runs.jsonl')
}

function git(cwd, args) {
  const result = spawnSync(gitPath(), args, { cwd, encoding: 'utf8', windowsHide: true, shell: false })
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function commit(dir, name, text) {
  writeFileSync(join(dir, name), text)
  git(dir, ['add', '-A'])
  git(dir, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Add ${name}`])
}

function repoOnMain() {
  const dir = tempFolder()
  git(dir, ['init', '-q', '-b', 'main'])
  commit(dir, 'readme.md', 'start\n')
  return dir
}

function repoWithLaneWorktree() {
  const base = repoOnMain()
  const worktree = join(tempFolder(), 'lane')
  git(base, ['worktree', 'add', '-q', '-b', 'feat/hand-run', worktree])
  commit(worktree, 'lane.md', 'lane\n')
  return { base, worktree }
}

function lanesFor(worktree) {
  return {
    agy: {
      name: 'agy',
      harness: 'agy',
      model: 'Gemini 3.8 Flash (High)',
      models: { T1b: 'Gemini 4 Argon (Medium)' },
      worktree,
      role: 'The HUD.',
      forbidden: ['server/**'],
    },
    hermes: {
      name: 'Hermes',
      harness: 'Hermes',
      model: 'deepseek/deepseek-v4.1-flash-1017',
      cli: { harness: 'hermes', bin: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017', provider: 'openrouter' },
      worktree,
      role: 'Cheap tasks.',
      forbidden: [],
    },
  }
}

function hand(args, { worktree, runsPath, now } = {}) {
  return handRun({ argv: args, lanes: lanesFor(worktree), briefs: BRIEFS, runsPath, now })
}

describe('hand-run refusals', () => {
  it('refuses a lane that is not in lanes.json and writes nothing', () => {
    const temp = tempFolder()
    const result = hand(['claude', 'T1b', '--minutes', '5', '--branch', 'feat/x'], { worktree: temp, runsPath: runsPathFor(temp) })

    expect(result.code).toBe(1)
    expect(result.lines).toEqual(['There is no lane named claude.'])
    expect(existsSync(runsPathFor(temp))).toBe(false)
  })

  it('runs as a command and prints the same refusal', () => {
    const temp = tempFolder()
    const result = spawnSync(process.execPath, [HAND_SCRIPT, 'nope', 'T1b', '--minutes', '5', '--branch', 'feat/x'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TEMP: temp },
      windowsHide: true,
    })

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('There is no lane named nope.')
    expect(existsSync(join(temp, 'machineroom-runs', 'runs.jsonl'))).toBe(false)
  })

  it('refuses a lane that the runner records already', () => {
    const temp = tempFolder()
    const result = hand(['hermes', 'T1b', '--minutes', '5', '--branch', 'feat/x'], { worktree: temp, runsPath: runsPathFor(temp) })

    expect(result.code).toBe(1)
    expect(result.lines).toEqual(['The hermes lane runs through npm run run-lane, which records it already.'])
    expect(existsSync(runsPathFor(temp))).toBe(false)
  })

  it('refuses a brief that briefProblems refuses', () => {
    const temp = tempFolder()
    const cases = [
      ['C3e', 'Brief C3e is for opencode, not agy. Pass --force to run it anyway.'],
      ['C9z', 'There is no brief named C9z.'],
      ['T1c', 'Brief T1c is marked AGY, merged as 0.1.1. Pick another brief, or pass --force to run it again.'],
    ]
    for (const [id, sentence] of cases) {
      const result = hand(['agy', id, '--minutes', '5', '--branch', 'feat/x'], { worktree: temp, runsPath: runsPathFor(temp) })
      expect(result.code, id).toBe(1)
      expect(result.lines, id).toEqual([sentence])
      expect(existsSync(runsPathFor(temp)), id).toBe(false)
    }
  })

  it('refuses minutes that are not a number from 1 to 600', () => {
    const temp = tempFolder()
    const cases = [['--minutes', '0'], ['--minutes', '601'], ['--minutes', 'many'], ['--minutes', '1.5.2'], ['--minutes', '-2'], []]
    for (const args of cases) {
      const result = hand(['agy', 'T1b', ...args, '--branch', 'feat/x'], { worktree: temp, runsPath: runsPathFor(temp) })
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.lines, args.join(' ')).toEqual(['--minutes needs a number from 1 to 600.'])
      expect(existsSync(runsPathFor(temp)), args.join(' ')).toBe(false)
    }
  })

  it('refuses main as the branch, passed or read from the worktree', () => {
    const temp = tempFolder()
    const passed = hand(['agy', 'T1b', '--minutes', '5', '--branch', 'main'], { worktree: temp, runsPath: runsPathFor(temp) })
    expect(passed.code).toBe(1)
    expect(passed.lines).toEqual(['The worktree is on main. Pass --branch.'])

    const base = repoOnMain()
    const read = hand(['agy', 'T1b', '--minutes', '5'], { worktree: base, runsPath: runsPathFor(temp) })
    expect(read.code).toBe(1)
    expect(read.lines).toEqual(['The worktree is on main. Pass --branch.'])
    expect(existsSync(runsPathFor(temp))).toBe(false)
  })

  it('refuses a branch that a run record has already', () => {
    const temp = tempFolder()
    const path = runsPathFor(temp)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ lane: 'agy', branch: 'feat/taken' })}\n`)

    const result = hand(['agy', 'T1b', '--minutes', '5', '--branch', 'feat/taken'], { worktree: temp, runsPath: path })

    expect(result.code).toBe(1)
    expect(result.lines).toEqual(['A run record for feat/taken exists already.'])
    expect(readAllRunRecords(path)).toHaveLength(1)
  })
})

describe('hand-run record', () => {
  it('records the lane, brief, model and commits, and outcome accepts the branch', () => {
    const { worktree } = repoWithLaneWorktree()
    const temp = tempFolder()
    const path = runsPathFor(temp)
    const now = Date.parse('2026-10-20T12:00:00.000Z')

    const result = hand(['agy', 'T1b', '--minutes', '12'], { worktree, runsPath: path, now })

    expect(result.code).toBe(0)
    expect(result.lines).toEqual(['Recorded agy T1b on feat/hand-run. Record the review with npm run outcome -- feat/hand-run merged or rejected.'])
    const [record] = readAllRunRecords(path)
    expect(record).toMatchObject({
      lane: 'agy',
      briefs: ['T1b'],
      model: 'Gemini 4 Argon (Medium)',
      reasoning: null,
      minutes: 12,
      exitCode: 0,
      killed: false,
      costUsd: null,
      log: null,
      branch: 'feat/hand-run',
      source: 'hand',
    })
    expect(record.startedAt).toBe('2026-10-20T11:48:00.000Z')
    expect(record.commits).toHaveLength(1)
    expect(record.commits[0]).toContain('Add lane.md')

    const accepted = spawnSync(process.execPath, [OUTCOME_SCRIPT, 'feat/hand-run', 'merged'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TEMP: temp },
      windowsHide: true,
    })
    expect(accepted.status).toBe(0)
    expect(accepted.stdout).toContain('Recorded merged for feat/hand-run.')

    const outcomes = readOutcomeRecords(join(temp, 'machineroom-runs', 'outcomes.jsonl'))
    expect(outcomeTable(readAllRunRecords(path), outcomes)).toEqual([
      {
        lane: 'agy',
        model: 'Gemini 4 Argon (Medium)',
        runs: 1,
        merged: 1,
        rejected: 0,
        pending: 0,
        mergeRate: 1,
        averageFixes: null,
        costUsd: 0,
        decidedCostUsd: 0,
        costPerMerge: 0,
      },
    ])
  })

  it('takes the model and exit code from the flags and keeps the minutes before now', () => {
    const worktree = repoOnMain()
    const temp = tempFolder()
    const path = runsPathFor(temp)
    const now = Date.parse('2026-10-20T12:00:00.000Z')

    const result = hand(['agy', 'T1b', '--minutes', '3', '--model', 'custom/model', '--exit', '7', '--branch', 'feat/custom'], { worktree, runsPath: path, now })

    expect(result.code).toBe(0)
    const [record] = readAllRunRecords(path)
    expect(record).toMatchObject({
      model: 'custom/model',
      exitCode: 7,
      branch: 'feat/custom',
      minutes: 3,
      commits: [],
      source: 'hand',
    })
    expect(record.startedAt).toBe('2026-10-20T11:57:00.000Z')
  })

  it('is named in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['hand-run']).toBe('node scripts/hand-run.mjs')
  })
})
