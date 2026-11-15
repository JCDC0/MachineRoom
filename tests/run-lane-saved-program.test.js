import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { runDoctorWithProject } from '../server/doctor.js'
import { saveHarnessSettings } from '../server/harness-settings.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function makeFolder(prefix) {
  const folder = makeTempDir(prefix)
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return folder
}

function nodeCopy(folder, name) {
  const file = join(folder, name)
  try {
    linkSync(process.execPath, file)
  } catch {
    copyFileSync(process.execPath, file)
  }
  return file
}

function fakeClaudeCommand(marker) {
  const previous = harnessByKey.claude.command
  harnessByKey.claude.command = ({ cli, folder }) => ({
    file: cli.bin,
    args: ['-e', "require('node:fs').writeFileSync(process.argv[1], process.execPath)", marker],
    cwd: folder,
  })
  return () => {
    harnessByKey.claude.command = previous
  }
}

function useRunsFolder(runs) {
  const previous = process.env.MACHINEROOM_RUNS
  process.env.MACHINEROOM_RUNS = runs
  return () => {
    if (previous === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previous
  }
}

async function runLane({ folder, runs, lane, name }) {
  return startLane({
    options: { lane: name, minutes: 1 },
    lane,
    lanes: { [name]: lane },
    wanted: [],
    prompt: 'Do the task.',
    logPath: join(runs, `${name}.log`),
    usageFile: join(runs, `${name}.usage.json`),
    name,
    project: folder,
    task: 'Do the task.',
  })
}

function runBin(args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    cleanups.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error('run-lane did not exit'))
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

it('starts the program saved for the harness when the lane names no bin', async () => {
  const folder = makeFolder('mr-saved-program-')
  const runs = join(folder, 'runs')
  const saved = nodeCopy(folder, 'saved-node.exe')
  saveHarnessSettings(runs, { programs: { claude: saved }, off: [] })
  const marker = join(folder, 'marker.txt')
  const restore = fakeClaudeCommand(marker)
  const restoreRuns = useRunsFolder(runs)
  try {
    const lane = { name: 'Saved', worktree: folder, cli: { harness: 'claude', model: 'sonnet' } }
    await runLane({ folder, runs, lane, name: 'saved-program' })
    expect(readFileSync(marker, 'utf8')).toBe(saved)
  } finally {
    restore()
    restoreRuns()
  }
})

it('keeps a lane own bin and starts the saved program for the harness default', async () => {
  const folder = makeFolder('mr-own-bin-')
  const runs = join(folder, 'runs')
  const saved = nodeCopy(folder, 'saved-node.exe')
  saveHarnessSettings(runs, { programs: { claude: saved }, off: [] })
  const marker = join(folder, 'marker.txt')
  const restore = fakeClaudeCommand(marker)
  const restoreRuns = useRunsFolder(runs)
  try {
    const lane = { name: 'Default', worktree: folder, cli: { harness: 'claude', bin: 'claude', model: 'sonnet' } }
    await runLane({ folder, runs, lane, name: 'default-program' })
    expect(readFileSync(marker, 'utf8')).toBe(saved)

    const own = { ...lane, name: 'Own', cli: { ...lane.cli, bin: process.execPath } }
    await runLane({ folder, runs, lane: own, name: 'own-program' })
    expect(readFileSync(marker, 'utf8')).toBe(process.execPath)
    expect(readFileSync(marker, 'utf8')).not.toBe(saved)
  } finally {
    restore()
    restoreRuns()
  }
})

it('refuses a lane on a turned-off harness before it makes a folder, a lock or a worktree', async () => {
  const folder = makeFolder('mr-off-harness-')
  const runs = join(folder, 'runs')
  const worktree = join(folder, 'worktree')
  saveHarnessSettings(runs, { programs: {}, off: ['claude'] })
  const lanesFile = join(folder, 'lanes.json')
  writeFileSync(lanesFile, `${JSON.stringify({
    claude: { name: 'Claude', worktree, cli: { harness: 'claude', bin: 'claude', model: 'sonnet' } },
  })}\n`)

  const result = await runBin(['claude', 'T2'], {
    MACHINEROOM_LANES_FILE: lanesFile,
    MACHINEROOM_RUNS: runs,
    TEMP: folder,
    TMP: folder,
  })

  expect(result.code, result.stderr).toBe(1)
  expect(result.stdout).toContain('That harness is turned off in Settings.')
  expect(result.stdout).not.toContain('dry run')
  expect(existsSync(worktree)).toBe(false)
  expect(existsSync(join(runs, 'claude.lock'))).toBe(false)
  expect(readdirSync(runs)).toEqual(['harnesses.json'])
})

it('prints the doctor line for each harness state', async () => {
  const folder = makeFolder('mr-doctor-harness-')
  const project = join(folder, 'project')
  const dist = join(folder, 'dist')
  const runs = join(folder, 'runs')
  mkdirSync(project)
  mkdirSync(dist)
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  const ready = join(folder, 'ready.mjs')
  const failing = join(folder, 'failing.mjs')
  writeFileSync(ready, "console.log('fake 1.0')\n")
  writeFileSync(failing, 'process.exit(1)\n')
  saveHarnessSettings(runs, { programs: { claude: ready, opencode: failing }, off: ['agy'] })
  const lanesFile = join(folder, 'lanes.json')
  writeFileSync(lanesFile, '{}\n')

  const result = await runDoctorWithProject({
    projectRoot: project,
    runsFolder: runs,
    dist,
    lanesFile,
    env: { PATH: '' },
    readProject: async () => ({ files: [] }),
  })

  expect(result.lines).toContain('ok Claude Code is ready (fake 1.0).')
  expect(result.lines).toContain('warn OpenCode is not ready: The program did not answer a version check.')
  expect(result.lines).toContain('info AGY is turned off in Settings.')
})
