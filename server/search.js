import { lookup as dnsLookup } from 'node:dns/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, join } from 'node:path'

export const SEARCH_PROVIDERS = ['searxng', 'tavily', 'brave', 'duckduckgo']
export const SEARCH_OFF = 'Web search is off. Pick a provider in Settings.'
export const SEARCH_ORIGIN_PROBLEM = 'A request with no Origin cannot set web search.'
export const SEARCH_CONFIRM_PROBLEM = 'Confirm web search first.'
export const SEARCH_PROVIDER_PROBLEM = 'Pick SearXNG, Tavily, Brave, DuckDuckGo or Off.'
export const SEARCH_URL_PROBLEM = 'The SearXNG address must be an http or https address.'
export const SEARCH_KEY_PROBLEM = 'A key slot name holds 1 to 40 letters, digits, spaces, - or _.'
export const SEARCH_SAVE_PROBLEM = 'The bridge could not save the web search provider.'
export const METHOD_PROBLEM = 'Method not allowed.'
export const SEARCH_TIMEOUT_MS = 20000
export const FETCH_TIMEOUT_MS = 20000
export const FETCH_BYTES = 1024 * 1024
export const FETCH_CHARS = 20000
export const MAX_REDIRECTS = 3
export const MAX_RESULTS = 8

export const SEARCH_ENDPOINTS = {
  tavily: 'https://api.tavily.com/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
  duckduckgo: 'https://html.duckduckgo.com/html/',
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const BLOCKED_NAMES = new Set(['localhost'])
const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
])

export function searchFileFor(runsFolder) {
  return join(runsFolder || '.', 'search.json')
}

export function searchChoice(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const provider = typeof raw.provider === 'string' ? raw.provider.trim().toLowerCase() : ''
  if (!SEARCH_PROVIDERS.includes(provider)) return { provider: '', url: '', keyName: '' }
  return {
    provider,
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    keyName: typeof raw.keyName === 'string' ? raw.keyName.trim() : '',
  }
}

export function readSearchChoice(runsFolder) {
  try {
    return searchChoice(JSON.parse(readFileSync(searchFileFor(runsFolder), 'utf8')))
  } catch {
    return { provider: '', url: '', keyName: '' }
  }
}

export function writeSearchChoice(runsFolder, choice) {
  const file = searchFileFor(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(choice, null, 2)}\n`)
}

export function httpAddress(value) {
  try {
    const parsed = new URL(String(value ?? '').trim())
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
  } catch {
    return false
  }
}

export function cleanSearchChoice(body) {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const provider = typeof raw.provider === 'string' ? raw.provider.trim().toLowerCase() : ''
  if (provider !== '' && !SEARCH_PROVIDERS.includes(provider)) return { problem: SEARCH_PROVIDER_PROBLEM }
  if (provider === '') return { choice: { provider: '', url: '', keyName: '' } }
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (provider === 'searxng' && url === '') return { problem: SEARCH_URL_PROBLEM }
  if (url !== '' && !httpAddress(url)) return { problem: SEARCH_URL_PROBLEM }
  const keyName = typeof raw.keyName === 'string' ? raw.keyName.trim() : ''
  if (keyName !== '' && !/^[A-Za-z0-9 _-]{1,40}$/.test(keyName)) return { problem: SEARCH_KEY_PROBLEM }
  const names = provider === 'tavily' || provider === 'brave'
  return {
    choice: {
      provider,
      url,
      keyName: names ? keyName : '',
    },
  }
}

export function createSearchApi({ runsFolder = '', sendJson, readJsonBody } = {}) {
  async function handle(req, res, url) {
    if (url.pathname !== '/api/search-provider') return false
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      sendJson(req, res, 200, readSearchChoice(runsFolder))
      return true
    }
    if (method !== 'POST') {
      sendJson(req, res, 405, { error: METHOD_PROBLEM })
      return true
    }
    if (!req.headers.origin) {
      sendJson(req, res, 403, { error: SEARCH_ORIGIN_PROBLEM })
      return true
    }
    const body = await readJsonBody(req, res)
    if (body === null) return true
    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: SEARCH_CONFIRM_PROBLEM })
      return true
    }
    const cleaned = cleanSearchChoice(body)
    if (cleaned.problem) {
      sendJson(req, res, 400, { error: cleaned.problem })
      return true
    }
    try {
      writeSearchChoice(runsFolder, cleaned.choice)
    } catch {
      sendJson(req, res, 500, { error: SEARCH_SAVE_PROBLEM })
      return true
    }
    sendJson(req, res, 200, cleaned.choice)
    return true
  }

  return { handle }
}

export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    const lower = String(code).toLowerCase()
    if (NAMED_ENTITIES.has(lower)) return NAMED_ENTITIES.get(lower)
    if (lower.startsWith('#x')) {
      const number = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole
    }
    if (lower.startsWith('#')) {
      const number = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole
    }
    return whole
  })
}

export function cleanText(value, limit = 500) {
  const text = decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, limit)
}

export function htmlToText(html) {
  let text = String(html ?? '')
  text = text.replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/?(?:p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol)\b[^>]*>/gi, '\n')
  text = text.replace(/<[^>]*>/g, ' ')
  text = decodeEntities(text)
  text = text.replace(/\r/g, '')
  text = text.replace(/[ \t\f\v]+/g, ' ')
  text = text.replace(/ *\n */g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function ipv4Problem(address) {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return 'The page address is not public.'
  }
  const [a, b, c] = parts
  const blocked =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  return blocked ? `The address ${address} is not public.` : ''
}

function ipv6Bytes(address) {
  let text = address.split('%')[0].toLowerCase()
  if (!text.includes(':')) return null
  if (text.includes('.')) {
    const at = text.lastIndexOf(':')
    const tail = text.slice(at + 1).split('.').map((part) => Number(part))
    if (tail.length !== 4 || tail.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
    const high = ((tail[0] << 8) | tail[1]).toString(16)
    const low = ((tail[2] << 8) | tail[3]).toString(16)
    text = `${text.slice(0, at)}:${high}:${low}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (halves.length === 1 && missing !== 0) return null
  if (halves.length === 2 && missing < 0) return null
  const parts = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
  if (parts.length !== 8) return null
  const bytes = []
  for (const part of parts) {
    const number = Number.parseInt(part || '0', 16)
    if (!Number.isFinite(number) || number < 0 || number > 0xffff) return null
    bytes.push(number >> 8, number & 0xff)
  }
  return bytes
}

