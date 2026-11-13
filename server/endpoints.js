import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { keyFromFile, writeKey } from './family.js'

export { keyFromFile }

export const MAX_ENDPOINTS = 20
export const MAX_ENDPOINT_MODELS = 1000
export const MAX_MODEL_DETAIL_TEXT = 200
export const MAX_MODEL_PINS = 200
export const MODELS_TIMEOUT_MS = 10000
export const ENDPOINT_NAME_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/

export const PROVIDERS = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { name: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { name: 'Custom', baseUrl: '' },
]

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const SAVE_ORIGIN_PROBLEM = 'A request to save an endpoint needs a page Origin.'
export const DELETE_ORIGIN_PROBLEM = 'A request to delete an endpoint needs a page Origin.'
export const SAVE_CONFIRM_PROBLEM = 'Confirm saving the endpoint first.'
export const DELETE_CONFIRM_PROBLEM = 'Confirm deleting the endpoint first.'
export const NAME_PROBLEM = 'The endpoint name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const PROVIDER_PROBLEM = 'Choose a provider from the list.'
export const BASE_URL_PROBLEM = 'The base URL must be a full https address, or http on this computer.'
export const BASE_URL_PARTS_PROBLEM = 'The base URL cannot hold a user name, a query or a fragment.'
export const KEY_NAME_PROBLEM = 'The key slot name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const KEY_REQUIRED_PROBLEM = 'A remote endpoint needs a key slot.'
export const MODELS_PROBLEM = 'Models must be a list of 0 to 1000 ids.'
export const TOO_MANY_PROBLEM = 'At most 20 endpoints are allowed.'
export const ENDPOINT_NOT_FOUND_PROBLEM = 'The endpoint was not found.'
export const NO_KEY_PROBLEM = 'The key slot has no key.'
export const MODELS_FAILED_PROBLEM = 'The endpoint did not answer its model list.'
export const MODELS_TIMEOUT_PROBLEM = 'The endpoint did not answer within 10 seconds.'
export const MODELS_JSON_PROBLEM = 'The endpoint model list was not JSON.'
export const QUICK_ORIGIN_PROBLEM = 'A request to save a Direct API key needs a page Origin.'
export const QUICK_CONFIRM_PROBLEM = 'Confirm saving the Direct API key first.'
export const QUICK_KEY_PROBLEM = 'The key must be 1 to 500 characters.'
export const QUICK_KEY_SAVE_PROBLEM = 'The Direct API key could not be saved.'
export const REPLACE_KEY_PROVIDER_PROBLEM = 'The key can only be replaced on the endpoint it belongs to.'
export const REPLACE_KEY_SLOT_PROBLEM = 'This endpoint has no key slot to replace.'
export const REPLACE_KEY_SHARED_PROBLEM = 'That key slot is shared with another endpoint.'
export const PIN_PROBLEM = 'A pin is a model name of at most 200 characters.'
export const PIN_ORIGIN_PROBLEM = 'A change to the model pins needs a page Origin.'

export function endpointsFile(runsFolder) {
  return join(runsFolder, 'endpoints.json')
}

export function modelPinsFile(runsFolder) {
  return join(runsFolder, 'model-pins.json')
}

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname ?? '').toLowerCase())
}

export function parseBaseUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return { problem: BASE_URL_PROBLEM }
  let url
  try {
    url = new URL(text)
  } catch {
    return { problem: BASE_URL_PROBLEM }
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return { problem: BASE_URL_PARTS_PROBLEM }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { problem: BASE_URL_PROBLEM }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return { problem: BASE_URL_PROBLEM }
  return { url, local: isLocalHost(url.hostname) }
}

