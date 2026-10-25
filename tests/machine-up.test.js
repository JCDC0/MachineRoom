import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { withLanePrograms } from './helpers/lanePrograms.js'
import { makeTempDir } from './helpers/tempRoot.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(root, 'bin', 'machine-room.mjs')
const SOME_CHECKS_FAILED = 'Some checks failed. The room opens anyway.'
const OPEN = /^machine-room: open (http:\/\/127\.0\.0\.1:\d+\/\?live&bridge=http:\/\/127\.0\.0\.1:\d+)$/m
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

function makeProject() {
  return makeFolder('machine-room-up-')
}

function makeDist() {
  const base = makeFolder('machine-room-up-dist-')
  const dist = join(base, 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  return { base, dist }
}

function childEnv(temp) {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  delete env.MACHINEROOM_LANES
  delete env.MACHINEROOM_SESSIONS
  env.TEMP = temp
  return withLanePrograms(env, temp)
}

function startBin(args, env) {
  const run = { stdout: '', stderr: '', child: null }
  run.child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  run.child.stdout.on('data', (chunk) => {
    run.stdout += chunk
  })
  run.child.stderr.on('data', (chunk) => {
    run.stderr += chunk
  })
  cleanups.push(() => {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill()
  })
  return run
}

function outputLines(run) {
  return run.stdout.trim().split(/\r?\n/).filter(Boolean)
}

function waitForAddress(run, timeoutMs = 20000) {
  return new Promise((resolveAddress, rejectAddress) => {
    let timer
    const finish = (settle, value) => {
      clearTimeout(timer)
      run.child.stdout.off('data', check)
      run.child.off('exit', onExit)
      settle(value)
    }
    const check = () => {
      const match = OPEN.exec(run.stdout)
      if (match) finish(resolveAddress, match[1])
    }
    const onExit = (code) => {
      finish(rejectAddress, new Error(`the bin exited ${code}. stderr: ${run.stderr}`))
    }
    timer = setTimeout(() => {
      finish(rejectAddress, new Error(`the bin printed no address. stderr: ${run.stderr}`))
    }, timeoutMs)
    run.child.stdout.on('data', check)
    run.child.once('exit', onExit)
    check()
  })
}

function waitForText(run, marker, timeoutMs = 20000) {
  return new Promise((resolveText, rejectText) => {
    let timer
    const finish = (settle, value) => {
      clearTimeout(timer)
      run.child.stdout.off('data', check)
      run.child.off('exit', onExit)
      settle(value)
    }
    const check = () => {
      if (run.stdout.includes(marker)) finish(resolveText, run.stdout)
    }
    const onExit = (code) => {
      finish(rejectText, new Error(`the bin exited ${code}. stderr: ${run.stderr}`))
    }
    timer = setTimeout(() => {
      finish(rejectText, new Error(`the bin did not print ${marker}. stderr: ${run.stderr}`))
    }, timeoutMs)
    run.child.stdout.on('data', check)
    run.child.once('exit', onExit)
    check()
  })
}

function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => rejectExit(new Error('the bin process did not exit')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
}

async function kill(run) {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill()
  await waitForExit(run.child)
}

describe('machine-room up', () => {
  it('prints the checks, then the address, and serves the room with lanes and sessions on', async () => {
    const project = makeProject()
    const temp = makeFolder('machine-room-up-temp-')
    const { dist } = makeDist()
    const run = startBin(['up', '--root', project, '--dist', dist, '--port', '0'], childEnv(temp))

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect(address).toBe(`${origin}/?live&bridge=${origin}`)

    const viewer = await fetch(`${origin}/`)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toContain('<title>Room</title>')

    const health = await fetch(`${origin}/api/health`).then((response) => response.json())
    expect(health).toMatchObject({ ok: true, lanes: true, sessions: true })

    const lines = outputLines(run)
    expect(lines.slice(-3)).toEqual([
      `machine-room: open ${address}`,
      'The room fills when a lane or a session works on the project.',
      'Press Ctrl+C in the terminal to stop the room.',
    ])
    const checks = lines.slice(0, -3)
    expect(checks.length).toBeGreaterThan(3)
    expect(checks.every((line) => /^(ok|FAIL) /.test(line))).toBe(true)
    expect(checks[0]).toContain('The project folder')
    expect(checks[1]).toContain('Git is found at')
    expect(lines).not.toContain(SOME_CHECKS_FAILED)

    await kill(run)
  }, 30000)

  it('keeps the session source off with --no-sessions', async () => {
    const project = makeProject()
    const temp = makeFolder('machine-room-up-temp-')
    const { dist } = makeDist()
    const run = startBin(['up', '--no-sessions', '--root', project, '--dist', dist, '--port', '0'], childEnv(temp))

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    const health = await fetch(`${origin}/api/health`).then((response) => response.json())
    expect(health).toMatchObject({ lanes: true, sessions: false })

    await kill(run)
  }, 30000)

  it('prints a failed check and the warning, then still serves the room', async () => {
    const project = makeProject()
    const temp = makeFolder('machine-room-up-temp-')
    const { dist } = makeDist()
    const run = startBin(['up', '--root', join(project, 'missing'), '--dist', dist, '--port', '0'], childEnv(temp))

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect((await fetch(`${origin}/`)).status).toBe(200)

    const lines = outputLines(run)
    const addressAt = lines.findIndex((line) => line.startsWith('machine-room: open '))
    expect(addressAt).toBeGreaterThan(0)
    expect(lines[addressAt - 1]).toBe(SOME_CHECKS_FAILED)
    expect(lines.slice(0, addressAt).filter((line) => line.startsWith('FAIL '))).toHaveLength(1)
    expect(lines).toContainEqual(expect.stringContaining('does not exist.'))
    expect(lines.slice(addressAt, addressAt + 3)).toEqual([
      `machine-room: open ${address}`,
      'The room fills when a lane or a session works on the project.',
      'Press Ctrl+C in the terminal to stop the room.',
    ])

    await kill(run)
  }, 30000)

  it('accepts --open with up', async () => {
    const project = makeProject()
    const temp = makeFolder('machine-room-up-temp-')
    const { dist } = makeDist()
    const env = childEnv(temp)
    env.PATH = ''
    delete env.Path
    delete env.ComSpec
    delete env.COMSPEC
    const run = startBin(['up', '--open', '--root', project, '--dist', dist, '--port', '0'], env)

    await waitForAddress(run)
    await waitForText(run, 'program was not found.')
    const lines = outputLines(run)
    expect(lines).toContainEqual(expect.stringMatching(/The (?:rundll32|open|xdg-open) program was not found\./))

    await kill(run)
  }, 30000)

  it('stops with exit 1 when the build is missing', async () => {
    const project = makeProject()
    const temp = makeFolder('machine-room-up-temp-')
    const { dist } = makeDist()
    rmSync(join(dist, 'index.html'))
    const run = startBin(['up', '--root', project, '--dist', dist], childEnv(temp))

    const { code } = await waitForExit(run.child)
    expect(code).toBe(1)
    expect(`${run.stdout}${run.stderr}`).toContain('Build the viewer first with npm run build.')
  }, 15000)
})
