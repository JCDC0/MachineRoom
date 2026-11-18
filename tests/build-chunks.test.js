import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import config from '../vite.config.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('viewer build chunks', () => {
  it('reads vite.config.js and keeps vendor manualChunks for three and react', () => {
    const source = readFileSync(join(REPO_ROOT, 'vite.config.js'), 'utf8')
    expect(source).toContain('rollupOptions')
    expect(source).toContain('manualChunks')
    expect(source).toContain('chunkSizeWarningLimit')

    const manualChunks = config.build?.rollupOptions?.output?.manualChunks
    expect(typeof manualChunks).toBe('function')

    expect(manualChunks('/repo/node_modules/three/build/three.module.js')).toBe('three')
    expect(manualChunks('C:\\repo\\node_modules\\three\\examples\\jsm\\lines\\Line2.js')).toBe('three')
    expect(manualChunks('/repo/node_modules/react/index.js')).toBe('react')
    expect(manualChunks('/repo/node_modules/react-dom/client.js')).toBe('react')
    expect(manualChunks('C:\\repo\\node_modules\\scheduler\\index.js')).toBe('react')
    expect(manualChunks('/repo/src/main.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/App.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/Stage.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/engine/room.js')).toBeUndefined()
    expect(config.build?.chunkSizeWarningLimit).toBe(970)
  })

  it('builds separate cacheable vendor chunks', async () => {
    const warnings = []
    const logger = {
      info() {},
      warn(message) {
        warnings.push(message)
      },
      warnOnce(message) {
        warnings.push(message)
      },
      error(message) {
        warnings.push(message)
      },
      clearScreen() {},
      hasErrorLogged() {
        return false
      },
      hasWarned: false,
    }

    const result = await build({
      root: REPO_ROOT,
      configFile: join(REPO_ROOT, 'vite.config.js'),
      customLogger: logger,
      build: {
        write: false,
      },
    })

    const outputs = [result].flat().flatMap((entry) => entry.output)
    const chunks = outputs.filter((item) => item.type === 'chunk')
    const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]))

    expect(byName.has('three')).toBe(true)
    expect(byName.has('react')).toBe(true)
    expect(byName.has('index')).toBe(true)
    expect(byName.get('three').imports).toEqual([])
    expect(byName.get('react').imports).toEqual([])
  })
})