export function endpointProblem(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return NAME_PROBLEM
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!ENDPOINT_NAME_PATTERN.test(name)) return NAME_PROBLEM
  const provider = typeof draft.provider === 'string' ? draft.provider.trim() : ''
  const preset = PROVIDERS.find((item) => item.name === provider)
  if (!preset) return PROVIDER_PROBLEM
  const parsed = parseBaseUrl(draft.baseUrl)
  if (parsed.problem) return parsed.problem
  if (preset.name !== 'Custom') {
    const normalized = parsed.url.toString().replace(/\/+$/, '')
    const presetBase = preset.baseUrl.replace(/\/+$/, '')
    if (normalized !== presetBase) {
      return `The ${preset.name} preset uses its own address. Pick Custom for another one.`
    }
  }
  const keyName = typeof draft.keyName === 'string' ? draft.keyName.trim() : ''
  if (keyName !== '' && !ENDPOINT_NAME_PATTERN.test(keyName)) return KEY_NAME_PROBLEM
  if (keyName === '' && !parsed.local) return KEY_REQUIRED_PROBLEM
  if (!Array.isArray(draft.models)) return MODELS_PROBLEM
  if (draft.models.length > MAX_ENDPOINT_MODELS) return MODELS_PROBLEM
  for (const model of draft.models) {
    if (typeof model !== 'string' || model.trim() === '' || model.trim().length > 200) return MODELS_PROBLEM
  }
  return null
}

function detailText(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > MAX_MODEL_DETAIL_TEXT ? text.slice(0, MAX_MODEL_DETAIL_TEXT) : text
}

function detailNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function cleanModelDetails(value, models) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(models)
  const details = []
  const seen = new Set()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const id = detailText(entry.id)
    if (id === '' || !allowed.has(id) || seen.has(id)) continue
    seen.add(id)
    details.push({
      id,
      name: detailText(entry.name) || id,
      contextLength: detailNumber(entry.contextLength),
      promptPrice: detailNumber(entry.promptPrice),
      completionPrice: detailNumber(entry.completionPrice),
      created: detailNumber(entry.created),
    })
    if (details.length >= MAX_ENDPOINT_MODELS) break
  }
  return details
}

export function modelPinsProblem(value) {
  if (!Array.isArray(value) || value.length > MAX_MODEL_PINS) return PIN_PROBLEM
  for (const pin of value) {
    if (typeof pin !== 'string') return PIN_PROBLEM
    const text = pin.trim()
    if (text === '' || text.length > MAX_MODEL_DETAIL_TEXT) return PIN_PROBLEM
  }
  return null
}

export function cleanModelPins(value) {
  const pins = []
  const seen = new Set()
  for (const pin of Array.isArray(value) ? value : []) {
    if (typeof pin !== 'string') continue
    const text = pin.trim()
    if (text === '' || text.length > MAX_MODEL_DETAIL_TEXT || seen.has(text)) continue
    seen.add(text)
    pins.push(text)
    if (pins.length >= MAX_MODEL_PINS) break
  }
  return pins
}

