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
const BRIEF = { id: 'P430X', title: 'A failover bypass check', text: 'Do it.\n\nFiles: note.txt\n' }
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

async function runFailover({ laneKey, lane, lanes, runs, name }) {
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
      options: { lane: laneKey, minutes: 1, folderCheck: check },
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

async function runCodexBackupFailover({ backupMode, name }) {
  const base = makeTempDir(`machine-room-failover-bypass-${name}-`)
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
    const lanes = {
      claude: {
        name: 'Primary lane',
        worktree: first,
        fallback: 'codex',
        cli: { harness: 'claude', bin: process.execPath, model: 'fake/fail', mode: 'bypass' },
      },
      codex: {
        name: 'Backup lane',
        worktree: backup,
        cli: { harness: 'codex', bin: process.execPath, model: 'fake/ok' },
      },
    }
    if (backupMode !== undefined) lanes.codex.cli.mode = backupMode
    const originalClaude = harnessByKey.claude.command
    const originalCodex = harnessByKey.codex.command
    const seen = []
    harnessByKey.claude.command = (input) => {
      const command = originalClaude(input)
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
      ({ result, logs } = await runFailover({ laneKey: 'claude', lane: lanes.claude, lanes, runs, name }))
    } finally {
      harnessByKey.claude.command = originalClaude
      harnessByKey.codex.command = originalCodex
    }
    return { result, logs, seen, records: readRecords(runs), okRuns: count(okCount) }
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function sandboxArgs(args) {
  const at = args.indexOf('--sandbox')
  return at === -1 ? [] : args.slice(at, at + 2)
}

describe('a failover never hands Bypass to a backup that did not save it', { timeout: 60000 }, () => {
  it('runs a Codex backup with no saved mode in its own sandbox', async () => {
    const { result, logs, seen, records, okRuns } = await runCodexBackupFailover({ name: 'no-mode' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBeUndefined()
    expect(sandboxArgs(seen[0].args)).toEqual(['--sandbox', 'workspace-write'])
    expect(seen[0].args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'codex', failoverFrom: { lane: 'claude' } })
    expect(records[1].mode).toBeUndefined()
    expect(okRuns).toBe(1)
  })

  it('runs a Codex backup saved as choice in its own sandbox', async () => {
    const { result, logs, seen, records, okRuns } = await runCodexBackupFailover({ backupMode: 'choice', name: 'choice' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBeUndefined()
    expect(sandboxArgs(seen[0].args)).toEqual(['--sandbox', 'workspace-write'])
    expect(seen[0].args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'codex', failoverFrom: { lane: 'claude' } })
    expect(records[1].mode).toBeUndefined()
    expect(okRuns).toBe(1)
  })

  it('keeps Bypass on a Codex backup saved as bypass', async () => {
    const { result, logs, seen, records, okRuns } = await runCodexBackupFailover({ backupMode: 'bypass', name: 'bypass' })
    expect(result.code, logs.join('\n')).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].mode).toBe('bypass')
    expect(seen[0].args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ lane: 'codex', mode: 'bypass', failoverFrom: { lane: 'claude' } })
    expect(okRuns).toBe(1)
  })
})
