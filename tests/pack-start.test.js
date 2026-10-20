import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packTo } from '../scripts/pack-check.mjs'
import { untar } from '../scripts/untar.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_INDEX = join(root, 'dist', 'index.html')
const PACK_BUDGET_MS = 30000
const START_TIMEOUT_MS = 30000

function readTitle(html) {
  const match = /<title>([^<]*)<\/title>/i.exec(html)
  return match ? match[1] : null
}

function childEnv() {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  delete env.PORT
  return env
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
  it('serves the viewer and the health answer with no node_modules', async (context) => {
    if (!existsSync(DIST_INDEX)) {
      console.log('tests/pack-start.test.js skipped: dist/index.html is missing. Run npm run build first.')
      context.skip()
      return
    }
    const packDir = makeTempDir('machine-room-pack-start-')
    const unpackDir = makeTempDir('machine-room-unpacked-')
    const emptyRoot = makeTempDir('machine-room-project-')
    try {
      const packed = packTo(root, packDir, PACK_BUDGET_MS)
      if (packed.error?.code === 'ETIMEDOUT' || packed.signal) {
        context.skip()
        return
      }
      expect(packed.error).toBeUndefined()
      expect(packed.status).toBe(0)
      expect(packed.file).toBeTruthy()
      expect(existsSync(packed.file)).toBe(true)

      untar(readFileSync(packed.file), unpackDir)
      const packageDir = join(unpackDir, 'package')
      const binPath = join(packageDir, 'bin', 'machine-room.mjs')
      expect(existsSync(binPath)).toBe(true)

      const child = spawn(
        process.execPath,
        [binPath, '--port', '0', '--paperclip', 'http://127.0.0.1:1', '--company', 'pack-test', '--root', emptyRoot],
        { cwd: packageDir, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
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
        expect((await health.json()).paperclip).toBe(false)

        expect(existsSync(join(packageDir, 'node_modules'))).toBe(false)
      } finally {
        await stop(child)
      }
    } finally {
      rmSync(packDir, { recursive: true, force: true })
      rmSync(unpackDir, { recursive: true, force: true })
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  }, 120000)
})
