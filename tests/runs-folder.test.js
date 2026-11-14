import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateRunsFolder, runsFolder } from '../server/lanes-source.js'
import { createRunsApi, laneStatesFor } from '../server/runs.js'
import { runsFolderDefault as harnessModelsRunsFolder } from '../server/harness-models.js'
import { runsFolderDefault as orchestratorRunsFolder } from '../server/orchestrator.js'
import { runsFolderDefault as orchestratorsRunsFolder } from '../server/orchestrators.js'
import { mcpRunsDir } from '../scripts/mcp-bridge.mjs'
import { runsFolderFrom as agentRunsFolder } from '../scripts/mr-agent.mjs'
import { runsFile as recordingRunsFile } from '../scripts/run-recording.mjs'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const RECORDING_SCRIPT = fileURLToPath(new URL('../scripts/run-recording.mjs', import.meta.url))

const made = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  made.push(dir)
  return dir
}

function oldFolder(base) {
  const folder = join(base, 'temp', 'machineroom-runs')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'runs.jsonl'), 'one\n')
  return folder
}

afterEach(() => {
  for (const dir of made.splice(0)) removeTempDir(dir)
})

describe('the runs folder on each system', () => {
  it('answers the Windows local app data folder', () => {
    const base = tempDir('mr-runs-win-')
    const local = join(base, 'local')
    const temp = join(base, 'temp')
    expect(runsFolder({ LOCALAPPDATA: local, TEMP: temp }, 'win32')).toBe(join(local, 'MachineRoom', 'runs'))
  })

  it('falls back to the temp folder on Windows when local app data is missing', () => {
    const base = tempDir('mr-runs-win-temp-')
    const temp = join(base, 'temp')
    expect(runsFolder({ TEMP: temp }, 'win32')).toBe(join(temp, 'machineroom-runs'))
  })

  it('answers the XDG state folder elsewhere', () => {
    const base = tempDir('mr-runs-linux-')
    const state = join(base, 'state')
    expect(runsFolder({ XDG_STATE_HOME: state, TEMP: join(base, 'temp') }, 'linux')).toBe(join(state, 'machineroom', 'runs'))
  })

  it('answers the home state folder elsewhere when XDG state is missing', () => {
    const base = tempDir('mr-runs-home-')
    const home = join(base, 'home')
    expect(runsFolder({ HOME: home, TEMP: join(base, 'temp') }, 'linux')).toBe(join(home, '.local', 'state', 'machineroom', 'runs'))
  })

  it('falls back to the temp folder elsewhere when no state folder is found', () => {
    const base = tempDir('mr-runs-linux-temp-')
    const temp = join(base, 'temp')
    expect(runsFolder({ TEMP: temp }, 'linux')).toBe(join(temp, 'machineroom-runs'))
  })

  it('lets MACHINEROOM_RUNS win on every system', () => {
    const base = tempDir('mr-runs-named-')
    const named = join(base, 'named')
    expect(runsFolder({ MACHINEROOM_RUNS: named, LOCALAPPDATA: join(base, 'local') }, 'win32')).toBe(resolve(named))
    expect(runsFolder({ MACHINEROOM_RUNS: named, XDG_STATE_HOME: join(base, 'state') }, 'linux')).toBe(resolve(named))
  })
})

describe('the callers of the runs folder', () => {
  it('give the same folder as runsFolder', () => {
    const base = tempDir('mr-runs-callers-')
    const env = {
      LOCALAPPDATA: join(base, 'local'),
      XDG_STATE_HOME: join(base, 'state'),
      HOME: join(base, 'home'),
      TEMP: join(base, 'temp'),
    }
    const expected = runsFolder(env)
    expect(harnessModelsRunsFolder(env)).toBe(expected)
    expect(orchestratorRunsFolder(env)).toBe(expected)
    expect(orchestratorsRunsFolder(env)).toBe(expected)
    expect(mcpRunsDir(env)).toBe(expected)
    expect(agentRunsFolder(env)).toBe(expected)
    expect(recordingRunsFile(env)).toBe(join(expected, 'runs.jsonl'))
  })

  it('give the same named folder when MACHINEROOM_RUNS is set', () => {
    const base = tempDir('mr-runs-callers-named-')
    const named = join(base, 'named')
    const env = {
      MACHINEROOM_RUNS: named,
      LOCALAPPDATA: join(base, 'local'),
      XDG_STATE_HOME: join(base, 'state'),
      HOME: join(base, 'home'),
      TEMP: join(base, 'temp'),
    }
    expect(runsFolder(env)).toBe(resolve(named))
    expect(harnessModelsRunsFolder(env)).toBe(resolve(named))
    expect(orchestratorRunsFolder(env)).toBe(resolve(named))
    expect(orchestratorsRunsFolder(env)).toBe(resolve(named))
    expect(mcpRunsDir(env)).toBe(resolve(named))
    expect(agentRunsFolder(env)).toBe(resolve(named))
    expect(recordingRunsFile(env)).toBe(join(resolve(named), 'runs.jsonl'))
  })
})

