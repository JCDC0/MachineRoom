import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { harnessByKey } from '../src/harnesses/index.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const BRIEF = { id: 'P444X', title: 'A failover bypass default check', text: 'Do it.\n\nFiles: note.txt\n' }
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

function makeRepo(folder) {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
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
    "console.log('{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}')",
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

async function runBackupFailover({ backupHarness, backupKey, backupMode, name }) {
  const base = makeTempDir(`machine-room-failover-bypass-default-${name}-`)
  try {
    const first = join(base, '.worktrees', 'first')
    const backup = join(base, '.worktrees', 'backup')
    const runs = join(base, 'runs')
    const failCount = join(base, 'fail-count.txt')
    const okCount = join(base, 'ok-count.txt')
    const failScript = join(base, 'fake-fail.cjs')
    const okScriptPath = join(base, 'fake-ok.cjs')
    makeRepo(first)
    makeRepo(backup)
    writeFileSync(failScript, rateLimitFailScript(failCount))
    writeFileSync(okScriptPath, okScript(okCount))
    mkdirSync(runs, { recursive: true })
    const lanes = {
      primary: {
        name: 'Primary lane',
        worktree: first,
        fallback: backupKey,
        cli: { harness: 'claude', bin: process.execPath, model: 'fake/fail', mode: 'bypass' },
      },
      [backupKey]: {
        name: 'Backup lane',
        worktree: backup,
        cli: { harness: backupHarness, bin: process.execPath, model: 'fake/ok' },
      },
    }
    if (backupMode !== undefined) lanes[backupKey].cli.mode = backupMode
    const originals = {}
    const seen = []
    const patch = (harness) => {
      if (Object.hasOwn(originals, harness)) return
      originals[harness] = harnessByKey[harness].command
      harnessByKey[harness].command = (input) => {
        const command = originals[harness](input)
        if (input.cli?.model === 'fake/fail') return { file: process.execPath, args: [failScript], cwd: command.cwd }
        seen.push({ mode: input.mode, args: command.args, env: command.env })
        return { file: process.execPath, args: [okScriptPath], cwd: command.cwd }
      }
    }
    patch('claude')
    patch(backupHarness)
    const saved = process.env.MACHINEROOM_RUNS
    process.env.MACHINEROOM_RUNS = runs
    const indexPath = join(RECORDINGS, 'index.json')
    const recordingsExisted = existsSync(RECORDINGS)
    const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
    const logs = []
    const check = { mainCheckout: dirname(runs), lanes, home: join(dirname(runs), 'home'), temp: join(dirname(runs), 'temp'), runs }
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
    let result
    try {
      result = await startLane({
        options: { lane: 'primary', minutes: 1, folderCheck: check },
        lane: lanes.primary,
        lanes,
        wanted: [BRIEF],
        prompt: 'Do it.',
        logPath: join(runs, `${name}.log`),
        usageFile: join(runs, `${name}.usage.json`),
        name,
      })
    } finally {
      spy.mockRestore()
      for (const [harness, command] of Object.entries(originals)) harnessByKey[harness].command = command
      if (saved === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = saved
      removeRecordings(recordingNames(runs), indexBefore, recordingsExisted)
    }
    return { result, logs, seen, records: readRecords(runs), okRuns: count(okCount) }
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function flagValue(args, flag) {
  const at = args.indexOf(flag)
  return at === -1 ? [] : args.slice(at, at + 2)
}

describe('a failover that drops Bypass gives the backup its harness default', { timeout: 60000 }, () => {
  it('runs a Claude backup with no saved mode in its Auto default', async () => {
    const { result, logs, seen, records, okRuns } = await runBackupFailover({ backupHarness: 'claude', backupKey: 'claudeBackup', name: 'claude-default' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('auto')
    expect(flagValue(seen[0].args, '--permission-mode')).toEqual(['--permission-mode', 'auto'])
    expect(seen[0].args).not.toContain('--dangerously-skip-permissions')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'claudeBackup', mode: 'auto', failoverFrom: { lane: 'primary' } })
    expect(okRuns).toBe(1)
  })

  it('runs an AGY backup with no saved mode in its Auto default', async () => {
    const { result, logs, seen, records, okRuns } = await runBackupFailover({ backupHarness: 'agy', backupKey: 'agyBackup', name: 'agy-default' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('auto')
    expect(flagValue(seen[0].args, '--mode')).toEqual(['--mode', 'auto'])
    expect(seen[0].args).not.toContain('--dangerously-skip-permissions')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'agyBackup', mode: 'auto', failoverFrom: { lane: 'primary' } })
    expect(okRuns).toBe(1)
  })

  it('runs a native backup with no saved mode in its Auto default', async () => {
    const { result, logs, seen, records, okRuns } = await runBackupFailover({ backupHarness: 'machineroom', backupKey: 'nativeBackup', name: 'native-default' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('auto')
    expect(seen[0].env?.MACHINEROOM_PERMISSION_MODE).toBe('auto')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'nativeBackup', mode: 'auto', failoverFrom: { lane: 'primary' } })
    expect(okRuns).toBe(1)
  })

  it('gives a choice backup its harness default', async () => {
    const { result, logs, seen, records, okRuns } = await runBackupFailover({ backupHarness: 'claude', backupKey: 'claudeBackup', backupMode: 'choice', name: 'choice-default' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('auto')
    expect(flagValue(seen[0].args, '--permission-mode')).toEqual(['--permission-mode', 'auto'])
    expect(seen[0].args).not.toContain('--dangerously-skip-permissions')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'claudeBackup', mode: 'auto', failoverFrom: { lane: 'primary' } })
    expect(okRuns).toBe(1)
  })

  it('keeps Bypass on a backup saved as bypass', async () => {
    const { result, logs, seen, records, okRuns } = await runBackupFailover({ backupHarness: 'claude', backupKey: 'claudeBackup', backupMode: 'bypass', name: 'bypass-kept' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('bypass')
    expect(seen[0].args).toContain('--dangerously-skip-permissions')
    expect(flagValue(seen[0].args, '--permission-mode')).toEqual([])
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'claudeBackup', mode: 'bypass', failoverFrom: { lane: 'primary' } })
    expect(okRuns).toBe(1)
  })
})
