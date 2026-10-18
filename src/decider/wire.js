export const DEFAULT_URL = 'https://openrouter.ai/api/alpha/decisions'

export const noul = (instructions, whenTrue, whenFalse) => ({
  type: 'noul',
  instructions,
  criteria: { true: whenTrue, false: whenFalse },
})

export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria })

export const score = (instructions, levels) => ({ type: 'score', instructions, criteria: levels })

export function buildRequest({ model, state, questions }) {
  return { model, state, questions }
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

function numberOrNull(value) {
  return finite(value) ? value : null
}

function readProbabilities(raw, options) {
  if (!raw || typeof raw !== 'object') return null
  const result = {}
  for (const option of options) {
    const value = raw[option]
    result[option] = finite(value) && value >= 0 ? value : 0
  }
  return result
}

const PARSERS = {
  noul(raw) {
    if (!raw || raw.type !== 'noul' || !finite(raw.noul) || raw.noul < 0 || raw.noul > 1) return null
    return { type: 'noul', noul: raw.noul }
  },
  choice(raw, question) {
    const options = Object.keys(question.criteria)
    if (!raw || raw.type !== 'choice' || typeof raw.choice !== 'string' || !options.includes(raw.choice)) return null
    return {
      type: 'choice',
      choice: raw.choice,
      probabilities: readProbabilities(raw.probabilities, options),
      confidence: numberOrNull(raw.confidence),
    }
  },
  score(raw, question) {
    const levels = question.criteria.length
    if (!raw || raw.type !== 'score' || !finite(raw.score) || raw.score < 0 || raw.score > levels) return null
    return {
      type: 'score',
      score: raw.score,
      probabilities: readProbabilities(raw.probabilities, question.criteria.map((_, index) => String(index))),
      confidence: numberOrNull(raw.confidence),
    }
  },
}

function readUsage(raw) {
  if (!raw || typeof raw !== 'object') return { inputTokens: 0, outputTokens: 0, cost: null }
  return {
    inputTokens: finite(raw.input_tokens) ? raw.input_tokens : 0,
    outputTokens: finite(raw.output_tokens) ? raw.output_tokens : 0,
    cost: numberOrNull(raw.cost),
  }
}

export function parseAnswers(body, questions) {
  if (!body || typeof body !== 'object' || !body.answers || typeof body.answers !== 'object') {
    return { ok: false, error: 'The reply had no answers.' }
  }
  const answers = {}
  for (const [name, question] of Object.entries(questions)) {
    const parser = PARSERS[question.type]
    const parsed = parser ? parser(body.answers[name], question) : null
    if (!parsed) return { ok: false, error: `The answer for ${name} is missing or not valid.` }
    answers[name] = parsed
  }
  return { ok: true, answers, usage: readUsage(body.usage), model: typeof body.model === 'string' ? body.model : null }
}
