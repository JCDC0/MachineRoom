import { interpret } from '../assistant/intent.js'
import { sanitize } from './decide.js'
import { NONE } from './questions.js'
import { parseAnswers } from './wire.js'

export const LLM_URL = 'https://openrouter.ai/api/v1/chat/completions'

export function rulesPredict(text, context) {
  const result = interpret(text, context)
  const action = result.action ?? null
  return {
    action: action ? action.type : 'unknown',
    agent: action ? (action.agent ?? action.assignee ?? NONE) : NONE,
    path: action?.path ?? NONE,
    tab: action?.tab ?? NONE,
    section: action?.section ?? NONE,
  }
}

function describe(name, question) {
  if (question.type === 'choice') {
    const options = Object.entries(question.criteria).map(([key, guide]) => `${key} = ${guide}`)
    return `- ${name} (choice): ${question.instructions} Options: ${options.join(' | ')}`
  }
  if (question.type === 'noul') {
    return `- ${name} (true or false): ${question.instructions} True means: ${question.criteria.true} False means: ${question.criteria.false}`
  }
  const levels = question.criteria.map((guide, index) => `${index} = ${guide}`)
  return `- ${name} (level): ${question.instructions} Levels: ${levels.join(' | ')}`
}

export function llmPrompt(state, questions) {
  return [
    'Answer each question about the text. Reply with one JSON object and nothing else.',
    'For a choice give one option key. For a true or false question give true or false. For a level give its number, counting from 0.',
    '',
    'Text:',
    state,
    '',
    'Questions:',
    ...Object.entries(questions).map(([name, question]) => describe(name, question)),
  ].join('\n')
}

function firstObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function toWire(raw, questions) {
  const answers = {}
  for (const [name, question] of Object.entries(questions)) {
    const value = raw?.[name]
    if (question.type === 'choice') answers[name] = { type: 'choice', choice: String(value) }
    else if (question.type === 'noul') answers[name] = { type: 'noul', noul: value === true || value === 'true' ? 1 : 0 }
    else answers[name] = { type: 'score', score: Number(value) }
  }
  return { answers }
}

export async function llmDecide({
  fetch: fetchImpl = globalThis.fetch,
  url = LLM_URL,
  key,
  model,
  state,
  questions,
  timeoutMs = 20000,
  now = Date.now,
}) {
  if (!key) return { ok: false, kind: 'no_key', error: 'No key is set for the language model.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = now()
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [{ role: 'user', content: llmPrompt(state, questions) }],
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (!response.ok) {
      return { ok: false, kind: 'server', error: sanitize(body?.error?.message ?? `Status ${response.status}.`, key), status: response.status, ms: now() - started }
    }
    const raw = firstObject(String(body?.choices?.[0]?.message?.content ?? ''))
    if (!raw) return { ok: false, kind: 'bad_answer', error: 'The reply was not a JSON object.', ms: now() - started }
    const parsed = parseAnswers(toWire(raw, questions), questions)
    if (!parsed.ok) return { ok: false, kind: 'bad_answer', error: parsed.error, ms: now() - started }
    const usage = body.usage ?? {}
    return {
      ok: true,
      answers: parsed.answers,
      usage: {
        inputTokens: Number(usage.prompt_tokens) || 0,
        outputTokens: Number(usage.completion_tokens) || 0,
        cost: Number.isFinite(usage.cost) ? usage.cost : null,
      },
      ms: now() - started,
      attempts: 1,
    }
  } catch (error) {
    const kind = error?.name === 'AbortError' ? 'timeout' : 'network'
    return { ok: false, kind, error: kind === 'timeout' ? 'The language model did not answer in time.' : 'The language model could not be reached.', ms: now() - started }
  } finally {
    clearTimeout(timer)
  }
}
