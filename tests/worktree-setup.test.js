import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { portOffsetFor, prepareWorktree } from '../scripts/run-lane.mjs'
import { harnessStatus, readHarnessSettings, saveHarnessSettings, updateHarnessSettings, WORKTREE_SETUP_PROBLEM, worktreeSetupOf } from '../server/harness-settings.js'
import { gitPath } from '../server/programPath.js'
import { worktreeFor } from '../src/briefs/run.js'
import { withLanePrograms } from './helpers/lanePrograms.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const FAKE_LANE = fileURLToPath(new URL('fixtures/fake-lane.cjs', import.meta.url))
const cleanups = []
let repoTemplate = ''
let repoTemplateRoot = ''

beforeAll(() => {
  repoTemplateRoot = makeTempDir('mr-worktree-setup-template-')
  repoTemplate = join(repoTemplateRoot, 'Other')
  mkdirSync(repoTemplate)
  git(repoTemplate, ['init', '-q', '-b', 'main'])
  git(repoTemplate, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repoTemplate, 'readme.txt'), 'start\n')
  git(repoTemplate, ['add', '-A'])
  git(repoTemplate, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'start'])
})

afterAll(() => {
  rmSync(repoTemplateRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix = 'mr-worktree-setup-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))
  return dir
}

function git(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'user.email=worktree@example.com', '-c', 'user.name=MachineRoom Worktree', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(String(result.stderr ?? '').trim() || `git ${args[0]} failed.`)
  return String(result.stdout ?? '')
}

function initRepo(parent) {
  const folder = join(parent, 'Other')
  cpSync(repoTemplate, folder, { recursive: true })
  git(folder, ['config', 'user.name', 'MachineRoom Worktree'])
  git(folder, ['config', 'user.email', 'worktree@example.com'])
  return folder
}

function addLaneFiles(folder, setupScript) {
  copyFileSync(FAKE_LANE, join(folder, 'run'))
  writeFileSync(join(folder, setupScript.name), setupScript.text)
  writeFileSync(join(folder, '.gitignore'), 'setup-ran.txt\nsetup-tried.txt\n')
  git(folder, ['add', '-A'])
  git(folder, ['commit', '-q', '-m', 'Add the fake lane and the setup script'])
}

function lanesFile(base) {
  const file = join(base, 'lanes.json')
  writeFileSync(file, `${JSON.stringify({
    opencode: {
      name: 'Fake lane',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
    },
  }, null, 2)}\n`)
  return file
}

function runLane(args, extra = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...withLanePrograms(process.env, tempDir('mr-lane-programs-')), ...extra },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 60000)
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

describe('the worktree setup command', () => {
  it('passes the lane port offset to the run', { timeout: 60000 }, async () => {
    const base = tempDir()
    const project = initRepo(base)
    addLaneFiles(project, { name: 'setup.cjs', text: '' })
    writeFileSync(join(project, 'run'), "require('node:fs').writeFileSync('offset.txt', process.env.MACHINEROOM_PORT_OFFSET)\n")
    git(project, ['add', 'run'])
    git(project, ['commit', '-q', '-m', 'Record the offset'])
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    const lanes = lanesFile(base)
    const lane = JSON.parse(readFileSync(lanes, 'utf8')).opencode
    writeFileSync(lanes, JSON.stringify({ first: lane, opencode: lane }))
    const result = await runLane(
      ['opencode', '--project', project, '--task', 'Write the lane note.', '--worktree'],
      { TEMP: base, MACHINEROOM_RUNS: runs, MACHINEROOM_LANES_FILE: lanes }
    )
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(readFileSync(join(worktreeFor(project, 'opencode'), 'offset.txt'), 'utf8')).toBe(String(portOffsetFor('opencode', ['first', 'opencode'])))
  })
  it('runs once in a new worktree and writes its time to the run log', { timeout: 60000 }, async () => {
    const base = tempDir()
    const project = initRepo(base)
    addLaneFiles(project, {
      name: 'setup.cjs',
      text: "require('node:fs').writeFileSync('setup-ran.txt', 'yes')\n",
    })
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    saveHarnessSettings(runs, { programs: {}, off: [], worktreeSetup: 'node setup.cjs' })
    const lanes = lanesFile(base)

    const result = await runLane(
      ['opencode', '--project', project, '--task', 'Write the lane note.', '--worktree'],
      { TEMP: base, MACHINEROOM_RUNS: runs, MACHINEROOM_LANES_FILE: lanes }
    )
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)
    const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
    const log = readFileSync(record.log, 'utf8')
    expect(log).toMatch(/worktree setup: node setup\.cjs \(\d+ s, exit 0\)/)
    expect(existsSync(join(worktreeFor(project, 'opencode'), 'setup-ran.txt'))).toBe(true)
  })

  it('does not run in a worktree it reuses', () => {
    const base = tempDir()
    const project = initRepo(base)
    addLaneFiles(project, {
      name: 'setup.cjs',
      text: "require('node:fs').writeFileSync('setup-ran.txt', 'yes')\n",
    })
    const first = prepareWorktree(project, 'opencode', { setup: 'node setup.cjs' })
    expect(first.made).toBe(true)
    expect(first.worktreeSetup).toMatch(/^worktree setup: node setup\.cjs \(\d+ s, exit 0\)$/)
    unlinkSync(join(first.path, 'setup-ran.txt'))
    const plan = prepareWorktree(project, 'opencode', { setup: 'node setup.cjs' })
    expect(plan.made).toBe(false)
    expect(plan.worktreeSetup).toBeUndefined()
    expect(existsSync(join(plan.path, 'setup-ran.txt'))).toBe(false)
  })

  it('stops the run with the line and leaves the worktree when the command fails', { timeout: 60000 }, async () => {
    const base = tempDir()
    const project = initRepo(base)
    addLaneFiles(project, {
      name: 'fail.cjs',
      text: "require('node:fs').writeFileSync('setup-tried.txt', 'yes')\nprocess.exit(2)\n",
    })
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    saveHarnessSettings(runs, { programs: {}, off: [], worktreeSetup: 'node fail.cjs' })
    const lanes = lanesFile(base)

    const result = await runLane(
      ['opencode', '--project', project, '--task', 'Write the lane note.', '--worktree'],
      { TEMP: base, MACHINEROOM_RUNS: runs, MACHINEROOM_LANES_FILE: lanes }
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/worktree setup: node fail\.cjs \(\d+ s, exit 2\)/)
    const path = worktreeFor(project, 'opencode')
    expect(existsSync(path)).toBe(true)
    expect(existsSync(join(path, 'setup-tried.txt'))).toBe(true)
    expect(existsSync(join(runs, 'runs.jsonl'))).toBe(false)
  })

  it('runs nothing when the setting is empty', () => {
    const base = tempDir()
    const project = initRepo(base)
    addLaneFiles(project, {
      name: 'setup.cjs',
      text: "require('node:fs').writeFileSync('setup-ran.txt', 'yes')\n",
    })
    const settings = join(base, 'machineroom-runs')
    mkdirSync(settings)
    saveHarnessSettings(settings, { programs: {}, off: [] })
    expect(worktreeSetupOf(readHarnessSettings(settings))).toBe('')
    const plan = prepareWorktree(project, 'opencode', { setup: worktreeSetupOf(readHarnessSettings(settings)) })
    expect(plan.made).toBe(true)
    expect(plan.worktreeSetup).toBeUndefined()
    expect(existsSync(join(plan.path, 'setup-ran.txt'))).toBe(false)
  })

  it('keeps one command line in Settings', async () => {
    const settings = tempDir()
    expect(worktreeSetupOf(readHarnessSettings(settings))).toBe('')
    expect(updateHarnessSettings(settings, { worktreeSetup: ' npm ci ' })).toBe('')
    expect(readHarnessSettings(settings).worktreeSetup).toBe('npm ci')
    const row = await harnessStatus('claude', { runsFolder: settings, lanes: {}, env: { PATH: '' }, available: true })
    expect(row.worktreeSetup).toBe('npm ci')
    expect(updateHarnessSettings(settings, { worktreeSetup: 'npm ci\nnpm test' })).toBe(WORKTREE_SETUP_PROBLEM)
    expect(readHarnessSettings(settings).worktreeSetup).toBe('npm ci')
    expect(updateHarnessSettings(settings, { worktreeSetup: '' })).toBe('')
    expect(worktreeSetupOf(readHarnessSettings(settings))).toBe('')
  })
})
