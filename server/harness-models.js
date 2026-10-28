import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { modelIdsFromAnswer, readEndpointKey, readEndpoints } from './endpoints.js'
import { readLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { MODELS } from './model-list.js'
import { endpointModels } from './models.js'
import { killTree } from './processTree.js'
import { programPath } from './programPath.js'

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const COMMAND_TIMEOUT_MS = 30000
export const MAX_OUTPUT_BYTES = 1024 * 1024
export const KNOWN_HARNESSES = ['claude', 'opencode', 'agy', 'acp', 'machineroom', 'codex', 'copilot', 'hermes']
export const OWNER_MODELS_PROBLEM = 'Only the owner can refresh the model list.'

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g

function pageRequest(req) {
  const headers = req.headers ?? {}
  if (headers.origin) return true
  return headers['sec-fetch-site'] === 'same-origin'
}

function runsFolderDefault() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs')
}

export function cacheFileFor(runsFolder) {
  return join(runsFolder, 'harness-models.json')
}

export function readHarnessModelsCache(runsFolder) {
  if (!runsFolder) return {}
  try {
    const text = readFileSync(cacheFileFor(runsFolder), 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function saveHarnessModelsCache(runsFolder, cache) {
  if (!runsFolder) return
  const file = cacheFileFor(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(cache, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    renameSync(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  }
}

export function saveCachedHarnessModels(runsFolder, harness, models, fetchedAt = new Date().toISOString()) {
  const cache = readHarnessModelsCache(runsFolder)
  cache[harness] = {
    harness,
    models: models.map((m) => ({ id: m.id, label: m.label || m.id })),
    fetchedAt,
  }
  saveHarnessModelsCache(runsFolder, cache)
}

export function modelAllowed(harness, id, runsFolder) {
  const modelId = typeof id === 'string' ? id.trim() : ''
  if (!modelId || typeof harness !== 'string' || !harness.trim()) return false

  const harnessKey = harness.trim()

  if (MODELS.some((m) => m.harness === harnessKey && m.id === modelId)) {
    return true
  }

  if (harnessKey === 'machineroom' && runsFolder) {
    if (endpointModels(runsFolder).some((m) => m.id === modelId)) {
      return true
    }
  }

  if (runsFolder) {
    const cache = readHarnessModelsCache(runsFolder)
    const entry = Object.hasOwn(cache, harnessKey) ? cache[harnessKey] : null
    if (entry && Array.isArray(entry.models)) {
      if (entry.models.some((m) => m.id === modelId)) {
        return true
      }
    }
  }

  return false
}

function expand(bin, env) {
  let missing = ''
  const text = String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') {
      missing = name
      return whole
    }
    return value
  })
  return { text, missing }
}

function isProgramFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function resolveHarnessProgram(harness, { lanes = {}, env = process.env, platform = process.platform } = {}) {
  const baseLanes = typeof lanes === 'function' ? lanes() : (lanes ?? {})
  let laneBin = null
  for (const lane of Object.values(baseLanes ?? {})) {
    if (lane?.cli?.harness === harness && typeof lane?.cli?.bin === 'string') {
      laneBin = lane.cli.bin
      break
    }
  }

  if (laneBin) {
    const { text, missing } = expand(laneBin, env)
    if (missing) return null
    if (isAbsolute(text) || text.includes('/') || text.includes('\\')) {
      if (isProgramFile(text)) return text
      if (platform === 'win32') {
        for (const ending of ['.exe', '.com']) {
          const withEnding = `${text}${ending}`
          if (isProgramFile(withEnding)) return withEnding
        }
      }
      return null
    }
    const endings = platform === 'win32' && !/\.(exe|com)$/i.test(text) ? [text, `${text}.exe`, `${text}.com`] : [text]
    for (const name of endings) {
      const found = programPath(name, { env, platform })
      if (found) return found
    }
    return null
  }

  const endings = platform === 'win32' && !/\.(exe|com)$/i.test(harness) ? [harness, `${harness}.exe`, `${harness}.com`] : [harness]
  for (const name of endings) {
    const found = programPath(name, { env, platform })
    if (found) return found
  }
  return null
}

export function runCommand(command, args, {
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxBytes = MAX_OUTPUT_BYTES,
  cwd,
  env = process.env,
  platform = process.platform,
} = {}) {
  return new Promise((resolveResult) => {
    let child = null
    let timedOut = false
    let timer = null
    const stdoutChunks = []
    let stdoutLen = 0

    const isNode = command.endsWith('.js') || command.endsWith('.mjs')
    const file = isNode ? process.execPath : command
    const spawnArgs = isNode ? [command, ...args] : args

    try {
      child = spawn(file, spawnArgs, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      })
    } catch {
      resolveResult({ ok: false, error: 'The command could not be started.', stdout: '' })
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree(child, { platform })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      if (stdoutLen < maxBytes) {
        const toTake = Math.min(chunk.length, maxBytes - stdoutLen)
        stdoutChunks.push(chunk.subarray(0, toTake))
        stdoutLen += toTake
      }
    })

    child.on('error', () => {
      if (timer) clearTimeout(timer)
      resolveResult({ ok: false, error: 'The command could not be started.', stdout: '' })
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut) {
        resolveResult({
          ok: false,
          timedOut: true,
          error: `The command timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          stdout: '',
        })
        return
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      if (code !== 0) {
        resolveResult({
          ok: false,
          exitCode: code,
          error: `The command failed with exit code ${code}.`,
          stdout,
        })
        return
      }
      resolveResult({ ok: true, stdout })
    })
  })
}

export function parseAgyModels(stdout) {
  const lines = stdout.split(/\r?\n/)
  const hasHeader = lines.some((l) => l.trim().startsWith('Fetching available models'))
  let pastHeader = !hasHeader
  const models = []
  const seen = new Set()

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (!pastHeader) {
      if (trimmed.startsWith('Fetching available models')) {
        pastHeader = true
      }
      continue
    }
    const parts = raw.split('\t')
    const id = parts[0]?.trim()
    const label = parts[1]?.trim() || id
    if (id && !seen.has(id)) {
      seen.add(id)
      models.push({ id, label })
    }
  }
  return models
}

export function parseOpencodeModels(stdout) {
  const models = []
  const seen = new Set()
  for (const raw of stdout.split(/\r?\n/)) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, label: id })
  }
  return models
}

export function parseHelpForListCommand(helpText) {
  if (/\bmodels\s+list\b/i.test(helpText)) return ['models', 'list']
  if (/\bmodel\s+list\b/i.test(helpText)) return ['model', 'list']
  if (/\blist-models\b/i.test(helpText)) return ['list-models']
  if (/\bmodels\b/i.test(helpText)) return ['models']
  if (/\bmodel\b/i.test(helpText)) return ['model']
  return null
}

export function parseCommandModels(stdout) {
  const models = []
  const seen = new Set()
  for (const raw of stdout.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    const parts = raw.includes('\t') ? raw.split('\t') : trimmed.split(/\s{2,}/)
    const id = parts[0]?.trim()
    const label = parts[1]?.trim() || id
    if (id && !seen.has(id)) {
      seen.add(id)
      models.push({ id, label })
    }
  }
  return models
}

export async function fetchLiveMachineroomModels(runsFolder, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const endpoints = readEndpoints(runsFolder)
  const endpointModelsList = []
  let anyError = null

  for (const endpoint of endpoints) {
    let key = ''
    if (endpoint.keyName) {
      key = await readEndpointKey(runsFolder, endpoint.keyName)
    }
    const headers = { accept: 'application/json' }
    if (key) headers.authorization = `Bearer ${key}`
    try {
      const response = await fetchImpl(`${endpoint.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        anyError = 'The endpoint did not answer its model list.'
        continue
      }
      const data = await response.json()
      const ids = modelIdsFromAnswer(data)
      for (const id of ids) {
        endpointModelsList.push({
          id: `${endpoint.name}/${id}`,
          label: `${id} (${endpoint.name})`,
        })
      }
    } catch {
      anyError = 'The endpoint did not answer its model list.'
    }
  }

  const staticModels = MODELS.filter((m) => m.harness === 'machineroom').map(({ id, label }) => ({ id, label }))
  const seen = new Set()
  const combined = []

  for (const item of [...endpointModelsList, ...staticModels]) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      combined.push(item)
    }
  }

  return { models: combined, error: endpointModelsList.length === 0 && endpoints.length > 0 ? anyError : null }
}

export async function getHarnessModels(harness, {
  refresh = false,
  runsFolder,
  lanes,
  env = process.env,
  platform = process.platform,
  timeoutMs = COMMAND_TIMEOUT_MS,
  fetchImpl = fetch,
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  const staticModels = MODELS.filter((m) => m.harness === harness).map(({ id, label }) => ({ id, label }))

  if (harness === 'claude' || harness === 'hermes' || harness === 'acp') {
    return {
      harness,
      models: staticModels,
      source: 'list',
      fetchedAt: new Date().toISOString(),
    }
  }

  if (!refresh && runsFolder) {
    const cache = readHarnessModelsCache(runsFolder)
    const entry = Object.hasOwn(cache, harness) ? cache[harness] : null
    if (entry && Array.isArray(entry.models) && entry.fetchedAt) {
      const age = Date.now() - new Date(entry.fetchedAt).getTime()
      if (age >= 0 && age < cacheTtlMs) {
        return {
          harness,
          models: entry.models,
          source: 'cache',
          fetchedAt: entry.fetchedAt,
        }
      }
    }
  }

  if (harness === 'machineroom') {
    const result = await fetchLiveMachineroomModels(runsFolder, { fetchImpl, timeoutMs: Math.min(timeoutMs, 10000) })
    const fetchedAt = new Date().toISOString()
    if (runsFolder && result.models.length > 0) {
      saveCachedHarnessModels(runsFolder, harness, result.models, fetchedAt)
    }
    return {
      harness,
      models: result.models,
      source: 'live',
      fetchedAt,
      ...(result.error ? { error: result.error } : {}),
    }
  }

  const program = resolveHarnessProgram(harness, { lanes, env, platform })
  if (!program) {
    return {
      harness,
      models: staticModels,
      source: 'list',
      fetchedAt: new Date().toISOString(),
      error: `The program for ${harness} was not found.`,
    }
  }

  let args = ['models']
  let parser = parseOpencodeModels

  if (harness === 'agy') {
    args = ['models']
    parser = parseAgyModels
  } else if (harness === 'opencode') {
    args = ['models']
    parser = parseOpencodeModels
  } else if (harness === 'codex' || harness === 'copilot') {
    const helpResult = await runCommand(program, ['--help'], { timeoutMs, env, platform })
    if (!helpResult.ok) {
      return {
        harness,
        models: staticModels,
        source: 'list',
        fetchedAt: new Date().toISOString(),
        error: helpResult.error || 'The command failed.',
      }
    }
    const listArgs = parseHelpForListCommand(helpResult.stdout)
    if (!listArgs) {
      return {
        harness,
        models: staticModels,
        source: 'list',
        fetchedAt: new Date().toISOString(),
        error: `The harness ${harness} has no model list command.`,
      }
    }
    args = listArgs
    parser = parseCommandModels
  }

  const cmdResult = await runCommand(program, args, { timeoutMs, env, platform })
  if (!cmdResult.ok) {
    return {
      harness,
      models: staticModels,
      source: 'list',
      fetchedAt: new Date().toISOString(),
      error: cmdResult.error || 'The command failed.',
    }
  }

  const parsed = parser(cmdResult.stdout)
  if (parsed.length === 0) {
    return {
      harness,
      models: staticModels,
      source: 'list',
      fetchedAt: new Date().toISOString(),
      error: 'The harness returned no models.',
    }
  }

  const fetchedAt = new Date().toISOString()
  if (runsFolder) {
    saveCachedHarnessModels(runsFolder, harness, parsed, fetchedAt)
  }

  return {
    harness,
    models: parsed,
    source: 'live',
    fetchedAt,
  }
}

export function createHarnessModelsApi(options = {}) {
  const runsDir = options.runsFolder ?? defaultRunsFolder()
  const lanes = options.lanes ?? (() => readLanes())
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS
  const sendJson = options.sendJson ?? ((req, res, status, body) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    })
    res.end(payload)
  })

  async function handle(req, res, url) {
    const match = /^\/api\/harnesses\/([^/]+)\/models$/.exec(url.pathname)
    if (!match) return false

    const method = req.method ?? 'GET'
    if (method !== 'GET') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }
    if (!pageRequest(req)) {
      sendJson(req, res, 403, { error: OWNER_MODELS_PROBLEM })
      return true
    }

    const harness = decodeURIComponent(match[1])
    if (!KNOWN_HARNESSES.includes(harness)) {
      sendJson(req, res, 404, { error: `The harness ${harness} was not found.` })
      return true
    }

    const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true'
    const result = await getHarnessModels(harness, {
      refresh,
      runsFolder: runsDir,
      lanes,
      env,
      platform,
      timeoutMs,
      fetchImpl,
      cacheTtlMs,
    })

    sendJson(req, res, 200, result)
    return true
  }

  return { handle }
}