describe('run-recording help', () => {
  it('prints the usage for --help and -h without reading runs or writing a recording', () => {
    const runs = tempDir('mr-run-recording-help-')
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(process.execPath, [RECORDING_SCRIPT, flag], {
        encoding: 'utf8',
        env: { ...process.env, MACHINEROOM_RUNS: runs },
        windowsHide: true,
      })

      expect(result.status, flag).toBe(0)
      expect(result.stdout.trim(), flag).toBe('Usage: npm run run-recording -- 1')
      expect(result.stderr, flag).toBe('')
      expect(result.stdout, flag).not.toContain('recording:')
    }
    expect(existsSync(join(runs, 'runs.jsonl'))).toBe(false)
  })
})

describe('moving the old runs folder', () => {
  it('copies it once, keeps the old one and prints no real path', () => {
    const base = tempDir('mr-runs-move-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    const env = { LOCALAPPDATA: local, TEMP: join(base, 'temp') }
    const lines = []

    expect(migrateRunsFolder(env, 'win32', (line) => lines.push(line))).toEqual({ from: old, to })
    expect(readFileSync(join(to, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')

    writeFileSync(join(to, 'later.txt'), 'kept\n')
    expect(migrateRunsFolder(env, 'win32', (line) => lines.push(line))).toBe(null)
    expect(readFileSync(join(to, 'later.txt'), 'utf8')).toBe('kept\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(lines).toEqual(['Moved the runs folder from %TEMP%\\machineroom-runs to %LOCALAPPDATA%\\MachineRoom\\runs.'])
    expect(lines[0]).not.toContain(base)
  })

  it('never copies over a new folder', () => {
    const base = tempDir('mr-runs-new-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    mkdirSync(to, { recursive: true })
    writeFileSync(join(to, 'keep.txt'), 'new\n')
    const lines = []

    expect(migrateRunsFolder({ LOCALAPPDATA: local, TEMP: join(base, 'temp') }, 'win32', (line) => lines.push(line))).toBe(null)
    expect(readFileSync(join(to, 'keep.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(to, 'runs.jsonl'))).toBe(false)
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(lines).toEqual([])
  })

  it('runs when the bridge or a lane asks for the folder', () => {
    const base = tempDir('mr-runs-trigger-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    const printed = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(runsFolder({ LOCALAPPDATA: local, TEMP: join(base, 'temp') }, 'win32')).toBe(to)
    } finally {
      printed.mockRestore()
    }
    expect(readFileSync(join(to, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
  })

  it('does not move anything when MACHINEROOM_RUNS names the folder', () => {
    const base = tempDir('mr-runs-named-move-')
    oldFolder(base)
    const named = join(base, 'named')
    expect(runsFolder({ MACHINEROOM_RUNS: named, LOCALAPPDATA: join(base, 'local'), TEMP: join(base, 'temp') }, 'win32')).toBe(resolve(named))
    expect(existsSync(named)).toBe(false)
  })
})

describe('lane lock checks in laneStatesFor', () => {
  const DEAD_PID = 2147483647
  const lanesConfig = {
    orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
    opencode: { name: 'OpenCode', cli: { harness: 'opencode', model: 'model' } },
    opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', model: 'model' } },
  }
  const activeLanes = { isChosen: () => true, isLaneActive: () => true, hiddenKeySet: () => new Set() }

  function statesWith({ lock, platform = 'win32', stat, list }) {
    const runs = tempDir('mr-runs-lock-')
    if (lock !== undefined) writeFileSync(join(runs, 'opencode.lock'), JSON.stringify(lock))
    return laneStatesFor({ lanesConfig, runsFolder: runs, activeLanes, platform, stat, list })
  }

  function busyOf(state, key) {
    return state.lanes.find((lane) => lane.key === key)?.busy
  }

  it('does not mark a lane busy on Windows when lock pid and child pid were reused', () => {
    const childPid = process.ppid > 0 && process.ppid !== process.pid ? process.ppid : DEAD_PID
    let listCalls = 0
    const state = statesWith({
      lock: { pid: process.pid, child: childPid },
      stat: () => ({ mtimeMs: 10000 }),
      list: () => {
        listCalls += 1
        return [
          { pid: process.pid, created: 13000 },
          { pid: childPid, created: 14000 },
        ]
      },
    })
    expect(busyOf(state, 'opencode')).toBe(false)
    expect(busyOf(state, 'opencode2')).toBe(false)
    expect(listCalls).toBe(1)
  })

  it('marks a lane busy when either runner pid or child pid is alive', () => {
    const hasDistinctParent = process.ppid > 0 && process.ppid !== process.pid
    const childPid = hasDistinctParent ? process.ppid : process.pid
    const reusedPidLiveChild = statesWith({
      lock: { pid: hasDistinctParent ? process.pid : DEAD_PID, child: childPid },
      stat: () => ({ mtimeMs: 10000 }),
      list: () => [
        { pid: process.pid, created: hasDistinctParent ? 13000 : 9000 },
        ...(hasDistinctParent ? [{ pid: childPid, created: 9000 }] : []),
      ],
    })
    expect(busyOf(reusedPidLiveChild, 'opencode')).toBe(true)

    const liveRunnerOnly = statesWith({
      lock: { pid: process.pid },
      stat: () => ({ mtimeMs: 10000 }),
      list: () => [{ pid: process.pid, created: 9000 }],
    })
    expect(busyOf(liveRunnerOnly, 'opencode')).toBe(true)

    let listCalls = 0
    const linuxChild = statesWith({
      lock: { pid: DEAD_PID, child: process.pid },
      platform: 'linux',
      list: () => {
        listCalls += 1
        return []
      },
    })
    expect(busyOf(linuxChild, 'opencode')).toBe(true)
    expect(listCalls).toBe(0)

    const allDead = statesWith({
      lock: { pid: DEAD_PID, child: DEAD_PID - 1 },
      list: () => {
        listCalls += 1
        return []
      },
    })
    expect(busyOf(allDead, 'opencode')).toBe(false)
    expect(listCalls).toBe(0)
  })

  it('routes an auto run to a lane whose Windows lock pid was reused', async () => {
    const base = tempDir('mr-runs-auto-stale-')
    const runs = join(base, 'runs')
    const project = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(project, { recursive: true })
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(lanesConfig))
    writeFileSync(
      join(base, 'policy.json'),
      JSON.stringify({
        tiers: {
          small: [
            { lane: 'opencode', model: 'model', reasoning: 'max', provider: 'opencode' },
            { lane: 'opencode2', model: 'model', reasoning: 'max', provider: 'opencode' },
          ],
          medium: [{ lane: 'opencode', model: 'model', reasoning: 'max', provider: 'opencode' }],
          large: [{ lane: 'owner', model: null, reasoning: null, provider: null }],
        },
        limits: { runUsd: 1, issueUsd: 5, agentMonthlyUsd: 50, companyMonthlyUsd: 100, maxTurnsPerRun: 200, timeoutSec: 3600 },
        quotaSkipPercent: 90,
      })
    )
    writeFileSync(join(runs, 'opencode.lock'), JSON.stringify({ pid: process.pid }))

    let answer = null
    const api = createRunsApi({
      projectRoot: project,
      runsFolder: runs,
      lanesFile,
      activeLanes,
      runnerCommand: { file: process.execPath, args: ['-e', ''] },
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({ lane: 'auto', task: 'Fix typo.', confirmed: true }),
      platform: 'win32',
      stat: () => ({ mtimeMs: 10000 }),
      list: () => [{ pid: process.pid, created: 13000 }],
    })
    try {
      const handled = await api.handle({ method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } }, {}, new URL('http://127.0.0.1/api/control/runs'))
      expect(handled).toBe(true)
      expect(answer.status).toBe(202)
      expect(answer.body.lane).toBe('opencode')
      const deadline = Date.now() + 5000
      while (api.isRunning('opencode') && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 20))
      }
    } finally {
      api.stopAll()
    }
  })
})
