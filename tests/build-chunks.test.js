import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import config, { CHUNK_GROUPS, chunkGroupFor } from '../vite.config.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('viewer build chunks', () => {
  it('reads vite.config.js and keeps vendor and engine chunk groups', () => {
    const source = readFileSync(join(REPO_ROOT, 'vite.config.js'), 'utf8')
    expect(source).toContain('rollupOptions')
    expect(source).toContain('codeSplitting')
    expect(source).toContain('chunkSizeWarningLimit')

    expect(Array.isArray(CHUNK_GROUPS)).toBe(true)
    expect(typeof chunkGroupFor).toBe('function')

    expect(chunkGroupFor('/repo/node_modules/three/build/three.module.js')).toBe('three')
    expect(chunkGroupFor('C:\\repo\\node_modules\\three\\examples\\jsm\\lines\\Line2.js')).toBe('three')
    expect(chunkGroupFor('/repo/node_modules/react/index.js')).toBe('react')
    expect(chunkGroupFor('/repo/node_modules/react-dom/client.js')).toBe('react')
    expect(chunkGroupFor('C:\\repo\\node_modules\\scheduler\\index.js')).toBe('react')
    expect(chunkGroupFor('/repo/src/control/mock.js')).toBe('mock')
    expect(chunkGroupFor('C:\\repo\\src\\control\\mock.js')).toBe('mock')
    expect(chunkGroupFor('/repo/src/engine/room.js')).toBe('engine')
    expect(chunkGroupFor('/repo/src/model/state.js')).toBe('engine')
    expect(chunkGroupFor('/repo/src/main.jsx')).toBeUndefined()
    expect(chunkGroupFor('/repo/src/App.jsx')).toBeUndefined()
    expect(chunkGroupFor('/repo/src/Stage.jsx')).toBeUndefined()
    expect(chunkGroupFor('/repo/src/ui/agentStrip.js')).toBeUndefined()
    expect(config.build?.chunkSizeWarningLimit).toBe(970)
  })

  it('builds separate engine and vendor chunks', async () => {
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
    const modulesOf = (chunk) =>
      Object.keys(chunk.modules ?? {}).map((id) => id.replaceAll('\\', '/'))

    const threeChunk = byName.get('three')
    const reactChunk = byName.get('react')
    const mockChunk = byName.get('mock')
    const engineChunk = byName.get('engine')
    const indexChunk = byName.get('index')
    expect(threeChunk).toBeDefined()
    expect(reactChunk).toBeDefined()
    expect(mockChunk).toBeDefined()
    expect(engineChunk).toBeDefined()
    expect(byName.has('index')).toBe(true)
    expect(threeChunk.fileName).not.toBe(reactChunk.fileName)
    expect(threeChunk.imports).toEqual([])
    expect(reactChunk.imports).toEqual([])
    expect(threeChunk.dynamicImports).toEqual([])
    expect(reactChunk.dynamicImports).toEqual([])

    const threeModules = modulesOf(threeChunk)
    const reactModules = modulesOf(reactChunk)
    const mockModules = modulesOf(mockChunk)
    const engineModules = modulesOf(engineChunk)
    const indexModules = modulesOf(indexChunk)
    expect(threeModules.some((id) => id.includes('/node_modules/three/'))).toBe(true)
    expect(threeModules.some((id) => id.includes('/node_modules/react/'))).toBe(false)
    expect(reactModules.some((id) => id.includes('/node_modules/react/'))).toBe(true)
    expect(reactModules.some((id) => id.includes('/node_modules/three/'))).toBe(false)
    expect(mockModules.some((id) => id.endsWith('/src/control/mock.js'))).toBe(true)
    expect(mockModules.some((id) => id.includes('/node_modules/three/'))).toBe(false)
    expect(mockChunk.fileName).not.toBe(threeChunk.fileName)
    expect(mockChunk.fileName).not.toBe(reactChunk.fileName)
    expect(indexChunk.imports).toContain(mockChunk.fileName)
    expect(indexChunk.imports).toContain(engineChunk.fileName)

    expect(engineModules.some((id) => id.includes('/src/engine/'))).toBe(true)
    expect(engineModules.some((id) => id.includes('/src/model/'))).toBe(true)
    expect(engineModules.some((id) => id.includes('/node_modules/three/'))).toBe(false)
    expect(engineModules.some((id) => /node_modules\/(react|react-dom|scheduler)\//.test(id))).toBe(false)
    expect(engineChunk.imports).not.toContain(indexChunk.fileName)
    expect(engineChunk.dynamicImports).toEqual([])
    expect(indexModules.some((id) => id.includes('/src/engine/'))).toBe(false)
    expect(indexModules.some((id) => id.includes('/src/model/'))).toBe(false)

    const limitBytes = 970 * 1000
    expect(Buffer.byteLength(threeChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(threeChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(reactChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(reactChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(mockChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(mockChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(engineChunk.code, 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(engineChunk.code, 'utf8')).toBeLessThan(limitBytes)
    expect(Buffer.byteLength(indexChunk.code, 'utf8')).toBeLessThan(limitBytes)
  })
})
