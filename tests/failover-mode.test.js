import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { laneWithOverrides } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { createAgentsConfigApi, readAllLanes } from '../server/agents-config.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const BRIEF = { id: 'P412X', title: 'A failover mode check', text: 'Do it.\n\nFiles: note.txt\n' }
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...GIT_IDENTITY },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function makeRepo(folder, scriptName = '', script = '') {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  if (scriptName !== '') writeFileSync(join(folder, scriptName), script)
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
}

function rateLimitFailScript(counter) {
  return [
    "const { appendFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    "console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
    'process.exit(1)',
    '',
  ].join('\n')
}

function okScript(counter) {
  return [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    "writeFileSync('note.txt', 'done\\n')",
    "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
    '',
  ].join('\n')
}

function count(file) {
  try {
    return readFileSync(file, 'utf8').length
  } catch {
    return 0
  }
}

function readRecords(runs) {
  const path = join(runs, 'runs.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function recordingNames(runs) {
  const names = new Set()
  for (const record of readRecords(runs)) {
    if (typeof record.log !== 'string' || record.log === '') continue
    names.add(basename(record.log).replace(/\.log$/i, ''))
  }
  return [...names]
}

function removeRecordings(names, indexBefore, existed) {
  for (const name of names) {
    for (const suffix of ['run.jsonl', 'agents.json', 'tree.json']) {
      rmSync(join(RECORDINGS, `${name}-${suffix}`), { force: true })
    }
  }
  if (existed !== true) {
    rmSync(RECORDINGS, { recursive: true, force: true })
    return
  }
  if (indexBefore !== null) writeFileSync(join(RECORDINGS, 'index.json'), indexBefore)
  else rmSync(join(RECORDINGS, 'index.json'), { force: true })
}

async function runFailover({ laneKey, lane, lanes, runs, mode, name = 'failover-mode' }) {
  const saved = process.env.MACHINEROOM_RUNS
  process.env.MACHINEROOM_RUNS = runs
  const indexPath = join(RECORDINGS, 'index.json')
  const recordingsExisted = existsSync(RECORDINGS)
  const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
  const logs = []
  const check = { mainCheckout: dirname(runs), lanes, home: join(dirname(runs), 'home'), temp: join(dirname(runs), 'temp'), runs }
  const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
  try {
    const result = await startLane({
      options: { lane: laneKey, ...(mode !== undefined ? { mode } : {}), minutes: 1, folderCheck: check },
      lane,
      lanes,
      wanted: [BRIEF],
      prompt: 'Do it.',
      logPath: join(runs, `${name}.log`),
      usageFile: join(runs, `${name}.usage.json`),
      name,
    })
    return { result, logs }
  } finally {
    spy.mockRestore()
    if (saved === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = saved
    removeRecordings(recordingNames(runs), indexBefore, recordingsExisted)
  }
}

async function runCodexBackupFailover({ primaryHarness = 'claude', primarySavedMode, runMode, backupMode, name }) {
  const base = makeTempDir(`machine-room-failover-${name}-`)
  try {
    const first = join(base, '.worktrees', 'first')
    const backup = join(base, '.worktrees', 'backup')
    const runs = join(base, 'runs')
    const failCount = join(base, 'fail-count.txt')
    const okCount = join(base, 'ok-count.txt')
    const failScript = join(base, 'fake-fail.cjs')
    const okScriptPath = join(base, 'fake-codex.cjs')
    makeRepo(first)
    makeRepo(backup)
    writeFileSync(failScript, rateLimitFailScript(failCount))
    writeFileSync(okScriptPath, okScript(okCount))
    mkdirSync(runs, { recursive: true })
    const primaryKey = primaryHarness
    const lanes = {
      [primaryKey]: {
        name: 'Primary lane',
        worktree: first,
        fallback: 'codex',
        cli: {
          harness: primaryHarness,
          bin: process.execPath,
          model: 'fake/fail',
          ...(primarySavedMode !== undefined ? { mode: primarySavedMode } : {}),
        },
      },
      codex: {
        name: 'Backup lane',
        worktree: backup,
        cli: {
          harness: 'codex',
          bin: process.execPath,
          model: 'fake/ok',
          ...(backupMode !== undefined ? { mode: backupMode } : {}),
        },
      },
    }
    const primaryLane = runMode !== undefined ? laneWithOverrides(lanes[primaryKey], { mode: runMode }) : lanes[primaryKey]
    lanes[primaryKey] = primaryLane
    const originalPrimary = harnessByKey[primaryHarness].command
    const originalCodex = harnessByKey.codex.command
    const seenPrimary = []
    const seen = []
    harnessByKey[primaryHarness].command = (input) => {
      const command = originalPrimary(input)
      seenPrimary.push({ mode: input.mode, args: command.args })
      return { file: process.execPath, args: [failScript], cwd: command.cwd }
    }
    harnessByKey.codex.command = (input) => {
      const command = originalCodex(input)
      seen.push({ mode: input.mode, args: command.args })
      return { file: process.execPath, args: [okScriptPath], cwd: command.cwd }
    }
    let result
    let logs
    try {
      ({ result, logs } = await runFailover({ laneKey: primaryKey, lane: primaryLane, lanes, runs, mode: runMode, name }))
    } finally {
      harnessByKey[primaryHarness].command = originalPrimary
      harnessByKey.codex.command = originalCodex
    }
    return { result, logs, seenPrimary, seen, records: readRecords(runs), okRuns: count(okCount) }
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('failover respects the backup lane saved mode', { timeout: 60000 }, () => {
  it('starts a Codex backup saved as plan in plan when a choice primary fails over from bypass', async () => {
    const { result, logs, seenPrimary, seen, records, okRuns } = await runCodexBackupFailover({
      primaryHarness: 'claude',
      primarySavedMode: 'choice',
      runMode: 'bypass',
      backupMode: 'plan',
      name: 'fixed-plan',
    })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seenPrimary).toHaveLength(1)
    expect(seenPrimary[0].mode).toBe('bypass')
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('plan')
    expect(seen[0].args.slice(seen[0].args.indexOf('--sandbox'), seen[0].args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'read-only'])
    expect(seen[0].args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ lane: 'claude', mode: 'bypass', failover: { kind: 'rate-limit', to: 'codex' } })
    expect(records[1]).toMatchObject({ lane: 'codex', mode: 'plan', failoverFrom: { lane: 'claude' } })
    expect(okRuns).toBe(1)
  })

  it('gives a backup saved as choice the primary lane mode', async () => {
    const { result, logs, seen, records, okRuns } = await runCodexBackupFailover({
      primaryHarness: 'claude',
      primarySavedMode: 'choice',
      runMode: 'bypass',
      backupMode: 'choice',
      name: 'choice-bypass',
    })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('bypass')
    expect(seen[0].args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'codex', mode: 'bypass', failoverFrom: { lane: 'claude' } })
    expect(okRuns).toBe(1)
  })

  it('resolves a choice backup to its harness default when the primary has no mode', async () => {
    const { result, logs, seen, records, okRuns } = await runCodexBackupFailover({
      primaryHarness: 'opencode',
      backupMode: 'choice',
      name: 'choice-default',
    })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('auto')
    expect(seen[0].args.slice(seen[0].args.indexOf('--sandbox'), seen[0].args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'workspace-write'])
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'codex', mode: 'auto', failoverFrom: { lane: 'opencode' } })
    expect(okRuns).toBe(1)
  })
})

