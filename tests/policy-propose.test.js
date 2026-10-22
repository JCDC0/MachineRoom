import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTempDir } from './helpers/tempRoot.js'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'policy-propose.mjs')
const POLICY = join(ROOT, 'docs', 'agents', 'policy.json')
const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-policy-propose-no-git-config')
const OPENCODE2 = 'opencode2'
const AGY = 'agy'
const A = 'opencode-go/deepseek-v4.1-flash'
const B = 'Gemini 3.8 Flash (High)'
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function useTemp() {
  const dir = makeTempDir('mr-policy-propose-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function runsFolder(temp) {
  const folder = join(temp, 'machineroom-runs')
  mkdirSync(folder, { recursive: true })
  return folder
}

function writeRecords(temp, runs, outcomes) {
  const folder = runsFolder(temp)
  writeFileSync(join(folder, 'runs.jsonl'), `${runs.map((record) => JSON.stringify(record)).join('\n')}\n`)
  writeFileSync(join(folder, 'outcomes.jsonl'), `${outcomes.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

function runPolicy(temp, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TEMP: temp },
    windowsHide: true,
  })
}

function patchFiles(temp) {
  const folder = join(temp, 'machineroom-runs')
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter((name) => /^policy-\d{8}-\d{6}\.patch$/.test(name))
}

function record(lane, model, branch, costUsd) {
  return { lane, model, branch, costUsd }
}

function swapRecords() {
  const runs = []
  const outcomes = []
  for (let index = 1; index <= 10; index += 1) {
    const branch = `feat/a${index}`
    runs.push(record(OPENCODE2, A, branch, 0.05))
    outcomes.push({ branch, outcome: index <= 7 ? 'merged' : 'rejected', fixes: 0 })
  }
  for (let index = 1; index <= 12; index += 1) {
    const branch = `feat/b${index}`
    runs.push(record(AGY, B, branch, 0.03))
    outcomes.push({ branch, outcome: index <= 11 ? 'merged' : 'rejected', fixes: 0 })
  }
  return { runs, outcomes }
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
}

describe('policy-propose command', () => {
  it('writes a patch for a swap and the patch passes git apply check', () => {
    const temp = useTemp()
    const { runs, outcomes } = swapRecords()
    writeRecords(temp, runs, outcomes)

    const result = runPolicy(temp, [])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Move agy on Gemini 3.8 Flash (High) ahead of opencode2 on opencode-go/deepseek-v4.1-flash in the small tier:')

    const [name] = patchFiles(temp)
    expect(name).toBeTruthy()
    const patch = join(temp, 'machineroom-runs', name)
    expect(result.stdout).toContain(`Patch: ${patch}. Read it, then run git apply ${patch} in the main checkout.`)

    const repo = useTemp()
    const policyFile = join(repo, 'docs', 'agents', 'policy.json')
    mkdirSync(dirname(policyFile), { recursive: true })
    writeFileSync(policyFile, readFileSync(POLICY, 'utf8'))
    writeFileSync(join(repo, 'policy.patch'), readFileSync(patch, 'utf8'))
    git(repo, ['init', '-b', 'main'])
    git(repo, ['apply', '--check', 'policy.patch'])
    git(repo, ['apply', 'policy.patch'])
    const after = JSON.parse(readFileSync(policyFile, 'utf8'))
    expect(after.tiers.small.map((choice) => choice.model)).toEqual([B, A])
  })

  it('proposes nothing and writes no file when the records do not justify a swap', () => {
    const temp = useTemp()
    const runs = []
    const outcomes = []
    for (let index = 1; index <= 10; index += 1) {
      const branch = `feat/a${index}`
      runs.push(record(OPENCODE2, A, branch, 0.05))
      outcomes.push({ branch, outcome: index <= 7 ? 'merged' : 'rejected', fixes: 0 })
    }
    for (let index = 1; index <= 3; index += 1) {
      const branch = `feat/b${index}`
      runs.push(record(AGY, B, branch, 0.03))
      outcomes.push({ branch, outcome: 'merged', fixes: 0 })
    }
    writeRecords(temp, runs, outcomes)

    const result = runPolicy(temp, [])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('fewer than 10')
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toBe('No change to propose.')
    expect(patchFiles(temp)).toEqual([])
  })

  it('takes --min as the decided run floor', () => {
    const temp = useTemp()
    const { runs, outcomes } = swapRecords()
    writeRecords(temp, runs, outcomes)

    const accepted = runPolicy(temp, ['--min', '10'])
    expect(accepted.status).toBe(0)
    expect(patchFiles(temp)).toHaveLength(1)

    const quiet = useTemp()
    writeRecords(quiet, runs, outcomes)
    const refused = runPolicy(quiet, ['--min', '20'])
    expect(refused.status).toBe(0)
    expect(refused.stdout).toContain('fewer than 20')
    expect(refused.stdout).toContain('No change to propose.')
    expect(patchFiles(quiet)).toEqual([])
  })

  it('refuses a bad --since', () => {
    const temp = useTemp()
    writeRecords(temp, [], [])
    for (const value of ['not-a-date', '2026-02-30', '2026-1-5']) {
      const result = runPolicy(temp, ['--since', value])
      expect(result.status, value).toBe(1)
      expect(`${result.stdout}${result.stderr}`, value).toContain('--since needs a date like 2026-10-19.')
      expect(patchFiles(temp), value).toEqual([])
    }
  })

  it('refuses a bad --min', () => {
    const temp = useTemp()
    writeRecords(temp, [], [])
    for (const value of ['0', '1001', '1.5', 'many', '-1']) {
      const result = runPolicy(temp, ['--min', value])
      expect(result.status, value).toBe(1)
      expect(`${result.stdout}${result.stderr}`, value).toContain('--min needs a whole number from 1 to 1000.')
      expect(patchFiles(temp), value).toEqual([])
    }
    const missing = runPolicy(temp, ['--min'])
    expect(missing.status).toBe(1)
    expect(`${missing.stdout}${missing.stderr}`).toContain('--min needs a whole number from 1 to 1000.')
  })

  it('leaves the real policy file unchanged', () => {
    const before = readFileSync(POLICY, 'utf8')
    const temp = useTemp()
    const { runs, outcomes } = swapRecords()
    writeRecords(temp, runs, outcomes)
    expect(runPolicy(temp, []).status).toBe(0)

    const quiet = useTemp()
    writeRecords(quiet, [], [])
    expect(runPolicy(quiet, []).status).toBe(0)

    expect(readFileSync(POLICY, 'utf8')).toBe(before)
  })
})
