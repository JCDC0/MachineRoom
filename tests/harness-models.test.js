import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import {
  createHarnessModelsApi,
  getHarnessModels,
  modelAllowed,
  parseAgyModels,
  parseHelpForListCommand,
  parseOpencodeModels,
  readHarnessModelsCache,
  saveCachedHarnessModels,
} from '../server/harness-models.js'
import { MODELS } from '../server/model-list.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-hm-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

function writeFakeScript(folder, filename, code) {
  const file = join(folder, filename)
  writeFileSync(file, code, 'utf8')
  return file
}

describe('harness-models parsers', () => {
  it('parses agy models after the fetching header', () => {
    const stdout = [
      'Fetching available models...',
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'custom-gemini\tCustom Gemini Model',
      'bare-id',
      '',
    ].join('\n')

    const models = parseAgyModels(stdout)
    expect(models).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'custom-gemini', label: 'Custom Gemini Model' },
      { id: 'bare-id', label: 'bare-id' },
    ])
  })

  it('parses opencode models one id per line', () => {
    const stdout = [
      'opencode-go/qwen3.8-flash',
      'deepseek-v4.1',
      'opencode-go/qwen3.8-flash',
      '',
    ].join('\n')

    const models = parseOpencodeModels(stdout)
    expect(models).toEqual([
      { id: 'opencode-go/qwen3.8-flash', label: 'opencode-go/qwen3.8-flash' },
      { id: 'deepseek-v4.1', label: 'deepseek-v4.1' },
    ])
  })

  it('detects list commands in help output', () => {
    expect(parseHelpForListCommand('Commands:\n  models list  List all models')).toEqual(['models', 'list'])
    expect(parseHelpForListCommand('Commands:\n  model list  List models')).toEqual(['model', 'list'])
    expect(parseHelpForListCommand('Flags:\n  --list-models  Show models')).toEqual(['list-models'])
    expect(parseHelpForListCommand('Usage: codex models [options]')).toEqual(['models'])
    expect(parseHelpForListCommand('No command here')).toBeNull()
  })
})

describe('harness models discovery and caching', () => {
  it('runs fake agy program and caches models', async () => {
    const runs = tempDir('runs-')
    const binDir = tempDir('bin-')
    const script = writeFakeScript(
      binDir,
      'fake-agy.mjs',
      [
        'console.log("Fetching available models...")',
        'console.log("gemini-live-1\\tGemini Live 1")',
        'console.log("gemini-live-2\\tGemini Live 2")',
      ].join('\n')
    )

    const lanes = {
      agy: { cli: { harness: 'agy', bin: script } },
    }

    const first = await getHarnessModels('agy', { runsFolder: runs, lanes })
    expect(first.source).toBe('live')
    expect(first.models).toEqual([
      { id: 'gemini-live-1', label: 'Gemini Live 1' },
      { id: 'gemini-live-2', label: 'Gemini Live 2' },
    ])

    const cache = readHarnessModelsCache(runs)
    expect(cache.agy).toBeDefined()
    expect(cache.agy.models).toEqual(first.models)

    const second = await getHarnessModels('agy', { runsFolder: runs, lanes })
    expect(second.source).toBe('cache')
    expect(second.models).toEqual(first.models)
  })

  it('runs fake opencode program and handles refresh', async () => {
    const runs = tempDir('runs-')
    const binDir = tempDir('bin-')
    const counterFile = join(binDir, 'count.txt')
    writeFileSync(counterFile, '1', 'utf8')

    const script = writeFakeScript(
      binDir,
      'fake-opencode.mjs',
      [
        'import { readFileSync, writeFileSync } from "node:fs"',
        `const count = Number(readFileSync(${JSON.stringify(counterFile)}, "utf8"))`,
        `writeFileSync(${JSON.stringify(counterFile)}, String(count + 1))`,
        'console.log("model-v" + count)',
      ].join('\n')
    )

    const lanes = {
      opencode: { cli: { harness: 'opencode', bin: script } },
    }

    const first = await getHarnessModels('opencode', { runsFolder: runs, lanes })
    expect(first.source).toBe('live')
    expect(first.models).toEqual([{ id: 'model-v1', label: 'model-v1' }])

    const cached = await getHarnessModels('opencode', { runsFolder: runs, lanes, refresh: false })
    expect(cached.source).toBe('cache')
    expect(cached.models).toEqual([{ id: 'model-v1', label: 'model-v1' }])

    const refreshed = await getHarnessModels('opencode', { runsFolder: runs, lanes, refresh: true })
    expect(refreshed.source).toBe('live')
    expect(refreshed.models).toEqual([{ id: 'model-v2', label: 'model-v2' }])
  })

  it('handles command timeout with killTree and static list fallback', async () => {
    const runs = tempDir('runs-')
    const binDir = tempDir('bin-')
    const script = writeFakeScript(
      binDir,
      'slow-program.mjs',
      'setTimeout(() => { console.log("done"); }, 30000)'
    )

    const lanes = {
      agy: { cli: { harness: 'agy', bin: script } },
    }

    const result = await getHarnessModels('agy', { runsFolder: runs, lanes, timeoutMs: 100 })
    expect(result.source).toBe('list')
    expect(result.error).toContain('timed out')
    const staticAgy = MODELS.filter((m) => m.harness === 'agy').map(({ id, label }) => ({ id, label }))
    expect(result.models).toEqual(staticAgy)
  })

  it('handles missing program by falling back to static list with error', async () => {
    const runs = tempDir('runs-')
    const lanes = {
      agy: { cli: { harness: 'agy', bin: join(runs, 'nonexistent-agy-binary.exe') } },
    }

    const result = await getHarnessModels('agy', {
      runsFolder: runs,
      lanes,
      env: { PATH: '' },
    })
    expect(result.source).toBe('list')
    expect(result.error).toBe('The program for agy was not found.')
    const staticAgy = MODELS.filter((m) => m.harness === 'agy').map(({ id, label }) => ({ id, label }))
    expect(result.models).toEqual(staticAgy)
  })

  it('answers static list for claude, hermes and acp without running commands', async () => {
    for (const harness of ['claude', 'hermes', 'acp']) {
      const result = await getHarnessModels(harness)
      expect(result.source).toBe('list')
      expect(result.error).toBeUndefined()
      const expected = MODELS.filter((m) => m.harness === harness).map(({ id, label }) => ({ id, label }))
      expect(result.models).toEqual(expected)
    }
  })
})

