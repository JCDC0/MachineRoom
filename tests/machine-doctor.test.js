import { spawn } from 'node:child_process'
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { doctorSettings, openBrowser, openCommand, runDoctor, upArgs, upBlock } from '../server/doctor.js'
import { withLanePrograms } from './helpers/lanePrograms.js'
import { makeTempDir } from './helpers/tempRoot.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(root, 'bin', 'machine-room.mjs')
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

function writeLanes(lanes) {
  const folder = makeFolder('machine-room-doctor-lanes-')
  const file = join(folder, 'lanes.json')
  writeFileSync(file, JSON.stringify(lanes))
  return file
}

function doctor(options = {}) {
  const project = makeFolder('machine-room-doctor-project-')
  const runs = join(makeFolder('machine-room-doctor-runs-'), 'machineroom-runs')
  return runDoctor({
    projectRoot: project,
    runsFolder: runs,
    lanesFile: writeLanes({
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath } },
    }),
    env: { ...process.env },
    ...options,
  })
}

function failures(lines) {
  return lines.filter((line) => line.startsWith('FAIL '))
}

function childEnv(temp) {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  delete env.MACHINEROOM_LANES
  delete env.MACHINEROOM_SESSIONS
  delete env.MACHINEROOM_RUNS
  env.TEMP = temp
  return withLanePrograms(env, temp)
}

function runBin(args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    cleanups.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error('the doctor bin did not exit'))
    }, 15000)
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
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

describe('machine-room doctor', () => {
  it('passes the folder, git, the runs folder and the lane programs', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const base = makeFolder('machine-room-doctor-runs-')
    const runs = join(base, 'machineroom-runs')
    const lanes = writeLanes({
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath } },
      claude: { name: 'Claude Code', cli: { harness: 'claude', bin: '%NODE_BIN%' } },
    })
    const result = runDoctor({
      projectRoot: project,
      runsFolder: runs,
      lanesFile: lanes,
      env: { ...process.env, NODE_BIN: process.execPath },
    })

    expect(result.exitCode).toBe(0)
    expect(failures(result.lines)).toEqual([])
    expect(result.lines).toHaveLength(5)
    expect(result.lines[0]).toContain('The project folder')
    expect(result.lines[1]).toContain('Git is found at')
    expect(result.lines[2]).toBe(`ok The runs folder ${runs} is ready.`)
    expect(result.lines[3]).toContain('The OpenCode lane starts from')
    expect(result.lines[4]).toContain('The Claude Code lane starts from')
    expect(statSync(runs).isDirectory()).toBe(true)
  })

  it('checks the runs folder MACHINEROOM_RUNS names', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const runs = join(makeFolder('machine-room-doctor-runs-'), 'named-runs')
    const lanes = writeLanes({})
    const env = { ...process.env, MACHINEROOM_RUNS: runs }

    expect(doctorSettings({}, env).runsFolder).toBe(resolve(runs))
    const result = runDoctor({ projectRoot: project, lanesFile: lanes, env })
    expect(result.lines).toContain(`ok The runs folder ${runs} is ready.`)
  })

  it('fails a project folder that does not exist', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const result = doctor({ projectRoot: join(project, 'missing') })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(failures(result.lines)[0]).toContain('does not exist')
  })

  it('fails a project path that is a file', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const file = join(project, 'notes.txt')
    writeFileSync(file, 'x')
    const result = doctor({ projectRoot: file })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual([`FAIL The project folder ${file} is not a folder.`])
  })

  it('fails when git is not on the PATH', () => {
    const result = doctor({ env: { PATH: '' } })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toContain('FAIL Git is not on the PATH.')
  })

  it('fails a lane program that was not found', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const runs = join(makeFolder('machine-room-doctor-runs-'), 'machineroom-runs')
    const missing = join(project, 'no-such-program.exe')
    const lanes = writeLanes({
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath } },
      opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', bin: missing } },
    })
    const result = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: lanes, env: { ...process.env } })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual([`FAIL The OpenCode 2 lane program was not found: ${missing}.`])
  })

  it('fails a lane program whose environment variable is not set', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const runs = join(makeFolder('machine-room-doctor-runs-'), 'machineroom-runs')
    const lanes = writeLanes({
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: join('%MACHINEROOM_MISSING_BIN%', 'opencode.exe') } },
    })
    const env = { ...process.env }
    delete env.MACHINEROOM_MISSING_BIN
    const result = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: lanes, env })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(failures(result.lines)[0]).toContain('The OpenCode lane program cannot start.')
    expect(failures(result.lines)[0]).toContain('The environment variable MACHINEROOM_MISSING_BIN is not set.')
  })

  it('keeps a retired lane out of the checks', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const runs = join(makeFolder('machine-room-doctor-runs-'), 'machineroom-runs')
    const lanes = writeLanes({
      hermes: { name: 'Hermes', retired: true, cli: { harness: 'hermes', bin: join(project, 'gone.exe') } },
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath } },
    })
    const result = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: lanes, env: { ...process.env } })

    expect(result.exitCode).toBe(0)
    expect(result.lines.join('\n')).not.toContain('Hermes')
  })

  it('fails a lane file that is missing, broken or not a list', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const runs = join(makeFolder('machine-room-doctor-runs-'), 'machineroom-runs')
    const folder = makeFolder('machine-room-doctor-lanes-')

    const missing = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: join(folder, 'gone.json'), env: { ...process.env } })
    expect(missing.exitCode).toBe(1)
    expect(failures(missing.lines)[0]).toContain('could not be read')

    const brokenPath = join(folder, 'broken.json')
    writeFileSync(brokenPath, '{')
    const broken = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: brokenPath, env: { ...process.env } })
    expect(broken.exitCode).toBe(1)
    expect(failures(broken.lines)[0]).toContain('is not JSON')

    const listPath = join(folder, 'list.json')
    writeFileSync(listPath, '[]')
    const list = runDoctor({ projectRoot: project, runsFolder: runs, lanesFile: listPath, env: { ...process.env } })
    expect(list.exitCode).toBe(1)
    expect(failures(list.lines)[0]).toContain('is not a list of lanes')
  })

  it('fails a runs path that is a file', () => {
    const project = makeFolder('machine-room-doctor-project-')
    const base = makeFolder('machine-room-doctor-runs-')
    const file = join(base, 'runs.txt')
    writeFileSync(file, 'x')
    const result = doctor({ projectRoot: project, runsFolder: file })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual([`FAIL The runs folder ${file} is not a folder.`])
  })
})

