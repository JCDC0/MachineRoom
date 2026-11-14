import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isHarnessAvailable, readAllLanes, saveAgentsConfig } from '../server/agents-config.js'
import { gitPath } from '../server/programPath.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CONFIG_LANES = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'lanes.json'), 'utf8'))
const FLEET_LANES = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'agents', 'lanes.json'), 'utf8'))
const RUN_LANE_SCRIPT = join(REPO_ROOT, 'scripts', 'run-lane.mjs')
const CASES = ['opencode', 'agy', 'claude', 'codex', 'copilot', 'machineroom']

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir(prefix = 'mr-made-lane-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function fleetLane(harness) {
  return Object.values(FLEET_LANES).find((lane) => lane?.cli?.harness === harness && lane.retired !== true) ?? null
}

function runLane(args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

describe('made lane defaults', () => {
  it('names each harness and gives it a program without a fleet lane', () => {
    const runs = tempDir()
    const agents = CASES.map((harness, index) => ({
      key: `${harness}-1`,
      name: `Made ${harness}`,
      harness,
      model: harness === 'machineroom' ? 'Local/alpha' : `model-${index + 1}`,
      createdAt: '2026-11-12T10:00:00.000Z',
    }))
    saveAgentsConfig(runs, { agents })

    const all = readAllLanes({ lanesJson: CONFIG_LANES, runsFolder: runs })

    for (const harness of CASES) {
      const lane = all[`${harness}-1`]
      const descriptor = harnessByKey[harness]
      expect(lane.name).toBe(`Made ${harness}`)
      expect(lane.harness).toBe(descriptor.laneName)
      expect(lane.cli.harness).toBe(harness)
      expect(lane.cli.bin).toBe(descriptor.defaultProgram)
      expect(lane.cli.bin.trim()).not.toBe('')
    }

    expect(all['opencode-1'].cli.bin).toBe(fleetLane('opencode').cli.bin)
    expect(all['agy-1'].cli.bin).toBe(fleetLane('agy').cli.bin)
    expect(all['opencode-1'].cli.bin).not.toBe('opencode')
    expect(all['agy-1'].cli.bin).not.toBe('agy')
  })

  it('copies the fleet lane when MACHINEROOM_LANES_DIR names the fleet', () => {
    const runs = tempDir()
    saveAgentsConfig(runs, {
      agents: [{ key: 'opencode-1', name: 'Made OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }],
    })
    const previous = process.env.MACHINEROOM_LANES_DIR
    process.env.MACHINEROOM_LANES_DIR = join(REPO_ROOT, 'docs', 'agents')
    cleanups.push(() => {
      if (previous === undefined) delete process.env.MACHINEROOM_LANES_DIR
      else process.env.MACHINEROOM_LANES_DIR = previous
    })

    const lane = readAllLanes({ runsFolder: runs })['opencode-1']

    expect(lane.harness).toBe(FLEET_LANES.opencode.harness)
    expect(lane.cli).toEqual({ ...FLEET_LANES.opencode.cli, model: 'opencode-go/deepseek-v4.1-flash' })
    expect(lane.notes).toEqual(FLEET_LANES.opencode.notes)
  })

  it('prints the expanded program path for a made OpenCode lane on a dry run', async () => {
    const folder = tempDir()
    const project = join(folder, 'Project')
    mkdirSync(project, { recursive: true })
    execFileSync(gitPath(), ['init'], { cwd: project, stdio: 'ignore' })

    const runs = join(folder, 'runs')
    saveAgentsConfig(runs, {
      agents: [{ key: 'opencode-1', name: 'Made OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }],
    })
    const appData = join(folder, 'AppData', 'Roaming')
    const expected = harnessByKey.opencode.defaultProgram.replace('%APPDATA%', appData)

    const result = await runLane(
      ['opencode-1', '--project', project, '--task', 'Fix it.', '--dry-run'],
      {
        MACHINEROOM_LANES_FILE: join(REPO_ROOT, 'config', 'lanes.json'),
        MACHINEROOM_LANES_DIR: '',
        MACHINEROOM_RUNS: runs,
        APPDATA: appData,
      }
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('file: ')
    expect(result.stdout).toContain(basename(expected))
  })

  it.skipIf(process.platform !== 'win32')('finds a harness at its fleet path when the room has no lane for it', () => {
    const folder = tempDir()
    const localAppData = join(folder, 'Local')
    const program = join(localAppData, 'agy', 'bin', 'agy.exe')
    mkdirSync(dirname(program), { recursive: true })
    writeFileSync(program, '')

    expect(
      isHarnessAvailable('agy', {
        lanes: CONFIG_LANES,
        env: { ...process.env, LOCALAPPDATA: localAppData },
        platform: 'win32',
      })
    ).toBe(true)
    expect(
      isHarnessAvailable('agy', {
        lanes: CONFIG_LANES,
        env: { ...process.env, LOCALAPPDATA: join(folder, 'Missing') },
        platform: 'win32',
      })
    ).toBe(false)
  })
})
