import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL_PROBLEM,
  KEY_REQUIRED_PROBLEM,
  MAX_ENDPOINT_MODELS,
  MAX_ENDPOINTS,
  MODELS_TIMEOUT_MS,
  MODELS_FAILED_PROBLEM,
  NAME_PROBLEM,
  NO_KEY_PROBLEM,
  PROVIDERS,
  PROVIDER_PROBLEM,
  createEndpointsApi,
  endpointProblem,
  readEndpoints,
  saveEndpoints,
} from '../server/endpoints.js'
import { modelsFor } from '../server/models.js'
import { readAllLanes } from '../server/agents-config.js'
import { startLaneBridge } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function endpointBody(overrides = {}) {
  return {
    name: 'Work',
    provider: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyName: 'openrouter',
    models: ['alpha'],
    confirmed: true,
    ...overrides,
  }
}

async function post(url, path, body, origin = url) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, text }
}

async function get(url, path) {
  const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(10000) })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, text }
}

describe('provider presets', () => {
  it('lists each preset with its base URL', () => {
    expect(PROVIDERS.map((entry) => [entry.name, entry.baseUrl])).toEqual([
      ['OpenRouter', 'https://openrouter.ai/api/v1'],
      ['OpenAI', 'https://api.openai.com/v1'],
      ['DeepSeek', 'https://api.deepseek.com/v1'],
      ['NVIDIA', 'https://integrate.api.nvidia.com/v1'],
      ['Kimi (Moonshot)', 'https://api.moonshot.ai/v1'],
      ['Groq', 'https://api.groq.com/openai/v1'],
      ['Mistral', 'https://api.mistral.ai/v1'],
      ['Together', 'https://api.together.xyz/v1'],
      ['xAI', 'https://api.x.ai/v1'],
      ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
      ['Ollama', 'http://127.0.0.1:11434/v1'],
      ['LM Studio', 'http://127.0.0.1:1234/v1'],
      ['Custom', ''],
    ])
  })
})

describe('endpoint rules', () => {
  it('accepts a remote https endpoint with a key slot', () => {
    expect(endpointProblem(endpointBody())).toBeNull()
  })

  it('accepts http only on localhost, 127.0.0.1 and [::1]', () => {
    for (const baseUrl of ['http://localhost:8080/v1', 'http://127.0.0.1:11434/v1', 'http://[::1]:1234/v1']) {
      expect(endpointProblem(endpointBody({ baseUrl, keyName: '' }))).toBeNull()
    }
    expect(endpointProblem(endpointBody({ baseUrl: 'http://192.168.1.4/v1', keyName: '' }))).toBe(BASE_URL_PROBLEM)
  })

  it('refuses a remote endpoint with no key slot', () => {
    expect(endpointProblem(endpointBody({ keyName: '' }))).toBe(KEY_REQUIRED_PROBLEM)
  })

  it('refuses a name that is empty, too long or holds another character', () => {
    expect(endpointProblem(endpointBody({ name: '   ' }))).toBe(NAME_PROBLEM)
    expect(endpointProblem(endpointBody({ name: 'A'.repeat(41) }))).toBe(NAME_PROBLEM)
    expect(endpointProblem(endpointBody({ name: 'Work/one' }))).toBe(NAME_PROBLEM)
  })

  it('refuses a provider that is not in the list', () => {
    expect(endpointProblem(endpointBody({ provider: 'Elsewhere' }))).toBe(PROVIDER_PROBLEM)
  })

  it('refuses more than 50 models', () => {
    const models = Array.from({ length: MAX_ENDPOINT_MODELS + 1 }, (_, index) => `model-${index}`)
    expect(endpointProblem(endpointBody({ models }))).not.toBeNull()
  })
})

