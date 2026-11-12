import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_MODEL_PINS,
  PIN_ORIGIN_PROBLEM,
  PIN_PROBLEM,
  modelPinsProblem,
  readModelPins,
  saveModelPins,
} from '../server/endpoints.js'
import { createClient } from '../src/control/client.js'
import { startLaneBridge } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

async function request(url, path, { method = 'GET', body, origin } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (origin) headers.origin = origin
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

describe('/api/model-pins', () => {
  it('saves the pins, reads them back and writes them in the runs folder', async () => {
    const bridge = await startLaneBridge()
    cleanups.push(() => bridge.stop())
    const empty = await request(bridge.url, '/api/model-pins')
    expect(empty).toEqual({ status: 200, body: { pins: [] } })

    const saved = await request(bridge.url, '/api/model-pins', {
      method: 'PUT',
      origin: bridge.url,
      body: { pins: ['openai/gpt-5', 'alpha'] },
    })
    expect(saved).toEqual({ status: 200, body: { ok: true, pins: ['openai/gpt-5', 'alpha'] } })

    const readBack = await request(bridge.url, '/api/model-pins')
    expect(readBack).toEqual({ status: 200, body: { pins: ['openai/gpt-5', 'alpha'] } })

    const file = JSON.parse(readFileSync(join(bridge.runsDir, 'model-pins.json'), 'utf8'))
    expect(file).toEqual({ pins: ['openai/gpt-5', 'alpha'] })
  })

  it('refuses a bad list with the pin sentence and keeps the old pins', async () => {
    const bridge = await startLaneBridge()
    cleanups.push(() => bridge.stop())
    await request(bridge.url, '/api/model-pins', {
      method: 'PUT',
      origin: bridge.url,
      body: { pins: ['kept'] },
    })

    const tooMany = Array.from({ length: MAX_MODEL_PINS + 1 }, (_, index) => `model-${index}`)
    for (const pins of [tooMany, ['x'.repeat(201)], ['ok', 7], [''], 'nope']) {
      const refused = await request(bridge.url, '/api/model-pins', {
        method: 'PUT',
        origin: bridge.url,
        body: { pins },
      })
      expect(refused).toEqual({ status: 400, body: { error: PIN_PROBLEM } })
    }

    const missing = await request(bridge.url, '/api/model-pins', {
      method: 'PUT',
      origin: bridge.url,
      body: {},
    })
    expect(missing).toEqual({ status: 400, body: { error: PIN_PROBLEM } })

    const readBack = await request(bridge.url, '/api/model-pins')
    expect(readBack.body).toEqual({ pins: ['kept'] })
  })

  it('needs a page Origin to save', async () => {
    const bridge = await startLaneBridge()
    cleanups.push(() => bridge.stop())
    const refused = await request(bridge.url, '/api/model-pins', {
      method: 'PUT',
      body: { pins: ['alpha'] },
    })
    expect(refused).toEqual({ status: 403, body: { error: PIN_ORIGIN_PROBLEM } })
    expect(readModelPins(bridge.runsDir)).toEqual([])
  })

  it('offers PUT in the preflight methods', async () => {
    const bridge = await startLaneBridge()
    cleanups.push(() => bridge.stop())
    const response = await fetch(`${bridge.url}/api/model-pins`, {
      method: 'OPTIONS',
      headers: { origin: bridge.url, 'access-control-request-method': 'PUT' },
      signal: AbortSignal.timeout(10000),
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT')
  })
})

describe('model pin rules', () => {
  it('reads a bare array and drops duplicates, empty pins and long pins', () => {
    const runsDir = makeTempDir('mr-pins-')
    cleanups.push(async () => removeTempDir(runsDir))
    writeFileSync(
      join(runsDir, 'model-pins.json'),
      JSON.stringify([' alpha ', 'alpha', '', 7, 'x'.repeat(201), 'beta']),
      'utf8',
    )
    expect(readModelPins(runsDir)).toEqual(['alpha', 'beta'])
  })

  it('caps the saved list at 200 pins', () => {
    const runsDir = makeTempDir('mr-pins-cap-')
    cleanups.push(async () => removeTempDir(runsDir))
    const pins = Array.from({ length: MAX_MODEL_PINS + 5 }, (_, index) => `model-${index}`)
    expect(modelPinsProblem(pins)).toBe(PIN_PROBLEM)
    saveModelPins(runsDir, pins)
    expect(readModelPins(runsDir)).toHaveLength(MAX_MODEL_PINS)
  })
})

describe('the client model pin methods', () => {
  it('reads and saves the pins at /api/model-pins', async () => {
    const seen = []
    const fetchImpl = async (url, options = {}) => {
      seen.push({ url, method: options.method, body: options.body })
      const pins = options.method === 'PUT' ? JSON.parse(options.body).pins : ['alpha']
      return { ok: true, json: async () => ({ ok: true, pins }) }
    }
    const client = createClient({ fetchImpl })
    expect(await client.modelPins()).toEqual(['alpha'])
    expect(await client.saveModelPins({ pins: ['alpha', 'beta'] })).toEqual({
      ok: true,
      pins: ['alpha', 'beta'],
    })
    expect(seen).toEqual([
      { url: '/api/model-pins', method: 'GET', body: undefined },
      { url: '/api/model-pins', method: 'PUT', body: JSON.stringify({ pins: ['alpha', 'beta'] }) },
    ])
  })
})
