import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_ENDPOINTS = 20
export const MAX_ENDPOINT_MODELS = 50
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
export const MODELS_PROBLEM = 'Models must be a list of 0 to 50 ids.'
export const TOO_MANY_PROBLEM = 'At most 20 endpoints are allowed.'
export const ENDPOINT_NOT_FOUND_PROBLEM = 'The endpoint was not found.'
export const NO_KEY_PROBLEM = 'The key slot has no key.'
export const MODELS_FAILED_PROBLEM = 'The endpoint did not answer its model list.'
export const MODELS_TIMEOUT_PROBLEM = 'The endpoint did not answer within 10 seconds.'
export const MODELS_JSON_PROBLEM = 'The endpoint model list was not JSON.'

export function endpointsFile(runsFolder) {
  return join(runsFolder, 'endpoints.json')
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
  if (!PROVIDERS.some((item) => item.name === provider)) return PROVIDER_PROBLEM
  const parsed = parseBaseUrl(draft.baseUrl)
  if (parsed.problem) return parsed.problem
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

export function cleanEndpoint(draft) {
  const models = []
  const seen = new Set()
  for (const model of draft.models) {
    const id = model.trim()
    if (seen.has(id)) continue
    seen.add(id)
    models.push(id)
  }
  return {
    name: draft.name.trim(),
    provider: draft.provider.trim(),
    baseUrl: parseBaseUrl(draft.baseUrl).url.toString().replace(/\/+$/, ''),
    keyName: typeof draft.keyName === 'string' ? draft.keyName.trim() : '',
    models,
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

export function saveEndpoints(runsFolder, endpoints) {
  const file = endpointsFile(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify({ endpoints: endpoints.map((entry) => ({ ...entry, models: [...entry.models] })) }, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    renameSync(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  }
}

export function resolveEndpoint(runsFolder, name) {
  const wanted = typeof name === 'string' ? name.trim() : ''
  if (wanted === '') return null
  return readEndpoints(runsFolder).find((entry) => entry.name === wanted) ?? null
}

function keyFromFile(runsFolder, name) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(runsFolder, 'keys.json'), 'utf8'))
  } catch {
    return ''
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Object.hasOwn(parsed, name) && typeof parsed[name] === 'string') return parsed[name]
    const map = parsed.keys
    if (map && typeof map === 'object' && !Array.isArray(map) && Object.hasOwn(map, name) && typeof map[name] === 'string') return map[name]
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.keys) ? parsed.keys : []
  for (const entry of list) {
    if (entry && entry.name === name && typeof entry.value === 'string') return entry.value
  }
  return ''
}

export async function readEndpointKey(runsFolder, keyName) {
  const name = typeof keyName === 'string' ? keyName.trim() : ''
  if (name === '') return ''
  let family = null
  try {
    family = await import('./family.js')
  } catch {
    family = null
  }
  if (family && typeof family.readKey === 'function') {
    try {
      const value = await family.readKey(runsFolder, name)
      return typeof value === 'string' ? value : ''
    } catch {
      return ''
    }
  }
  return keyFromFile(runsFolder, name)
}

export function modelIdsFromAnswer(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : []
  const ids = []
  for (const item of list) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : ''
    if (id.trim() !== '') ids.push(id.trim())
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
      const endpoint = cleanEndpoint(body)
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
        sendJson(req, res, timedOut ? 504 : 502, { error: timedOut ? MODELS_TIMEOUT_PROBLEM : MODELS_FAILED_PROBLEM })
        return true
      }
      if (!response.ok) {
        sendJson(req, res, 502, { error: MODELS_FAILED_PROBLEM })
        return true
      }
      let data
      try {
        data = await response.json()
      } catch {
        sendJson(req, res, 502, { error: MODELS_JSON_PROBLEM })
        return true
      }
      sendJson(req, res, 200, { models: modelIdsFromAnswer(data) })
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
