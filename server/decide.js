import { decide } from '../src/decider/decide.js'

export const DEFAULT_DECISION_MODEL = 'typesafe/jev-1.14'
export const DECIDE_BODY_LIMIT = 32 * 1024

function validState(state) {
  return typeof state === 'string' || (state !== null && typeof state === 'object')
}

function validQuestions(questions) {
  return questions !== null && typeof questions === 'object' && !Array.isArray(questions) && Object.keys(questions).length > 0
}

function modelFor(body, env) {
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !body.model.trim()) return null
    return body.model.trim()
  }
  const configured = typeof env.DECISION_MODEL === 'string' ? env.DECISION_MODEL.trim() : ''
  return configured || DEFAULT_DECISION_MODEL
}

export function createDecideApi({ sendJson, readJsonBody, env = process.env, decideUrl, timeoutMs, log = (line) => console.log(line) } = {}) {
  async function handle(req, res, url) {
    if (url.pathname !== '/api/decide') return false
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Use POST for a decision.' })
      return true
    }
    const body = await readJsonBody(req, res, DECIDE_BODY_LIMIT)
    if (body === null) return true
    if (!validState(body.state)) {
      sendJson(req, res, 400, { error: 'Send a state as text or an object.' })
      return true
    }
    if (!validQuestions(body.questions)) {
      sendJson(req, res, 400, { error: 'Send at least one question.' })
      return true
    }
    const model = modelFor(body, env)
    if (!model) {
      sendJson(req, res, 400, { error: 'The model must be a name.' })
      return true
    }
    const key = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY : ''
    const result = await decide({
      url: decideUrl,
      key,
      model,
      state: body.state,
      questions: body.questions,
      timeoutMs,
    })
    const names = Object.keys(body.questions)
    const ms = Number.isFinite(result.ms) ? result.ms : 0
    log(`decide ${model} [${names.join(', ')}] ${result.ok ? 'ok' : result.kind} ${ms}ms`)
    if (result.ok) {
      sendJson(req, res, 200, {
        ok: true,
        model: result.model ?? model,
        answers: result.answers,
        usage: result.usage,
        ms: result.ms,
        attempts: result.attempts,
      })
      return true
    }
    if (result.kind === 'no_key') {
      sendJson(req, res, 404, { error: result.error })
      return true
    }
    if (result.kind === 'rate_limited') {
      sendJson(req, res, 429, { error: result.error })
      return true
    }
    sendJson(req, res, 502, { error: result.error })
    return true
  }

  return { handle }
}