describe('/api/endpoints', () => {
  it('answers the providers and an empty list', async () => {
    const { url } = await startLaneBridge()
    const providers = await get(url, '/api/providers')
    expect(providers.status).toBe(200)
    expect(providers.body).toEqual(PROVIDERS)
    const endpoints = await get(url, '/api/endpoints')
    expect(endpoints.status).toBe(200)
    expect(endpoints.body).toEqual({ endpoints: [], max: MAX_ENDPOINTS })
  })

  it('needs a page Origin and a confirmation to save', async () => {
    const { url } = await startLaneBridge()
    const noOrigin = await post(url, '/api/endpoints', endpointBody(), null)
    expect(noOrigin.status).toBe(403)
    const unconfirmed = await post(url, '/api/endpoints', endpointBody({ confirmed: false }))
    expect(unconfirmed.status).toBe(400)
  })

  it('creates, replaces by name, lists and deletes an endpoint', async () => {
    const { url, runsDir } = await startLaneBridge()
    const created = await post(url, '/api/endpoints', endpointBody())
    expect(created.status).toBe(200)
    expect(created.body.endpoint).toMatchObject({ name: 'Work', provider: 'OpenRouter', keyName: 'openrouter' })

    const replaced = await post(url, '/api/endpoints', endpointBody({ baseUrl: 'https://api.openai.com/v1', models: ['beta'] }))
    expect(replaced.status).toBe(200)
    const list = await get(url, '/api/endpoints')
    expect(list.body.endpoints).toHaveLength(1)
    expect(list.body.endpoints[0].baseUrl).toBe('https://api.openai.com/v1')
    expect(list.body.endpoints[0].models).toEqual(['beta'])

    const deleted = await post(url, `/api/endpoints/${encodeURIComponent('Work')}/delete`, { confirmed: true })
    expect(deleted.status).toBe(200)
    expect(deleted.body.deleted).toBe('Work')
    expect(readEndpoints(runsDir)).toEqual([])
  })

  it('refuses a new endpoint past 20', async () => {
    const { url, runsDir } = await startLaneBridge()
    const endpoints = Array.from({ length: MAX_ENDPOINTS }, (_, index) => ({
      name: `Endpoint ${index}`,
      provider: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyName: 'openrouter',
      models: ['alpha'],
    }))
    saveEndpoints(runsDir, endpoints)
    const refused = await post(url, '/api/endpoints', endpointBody({ name: 'One more' }))
    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('At most 20')
  })
})

describe('endpoint lanes', () => {
  it('lists endpoint models for the machineroom harness and saves the endpoint on a lane', async () => {
    const { url, runsDir } = await startLaneBridge()
    await post(
      url,
      '/api/endpoints',
      endpointBody({ name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: ['alpha', 'beta'] }),
    )
    const harnesses = await get(url, '/api/harnesses')
    const machineroom = harnesses.body.find((entry) => entry.key === 'machineroom')
    expect(machineroom.available).toBe(true)
    expect(machineroom.models.map((entry) => entry.id)).toEqual([
      'xiaomi/mimo-v2.6-pro',
      'deepseek/deepseek-v4.1-flash-1017',
      'Local/alpha',
      'Local/beta',
    ])
    const created = await post(url, '/api/lanes/create', {
      name: 'Endpoint Lane',
      harness: 'machineroom',
      model: 'Local/alpha',
      endpoint: 'Local',
      confirmed: true,
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ model: 'Local/alpha', endpoint: 'Local' })
    expect(readAllLanes({ lanesJson: {}, runsFolder: runsDir })[created.body.key].cli.endpoint).toBe('Local')
    const updated = await post(url, `/api/lanes/${encodeURIComponent(created.body.key)}/update`, {
      name: 'Endpoint Lane Two',
      model: 'beta',
      endpoint: 'Local',
      confirmed: true,
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ name: 'Endpoint Lane Two', model: 'Local/beta', endpoint: 'Local' })
    const cleared = await post(url, `/api/lanes/${encodeURIComponent(created.body.key)}/update`, {
      model: 'xiaomi/mimo-v2.6-pro',
      endpoint: '',
      confirmed: true,
    })
    expect(cleared.status).toBe(200)
    expect(cleared.body.endpoint).toBeUndefined()
  })

  it('refuses an endpoint on another harness and a model outside the endpoint', async () => {
    const { url } = await startLaneBridge()
    await post(
      url,
      '/api/endpoints',
      endpointBody({ name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: ['alpha'] }),
    )
    const wrongHarness = await post(url, '/api/lanes/create', {
      name: 'Claude Endpoint',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      endpoint: 'Local',
      confirmed: true,
    })
    expect(wrongHarness.status).toBe(400)
    const wrongModel = await post(url, '/api/lanes/create', {
      name: 'Endpoint Lane',
      harness: 'machineroom',
      model: 'Local/unknown',
      endpoint: 'Local',
      confirmed: true,
    })
    expect(wrongModel.status).toBe(400)
  })
})

