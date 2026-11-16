import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { createRunsApi } from '../server/runs.js'
import { startLane } from '../scripts/run-lane.mjs'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const OUTSIDE_PROBLEM = 'The backup lane outside is outside the sector that started this run.'
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

function makeRepo(folder, script = '') {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  if (script !== '') writeFileSync(join(folder, 'run'), script)
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
}

function sectorScript(failCounter, okCounter) {
  return [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    "const title = process.argv.includes('--title') ? process.argv[process.argv.indexOf('--title') + 1] : ''",
    "if (title.startsWith('outside-')) {",
    `  appendFileSync(${JSON.stringify(okCounter)}, 'x')`,
    "  writeFileSync('note.txt', 'done\\n')",
    "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
    '} else {',
    `  appendFileSync(${JSON.stringify(failCounter)}, 'x')`,
    "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.rate_limit', message: '429 Too Many Requests' } }))",
    '  process.exit(1)',
    '}',
    '',
  ].join('\n')
}

function lanePair(base) {
  return {
    inside: {
      name: 'Inside',
      worktree: join(base, '.worktrees', 'inside'),
      fallback: 'outside',
      cli: { harness: 'opencode', bin: process.execPath, model: 'fake/fail', commits: 'runner' },
    },
    outside: {
      name: 'Outside',
      worktree: join(base, '.worktrees', 'outside'),
      cli: { harness: 'opencode', bin: process.execPath, model: 'fake/ok', commits: 'runner' },
    },
  }
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

function runLane(args, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'MachineRoom Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'MachineRoom Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        ...env,
      },
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
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

async function runTask({ lanes, project, runs, options = {} }) {
  const saved = process.env.MACHINEROOM_RUNS
  process.env.MACHINEROOM_RUNS = runs
  const logs = []
  const spy = vi.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)))
  try {
    const result = await startLane({
      options: { lane: 'inside', minutes: 1, ...options },
      lane: lanes.inside,
      lanes,
      wanted: [],
      prompt: 'Do it.',
      project,
      task: 'Do it.',
      logPath: join(runs, 'inside-project.log'),
      usageFile: join(runs, 'inside-project.usage.json'),
      name: 'inside-project',
    })
    return { result, logs }
  } finally {
    spy.mockRestore()
    if (saved === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = saved
  }
}

function readCalls(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function optionValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? '' : args[index + 1]
}