describe('the machine-room doctor command', () => {
  it('runs as a child process and exits 0 when every check passes', async () => {
    const project = makeFolder('machine-room-doctor-project-')
    const temp = makeFolder('machine-room-doctor-temp-')
    const run = await runBin(['doctor', '--root', project], childEnv(temp))

    expect(run.code).toBe(0)
    expect(run.stderr).toBe('')
    const lines = run.stdout.trim().split(/\r?\n/)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.every((line) => line.startsWith('ok '))).toBe(true)
    expect(existsSync(join(temp, 'machineroom-runs'))).toBe(true)
  })

  it('exits 1 on a failed check', async () => {
    const project = makeFolder('machine-room-doctor-project-')
    const temp = makeFolder('machine-room-doctor-temp-')
    const run = await runBin(['doctor', '--root', join(project, 'missing')], childEnv(temp))

    expect(run.code).toBe(1)
    expect(run.stdout).toContain('FAIL The project folder')
    expect(run.stdout).toContain('does not exist.')
  })

  it('prints its help', async () => {
    const temp = makeFolder('machine-room-doctor-temp-')
    const run = await runBin(['--help'], childEnv(temp))

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Usage: machine-room')
    expect(run.stdout).toContain('--no-sessions')
    expect(run.stdout).toContain('--open')
  })
})

