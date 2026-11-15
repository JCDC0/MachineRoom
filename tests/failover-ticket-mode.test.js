import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { branchFor, buildPrompt } from '../src/briefs/briefs.js'
import { unattendedPrompt } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const BRIEF = { id: 'P349X', title: 'A failover run', text: 'Do it.\n\nFiles: note.txt\n' }
const TICKET_VALUE = '9f8e7d6c5b4a39281706f5e4d3c2b1a0'
const BRIDGE_VALUE = 'http://127.0.0.1:5999'
const MESSAGE_START = 'You may send your coordinator a short message'
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

function codexFailScript(counter, envFile) {
  return [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    `writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ ticket: process.env.MACHINEROOM_LANE_TICKET ?? null, bridge: process.env.MACHINEROOM_BRIDGE ?? null }))`,
    "console.log(JSON.stringify({ type: 'error', message: '429 Too Many Requests' }))",
    'process.exit(1)',
    '',
  ].join('\n')
}

function opencodeFailScript(counter, envFile) {
  return [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    `writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ ticket: process.env.MACHINEROOM_LANE_TICKET ?? null, bridge: process.env.MACHINEROOM_BRIDGE ?? null }))`,
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

function okEnvScript(counter, envFile, promptFile) {
  return [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    `writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ ticket: process.env.MACHINEROOM_LANE_TICKET ?? null, bridge: process.env.MACHINEROOM_BRIDGE ?? null }))`,
    `writeFileSync(${JSON.stringify(promptFile)}, process.argv[process.argv.length - 1] ?? '')`,
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

async function runFailover({ laneKey, lane, lanes, runs, prompt = 'Do it.', promptFor = null, name = 'failover' }) {
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
      prompt,
      promptFor,
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

describe('a failover run keeps the failed run mode', { timeout: 60000 }, () => {
  it('gives a Claude backup the plan mode the primary lane ran in', async () => {
    const base = makeTempDir('machine-room-failover-mode-')
    try {
      const first = join(base, '.worktrees', 'first')
      const backup = join(base, '.worktrees', 'backup')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const primaryEnv = join(base, 'primary-env.json')
      const okCount = join(base, 'ok-count.txt')
      const script = join(base, 'fake-claude.cjs')
      makeRepo(first, 'exec', codexFailScript(failCount, primaryEnv))
      makeRepo(backup)
      writeFileSync(script, okScript(okCount))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        codex: { name: 'Primary lane', worktree: first, fallback: 'claude', cli: { harness: 'codex', bin: process.execPath, model: 'fake/fail', mode: 'plan' } },
        claude: { name: 'Backup lane', worktree: backup, cli: { harness: 'claude', bin: process.execPath, model: 'fake/ok' } },
      }
      const original = harnessByKey.claude.command
      const seen = []
      harnessByKey.claude.command = (input) => {
        const command = original(input)
        seen.push({ mode: input.mode, args: command.args })
        return { file: process.execPath, args: [script], cwd: command.cwd }
      }
      let result
      let logs
      try {
        ({ result, logs } = await runFailover({ laneKey: 'codex', lane: lanes.codex, lanes, runs, name: 'mode' }))
      } finally {
        harnessByKey.claude.command = original
      }
      expect(result.code, logs.join('\n')).toBe(0)
      expect(seen).toHaveLength(1)
      expect(seen[0].mode).toBe('plan')
      expect(seen[0].args).toContain('--permission-mode')
      expect(seen[0].args[seen[0].args.indexOf('--permission-mode') + 1]).toBe('plan')
      expect(seen[0].args).not.toContain('--dangerously-skip-permissions')
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[1]).toMatchObject({ lane: 'claude', mode: 'plan', failoverFrom: { lane: 'codex' } })
      expect(count(okCount)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('does not start a backup whose harness lacks the mode', async () => {
    const base = makeTempDir('machine-room-failover-mode-refused-')
    try {
      const first = join(base, '.worktrees', 'first')
      const backup = join(base, '.worktrees', 'backup')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const primaryEnv = join(base, 'primary-env.json')
      const okCount = join(base, 'ok-count.txt')
      makeRepo(first, 'exec', codexFailScript(failCount, primaryEnv))
      makeRepo(backup, 'run', okScript(okCount))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        codex: { name: 'Primary lane', worktree: first, fallback: 'opencode', cli: { harness: 'codex', bin: process.execPath, model: 'fake/fail', mode: 'plan' } },
        opencode: { name: 'Backup lane', worktree: backup, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      const { result, logs } = await runFailover({ laneKey: 'codex', lane: lanes.codex, lanes, runs, name: 'refused' })
      expect(result.code, logs.join('\n')).toBe(1)
      expect(logs.join('\n')).toContain('OpenCode lanes cannot use plan mode because it needs a permission config.')
      expect(count(okCount)).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(1)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'opencode', refused: true })
      expect(records[0].lane).toBe('codex')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('a failover run gets no ticket of the failed lane', { timeout: 60000 }, () => {
  it('starts the backup harness without the ticket or the bridge and leaves the message paragraph out', async () => {
    const base = makeTempDir('machine-room-failover-message-')
    const savedTicket = process.env.MACHINEROOM_LANE_TICKET
    const savedBridge = process.env.MACHINEROOM_BRIDGE
    try {
      const first = join(base, '.worktrees', 'first')
      const backup = join(base, '.worktrees', 'backup')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const primaryEnv = join(base, 'primary-env.json')
      const okCount = join(base, 'ok-count.txt')
      const backupEnv = join(base, 'backup-env.json')
      const promptFile = join(base, 'backup-prompt.txt')
      makeRepo(first, 'run', opencodeFailScript(failCount, primaryEnv))
      makeRepo(backup, 'run', okEnvScript(okCount, backupEnv, promptFile))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Primary lane', worktree: first, fallback: 'agy', forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail' } },
        agy: { name: 'Backup lane', worktree: backup, forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      process.env.MACHINEROOM_LANE_TICKET = TICKET_VALUE
      process.env.MACHINEROOM_BRIDGE = BRIDGE_VALUE
      const promptFor = (laneKey, branchSuffix = '') =>
        unattendedPrompt(buildPrompt({ briefs: [BRIEF], laneKey, lanes, rules: { about: '', rules: [] }, version: '0.1.1', branchSuffix }), process.env)
      const { result, logs } = await runFailover({
        laneKey: 'opencode',
        lane: lanes.opencode,
        lanes,
        runs,
        prompt: promptFor('opencode'),
        promptFor,
        name: 'message',
      })
      expect(result.code, logs.join('\n')).toBe(0)
      expect(JSON.parse(readFileSync(primaryEnv, 'utf8'))).toEqual({ ticket: TICKET_VALUE, bridge: BRIDGE_VALUE })
      expect(JSON.parse(readFileSync(backupEnv, 'utf8'))).toEqual({ ticket: null, bridge: null })
      const prompt = readFileSync(promptFile, 'utf8')
      expect(prompt).toContain(`Your worktree is ${backup}.`)
      expect(prompt).toContain(`${branchFor(BRIEF)}-on-agy`)
      expect(prompt).not.toContain(MESSAGE_START)
      expect(count(okCount)).toBe(1)
    } finally {
      if (savedTicket === undefined) delete process.env.MACHINEROOM_LANE_TICKET
      else process.env.MACHINEROOM_LANE_TICKET = savedTicket
      if (savedBridge === undefined) delete process.env.MACHINEROOM_BRIDGE
      else process.env.MACHINEROOM_BRIDGE = savedBridge
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
