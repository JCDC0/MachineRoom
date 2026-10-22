import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PAPERCLIP_SURFACE } from '../server/surface.js'
import { makeTempDir } from './helpers/tempRoot.js'

const root = dirname(fileURLToPath(import.meta.url))
const BIN = join(root, '..', 'bin', 'machine-room.mjs')
const SOME_CHECKS_FAILED = 'Some checks failed. The room opens anyway; features whose routes changed stay off.'
const PAPERCLIP_NOT_RUNNING = 'Paperclip is not running. Start it yourself with paperclipai run; machine-room never starts it.'
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

function makeProject() {
  const folder = makeTempDir('machine-room-up-')
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return folder
}

function makeDist() {
  const base = makeTempDir('machine-room-up-dist-')
  const dist = join(base, 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return { base, dist }
}

function completeSpec(routes = PAPERCLIP_SURFACE) {
  const paths = {}
  for (const route of routes) {
    if (route.socket) continue
    const item = (paths[route.path] ??= {})
    const properties = Object.fromEntries((route.body ?? []).map((key) => [key, { type: 'string' }]))
    item[route.method.toLowerCase()] = {
      responses: {
        200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: {} } } } },
      },
      ...(route.body?.length ? { requestBody: { content: { 'application/json': { schema: { type: 'object', properties } } } } } : {}),
    }
  }
  return { openapi: '3.0.0', info: { version: '1.0.0' }, paths }
}

function backupAt(ageHours) {
  return {
    enabled: true,
    status: 'ok',
    maxAgeHours: 26,
    latestBackup: {
      name: 'paperclip-20261020-120000.sql.gz',
      mtime: new Date(Date.now() - ageHours * 3600000).toISOString(),
      ageHours,
      sizeBytes: 1024,
    },
    warnings: [],
  }
}

function healthWith(databaseBackup) {
  return { ok: true, version: '2026.1012.0', databaseBackup }
}

function startFake({ health = healthWith(backupAt(1.5)) } = {}) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(health))
      return
    }
    if (req.method === 'GET' && req.url === '/api/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(completeSpec()))
      return
    }
    if (req.method === 'GET' && req.url === '/api/companies') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 'company-1', name: 'One' }]))
      return
    }
    if (req.method === 'GET' && req.url === '/api/companies/company-1/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('[]')
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolveFake) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      cleanups.push(() => new Promise((resolveClose) => server.close(() => resolveClose())))
      resolveFake({ url: `http://127.0.0.1:${port}` })
    })
  })
}

function childEnv() {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  return env
}

function startBin(args) {
  const run = { stdout: '', stderr: '', child: null }
  run.child = spawn(process.execPath, [BIN, ...args], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
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
      finish(rejectAddress, new Error(`the bin exited ${code}. stdout: ${run.stdout} stderr: ${run.stderr}`))
    }
    timer = setTimeout(() => {
      finish(rejectAddress, new Error(`the bin printed no address. stdout: ${run.stdout} stderr: ${run.stderr}`))
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
  it('prints the checks, then the address, and serves the room', async () => {
    const project = makeProject()
    const { dist } = makeDist()
    const fake = await startFake()
    const run = startBin([
      'up',
      '--paperclip', fake.url,
      '--company', 'company-1',
      '--root', project,
      '--dist', dist,
      '--port', '0',
    ])

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect(address).toBe(`${origin}/?live&bridge=${origin}`)

    const viewer = await fetch(`${origin}/`)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toContain('<title>Room</title>')

    const lines = outputLines(run)
    expect(lines.at(-1)).toBe(`machine-room: open ${address}`)
    const checks = lines.slice(0, -1)
    expect(checks).toHaveLength(5)
    expect(checks.every((line) => line.startsWith('ok '))).toBe(true)
    expect(checks[0]).toContain('Paperclip answers at')
    expect(checks[4]).toContain('The newest database backup is 1.5 hours old.')
    expect(lines).not.toContain(SOME_CHECKS_FAILED)
    expect(lines).not.toContain(PAPERCLIP_NOT_RUNNING)

    await kill(run)
  }, 30000)

  it('prints the failed backup line and the warning, then still serves the room', async () => {
    const project = makeProject()
    const { dist } = makeDist()
    const fake = await startFake({ health: healthWith(backupAt(30)) })
    const run = startBin([
      'up',
      '--paperclip', fake.url,
      '--company', 'company-1',
      '--root', project,
      '--dist', dist,
      '--port', '0',
    ])

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    expect((await fetch(`${origin}/`)).status).toBe(200)

    const lines = outputLines(run)
    const addressAt = lines.findIndex((line) => line.startsWith('machine-room: open '))
    expect(addressAt).toBeGreaterThan(0)
    expect(lines[addressAt - 1]).toBe(SOME_CHECKS_FAILED)
    expect(lines.slice(0, addressAt).filter((line) => line.startsWith('FAIL '))).toHaveLength(1)
    expect(lines).toContainEqual(expect.stringContaining('The newest database backup is 30 hours old.'))

    await kill(run)
  }, 30000)

  it('says Paperclip is not running and serves the room without it', async () => {
    const project = makeProject()
    const { dist } = makeDist()
    const run = startBin([
      'up',
      '--paperclip', 'http://127.0.0.1:1',
      '--company', 'company-1',
      '--root', project,
      '--dist', dist,
      '--port', '0',
    ])

    const address = await waitForAddress(run)
    const origin = new URL(address).origin
    const viewer = await fetch(`${origin}/`)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toContain('<title>Room</title>')

    const lines = outputLines(run)
    const addressAt = lines.findIndex((line) => line.startsWith('machine-room: open '))
    expect(addressAt).toBeGreaterThan(0)
    expect(lines[addressAt - 1]).toBe(PAPERCLIP_NOT_RUNNING)
    expect(lines.some((line) => line.startsWith('FAIL Paperclip does not answer at'))).toBe(true)

    await kill(run)
  }, 30000)

  it('stops with exit 1 when the build is missing', async () => {
    const project = makeProject()
    const { dist } = makeDist()
    rmSync(join(dist, 'index.html'))
    const run = startBin([
      'up',
      '--paperclip', 'http://127.0.0.1:1',
      '--company', 'company-1',
      '--root', project,
      '--dist', dist,
    ])

    const { code } = await waitForExit(run.child)
    expect(code).toBe(1)
    expect(`${run.stdout}${run.stderr}`).toContain('Build the viewer first with npm run build.')
  }, 15000)
})
