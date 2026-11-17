import { afterEach, describe, expect, it } from 'vitest'
import { createEndpointsApi, readEndpoints, saveEndpoints } from '../server/endpoints.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const folders = []
afterEach(() => folders.splice(0).forEach(removeTempDir))

describe('quick connect during endpoint edits', () => {
  it.each(['added', 'changed', 'deleted'])('keeps an endpoint %s while models load', async (change) => {
    const runsFolder = makeTempDir('quick-race-')
    folders.push(runsFolder)
    let release
    let started
    const fetching = new Promise((resolve) => { started = resolve })
    const response = new Promise((resolve) => { release = resolve })
    const answers = []
    let body = { provider: 'OpenRouter', key: 'canary', confirmed: true }
    const api = createEndpointsApi({
      runsFolder,
      readJsonBody: async () => body,
      sendJson: (_req, _res, status, data) => answers.push({ status, data }),
      fetchImpl: () => { started(); return response },
    })
    const request = { method: 'POST', headers: { origin: 'http://localhost' } }
    const quick = api.handle(request, {}, new URL('http://localhost/api/endpoints/quick'))
    await fetching
    const original = readEndpoints(runsFolder)[0]
    if (change === 'added') {
      body = { name: 'Second', provider: 'Custom', baseUrl: 'http://localhost:1234/v1', keyName: '', models: [], confirmed: true }
      await api.handle(request, {}, new URL('http://localhost/api/endpoints'))
    } else if (change === 'changed') {
      saveEndpoints(runsFolder, [{ ...original, provider: 'Custom', baseUrl: 'http://localhost:1234/v1' }])
    } else {
      saveEndpoints(runsFolder, [])
    }
    release({ ok: true, json: async () => ({ data: [{ id: 'new-model' }] }) })
    await quick
    const saved = readEndpoints(runsFolder)
    if (change === 'added') {
      expect(saved.map((entry) => entry.name)).toEqual(['OpenRouter', 'Second'])
      expect(saved[0].models).toEqual(['new-model'])
      expect(answers.at(-1).status).toBe(200)
    } else {
      expect(saved).toEqual(change === 'changed' ? [{ ...original, provider: 'Custom', baseUrl: 'http://localhost:1234/v1' }] : [])
      expect(answers.at(-1)).toEqual({ status: 409, data: { error: 'The endpoint was deleted or its connection settings changed while models were loading. No models were saved.' } })
    }
  })
})
