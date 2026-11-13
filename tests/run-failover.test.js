import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { branchFor, buildPrompt } from '../src/briefs/briefs.js'
import { failoverKind, laneLockText } from '../src/briefs/run.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const BRIEF = { id: 'P260X', title: 'A failover run', text: 'Do it.\n\nFiles: note.txt\n' }
const FAILOVER_BRANCH = `${branchFor(BRIEF)}-on-agy`

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'user.name=MachineRoom Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function makeRepo(folder, script = '') {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  if (script !== '') writeFileSync(join(folder, 'run'), script)
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
}

function failScript(counter, message = '429 Too Many Requests') {
  return [
    "const { appendFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    `console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: ${JSON.stringify(message)} } }))`,
    'process.exit(1)',
    '',
  ].join('\n')
}

function okScript(counter, file) {
  return [
    "const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')",
    "const { dirname, join } = require('node:path')",
    `appendFileSync(${JSON.stringify(counter)}, 'x')`,
    `mkdirSync(dirname(join(process.cwd(), ${JSON.stringify(file)})), { recursive: true })`,
    `writeFileSync(join(process.cwd(), ${JSON.stringify(file)}), 'done\\n')`,
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
  const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
  try {
    const result = await startLane({
      options: { lane: laneKey, minutes: 1 },
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

describe('a lane that hits its quota hands its run to a backup lane', { timeout: 60000 }, () => {
  it('starts the same brief once on the backup lane with a -on- branch and links both records', async () => {
    const base = makeTempDir('machine-room-failover-')
    try {
      const first = join(base, 'first')
      const backup = join(base, 'backup')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const okCount = join(base, 'ok-count.txt')
      makeRepo(first, failScript(failCount))
      makeRepo(backup, okScript(okCount, 'note.txt'))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Fail lane', worktree: first, fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail', commits: 'runner' } },
        agy: { name: 'Backup lane', worktree: backup, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' } },
      }
      const { result, logs } = await runFailover({ laneKey: 'opencode', lane: lanes.opencode, lanes, runs })
      expect(result.code, logs.join('\n')).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(records[1].failoverFrom).toEqual({ lane: 'opencode', startedAt: records[0].startedAt })
      expect(records[1].lane).toBe('agy')
      expect(records[1].branch).toBe(FAILOVER_BRANCH)
      expect(gitIn(backup, ['rev-parse', '--verify', `refs/heads/${FAILOVER_BRANCH}`])).not.toBe('')
      expect(count(failCount)).toBe(1)
      expect(count(okCount)).toBe(1)
      expect(logs.join('\n')).toContain('moving the run to agy because rate-limit')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('keeps the backup prompt when a readiness retry moves the run', async () => {
    const base = makeTempDir('machine-room-failover-ready-')
    try {
      const first = join(base, 'first')
      const backup = join(base, 'backup')
      const runs = join(base, 'runs')
      const readyCount = join(base, 'ready-count.txt')
      const okCount = join(base, 'ok-count.txt')
      const promptFile = join(base, 'backup-prompt.txt')
      const readyScript = [
        "const { appendFileSync } = require('node:fs')",
        `appendFileSync(${JSON.stringify(readyCount)}, 'x')`,
        "console.log('Standalone server exited before reporting readiness')",
        'process.exit(1)',
        '',
      ].join('\n')
      const okPromptScript = [
        "const { appendFileSync, writeFileSync } = require('node:fs')",
        `appendFileSync(${JSON.stringify(okCount)}, 'x')`,
        `writeFileSync(${JSON.stringify(promptFile)}, process.argv[process.argv.length - 1])`,
        "writeFileSync('note.txt', 'done\\n')",
        "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        '',
      ].join('\n')
      makeRepo(first, readyScript)
      makeRepo(backup, okPromptScript)
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Fail lane', worktree: first, fallback: 'agy', forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail', commits: 'runner' } },
        agy: { name: 'Backup lane', worktree: backup, forbidden: [], cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' } },
      }
      const promptFor = (laneKey, branchSuffix = '') => buildPrompt({ briefs: [BRIEF], laneKey, lanes, rules: { about: '', rules: [] }, version: '0.1.1', branchSuffix })
      const { result, logs } = await runFailover({ laneKey: 'opencode', lane: lanes.opencode, lanes, runs, prompt: promptFor('opencode'), promptFor })
      expect(result.code, logs.join('\n')).toBe(0)
      expect(count(readyCount)).toBe(2)
      expect(count(okCount)).toBe(1)
      const prompt = readFileSync(promptFile, 'utf8')
      expect(prompt).toContain(`Your worktree is ${backup}.`)
      expect(prompt).toContain(`${branchFor(BRIEF)}-on-agy`)
      expect(prompt).not.toContain(`Your worktree is ${first}.`)
      expect(logs.join('\n')).toContain('moving the run to agy because start-failed')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('moves the run when the harness program cannot start at all', async () => {
    const base = makeTempDir('machine-room-failover-spawn-')
    try {
      const first = join(base, 'first')
      const backup = join(base, 'backup')
      const runs = join(base, 'runs')
      const okCount = join(base, 'ok-count.txt')
      makeRepo(first)
      makeRepo(backup, okScript(okCount, 'note.txt'))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Missing lane', worktree: first, fallback: 'agy', cli: { harness: 'opencode', bin: join(base, 'no-such-harness.exe'), model: 'fake/missing', commits: 'runner' } },
        agy: { name: 'Backup lane', worktree: backup, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' } },
      }
      const { result, logs } = await runFailover({ laneKey: 'opencode', lane: lanes.opencode, lanes, runs })
      expect(result.code, logs.join('\n')).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].startFailed).toBe(true)
      expect(records[0].failover).toEqual({ kind: 'start-failed', to: 'agy' })
      expect(records[1].lane).toBe('agy')
      expect(records[1].failoverFrom.lane).toBe('opencode')
      expect(count(okCount)).toBe(1)
      expect(logs.join('\n')).toContain('moving the run to agy because start-failed')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('does not move again when the backup run also fails', async () => {
    const base = makeTempDir('machine-room-failover-again-')
    try {
      const first = join(base, 'first')
      const backup = join(base, 'backup')
      const third = join(base, 'third')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const backupCount = join(base, 'backup-count.txt')
      const thirdCount = join(base, 'third-count.txt')
      makeRepo(first, failScript(failCount))
      makeRepo(backup, failScript(backupCount))
      makeRepo(third, okScript(thirdCount, 'note.txt'))
      mkdirSync(runs, { recursive: true })
      const lanes = {
        opencode: { name: 'Fail lane', worktree: first, fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail', commits: 'runner' } },
        agy: { name: 'Backup lane', worktree: backup, fallback: 'agy2', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail-again', commits: 'runner' } },
        agy2: { name: 'Third lane', worktree: third, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' } },
      }
      const { result, logs } = await runFailover({ laneKey: 'opencode', lane: lanes.opencode, lanes, runs })
      expect(result.code).toBe(1)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(records[1].failoverFrom.lane).toBe('opencode')
      expect(Object.hasOwn(records[1], 'failover')).toBe(false)
      expect(count(failCount)).toBe(1)
      expect(count(backupCount)).toBe(1)
      expect(count(thirdCount)).toBe(0)
      expect(logs.join('\n')).toContain('moving the run to agy because rate-limit')
      expect(logs.join('\n')).not.toContain('moving the run to agy2')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('moves a single project task to the backup lane on a -on- branch', async () => {
    const base = makeTempDir('machine-room-failover-project-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      const script = [
        "const { appendFileSync, writeFileSync } = require('node:fs')",
        "const title = process.argv.includes('--title') ? process.argv[process.argv.indexOf('--title') + 1] : ''",
        "if (title.startsWith('agy-project-')) {",
        `  appendFileSync(${JSON.stringify(okCount)}, 'x')`,
        "  writeFileSync('note.txt', 'done\\n')",
        "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        '} else {',
        "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
        '  process.exit(1)',
        '}',
        '',
      ].join('\n')
      makeRepo(project, script)
      const lanes = {
        opencode: { name: 'Fail lane', worktree: join(base, 'first'), fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail' } },
        agy: { name: 'Backup lane', worktree: join(base, 'backup'), cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      const saved = process.env.MACHINEROOM_RUNS
      const logs = []
      const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
      process.env.MACHINEROOM_RUNS = runs
      let result
      try {
        result = await startLane({
          options: { lane: 'opencode', minutes: 1 },
          lane: lanes.opencode,
          lanes,
          wanted: [],
          prompt: 'Do it.',
          logPath: join(runs, 'first-project.log'),
          usageFile: join(runs, 'first-project.usage.json'),
          name: 'first-project',
          project,
          task: 'Do it.',
        })
      } finally {
        spy.mockRestore()
        if (saved === undefined) delete process.env.MACHINEROOM_RUNS
        else process.env.MACHINEROOM_RUNS = saved
      }
      expect(result.code, logs.join('\n')).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(records[1].failoverFrom).toEqual({ lane: 'opencode', startedAt: records[0].startedAt })
      expect(gitIn(project, ['branch', '--show-current'])).toBe('main-on-agy')
      expect(existsSync(join(project, 'note.txt'))).toBe(true)
      expect(count(okCount)).toBe(1)
      expect(logs.join('\n')).toContain('moving the run to agy because rate-limit')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('returns the backup record and start state to a deferred project task', async () => {
    const base = makeTempDir('machine-room-failover-deferred-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      const script = [
        "const { appendFileSync, writeFileSync } = require('node:fs')",
        "const title = process.argv.includes('--title') ? process.argv[process.argv.indexOf('--title') + 1] : ''",
        "if (title.startsWith('agy-project-')) {",
        `  appendFileSync(${JSON.stringify(okCount)}, 'x')`,
        "  writeFileSync('note.txt', 'done\\n')",
        "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        '} else {',
        "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
        '  process.exit(1)',
        '}',
        '',
      ].join('\n')
      makeRepo(project, script)
      const lanes = {
        opencode: { name: 'Fail lane', worktree: join(base, 'first'), fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail' } },
        agy: { name: 'Backup lane', worktree: join(base, 'backup'), cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      const saved = process.env.MACHINEROOM_RUNS
      const logs = []
      const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
      process.env.MACHINEROOM_RUNS = runs
      let result
      try {
        result = await startLane({
          options: { lane: 'opencode', minutes: 1 },
          lane: lanes.opencode,
          lanes,
          wanted: [],
          prompt: 'Do it.',
          logPath: join(runs, 'deferred-project.log'),
          usageFile: join(runs, 'deferred-project.usage.json'),
          name: 'deferred-project',
          project,
          task: 'Do it.',
          deferRecord: true,
        })
      } finally {
        spy.mockRestore()
        if (saved === undefined) delete process.env.MACHINEROOM_RUNS
        else process.env.MACHINEROOM_RUNS = saved
      }
      expect(result.code, logs.join('\n')).toBe(0)
      expect(result.record).toMatchObject({ lane: 'agy', branch: 'main-on-agy' })
      expect(result.startBranch).toBe('main')
      expect(result.startHead).toMatch(/^[0-9a-f]{40}$/)
      const records = readRecords(runs)
      expect(records).toHaveLength(1)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(gitIn(project, ['branch', '--show-current'])).toBe('main-on-agy')
      expect(count(okCount)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('keeps a queue record and its summary on the branch the backup used', async () => {
    const base = makeTempDir('machine-room-failover-queue-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      const script = [
        "const { appendFileSync, writeFileSync } = require('node:fs')",
        "const title = process.argv.includes('--title') ? process.argv[process.argv.indexOf('--title') + 1] : ''",
        "if (title.startsWith('agy-project-')) {",
        `  appendFileSync(${JSON.stringify(okCount)}, 'x')`,
        "  writeFileSync('note.txt', 'done\\n')",
        "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
        '} else {',
        "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
        '  process.exit(1)',
        '}',
        '',
      ].join('\n')
      makeRepo(project, script)
      const baseHead = gitIn(project, ['rev-parse', 'HEAD'])
      const lanes = {
        opencode: { name: 'Fail lane', worktree: join(base, 'first'), fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail' } },
        agy: { name: 'Backup lane', worktree: join(base, 'backup'), cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok' } },
      }
      const lanesFile = join(base, 'lanes.json')
      writeFileSync(lanesFile, `${JSON.stringify(lanes, null, 2)}\n`)
      const queueFile = join(base, 'queue.txt')
      writeFileSync(queueFile, 'Do the task.\n')
      const result = await runLane(['opencode', '--project', project, '--queue', queueFile], {
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanesFile,
      })
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(records[1]).toMatchObject({ lane: 'agy', queueIndex: 1, queueSize: 1, base: baseHead })
      expect(records[1].branch).toMatch(/-on-agy$/)
      expect(records[1].queue).toMatch(/^machineroom\/queue-opencode-/)
      expect(records[1].queue).not.toMatch(/-on-agy$/)
      expect(records[1].commits).toHaveLength(1)
      expect(gitIn(project, ['branch', '--show-current'])).toBe(records[1].branch)
      expect(result.stdout).toContain(`branch: ${records[1].branch}`)
      expect(count(okCount)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('leaves the run failed with one sentence when the backup lane is busy', async () => {
    const base = makeTempDir('machine-room-failover-busy-')
    try {
      const first = join(base, 'first')
      const backup = join(base, 'backup')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const okCount = join(base, 'ok-count.txt')
      makeRepo(first, failScript(failCount))
      makeRepo(backup, okScript(okCount, 'note.txt'))
      mkdirSync(runs, { recursive: true })
      writeFileSync(join(runs, 'agy.lock'), laneLockText({ pid: process.pid, folder: backup }))
      const lanes = {
        opencode: { name: 'Fail lane', worktree: first, fallback: 'agy', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail', commits: 'runner' } },
        agy: { name: 'Backup lane', worktree: backup, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' } },
      }
      const { result, logs } = await runFailover({ laneKey: 'opencode', lane: lanes.opencode, lanes, runs })
      expect(result.code).toBe(1)
      const records = readRecords(runs)
      expect(records).toHaveLength(1)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'agy' })
      expect(count(okCount)).toBe(0)
      expect(logs).toContain('The backup lane agy is busy, so the run stays failed.')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

function runLane(args, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

describe('a backup lane named in lanes.json', () => {
  it('is refused at start when it is unknown, retired, the lane itself or the orchestrator', async () => {
    const folder = makeTempDir('machine-room-failover-refused-')
    try {
      const runs = join(folder, 'runs')
      mkdirSync(runs, { recursive: true })
      const caseEnv = {
        MACHINEROOM_RUNS: runs,
        TEMP: folder,
        TMP: folder,
        APPDATA: join(folder, 'AppData', 'Roaming'),
      }
      const cases = [
        { lanes: { opencode: { fallback: 'nope', cli: { harness: 'opencode', bin: 'opencode', model: 'fake' } } }, sentence: 'The backup lane nope is not in lanes.json.' },
        { lanes: { opencode: { fallback: 'old', cli: { harness: 'opencode', bin: 'opencode', model: 'fake' } }, old: { retired: true, cli: { harness: 'opencode', bin: 'opencode', model: 'fake' } } }, sentence: 'The backup lane old is retired.' },
        { lanes: { opencode: { fallback: 'opencode', cli: { harness: 'opencode', bin: 'opencode', model: 'fake' } } }, sentence: 'The lane opencode cannot name itself as its backup lane.' },
        { lanes: { opencode: { fallback: 'orchestrator', cli: { harness: 'opencode', bin: 'opencode', model: 'fake' } }, orchestrator: { cli: { harness: 'claude', bin: 'claude', model: 'opus' } } }, sentence: 'The orchestrator lane cannot be a backup lane.' },
      ]
      for (const [index, item] of cases.entries()) {
        const file = join(folder, `lanes-${index}.json`)
        writeFileSync(file, `${JSON.stringify(item.lanes, null, 2)}\n`)
        const result = await runLane(['opencode', 'P260X', '--dry-run'], { ...caseEnv, MACHINEROOM_LANES_FILE: file })
        expect(result.code, result.stderr).toBe(1)
        expect(`${result.stdout}\n${result.stderr}`).toContain(item.sentence)
        expect(result.stdout).not.toContain('moving the run')
      }
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('when a run moves to its backup lane', () => {
  it('moves only on a limit or a failed start, never after a success or a plain failure', () => {
    expect(failoverKind({ exitCode: 1, limited: 'rate-limit' })).toBe('rate-limit')
    expect(failoverKind({ exitCode: 1, limited: '', startFailed: true })).toBe('start-failed')
    expect(failoverKind({ exitCode: 1, limited: '' })).toBe('')
    expect(failoverKind({ exitCode: 0, limited: 'rate-limit' })).toBe('')
    expect(failoverKind({ exitCode: 1, limited: 'quota', killed: true })).toBe('')
  })

  it('gives the backup lane a prompt with its own worktree and the -on- branch', () => {
    const lanes = {
      opencode: { name: 'First', harness: 'OpenCode', model: 'a', role: '', worktree: 'C:/w/first', forbidden: [] },
      agy: { name: 'Backup', harness: 'AGY', model: 'b', role: '', worktree: 'C:/w/backup', forbidden: ['src/engine/**'] },
    }
    const briefs = [{ id: 'P1', title: 'Do the thing', text: 'Text.' }]
    const prompt = buildPrompt({ briefs, laneKey: 'agy', lanes, rules: { about: '', rules: [] }, version: '0.1.1', branchSuffix: '-on-agy' })
    expect(prompt).toContain('Your worktree is C:/w/backup.')
    expect(prompt).toContain(`git switch -c ${branchFor(briefs[0])}-on-agy refs/heads/main`)
    expect(prompt).toContain('src/engine/**')
    expect(prompt).not.toContain('C:/w/first')
  })
})