describe('modelAllowed validation helper', () => {
  it('allows static models', () => {
    expect(modelAllowed('claude', 'claude-sonnet-5-5')).toBe(true)
    expect(modelAllowed('opencode', 'opencode/deepseek-v4.1-flash-free')).toBe(true)
    expect(modelAllowed('claude', 'unknown-model')).toBe(false)
    expect(modelAllowed('agy', '')).toBe(false)
  })

  it('allows models cached in harness-models.json', () => {
    const runs = tempDir('runs-allowed-')
    expect(modelAllowed('agy', 'custom-live-model', runs)).toBe(false)

    saveCachedHarnessModels(runs, 'agy', [
      { id: 'custom-live-model', label: 'Custom Live Model' },
    ])

    expect(modelAllowed('agy', 'custom-live-model', runs)).toBe(true)
    expect(modelAllowed('opencode', 'custom-live-model', runs)).toBe(false)
  })
})

describe('harness models bridge route and client', () => {
  it('serves GET /api/harnesses/:key/models through bridge and client', async () => {
    const runs = tempDir('bridge-runs-')
    const binDir = tempDir('bridge-bin-')
    const script = writeFakeScript(
      binDir,
      'fake-agy.mjs',
      [
        'console.log("Fetching available models...")',
        'console.log("gemini-test-1\\tGemini Test 1")',
      ].join('\n')
    )

    const lanes = {
      agy: { cli: { harness: 'agy', bin: script } },
    }

    const bridge = createBridge({
      port: 0,
      runsFolder: runs,
      lanesFile: null,
      lanesSource: {
        folder: runs,
        lanes,
        pollMs: 50,
      },
    })

    const started = await bridge.start()
    cleanups.push(() => bridge.stop())

    const baseUrl = `http://127.0.0.1:${started.port}`
    const client = createClient({
      baseUrl,
      fetchImpl: (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), origin: baseUrl } }),
    })

    const res1 = await client.harnessModels({ harness: 'agy' })
    expect(res1.harness).toBe('agy')
    expect(res1.source).toBe('live')
    expect(res1.models).toEqual([{ id: 'gemini-test-1', label: 'Gemini Test 1' }])

    const res2 = await client.harnessModels({ harness: 'agy' })
    expect(res2.source).toBe('cache')

    const resClaude = await client.harnessModels({ harness: 'claude' })
    expect(resClaude.source).toBe('list')

    const mock = createMockClient()
    const mockRes = await mock.harnessModels({ harness: 'opencode' })
    expect(mockRes.source).toBe('list')
    expect(mockRes.harness).toBe('opencode')
    expect(mockRes.models.length).toBeGreaterThan(0)
  })

  it('refuses the models route with no Origin and takes the page Origin', async () => {
    const runs = tempDir('bridge-guard-')
    const bridge = createBridge({
      port: 0,
      runsFolder: runs,
      lanesFile: null,
      lanesSource: {
        folder: runs,
        lanes: {},
        pollMs: 50,
      },
    })
    const started = await bridge.start()
    cleanups.push(() => bridge.stop())
    const baseUrl = `http://127.0.0.1:${started.port}`
    const res = await fetch(`${baseUrl}/api/harnesses/agy/models`)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Only the owner can refresh the model list.' })

    const page = await fetch(`${baseUrl}/api/harnesses/agy/models`, { headers: { origin: baseUrl } })
    expect(page.status).toBe(200)
    expect((await page.json()).harness).toBe('agy')
  })

  it('takes a same-origin GET with no Origin from the page', async () => {
    const runs = tempDir('bridge-guard-')
    const bridge = createBridge({
      port: 0,
      runsFolder: runs,
      lanesFile: null,
      lanesSource: {
        folder: runs,
        lanes: {},
        pollMs: 50,
      },
    })
    const started = await bridge.start()
    cleanups.push(() => bridge.stop())
    const res = await fetch(`http://127.0.0.1:${started.port}/api/harnesses/agy/models`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).harness).toBe('agy')
  })

  it('includes cached live models in GET /api/harnesses', async () => {
    const runs = tempDir('bridge-harnesses-')
    saveCachedHarnessModels(runs, 'agy', [
      { id: 'cached-gemini-x', label: 'Cached Gemini X' },
    ])

    const bridge = createBridge({
      port: 0,
      runsFolder: runs,
      lanesFile: null,
      lanesSource: {
        folder: runs,
        lanes: {},
        pollMs: 50,
      },
    })

    const started = await bridge.start()
    cleanups.push(() => bridge.stop())

    const client = createClient({ baseUrl: `http://127.0.0.1:${started.port}` })
    const list = await client.harnesses()
    const agyEntry = list.find((h) => h.key === 'agy')
    expect(agyEntry).toBeDefined()
    expect(agyEntry.models.some((m) => m.id === 'cached-gemini-x')).toBe(true)
  })
})