export function readModelPins(runsFolder) {
  if (typeof runsFolder !== 'string' || runsFolder.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(modelPinsFile(runsFolder), 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.pins) ? parsed.pins : []
  return cleanModelPins(list)
}

export function saveModelPins(runsFolder, pins, { rename = renameSync } = {}) {
  const file = modelPinsFile(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify({ pins: cleanModelPins(pins) }, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function cleanEndpoint(draft) {
  const models = []
  const seen = new Set()
  for (const model of draft.models) {
    const id = model.trim()
    if (seen.has(id)) continue
    seen.add(id)
    models.push(id)
  }
  const provider = draft.provider.trim()
  const preset = PROVIDERS.find((item) => item.name === provider)
  const baseUrl = preset && preset.name !== 'Custom'
    ? preset.baseUrl
    : parseBaseUrl(draft.baseUrl).url.toString().replace(/\/+$/, '')
  return {
    name: draft.name.trim(),
    provider,
    baseUrl,
    keyName: typeof draft.keyName === 'string' ? draft.keyName.trim() : '',
    models,
    modelDetails: cleanModelDetails(draft.modelDetails, models),
  }
}

export function readEndpoints(runsFolder) {
  if (typeof runsFolder !== 'string' || runsFolder.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(endpointsFile(runsFolder), 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.endpoints) ? parsed.endpoints : []
  const endpoints = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (endpointProblem(entry) !== null) continue
    endpoints.push(cleanEndpoint(entry))
    if (endpoints.length >= MAX_ENDPOINTS) break
  }
  return endpoints
}

export function saveEndpoints(runsFolder, endpoints, { rename = renameSync } = {}) {
  const file = endpointsFile(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify({ endpoints: endpoints.map((entry) => ({ ...entry, models: [...entry.models], modelDetails: Array.isArray(entry.modelDetails) ? entry.modelDetails.map((detail) => ({ ...detail })) : [] })) }, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function resolveEndpoint(runsFolder, name) {
  const wanted = typeof name === 'string' ? name.trim() : ''
  if (wanted === '') return null
  return readEndpoints(runsFolder).find((entry) => entry.name === wanted) ?? null
}

export function endpointModelDetails(runsFolder, endpointName = '') {
  const endpoints = readEndpoints(runsFolder)
  if (!endpointName) return endpoints
  return endpoints.find((entry) => entry.name === endpointName) ?? null
}

export async function readEndpointKey(runsFolder, keyName) {
  const name = typeof keyName === 'string' ? keyName.trim() : ''
  if (name === '') return ''
  return keyFromFile(runsFolder, name)
}

export async function writeEndpointKey(runsFolder, keyName, value) {
  const name = typeof keyName === 'string' ? keyName.trim() : ''
  if (name === '') return false
  try {
    writeKey(runsFolder, name, value)
    return true
  } catch {
    return false
  }
}

export function quickEndpointName(provider) {
  const text = typeof provider === 'string' ? provider.trim() : ''
  return text.replace(/[^A-Za-z0-9 _-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}

async function fetchEndpointModelList(endpoint, key, { fetchImpl, timeoutMs }) {
  const headers = { accept: 'application/json' }
  if (key !== '') headers.authorization = `Bearer ${key}`
  let response
  try {
    response = await fetchImpl(`${endpoint.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return { status: timedOut ? 504 : 502, error: timedOut ? MODELS_TIMEOUT_PROBLEM : MODELS_FAILED_PROBLEM }
  }
  if (!response.ok) return { status: 502, error: MODELS_FAILED_PROBLEM }
  let data
  try {
    data = await response.json()
  } catch {
    return { status: 502, error: MODELS_JSON_PROBLEM }
  }
  return { models: modelIdsFromAnswer(data), modelDetails: modelDetailsFromAnswer(data) }
}

function modelListFromAnswer(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.models)) return data.models
  return []
}

function modelDetailFromItem(item) {
  const raw = typeof item === 'string' ? { id: item } : item && typeof item === 'object' && !Array.isArray(item) ? item : null
  if (!raw) return null
  const id = detailText(raw.id)
  if (id === '') return null
  const pricing = raw.pricing && typeof raw.pricing === 'object' && !Array.isArray(raw.pricing) ? raw.pricing : {}
  return {
    id,
    name: detailText(raw.name) || id,
    contextLength: detailNumber(raw.context_length ?? raw.contextLength),
    promptPrice: detailNumber(pricing.prompt ?? pricing.input),
    completionPrice: detailNumber(pricing.completion ?? pricing.output),
    created: detailNumber(raw.created),
  }
}

export function modelDetailsFromAnswer(data) {
  const details = []
  for (const item of modelListFromAnswer(data)) {
    const detail = modelDetailFromItem(item)
    if (!detail) continue
    details.push(detail)
    if (details.length >= MAX_ENDPOINT_MODELS) break
  }
  return details
}

export function modelIdsFromAnswer(data) {
  const ids = []
  for (const item of modelListFromAnswer(data)) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : ''
    if (id.trim() !== '') ids.push(id.trim())
    if (ids.length >= MAX_ENDPOINT_MODELS) break
  }
  return ids
}

export function createEndpointsApi(options = {}) {
  const runsDir = options.runsFolder ?? ''
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? MODELS_TIMEOUT_MS
  const readKey = options.readKey ?? readEndpointKey

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)

    if (path === '/api/providers') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      sendJson(req, res, 200, PROVIDERS.map((entry) => ({ ...entry })))
      return true
    }

    if (path === '/api/endpoints') {
      if (method === 'GET') {
        sendJson(req, res, 200, { endpoints: readEndpoints(runsDir), max: MAX_ENDPOINTS })
        return true
      }
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: SAVE_ORIGIN_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: SAVE_CONFIRM_PROBLEM })
        return true
      }
      const problem = endpointProblem(body)
      if (problem !== null) {
        sendJson(req, res, 400, { error: problem })
        return true
      }
      const endpoints = readEndpoints(runsDir)
      const draftName = typeof body.name === 'string' ? body.name.trim() : ''
      const savedEndpoint = endpoints.find((entry) => entry.name === draftName)
      const draft = savedEndpoint && !Array.isArray(body.modelDetails)
        ? { ...body, modelDetails: savedEndpoint.modelDetails }
        : body
      const endpoint = cleanEndpoint(draft)
      const index = endpoints.findIndex((entry) => entry.name === endpoint.name)
      if (index === -1 && endpoints.length >= MAX_ENDPOINTS) {
        sendJson(req, res, 400, { error: TOO_MANY_PROBLEM })
        return true
      }
      if (index === -1) endpoints.push(endpoint)
      else endpoints[index] = endpoint
      saveEndpoints(runsDir, endpoints)
      if (typeof notify === 'function') notify({ topic: 'endpoints' })
      sendJson(req, res, 200, { endpoint, endpoints })
      return true
    }

    if (path === '/api/endpoints/quick') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: QUICK_ORIGIN_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: QUICK_CONFIRM_PROBLEM })
        return true
      }
      const providerName = typeof body.provider === 'string' ? body.provider.trim() : ''
      const preset = PROVIDERS.find((entry) => entry.name === providerName)
      if (!preset) {
        sendJson(req, res, 400, { error: PROVIDER_PROBLEM })
        return true
      }
      const key = typeof body.key === 'string' ? body.key : ''
      if (key.length < 1 || key.length > 500) {
        sendJson(req, res, 400, { error: QUICK_KEY_PROBLEM })
        return true
      }
      const targetName = typeof body.name === 'string' ? body.name.trim() : ''
      if (targetName !== '') {
        if (!ENDPOINT_NAME_PATTERN.test(targetName)) {
          sendJson(req, res, 400, { error: NAME_PROBLEM })
          return true
        }
        if (preset.baseUrl === '') {
          sendJson(req, res, 400, { error: REPLACE_KEY_PROVIDER_PROBLEM })
          return true
        }
        const endpoints = readEndpoints(runsDir)
        const existing = endpoints.find((entry) => entry.name === targetName)
        if (!existing) {
          sendJson(req, res, 404, { error: ENDPOINT_NOT_FOUND_PROBLEM })
          return true
        }
        if (existing.provider !== providerName) {
          sendJson(req, res, 400, { error: REPLACE_KEY_PROVIDER_PROBLEM })
          return true
        }
        const keyName = typeof body.keyName === 'string' ? body.keyName.trim() : ''
        if (keyName === '' || keyName !== existing.keyName) {
          sendJson(req, res, 400, { error: REPLACE_KEY_SLOT_PROBLEM })
          return true
        }
        if (endpoints.some((entry) => entry.name !== existing.name && entry.keyName === keyName)) {
          sendJson(req, res, 400, { error: REPLACE_KEY_SHARED_PROBLEM })
          return true
        }
        const savedKey = await writeEndpointKey(runsDir, keyName, key)
        if (!savedKey) {
          sendJson(req, res, 500, { error: QUICK_KEY_SAVE_PROBLEM })
          return true
        }
        if (typeof notify === 'function') notify({ topic: 'family' })
        sendJson(req, res, 200, {
          endpoint: {
            name: existing.name,
            provider: existing.provider,
            baseUrl: existing.baseUrl,
            keyName,
            models: existing.models.length,
          },
        })
        return true
      }
      const name = quickEndpointName(providerName)
      if (!ENDPOINT_NAME_PATTERN.test(name)) {
        sendJson(req, res, 400, { error: NAME_PROBLEM })
        return true
      }
      const endpoints = readEndpoints(runsDir)
      const index = endpoints.findIndex((entry) => entry.name === name)
      if (index === -1 && endpoints.length >= MAX_ENDPOINTS) {
        sendJson(req, res, 400, { error: TOO_MANY_PROBLEM })
        return true
      }
      const existing = index === -1 ? null : endpoints[index]
      const providerSlot = name
      let keyName = providerSlot
      if (existing && typeof existing.keyName === 'string' && existing.keyName.trim() !== '') {
        const slot = existing.keyName.trim()
        const isSlotShared = endpoints.some((entry) => entry.name !== existing.name && entry.keyName === slot)
        if (!isSlotShared) {
          keyName = slot
        }
      }
      const draft = {
        name,
        provider: providerName,
        baseUrl: preset.baseUrl,
        keyName,
        models: existing ? [...existing.models] : [],
        modelDetails: existing ? [...existing.modelDetails] : [],
      }
      const problem = endpointProblem(draft)
      if (problem !== null) {
        sendJson(req, res, 400, { error: problem })
        return true
      }
      const savedKey = await writeEndpointKey(runsDir, keyName, key)
      if (!savedKey) {
        sendJson(req, res, 500, { error: QUICK_KEY_SAVE_PROBLEM })
        return true
      }
      const endpoint = cleanEndpoint(draft)
      if (index === -1) endpoints.push(endpoint)
      else endpoints[index] = endpoint
      saveEndpoints(runsDir, endpoints)
      if (typeof notify === 'function') {
        notify({ topic: 'family' })
        notify({ topic: 'endpoints' })
      }
      const fetched = await fetchEndpointModelList(endpoint, key, { fetchImpl, timeoutMs })
      if (Array.isArray(fetched.modelDetails)) {
        const seen = new Set()
        const models = []
        const details = []
        for (const detail of fetched.modelDetails) {
          if (seen.has(detail.id)) continue
          seen.add(detail.id)
          models.push(detail.id)
          details.push(detail)
          if (models.length >= MAX_ENDPOINT_MODELS) break
        }
        endpoint.models = models
        endpoint.modelDetails = details
        saveEndpoints(runsDir, endpoints)
      }
      const answer = {
        endpoint: {
          name: endpoint.name,
          provider: endpoint.provider,
          baseUrl: endpoint.baseUrl,
          keyName: endpoint.keyName,
          models: endpoint.models.length,
        },
      }
      if (fetched.error) answer.error = fetched.error
      sendJson(req, res, 200, answer)
      return true
    }

    const modelsMatch = /^\/api\/endpoints\/([^/]+)\/models$/.exec(path)
    if (modelsMatch) {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const name = decodeURIComponent(modelsMatch[1])
      const endpoint = resolveEndpoint(runsDir, name)
      if (!endpoint) {
        sendJson(req, res, 404, { error: ENDPOINT_NOT_FOUND_PROBLEM })
        return true
      }
      let key = ''
      if (endpoint.keyName !== '') {
        key = await readKey(runsDir, endpoint.keyName)
        if (typeof key !== 'string' || key.trim() === '') {
          sendJson(req, res, 400, { error: NO_KEY_PROBLEM })
          return true
        }
      }
      const fetched = await fetchEndpointModelList(endpoint, key, { fetchImpl, timeoutMs })
      if (fetched.error) {
        sendJson(req, res, fetched.status, { error: fetched.error })
        return true
      }
      sendJson(req, res, 200, { models: fetched.models, modelDetails: fetched.modelDetails })
      return true
    }

    const deleteMatch = /^\/api\/endpoints\/([^/]+)\/delete$/.exec(path)
    if (deleteMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: DELETE_ORIGIN_PROBLEM })
        return true
      }
      const name = decodeURIComponent(deleteMatch[1])
      const endpoints = readEndpoints(runsDir)
      const index = endpoints.findIndex((entry) => entry.name === name)
      if (index === -1) {
        sendJson(req, res, 404, { error: ENDPOINT_NOT_FOUND_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: DELETE_CONFIRM_PROBLEM })
        return true
      }
      endpoints.splice(index, 1)
      saveEndpoints(runsDir, endpoints)
      if (typeof notify === 'function') notify({ topic: 'endpoints' })
      sendJson(req, res, 200, { ok: true, deleted: name, endpoints })
      return true
    }

    return false
  }

  return { handle }
}

export function createModelPinsApi(options = {}) {
  const runsDir = options.runsFolder ?? ''
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody

  async function handle(req, res, url) {
    if (url.pathname !== '/api/model-pins') return false
    const method = req.method ?? 'GET'

    if (method === 'GET') {
      sendJson(req, res, 200, { pins: readModelPins(runsDir) })
      return true
    }

    if (method !== 'PUT') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    if (!req.headers.origin) {
      sendJson(req, res, 403, { error: PIN_ORIGIN_PROBLEM })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    const problem = modelPinsProblem(body.pins)
    if (problem !== null) {
      sendJson(req, res, 400, { error: problem })
      return true
    }

    const pins = cleanModelPins(body.pins)
    saveModelPins(runsDir, pins)
    sendJson(req, res, 200, { ok: true, pins })
    return true
  }

  return { handle }
}
