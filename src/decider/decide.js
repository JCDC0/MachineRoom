import { buildRequest, DEFAULT_URL, parseAnswers } from './wire.js'

const REFUSED = 'The key was refused. Check the key and that the Decisions API is open to it.'

const STATUS_TEXT = {
  400: ['bad_request', 'The request was refused as malformed.'],
  401: ['unauthorized', REFUSED],
  402: ['payment', 'The account has no credit left for this call.'],
  403: ['unauthorized', REFUSED],
  404: ['not_found', 'The model or the Decisions API was not found.'],
  413: ['too_large', 'The request was too large.'],
  429: ['rate_limited', 'Too many requests. Try again in a moment.'],
}

const RETRY_KINDS = new Set(['timeout', 'network', 'rate_limited', 'server'])
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function sanitize(text, key) {
  let clean = String(text ?? '')
  if (key) clean = clean.split(key).join('[key]')
  clean = clean.replace(/Bearer\s+\S+/gi, 'Bearer [key]')
  clean = clean.replace(/\b(sk|pk)-[A-Za-z0-9_-]{8,}/g, '[key]')
  return clean.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function failure(kind, error, extra = {}) {
  return { ok: false, kind, error, ...extra }
}

function classify(status, body, key) {
  const known = STATUS_TEXT[status]
  if (known) return failure(known[0], known[1], { status })
  if (status >= 500) {
    const detail = sanitize(body?.error?.message, key)
    return failure('server', detail ? `The service failed: ${detail}` : 'The service failed.', { status })
  }
  return failure('bad_request', `Unexpected status ${status}.`, { status })
}

async function attempt({ fetchImpl, url, key, payload, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (!response.ok) return { ...classify(response.status, body, key), retryAfter: response.headers?.get?.('retry-after') ?? null }
    const parsed = parseAnswers(body, payload.questions)
    if (!parsed.ok) return failure('bad_answer', parsed.error)
    return parsed
  } catch (error) {
    if (error?.name === 'AbortError') return failure('timeout', 'The decision model did not answer in time.')
    return failure('network', 'The decision model could not be reached.')
  } finally {
    clearTimeout(timer)
  }
}

export async function decide({
  fetch: fetchImpl = globalThis.fetch,
  url = DEFAULT_URL,
  key,
  model,
  state,
  questions,
  timeoutMs = 3000,
  retries = 1,
  sleep = sleepFor,
  now = Date.now,
}) {
  if (!key || typeof key !== 'string') return failure('no_key', 'No key is set for the decision model.')
  if (!model || typeof model !== 'string') return failure('bad_request', 'No model was named.')
  if (!questions || Object.keys(questions).length === 0) return failure('bad_request', 'No questions were given.')
  const payload = buildRequest({ model, state, questions })
  const started = now()
  let last = null
  for (let tries = 0; tries <= retries; tries += 1) {
    const result = await attempt({ fetchImpl, url, key, payload, timeoutMs })
    if (result.ok) return { ...result, ms: now() - started, attempts: tries + 1 }
    last = { ...result, ms: now() - started, attempts: tries + 1 }
    if (!RETRY_KINDS.has(result.kind) || tries === retries) break
    const wait = Number(result.retryAfter)
    await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 2000) : 250 * (tries + 1))
  }
  delete last.retryAfter
  return last
}