describe('/api/endpoints/NAME/models', () => {
  it('asks the endpoint for its models with the slot key and never answers the key', async () => {
    const { url, runsDir } = await startLaneBridge()
    const seen = []
    const seenUrls = []
    const upstream = createServer((req, res) => {
      seen.push(req.headers.authorization)
      seenUrls.push(req.url)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }))
    })
    await new Promise((done) => upstream.listen(0, '127.0.0.1', done))
    const { port } = upstream.address()
    cleanups.push(
      () =>
        new Promise((done) => {
          upstream.close(() => done())
          upstream.closeAllConnections?.()
        }),
    )
    const key = 'slot-secret-value'
    writeFileSync(join(runsDir, 'keys.json'), JSON.stringify({ local: key }), 'utf8')
    const created = await post(
      url,
      '/api/endpoints',
      endpointBody({ name: 'Local', provider: 'Custom', baseUrl: `http://127.0.0.1:${port}/v1`, keyName: 'local', models: [] }),
    )
    expect(created.status).toBe(200)
    const answer = await get(url, `/api/endpoints/${encodeURIComponent('Local')}/models`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ models: ['alpha', 'beta'] })
    expect(seen).toEqual([`Bearer ${key}`])
    expect(seenUrls).toEqual(['/v1/models'])
    expect(answer.text).not.toContain(key)
    expect(created.text).not.toContain(key)
    const list = await get(url, '/api/endpoints')
    expect(list.text).not.toContain(key)
    expect(JSON.stringify(modelsFor(runsDir))).not.toContain(key)
  })

  it('answers a missing key slot with one sentence and no key', async () => {
    const { url, runsDir } = await startLaneBridge()
    await post(
      url,
      '/api/endpoints',
      endpointBody({ name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: 'local', models: [] }),
    )
    const answer = await get(url, `/api/endpoints/${encodeURIComponent('Local')}/models`)
    expect(answer.status).toBe(400)
    expect(answer.body.error).toBe(NO_KEY_PROBLEM)
    expect(answer.text).not.toContain('slot-secret-value')
    expect(readEndpoints(runsDir)).toHaveLength(1)
  })

  it('answers 502 when the endpoint refuses the model list', async () => {
    const { url } = await startLaneBridge()
    const upstream = createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'no' }))
    })
    await new Promise((done) => upstream.listen(0, '127.0.0.1', done))
    const { port } = upstream.address()
    cleanups.push(
      () =>
        new Promise((done) => {
          upstream.close(() => done())
          upstream.closeAllConnections?.()
        }),
    )
    await post(
      url,
      '/api/endpoints',
      endpointBody({ name: 'Local', provider: 'Custom', baseUrl: `http://127.0.0.1:${port}/v1`, keyName: '', models: [] }),
    )
    const answer = await get(url, `/api/endpoints/${encodeURIComponent('Local')}/models`)
    expect(answer.status).toBe(502)
    expect(answer.body.error).toBe(MODELS_FAILED_PROBLEM)
  })

  it('uses a 10 second AbortSignal timeout', async () => {
    const runsDir = makeTempDir('mr-endpoints-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(runsDir, [
      { name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: [] },
    ])
    let signal = null
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => {
        expect(status).toBe(200)
        expect(body).toEqual({ models: ['alpha'] })
      },
      readJsonBody: async () => null,
      fetchImpl: async (_url, init) => {
        signal = init.signal
        return { ok: true, json: async () => ({ data: [{ id: 'alpha' }] }) }
      },
    })
    await api.handle(
      { method: 'GET', headers: {} },
      {},
      new URL('http://127.0.0.1/api/endpoints/Local/models'),
    )
    expect(MODELS_TIMEOUT_MS).toBe(10000)
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})