function ipv6Problem(address) {
  const bytes = ipv6Bytes(address)
  if (!bytes) return 'The page address is not public.'
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (mapped) return ipv4Problem(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`)
  const zero = bytes.every((byte) => byte === 0)
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80
  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc
  const multicast = bytes[0] === 0xff
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8
  if (zero || loopback || linkLocal || uniqueLocal || multicast || documentation) {
    return `The address ${address} is not public.`
  }
  return ''
}

export function addressProblem(value) {
  const address = String(value ?? '').trim()
  const family = isIP(address)
  if (family === 4) return ipv4Problem(address)
  if (family === 6) return ipv6Problem(address)
  return 'The page address is not public.'
}

export async function publicHostProblem(hostname, lookup = dnsLookup) {
  const name = String(hostname ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (name === '') return 'The page address is empty.'
  if (BLOCKED_NAMES.has(name) || name.endsWith('.localhost')) return 'The page address is not public.'
  if (isIP(name)) return addressProblem(name)
  let addresses
  try {
    addresses = await lookup(name, { all: true, verbatim: true })
  } catch {
    return 'The page address could not be resolved.'
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return 'The page address could not be resolved.'
  for (const entry of addresses) {
    const address = typeof entry === 'string' ? entry : entry?.address
    const problem = addressProblem(address)
    if (problem) return problem
  }
  return ''
}

async function readLimited(response, maxBytes = FETCH_BYTES) {
  const reader = response.body?.getReader?.()
  if (!reader) return { buffer: Buffer.alloc(0), truncated: false }
  const chunks = []
  let total = 0
  let truncated = false
  for (;;) {
    let chunk
    try {
      chunk = await reader.read()
    } catch {
      break
    }
    if (chunk.done) break
    const value = chunk.value
    const room = maxBytes - total
    const used = Math.min(value.length, Math.max(0, room))
    if (used > 0) {
      chunks.push(Buffer.from(value.buffer, value.byteOffset, used))
      total += used
    }
    if (used < value.length || total >= maxBytes) {
      truncated = true
      try {
        await reader.cancel()
      } catch {}
      break
    }
  }
  return { buffer: Buffer.concat(chunks), truncated }
}

function timeoutText(timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

export async function fetchPage(rawUrl, {
  fetchImpl = fetch,
  checkHost = publicHostProblem,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = FETCH_BYTES,
  maxChars = FETCH_CHARS,
} = {}) {
  let target
  try {
    target = new URL(String(rawUrl ?? '').trim())
  } catch {
    return { url: '', text: '', truncated: false, error: 'That is not a web address.' }
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { url: target.href, text: '', truncated: false, error: 'Only http and https pages can be fetched.' }
  }
  const deadline = Date.now() + Math.max(1, timeoutMs)
  let redirects = 0
  for (;;) {
    const hostProblem = await checkHost(target.hostname)
    if (hostProblem) return { url: target.href, text: '', truncated: false, error: hostProblem }
    let response
    try {
      response = await fetchImpl(target.href, {
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'user-agent': 'MachineRoom/0.1',
        },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return { url: target.href, text: '', truncated: false, error: `The page took longer than ${timeoutText(timeoutMs)}.` }
      }
      return { url: target.href, text: '', truncated: false, error: 'The page could not be reached.' }
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      try {
        await response.body?.cancel?.()
      } catch {}
      if (redirects >= MAX_REDIRECTS) {
        return { url: target.href, text: '', truncated: false, error: `The page redirected more than ${MAX_REDIRECTS} times.` }
      }
      const location = response.headers.get('location')
      if (!location) return { url: target.href, text: '', truncated: false, error: 'The page redirected without an address.' }
      let next
      try {
        next = new URL(location, target)
      } catch {
        return { url: target.href, text: '', truncated: false, error: 'The page redirected to an address that is not valid.' }
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { url: target.href, text: '', truncated: false, error: 'The page redirected to an address that is not http or https.' }
      }
      redirects += 1
      target = next
      continue
    }
    if (!response.ok) {
      try {
        await response.body?.cancel?.()
      } catch {}
      return { url: target.href, text: '', truncated: false, error: `The page answered ${response.status}.` }
    }
    const { buffer, truncated } = await readLimited(response, maxBytes)
    const type = String(response.headers.get('content-type') ?? '')
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    const plain = /html/i.test(type) ? htmlToText(decoded) : decoded.replace(/\r\n?/g, '\n')
    const text = plain.slice(0, maxChars)
    return { url: target.href, text, truncated: truncated || plain.length > maxChars, error: '' }
  }
}

function valueAttribute(tag, name) {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(String(tag ?? ''))
  if (!match) return ''
  return decodeEntities(match[1] ?? match[2] ?? '').trim()
}

function duckDuckGoTarget(href) {
  let value = decodeEntities(String(href ?? '').trim())
  if (value === '') return ''
  if (value.startsWith('//')) value = `https:${value}`
  try {
    const parsed = new URL(value, 'https://duckduckgo.com')
    const target = parsed.searchParams.get('uddg')
    if (target) return httpAddress(target) ? target : ''
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

export function parseDuckDuckGo(html) {
  const text = String(html ?? '')
  const anchorPattern = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>[\s\S]*?<\/a>/gi
  const results = []
  let match
  while (results.length < MAX_RESULTS && (match = anchorPattern.exec(text)) !== null) {
    const anchor = match[0]
    const href = valueAttribute(anchor, 'href')
    const url = duckDuckGoTarget(href)
    if (!url) continue
    const rest = text.slice(match.index + anchor.length)
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i.exec(rest)
    results.push({
      title: cleanText(anchor.replace(/^<a\b[^>]*>|<\/a>$/gi, ''), 300) || url,
      url,
      snippet: cleanText(snippetMatch?.[1] ?? '', 500),
    })
  }
  return results
}

function cleanResults(items, keys) {
  const results = []
  for (const item of Array.isArray(items) ? items : []) {
    if (results.length >= MAX_RESULTS) break
    const url = String(item?.[keys.url] ?? '').trim()
    if (!httpAddress(url)) continue
    results.push({
      title: cleanText(item?.[keys.title], 300) || url,
      url,
      snippet: cleanText(item?.[keys.snippet], 500),
    })
  }
  return results
}

function providerError(status) {
  return new Error(`The search provider answered ${status}.`)
}

async function requestWithTimeout(target, init, fetchImpl, timeoutMs) {
  const headers = { 'user-agent': 'MachineRoom/0.1', ...(init?.headers ?? {}) }
  try {
    return await fetchImpl(target, { ...init, headers, signal: AbortSignal.timeout(Math.max(1, timeoutMs)) })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`The search provider took longer than ${timeoutText(timeoutMs)}.`)
    }
    throw new Error('The search provider could not be reached.')
  }
}

async function requestJson(target, init, fetchImpl, timeoutMs) {
  const response = await requestWithTimeout(target, init, fetchImpl, timeoutMs)
  if (!response.ok) throw providerError(response.status)
  let body
  try {
    body = await response.text()
  } catch {
    throw new Error('The search provider answer could not be read.')
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('The search provider answer was not JSON.')
  }
}

async function requestText(target, init, fetchImpl, timeoutMs) {
  const response = await requestWithTimeout(target, init, fetchImpl, timeoutMs)
  if (!response.ok) throw providerError(response.status)
  try {
    return await response.text()
  } catch {
    throw new Error('The search provider answer could not be read.')
  }
}

function searxngTarget(base) {
  const parsed = new URL(base)
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${path}`
}

async function searxngSearch(choice, query, { fetchImpl, timeoutMs }) {
  if (!httpAddress(choice.url)) throw new Error(SEARCH_URL_PROBLEM)
  const target = `${searxngTarget(choice.url)}/search?format=json&q=${encodeURIComponent(query)}`
  const data = await requestJson(target, { headers: { accept: 'application/json' } }, fetchImpl, timeoutMs)
  return cleanResults(data?.results, { title: 'title', url: 'url', snippet: 'content' })
}

async function tavilySearch(choice, query, { fetchImpl, timeoutMs, endpoints }) {
  if (choice.key === '') throw new Error('Set a key for Tavily in Settings.')
  const data = await requestJson(
    endpoints.tavily,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${choice.key}`,
      },
      body: JSON.stringify({ api_key: choice.key, query, max_results: MAX_RESULTS, search_depth: 'basic' }),
    },
    fetchImpl,
    timeoutMs
  )
  return cleanResults(data?.results, { title: 'title', url: 'url', snippet: 'content' })
}

async function braveSearch(choice, query, { fetchImpl, timeoutMs, endpoints }) {
  if (choice.key === '') throw new Error('Set a key for Brave in Settings.')
  const target = `${endpoints.brave}?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`
  const data = await requestJson(
    target,
    {
      headers: {
        accept: 'application/json',
        'x-subscription-token': choice.key,
      },
    },
    fetchImpl,
    timeoutMs
  )
  return cleanResults(data?.web?.results, { title: 'title', url: 'url', snippet: 'description' })
}

async function duckDuckGoSearch(query, { fetchImpl, timeoutMs, endpoints }) {
  const target = `${endpoints.duckduckgo}?q=${encodeURIComponent(query)}`
  const html = await requestText(target, { headers: { accept: 'text/html' } }, fetchImpl, timeoutMs)
  return parseDuckDuckGo(html)
}

export function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) return 'No results.'
  return results
    .slice(0, MAX_RESULTS)
    .map((item, index) => `${index + 1}. ${item.title}\n${item.url}${item.snippet ? `\n${item.snippet}` : ''}`)
    .join('\n\n')
}

export async function searchWeb(query, {
  choice = { provider: '', url: '', keyName: '' },
  key = '',
  fetchImpl = fetch,
  timeoutMs = SEARCH_TIMEOUT_MS,
  endpoints = SEARCH_ENDPOINTS,
} = {}) {
  const text = String(query ?? '').trim()
  if (text === '') {
    return { results: [], text: 'Write a search query.', error: 'Write a search query.' }
  }
  const cleaned = searchChoice(choice)
  if (cleaned.provider === '') return { results: [], text: SEARCH_OFF }
  const used = { ...cleaned, key: String(key ?? '') }
  try {
    let results
    if (used.provider === 'searxng') results = await searxngSearch(used, text, { fetchImpl, timeoutMs })
    else if (used.provider === 'tavily') results = await tavilySearch(used, text, { fetchImpl, timeoutMs, endpoints })
    else if (used.provider === 'brave') results = await braveSearch(used, text, { fetchImpl, timeoutMs, endpoints })
    else results = await duckDuckGoSearch(text, { fetchImpl, timeoutMs, endpoints })
    return { results, text: formatSearchResults(results) }
  } catch (error) {
    const message = String(error?.message ?? error)
    return { results: [], text: message, error: message }
  }
}
