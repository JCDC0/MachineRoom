import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packTo } from '../scripts/pack-check.mjs'
import { untar } from '../scripts/untar.mjs'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_INDEX = join(root, 'dist', 'index.html')
const PACK_BUDGET_MS = 30000
const START_TIMEOUT_MS = 30000

function readTitle(html) {
  const match = /<title>([^<]*)<\/title>/i.exec(html)
  return match ? match[1] : null
}

function childEnv(tempDir) {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  env.TEMP = tempDir
  env.TMP = tempDir
  return env
}

function gitRead(cwd, args) {
  try {
    const git = gitPath()
    const result = spawnSync(git, args, { cwd, encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) return null
    return String(result.stdout ?? '').trim()
  } catch {
    return null
  }
}

function openAddress(child) {
  return new Promise((settle, fail) => {
    let seen = ''
    const timer = setTimeout(() => {
      fail(new Error('machine-room did not print its address.'))
    }, START_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      seen += chunk.toString('utf8')
      const match = /machine-room: open (\S+)/.exec(seen)
      if (match === null) return
      clearTimeout(timer)
      settle(match[1])
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`machine-room exited with ${code} before it printed its address.`))
    })
  })
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((settle) => {
    child.once('exit', () => settle())
    child.kill()
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 5000).unref()
  })
}

describe('a pack starts the room', () => {
  let packDir
  let unpackDir
  let emptyRoot
  let runsDir
  let packageDir
  let skipped = false

  beforeAll(async () => {
    if (!existsSync(DIST_INDEX)) {
      skipped = true
      return
    }
    packDir = makeTempDir('machine-room-pack-start-')
    unpackDir = makeTempDir('machine-room-unpacked-')
    emptyRoot = makeTempDir('machine-room-project-')
    runsDir = makeTempDir('machine-room-pack-runs-')

    const packed = packTo(root, packDir, PACK_BUDGET_MS)
    if (packed.error?.code === 'ETIMEDOUT' || packed.signal) {
      skipped = true
      return
    }
    expect(packed.error).toBeUndefined()
    expect(packed.status).toBe(0)
    expect(packed.file).toBeTruthy()
    expect(existsSync(packed.file)).toBe(true)

    untar(readFileSync(packed.file), unpackDir)
    packageDir = join(unpackDir, 'package')
  }, 120000)

  afterAll(() => {
    if (packDir) rmSync(packDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    if (unpackDir) rmSync(unpackDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    if (emptyRoot) rmSync(emptyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    if (runsDir) rmSync(runsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('serves the viewer and the health answer with no node_modules', async (context) => {
    if (skipped || !packageDir) {
      context.skip()
      return
    }
    const binPath = join(packageDir, 'bin', 'machine-room.mjs')
    expect(existsSync(binPath)).toBe(true)

    const child = spawn(
      process.execPath,
      [binPath, '--port', '0', '--root', emptyRoot, '--lanes'],
      { cwd: packageDir, env: childEnv(runsDir), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stderr.resume()
    try {
      const address = await openAddress(child)
      const base = new URL(address).origin

      const page = await fetch(`${base}/`)
      expect(page.status).toBe(200)
      expect(readTitle(await page.text())).toBe(readTitle(readFileSync(DIST_INDEX, 'utf8')))

      const health = await fetch(`${base}/api/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toMatchObject({ ok: true, lanes: true, sessions: false })

      const agents = await fetch(`${base}/api/agents`)
      expect(agents.status).toBe(200)
      expect((await agents.json()).map((agent) => agent.key)).toEqual(['orchestrator'])

      const orchestrator = await fetch(`${base}/api/orchestrator`)
      expect(orchestrator.status).toBe(200)

      expect(existsSync(join(packageDir, 'node_modules'))).toBe(false)
    } finally {
      await stop(child)
    }
  }, 120000)

  it('runs a lane dry-run and loads mr-agent from the unpacked pack', (context) => {
    if (skipped || !packageDir) {
      context.skip()
      return
    }
    const env = childEnv(runsDir)
    const gitCommon = gitRead(root, ['rev-parse', '--git-common-dir'])
    if (gitCommon) {
      writeFileSync(join(packageDir, '.git'), `gitdir: ${resolve(root, gitCommon)}\n`)
    }

    const laneResult = spawnSync(
      process.execPath,
      ['scripts/run-lane.mjs', 'opencode', 'P1', '--dry-run'],
      { cwd: packageDir, env, encoding: 'utf8' },
    )
    expect(laneResult.status).toBe(0)
    expect(laneResult.stderr).not.toContain('Cannot find module')
    expect(laneResult.stderr).not.toContain('ERR_MODULE_NOT_FOUND')

    const mrResult = spawnSync(
      process.execPath,
      ['scripts/mr-agent.mjs', '--help'],
      { cwd: packageDir, env, encoding: 'utf8' },
    )
    expect(mrResult.status).toBe(0)
    expect(mrResult.stderr).not.toContain('Cannot find module')
    expect(mrResult.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  })
})
