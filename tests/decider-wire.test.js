import { describe, expect, it } from 'vitest'
import { buildRequest, choice, noul, parseAnswers, score } from '../src/decider/wire.js'

const questions = {
  tier: choice('Which tier?', { small: 'A small one.', large: 'A large one.' }),
  risky: noul('Is it risky?', 'Yes.', 'No.'),
  effort: score('How much effort?', ['None.', 'Some.', 'Lots.']),
}

const reply = {
  id: 'r1',
  model: 'typesafe/jev-1.14',
  answers: {
    tier: { type: 'choice', choice: 'large', confidence: 0.8, probabilities: { small: 0.2, large: 0.8 } },
    risky: { type: 'noul', noul: 0.35 },
    effort: { type: 'score', score: 1.6, confidence: 0.7, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 } },
  },
  usage: { input_tokens: 300, output_tokens: 20, cost: 0.0000126 },
}

describe('request builders', () => {
  it('puts the required criteria on each question type', () => {
    expect(questions.risky.criteria).toEqual({ true: 'Yes.', false: 'No.' })
    expect(Object.keys(questions.tier.criteria)).toEqual(['small', 'large'])
    expect(questions.effort.criteria).toHaveLength(3)
  })

  it('builds the body from the model, the state and the questions only', () => {
    expect(buildRequest({ model: 'm', state: 's', questions, extra: 'x' })).toEqual({ model: 'm', state: 's', questions })
  })
})

describe('parseAnswers', () => {
  it('reads a full reply', () => {
    const result = parseAnswers(reply, questions)
    expect(result.ok).toBe(true)
    expect(result.answers.tier.choice).toBe('large')
    expect(result.answers.tier.probabilities).toEqual({ small: 0.2, large: 0.8 })
    expect(result.answers.risky.noul).toBe(0.35)
    expect(result.answers.effort.score).toBe(1.6)
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 20, cost: 0.0000126 })
    expect(result.model).toBe('typesafe/jev-1.14')
  })

  it('fills in a missing probability with zero and a missing confidence with null', () => {
    const result = parseAnswers({ answers: { ...reply.answers, tier: { type: 'choice', choice: 'small', probabilities: { small: 1 } } } }, questions)
    expect(result.answers.tier.probabilities).toEqual({ small: 1, large: 0 })
    expect(result.answers.tier.confidence).toBeNull()
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cost: null })
  })

  it('accepts a choice with no probabilities', () => {
    const result = parseAnswers({ answers: { ...reply.answers, tier: { type: 'choice', choice: 'small' } } }, questions)
    expect(result.answers.tier.probabilities).toBeNull()
  })

  it('refuses an answer to a question whose type is only an inherited name', () => {
    for (const type of ['constructor', 'toString', '__proto__']) {
      const asked = { tier: { type, instructions: 'Which tier?', criteria: {} } }
      const result = parseAnswers({ answers: { tier: { anything: 'goes' } } }, asked)
      expect(result, type).toEqual({ ok: false, error: 'The answer for tier is missing or not valid.' })
    }
  })

  it('refuses a reply with no answers', () => {
    expect(parseAnswers(null, questions).ok).toBe(false)
    expect(parseAnswers({}, questions).ok).toBe(false)
    expect(parseAnswers({ answers: 'x' }, questions).ok).toBe(false)
  })

  it('refuses a missing answer and says which one', () => {
    const { effort, ...rest } = reply.answers
    const result = parseAnswers({ answers: rest }, questions)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('effort')
    expect(effort).toBeTruthy()
  })

  it('refuses an option that was not offered', () => {
    const bad = { answers: { ...reply.answers, tier: { type: 'choice', choice: 'huge' } } }
    expect(parseAnswers(bad, questions).ok).toBe(false)
  })

  it('refuses a probability outside zero to one and an answer of the wrong type', () => {
    expect(parseAnswers({ answers: { ...reply.answers, risky: { type: 'noul', noul: 1.4 } } }, questions).ok).toBe(false)
    expect(parseAnswers({ answers: { ...reply.answers, risky: { type: 'choice', choice: 'x' } } }, questions).ok).toBe(false)
    expect(parseAnswers({ answers: { ...reply.answers, risky: { type: 'noul', noul: 'high' } } }, questions).ok).toBe(false)
  })

  it('refuses a score outside the levels', () => {
    expect(parseAnswers({ answers: { ...reply.answers, effort: { type: 'score', score: 7 } } }, questions).ok).toBe(false)
    expect(parseAnswers({ answers: { ...reply.answers, effort: { type: 'score', score: -1 } } }, questions).ok).toBe(false)
  })

  it('ignores answers to questions that were not asked', () => {
    const result = parseAnswers({ answers: { ...reply.answers, extra: { type: 'noul', noul: 1 } } }, questions)
    expect(Object.keys(result.answers)).toEqual(['tier', 'risky', 'effort'])
  })
})
