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
    expect(manualChunks('/repo/src/control/mock.js')).toBe('mock')
    expect(manualChunks('C:\\repo\\src\\control\\mock.js')).toBe('mock')
    expect(manualChunks('/repo/src/main.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/App.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/Stage.jsx')).toBeUndefined()
    expect(manualChunks('/repo/src/engine/room.js')).toBeUndefined()
    expect(config.build?.chunkSizeWarningLimit).toBe(990)
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

    const threeChunk = byName.get('three')
    const reactChunk = byName.get('react')
    const mockChunk = byName.get('mock')
    const indexChunk = byName.get('index')
    expect(threeChunk).toBeDefined()
    expect(reactChunk).toBeDefined()
    expect(mockChunk).toBeDefined()
    expect(byName.has('index')).toBe(true)
    expect(threeChunk.fileName).not.toBe(reactChunk.fileName)
    expect(threeChunk.imports).toEqual([])
    expect(reactChunk.imports).toEqual([])
    expect(threeChunk.dynamicImports).toEqual([])
    expect(reactChunk.dynamicImports).toEqual([])

    const threeModules = Object.keys(threeChunk.modules ?? {}).map((id) => id.replaceAll('\\', '/'))
    const reactModules = Object.keys(reactChunk.modules ?? {}).map((id) => id.replaceAll('\\', '/'))
    const mockModules = Object.keys(mockChunk.modules ?? {}).map((id) => id.replaceAll('\\', '/'))
    expect(threeModules.some((id) => id.includes('/node_modules/three/'))).toBe(true)
    expect(threeModules.some((id) => id.includes('/node_modules/react/'))).toBe(false)
    expect(reactModules.some((id) => id.includes('/node_modules/react/'))).toBe(true)
    expect(reactModules.some((id) => id.includes('/node_modules/three/'))).toBe(false)
    expect(mockModules.some((id) => id.endsWith('/src/control/mock.js'))).toBe(true)
    expect(mockModules.some((id) => id.includes('/node_modules/three/'))).toBe(false)
    expect(mockChunk.fileName).not.toBe(threeChunk.fileName)
    expect(mockChunk.fileName).not.toBe(reactChunk.fileName)
    expect(indexChunk.imports).toContain(mockChunk.fileName)

    const limitBytes = 990 * 1000
    expect(Buffer.byteLength(threeChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(threeChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(reactChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(reactChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(mockChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(mockChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(indexChunk.code, 'utf8')).toBeLessThan(limitBytes)
  })
})
