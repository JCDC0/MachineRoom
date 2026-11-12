import { createServer } from 'node:http'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASE_URL_PROBLEM,
  DELETE_CONFIRM_PROBLEM,
  DELETE_ORIGIN_PROBLEM,
  ENDPOINT_NOT_FOUND_PROBLEM,
  KEY_REQUIRED_PROBLEM,
  MAX_ENDPOINT_MODELS,
  MAX_ENDPOINTS,
  MODELS_TIMEOUT_MS,
  MODELS_FAILED_PROBLEM,
  NAME_PROBLEM,
  NO_KEY_PROBLEM,
  PROVIDERS,
  PROVIDER_PROBLEM,
  SAVE_CONFIRM_PROBLEM,
  SAVE_ORIGIN_PROBLEM,
  TOO_MANY_PROBLEM,
  cleanEndpoint,
  createEndpointsApi,
  endpointProblem,
  modelDetailsFromAnswer,
  modelIdsFromAnswer,
  readEndpoints,
  saveEndpoints,
} from '../server/endpoints.js'
import { modelsFor } from '../server/models.js'
import { readAllLanes } from '../server/agents-config.js'
import { readKeys } from '../server/family.js'
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
      expect(endpointProblem(endpointBody({ provider: 'Custom', baseUrl, keyName: '' }))).toBeNull()
    }
    expect(endpointProblem(endpointBody({ provider: 'Custom', baseUrl: 'http://192.168.1.4/v1', keyName: '' }))).toBe(BASE_URL_PROBLEM)
  })

  it('refuses an address that does not match a preset provider', () => {
    expect(endpointProblem(endpointBody({ provider: 'OpenRouter', baseUrl: 'https://attacker.com/v1' }))).toBe(
      'The OpenRouter preset uses its own address. Pick Custom for another one.',
    )
    expect(endpointProblem(endpointBody({ provider: 'OpenAI', baseUrl: 'https://attacker.com/v1' }))).toBe(
      'The OpenAI preset uses its own address. Pick Custom for another one.',
    )
    expect(endpointProblem(endpointBody({ provider: 'Custom', baseUrl: 'https://attacker.com/v1' }))).toBeNull()
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

  it('refuses more than 1000 models', () => {
    const models = Array.from({ length: MAX_ENDPOINT_MODELS + 1 }, (_, index) => `model-${index}`)
    expect(endpointProblem(endpointBody({ models }))).not.toBeNull()
  })

  it('keeps preset address in cleanEndpoint and normalizes Custom address', () => {
    expect(cleanEndpoint(endpointBody({ provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/' })).baseUrl).toBe(
      'https://openrouter.ai/api/v1',
    )
    expect(cleanEndpoint(endpointBody({ provider: 'Custom', baseUrl: 'https://example.com/api/v1/' })).baseUrl).toBe(
      'https://example.com/api/v1',
    )
  })
})

describe('model details', () => {
  it('keeps all five details of an OpenRouter-shaped answer', async () => {
    const runsDir = makeTempDir('mr-details-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(runsDir, [
      { name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: [] },
    ])
    const answers = []
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => null,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'openai/gpt-5',
              name: 'OpenAI: GPT-5',
              context_length: 400000,
              pricing: { prompt: '0.00000125', completion: '0.000010' },
              created: 1735689600,
            },
          ],
        }),
      }),
    })
    await api.handle(
      { method: 'GET', headers: {} },
      {},
      new URL('http://127.0.0.1/api/endpoints/Local/models'),
    )
    expect(answers).toEqual([
      {
        status: 200,
        body: {
          models: ['openai/gpt-5'],
          modelDetails: [
            {
              id: 'openai/gpt-5',
              name: 'OpenAI: GPT-5',
              contextLength: 400000,
              promptPrice: 0.00000125,
              completionPrice: 0.00001,
              created: 1735689600,
            },
          ],
        },
      },
    ])
  })

  it('keeps ids and nulls for an answer of plain ids', () => {
    const answer = { data: ['alpha', 'beta'] }
    expect(modelIdsFromAnswer(answer)).toEqual(['alpha', 'beta'])
    expect(modelDetailsFromAnswer(answer)).toEqual([
      { id: 'alpha', name: 'alpha', contextLength: null, promptPrice: null, completionPrice: null, created: null },
      { id: 'beta', name: 'beta', contextLength: null, promptPrice: null, completionPrice: null, created: null },
    ])
  })

  it('cuts a huge name to 200 characters and keeps no description', () => {
    const details = modelDetailsFromAnswer({
      data: [{ id: 'alpha', name: 'n'.repeat(500), description: 'd'.repeat(500), context_length: 128000 }],
    })
    expect(details[0].name).toBe('n'.repeat(200))
    expect(details[0]).not.toHaveProperty('description')
    expect(details[0].contextLength).toBe(128000)
  })

  it('loads an old endpoints.json without details', () => {
    const runsDir = makeTempDir('mr-old-endpoints-')
    cleanups.push(async () => removeTempDir(runsDir))
    writeFileSync(
      join(runsDir, 'endpoints.json'),
      JSON.stringify({
        endpoints: [
          {
            name: 'Work',
            provider: 'OpenRouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            keyName: 'openrouter',
            models: ['alpha'],
          },
        ],
      }),
      'utf8',
    )
    const endpoints = readEndpoints(runsDir)
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].models).toEqual(['alpha'])
    expect(endpoints[0].modelDetails).toEqual([])
  })

  it('saves the details beside the ids from the quick route, capped at 1000', async () => {
    const runsDir = makeTempDir('mr-quick-details-')
    cleanups.push(async () => removeTempDir(runsDir))
    const answers = []
    const models = Array.from({ length: MAX_ENDPOINT_MODELS + 1 }, (_, index) => ({
      id: `model-${index}`,
      name: `Model ${index}`,
      context_length: 128000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
      created: 1735689600,
    }))
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ provider: 'OpenRouter', key: 'quick-details-value', confirmed: true }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: models }) }),
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/endpoints/quick'),
    )
    expect(answers[0].status).toBe(200)
    const saved = readEndpoints(runsDir)[0]
    expect(saved.models).toHaveLength(MAX_ENDPOINT_MODELS)
    expect(saved.modelDetails).toHaveLength(MAX_ENDPOINT_MODELS)
    expect(saved.modelDetails[0]).toEqual({
      id: 'model-0',
      name: 'Model 0',
      contextLength: 128000,
      promptPrice: 0.000001,
      completionPrice: 0.000002,
      created: 1735689600,
    })
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
    expect(noOrigin.body).toEqual({ error: SAVE_ORIGIN_PROBLEM })
    const unconfirmed = await post(url, '/api/endpoints', endpointBody({ confirmed: false }))
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body).toEqual({ error: SAVE_CONFIRM_PROBLEM })
  })

  it('needs a page Origin and a confirmation to delete an endpoint', async () => {
    const { url } = await startLaneBridge()
    await post(url, '/api/endpoints', endpointBody({ name: 'Deletable' }))
    const noOrigin = await post(url, `/api/endpoints/${encodeURIComponent('Deletable')}/delete`, { confirmed: true }, null)
    expect(noOrigin.status).toBe(403)
    expect(noOrigin.body).toEqual({ error: DELETE_ORIGIN_PROBLEM })

    const unconfirmed = await post(url, `/api/endpoints/${encodeURIComponent('Deletable')}/delete`, { confirmed: false })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body).toEqual({ error: DELETE_CONFIRM_PROBLEM })

    const missing = await post(url, `/api/endpoints/${encodeURIComponent('Missing')}/delete`, { confirmed: true })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: ENDPOINT_NOT_FOUND_PROBLEM })

    const deleted = await post(url, `/api/endpoints/${encodeURIComponent('Deletable')}/delete`, { confirmed: true })
    expect(deleted.status).toBe(200)
    expect(deleted.body.deleted).toBe('Deletable')
  })

  it('creates, replaces by name, lists and deletes an endpoint', async () => {
    const { url, runsDir } = await startLaneBridge()
    const created = await post(url, '/api/endpoints', endpointBody())
    expect(created.status).toBe(200)
    expect(created.body.endpoint).toMatchObject({ name: 'Work', provider: 'OpenRouter', keyName: 'openrouter' })

    const replaced = await post(
      url,
      '/api/endpoints',
      endpointBody({ provider: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyName: 'openai', models: ['beta'] }),
    )
    expect(replaced.status).toBe(200)
    const list = await get(url, '/api/endpoints')
    expect(list.body.endpoints).toHaveLength(1)
    expect(list.body.endpoints[0].baseUrl).toBe('https://api.openai.com/v1')
    expect(list.body.endpoints[0].provider).toBe('OpenAI')
    expect(list.body.endpoints[0].models).toEqual(['beta'])

    const deleted = await post(url, `/api/endpoints/${encodeURIComponent('Work')}/delete`, { confirmed: true })
    expect(deleted.status).toBe(200)
    expect(deleted.body.deleted).toBe('Work')
    expect(readEndpoints(runsDir)).toEqual([])
  })

  it('saves an endpoint with 181 models', async () => {
    const { url, runsDir } = await startLaneBridge()
    const models = Array.from({ length: 181 }, (_, index) => `model-${index}`)
    const saved = await post(url, '/api/endpoints', endpointBody({ name: 'Big', models }))
    expect(saved.status).toBe(200)
    expect(saved.body.endpoint.models).toHaveLength(181)
    const list = await get(url, '/api/endpoints')
    expect(list.body.endpoints[0].models).toHaveLength(181)
    expect(readEndpoints(runsDir)[0].models).toHaveLength(181)
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
    expect(refused.body.error).toBe(TOO_MANY_PROBLEM)
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
    expect(machineroom.models.map((entry) => entry.id)).toEqual(['Local/alpha', 'Local/beta'])
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
      model: 'Local/alpha',
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
    expect(answer.body).toEqual({
      models: ['alpha', 'beta'],
      modelDetails: [
        { id: 'alpha', name: 'alpha', contextLength: null, promptPrice: null, completionPrice: null, created: null },
        { id: 'beta', name: 'beta', contextLength: null, promptPrice: null, completionPrice: null, created: null },
      ],
    })
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
        expect(body).toEqual({
          models: ['alpha'],
          modelDetails: [
            { id: 'alpha', name: 'alpha', contextLength: null, promptPrice: null, completionPrice: null, created: null },
          ],
        })
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

describe('POST /api/endpoints/quick', () => {
  it('needs a page Origin and a confirmation', async () => {
    const { url, runsDir } = await startLaneBridge()
    const noOrigin = await post(url, '/api/endpoints/quick', { provider: 'OpenRouter', key: 'secret', confirmed: true }, null)
    expect(noOrigin.status).toBe(403)
    const unconfirmed = await post(url, '/api/endpoints/quick', { provider: 'OpenRouter', key: 'secret', confirmed: false })
    expect(unconfirmed.status).toBe(400)
    expect(readEndpoints(runsDir)).toEqual([])
    expect(readKeys(runsDir)).toEqual({})
  })

  it('saves the slot, the endpoint and 181 models from a fake provider', async () => {
    const runsDir = makeTempDir('mr-quick-')
    cleanups.push(async () => removeTempDir(runsDir))
    const key = 'quick-secret-value'
    const models = Array.from({ length: 181 }, (_, index) => `model-${index}`)
    const seen = []
    const answers = []
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ provider: 'OpenRouter', key, confirmed: true }),
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), auth: init.headers.authorization })
        return { ok: true, json: async () => ({ data: models.map((id) => ({ id })) }) }
      },
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/endpoints/quick'),
    )
    expect(answers).toHaveLength(1)
    expect(answers[0].status).toBe(200)
    expect(seen).toEqual([{ url: 'https://openrouter.ai/api/v1/models', auth: `Bearer ${key}` }])
    expect(answers[0].body).toEqual({
      endpoint: {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'OpenRouter',
        models: 181,
      },
    })
    expect(JSON.stringify(answers[0].body)).not.toContain(key)
    expect(readKeys(runsDir)).toEqual({ OpenRouter: key })
    const endpoints = readEndpoints(runsDir)
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].models).toHaveLength(181)
    expect(JSON.stringify(endpoints)).not.toContain(key)
  })

  it('keeps the endpoint and its models when the fetch fails and answers without the key', async () => {
    const runsDir = makeTempDir('mr-quick-fail-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(runsDir, [
      {
        name: 'OpenRouter',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['alpha'],
        modelDetails: [
          { id: 'alpha', name: 'Alpha', contextLength: 128000, promptPrice: 0.000001, completionPrice: 0.000002, created: 1735689600 },
        ],
      },
    ])
    const key = 'quick-fail-value'
    const answers = []
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ provider: 'OpenRouter', key, confirmed: true }),
      fetchImpl: async () => {
        throw new Error('no network')
      },
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/endpoints/quick'),
    )
    expect(answers).toHaveLength(1)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.error).toBe(MODELS_FAILED_PROBLEM)
    expect(answers[0].body.endpoint).toMatchObject({ name: 'OpenRouter', keyName: 'openrouter', models: 1 })
    expect(JSON.stringify(answers[0].body)).not.toContain(key)
    expect(readKeys(runsDir)).toEqual({ openrouter: key })
    expect(readEndpoints(runsDir)[0].models).toEqual(['alpha'])
    expect(readEndpoints(runsDir)[0].modelDetails).toEqual([
      { id: 'alpha', name: 'Alpha', contextLength: 128000, promptPrice: 0.000001, completionPrice: 0.000002, created: 1735689600 },
    ])
  })

  it('repoints the endpoint at the provider slot when another endpoint names that slot', async () => {
    const runsDir = makeTempDir('mr-quick-repoint-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(runsDir, [
      { name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'shared_slot', models: ['alpha'] },
      { name: 'Team', provider: 'Custom', baseUrl: 'http://127.0.0.1:1234/v1', keyName: 'shared_slot', models: ['beta'] },
    ])
    const oldShared = 'kept-shared-value'
    const newProvider = 'new-provider-value'
    const { saveKeys } = await import('../server/family.js')
    saveKeys(runsDir, { shared_slot: oldShared })
    const answers = []
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ provider: 'OpenRouter', key: newProvider, confirmed: true }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'alpha' }] }) }),
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/endpoints/quick'),
    )
    expect(answers).toHaveLength(1)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.endpoint.keyName).toBe('OpenRouter')
    const savedKeys = readKeys(runsDir)
    expect(savedKeys.shared_slot).toBe(oldShared)
    expect(savedKeys.OpenRouter).toBe(newProvider)
    const endpoints = readEndpoints(runsDir)
    expect(endpoints.find((entry) => entry.name === 'OpenRouter').keyName).toBe('OpenRouter')
    expect(endpoints.find((entry) => entry.name === 'Team').keyName).toBe('shared_slot')
  })

  it('reuses the existing endpoint slot when no other endpoint names that slot', async () => {
    const runsDir = makeTempDir('mr-quick-reuse-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(runsDir, [
      { name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'single_slot', models: ['alpha'] },
    ])
    const updatedValue = 'updated-slot-value'
    const answers = []
    const api = createEndpointsApi({
      runsFolder: runsDir,
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ provider: 'OpenRouter', key: updatedValue, confirmed: true }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'alpha' }] }) }),
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/endpoints/quick'),
    )
    expect(answers).toHaveLength(1)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.endpoint.keyName).toBe('single_slot')
    const savedKeys = readKeys(runsDir)
    expect(savedKeys.single_slot).toBe(updatedValue)
  })

  it('removes the temporary file when rename fails', () => {
    const runsDir = makeTempDir('mr-fallback-tmp-')
    cleanups.push(async () => removeTempDir(runsDir))
    saveEndpoints(
      runsDir,
      [{ name: 'OpenRouter', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'k1', models: ['alpha'] }],
      {
        rename: () => {
          const err = new Error('EBUSY')
          err.code = 'EBUSY'
          throw err
        },
      }
    )
    expect(existsSync(join(runsDir, 'endpoints.json'))).toBe(true)
    expect(existsSync(join(runsDir, 'endpoints.json.tmp'))).toBe(false)
  })
})