function agentsPost(lanes, runsFolder, body) {
  let answer = null
  const api = createAgentsConfigApi({
    runsFolder,
    lanes,
    env: {},
    readJsonBody: async () => body,
    sendJson: (req, res, status, result) => {
      answer = { status, body: result }
    },
  })
  return async (path) => {
    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL(path, 'http://localhost'))
    return answer
  }
}

describe('choice needs a harness with modes', () => {
  it('refuses choice when creating or updating a Hermes lane and accepts it for Codex', async () => {
    const runs = makeTempDir('machine-room-choice-hermes-')
    try {
      const lanes = {
        hermesBase: { cli: { harness: 'hermes', bin: process.execPath } },
        codexBase: { cli: { harness: 'codex', bin: process.execPath } },
      }
      const createdHermesChoice = await agentsPost(lanes, runs, { name: 'Hermes Choice', harness: 'hermes', mode: 'choice', confirmed: true })('/api/lanes/create')
      expect(createdHermesChoice.status).toBe(400)
      expect(createdHermesChoice.body.error).toBe('The mode choice is not available for hermes.')

      const createdHermes = await agentsPost(lanes, runs, { name: 'Hermes Plain', harness: 'hermes', confirmed: true })('/api/lanes/create')
      expect(createdHermes.status).toBe(200)
      const updatedHermes = await agentsPost(lanes, runs, { mode: 'choice', confirmed: true })(`/api/lanes/${createdHermes.body.key}/update`)
      expect(updatedHermes.status).toBe(400)
      expect(updatedHermes.body.error).toBe('The mode choice is not available for hermes.')
      expect(readAllLanes({ lanesJson: lanes, runsFolder: runs })[createdHermes.body.key].cli.mode).toBeUndefined()

      const createdCodex = await agentsPost(lanes, runs, { name: 'Codex Choice', harness: 'codex', mode: 'choice', confirmed: true })('/api/lanes/create')
      expect(createdCodex.status).toBe(200)
      expect(readAllLanes({ lanesJson: lanes, runsFolder: runs })[createdCodex.body.key].cli.mode).toBe('choice')
    } finally {
      rmSync(runs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('treats a saved choice on a Hermes lane as no mode in run-lane', () => {
    const base = makeTempDir('machine-room-run-hermes-choice-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const lanesPath = join(base, 'lanes.json')
      mkdirSync(project, { recursive: true })
      writeFileSync(lanesPath, JSON.stringify({
        hermes: { name: 'Hermes', cli: { harness: 'hermes', bin: process.execPath, provider: 'fake', mode: 'choice' } },
      }))
      const env = { ...process.env, MACHINEROOM_LANES_FILE: lanesPath, MACHINEROOM_RUNS: runs }
      const dryRun = spawnSync(process.execPath, [RUN_LANE_SCRIPT, 'hermes', '--project', project, '--task', 'Say hi.', '--dry-run'], {
        env,
        encoding: 'utf8',
        timeout: 60000,
      })
      expect(dryRun.status, dryRun.stderr).toBe(0)
      expect(dryRun.stdout).toContain('Dry run, nothing started.')

      const explicitPlan = spawnSync(process.execPath, [RUN_LANE_SCRIPT, 'hermes', '--project', project, '--task', 'Say hi.', '--mode', 'plan', '--dry-run'], {
        env,
        encoding: 'utf8',
        timeout: 60000,
      })
      expect(explicitPlan.status).toBe(1)
      expect(explicitPlan.stderr).toContain('The hermes lane has no permission modes, so it cannot run in plan mode.')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