describe('a failover stays inside the sector that started the run', { timeout: 60000 }, () => {
  it('does not start a task backup outside the allowed lanes', async () => {
    const base = makeTempDir('machine-room-sector-task-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      makeRepo(project, sectorScript(failCount, okCount))
      const lanes = lanePair(base)
      const { result, logs } = await runTask({ lanes, project, runs, options: { allowedLanes: ['inside'] } })
      expect(result.code, logs.join('\n')).toBe(1)
      expect(logs).toContain(OUTSIDE_PROBLEM)
      expect(count(okCount)).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ lane: 'inside', failover: { kind: 'rate-limit', to: 'outside', refused: true } })
      expect(gitIn(project, ['branch', '--show-current'])).toBe('main')
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('does not start a queue backup outside the allowed lanes', async () => {
    const base = makeTempDir('machine-room-sector-queue-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      makeRepo(project, sectorScript(failCount, okCount))
      const lanes = lanePair(base)
      const lanesFile = join(base, 'lanes.json')
      writeFileSync(lanesFile, `${JSON.stringify(lanes, null, 2)}\n`)
      const queueFile = join(base, 'queue.txt')
      writeFileSync(queueFile, 'Do the task.\n')
      const result = await runLane(['inside', '--project', project, '--queue', queueFile, '--allowed-lanes', 'inside'], {
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanesFile,
      })
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain(OUTSIDE_PROBLEM)
      expect(count(okCount)).toBe(0)
      const records = readRecords(runs)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ lane: 'inside', failover: { kind: 'rate-limit', to: 'outside', refused: true } })
      expect(records[0].queueStatus).toMatch(/^failed/)
      expect(gitIn(project, ['branch', '--show-current'])).toMatch(/^machineroom\/queue-inside-/)
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('still fails over when Main starts the task', async () => {
    const base = makeTempDir('machine-room-sector-main-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      const failCount = join(base, 'fail-count.txt')
      const okCount = join(base, 'ok-count.txt')
      mkdirSync(runs, { recursive: true })
      makeRepo(project, sectorScript(failCount, okCount))
      const lanes = lanePair(base)
      const { result, logs } = await runTask({ lanes, project, runs })
      expect(result.code, logs.join('\n')).toBe(0)
      expect(logs).not.toContain(OUTSIDE_PROBLEM)
      expect(count(failCount)).toBe(1)
      expect(count(okCount)).toBe(1)
      const records = readRecords(runs)
      expect(records).toHaveLength(2)
      expect(records[0].failover).toEqual({ kind: 'rate-limit', to: 'outside' })
      expect(records[1]).toMatchObject({ lane: 'outside', branch: 'main-on-outside', failoverFrom: { lane: 'inside' } })
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('gives a sub start its sector lanes and a Main start none', async () => {
    const base = makeTempDir('machine-room-sector-server-')
    try {
      const project = join(base, 'project')
      const runs = join(base, 'runs')
      mkdirSync(runs, { recursive: true })
      makeRepo(project)
      const lanes = lanePair(base)
      const lanesFile = join(base, 'lanes.json')
      writeFileSync(lanesFile, `${JSON.stringify(lanes, null, 2)}\n`)
      const callsFile = join(base, 'calls.jsonl')
      const runner = join(base, 'runner.mjs')
      writeFileSync(runner, [
        "import { appendFileSync } from 'node:fs'",
        "appendFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)) + '\\n')",
        '',
      ].join('\n'))
      const registry = {
        idForToken: (token) => (token === 'sub-token' ? 'scout' : token === 'main-token' ? 'orchestrator' : null),
        sector: (id) => (id === 'scout' ? { id: 'scout', name: 'Scout', lanes: ['inside'] } : null),
        sectorForLane: (lane) => (lane === 'inside' ? { id: 'scout' } : null),
      }
      let body = null
      let answer = null
      const api = createRunsApi({
        projectRoot: project,
        lanesFile,
        runsFolder: runs,
        runnerCommand: { file: process.execPath, args: [runner, callsFile] },
        activeLanes: { isChosen: () => true, isLaneActive: () => true, isLaneHidden: () => false },
        orchestrators: () => registry,
        readJsonBody: async () => body,
        sendJson: (req, res, status, value) => {
          answer = { status, body: value }
        },
      })
      async function post(token, value) {
        body = value
        answer = null
        await api.handle(
          { method: 'POST', headers: { 'x-machineroom-orchestrator': token } },
          {},
          new URL('http://127.0.0.1/api/control/runs')
        )
        return answer
      }
      try {
        const task = await post('sub-token', { lane: 'inside', task: 'Fix it.', confirmed: true })
        expect(task.status).toBe(202)
        await waitFor(() => readCalls(callsFile).length === 1, { what: 'the sub task runner call' })
        expect(optionValue(readCalls(callsFile)[0], '--allowed-lanes')).toBe('inside')
        await waitFor(() => !api.isRunning('inside'), { what: 'the sub task to end' })

        const queue = await post('sub-token', { lane: 'inside', tasks: ['Fix it.', 'Check it.'], confirmed: true })
        expect(queue.status).toBe(202)
        await waitFor(() => readCalls(callsFile).length === 2, { what: 'the sub queue runner call' })
        expect(optionValue(readCalls(callsFile)[1], '--allowed-lanes')).toBe('inside')
        await waitFor(() => !api.isRunning('inside'), { what: 'the sub queue to end' })

        const main = await post('main-token', { lane: 'inside', task: 'Fix it.', confirmed: true })
        expect(main.status).toBe(202)
        await waitFor(() => readCalls(callsFile).length === 3, { what: 'the Main runner call' })
        expect(optionValue(readCalls(callsFile)[2], '--allowed-lanes')).toBe('')
        await waitFor(() => !api.isRunning('inside'), { what: 'the Main task to end' })
      } finally {
        api.stopAll()
      }
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