describe('the up block and browser open command', () => {
  it('formats the short block with the address, waiting room line and Ctrl+C', () => {
    const url = 'http://127.0.0.1:5174/?live&bridge=http://127.0.0.1:5174'
    expect(upBlock(url)).toEqual([
      'MachineRoom is running.',
      `machine-room: open ${url}`,
      'The room fills when a lane or a session works on the project.',
      'Press Ctrl+C in the terminal to stop the room.',
    ])
  })

  it('chooses the platform open command per platform', () => {
    const url = 'http://127.0.0.1:5174/?live&bridge=http://127.0.0.1:5174'
    const win = openCommand(url, {
      platform: 'win32',
      env: { Path: 'C:\\Windows\\System32' },
      check: (p) => p === 'C:\\Windows\\System32\\rundll32.exe',
    })
    expect(win).toEqual({
      command: 'C:\\Windows\\System32\\rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    })

    const mac = openCommand(url, {
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      check: (p) => p === '/usr/bin/open',
    })
    expect(mac).toEqual({
      command: '/usr/bin/open',
      args: [url],
    })

    const linux = openCommand(url, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: (p) => p === '/usr/bin/xdg-open',
    })
    expect(linux).toEqual({
      command: '/usr/bin/xdg-open',
      args: [url],
    })

    const missing = openCommand(url, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: () => false,
    })
    expect(missing).toBeNull()
  })

  it('spawns the browser with fake spawn per platform and unrefs the child', () => {
    const url = 'http://127.0.0.1:5174/?live&bridge=http://127.0.0.1:5174'
    const spawned = []
    const fakeSpawn = (command, args, options) => {
      let unreferenced = false
      spawned.push({ command, args, options, get unreferenced() { return unreferenced } })
      return {
        on: () => {},
        unref: () => {
          unreferenced = true
        },
      }
    }

    const ranWin = openBrowser(url, {
      platform: 'win32',
      env: { Path: 'C:\\Windows\\System32' },
      check: (p) => p === 'C:\\Windows\\System32\\rundll32.exe',
      spawn: fakeSpawn,
    })
    expect(ranWin).toBe(true)
    expect(spawned[0].command).toBe('C:\\Windows\\System32\\rundll32.exe')
    expect(spawned[0].args).toEqual(['url.dll,FileProtocolHandler', url])
    expect(spawned[0].options).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(spawned[0].unreferenced).toBe(true)

    const ranMac = openBrowser(url, {
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      check: (p) => p === '/usr/bin/open',
      spawn: fakeSpawn,
    })
    expect(ranMac).toBe(true)
    expect(spawned[1].command).toBe('/usr/bin/open')
    expect(spawned[1].args).toEqual([url])

    const ranLinux = openBrowser(url, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: (p) => p === '/usr/bin/xdg-open',
      spawn: fakeSpawn,
    })
    expect(ranLinux).toBe(true)
    expect(spawned[2].command).toBe('/usr/bin/xdg-open')
    expect(spawned[2].args).toEqual([url])
  })

  it('prints a line and does not throw when the program is missing or fails to spawn', () => {
    const url = 'http://127.0.0.1:5174/?live&bridge=http://127.0.0.1:5174'
    const logged = []
    const log = (line) => logged.push(line)

    const ranMissing = openBrowser(url, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: () => false,
      log,
    })
    expect(ranMissing).toBe(false)
    expect(logged).toEqual(['The xdg-open program was not found.'])

    const handlers = {}
    const fakeSpawn = () => ({
      on: (event, handler) => {
        handlers[event] = handler
      },
      unref: () => {},
    })

    const ranError = openBrowser(url, {
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      check: () => true,
      spawn: fakeSpawn,
      log,
    })
    expect(ranError).toBe(true)
    handlers.error(new Error('ENOENT'))
    expect(logged).toEqual([
      'The xdg-open program was not found.',
      'The open program was not found.',
    ])
  })
})

describe('the machineroom command', () => {
  const cwd = resolve('/work/LowBeam')

  it('runs up on the current folder and opens the browser', () => {
    expect(upArgs([], cwd)).toEqual({ root: cwd, args: ['up', '--root', cwd, '--open'] })
  })

  it('takes a folder first and passes the other options through', () => {
    const other = resolve('/work/ulolTris')
    expect(upArgs([other, '--port', '5199'], cwd)).toEqual({ root: other, args: ['up', '--root', other, '--open', '--port', '5199'] })
    expect(upArgs(['../ulolTris'], cwd).root).toBe(resolve(cwd, '../ulolTris'))
  })

  it('leaves the browser closed with --no-open', () => {
    expect(upArgs(['--no-open', '--no-sessions'], cwd).args).toEqual(['up', '--root', cwd, '--no-sessions'])
  })
})

