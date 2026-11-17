import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()()
})

async function setup() {
  const base = makeTempDir('mr-static-links-')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const staticDir = join(base, 'static')
  const musicFolder = join(base, 'music')
  const outside = join(base, 'outside')
  for (const dir of [staticDir, musicFolder, outside]) mkdirSync(dir)
  writeFileSync(join(staticDir, 'index.html'), 'index')
  writeFileSync(join(staticDir, 'normal.txt'), 'static')
  writeFileSync(join(musicFolder, 'normal.mp3'), 'music')
  writeFileSync(join(musicFolder, 'notes.txt'), 'notes')
  writeFileSync(join(outside, 'secret.mp3'), 'outside')
  const kind = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(outside, join(staticDir, 'link'), kind)
  symlinkSync(outside, join(musicFolder, 'link'), kind)
  const bridge = createBridge({ port: 0, projectRoot: base, env: {}, staticDir, musicFolder })
  const info = await bridge.start()
  cleanups.push(() => bridge.stop())
  return { base, staticDir, url: `http://127.0.0.1:${info.port}` }
}

describe('static and music real paths', () => {
  it('serves normal files and refuses linked files outside either root', async () => {
    const { url } = await setup()
    for (const path of ['/normal.txt', '/music/normal.mp3']) {
      expect((await fetch(`${url}${path}`)).status).toBe(200)
    }
    for (const path of ['/link/secret.mp3', '/link', '/music/link/secret.mp3', '/music/notes.txt']) {
      expect((await fetch(`${url}${path}`)).status).toBe(404)
    }
  })

  it('refuses an index linked outside the static root', async ({ skip }) => {
    const { staticDir, url } = await setup()
    const outsideIndex = join(staticDir, '..', 'outside', 'index.html')
    const marker = 'outside index marker'
    writeFileSync(outsideIndex, marker)
    rmSync(join(staticDir, 'index.html'))
    try {
      symlinkSync(outsideIndex, join(staticDir, 'index.html'), 'file')
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error
      skip(`File symlinks are unavailable: ${error.code}`)
    }
    for (const path of ['/', '/client-route']) {
      const response = await fetch(`${url}${path}`)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(marker)
    }
  })
})
