import { describe, expect, it } from 'vitest'
import { argmax, calibrationError, coverageAtError, flipRate, majorityAccuracy, median, scoreAnswer, summarize } from '../src/decider/stats.js'

const rec = (correct, confidence) => ({ correct, confidence })

describe('scoreAnswer', () => {
  it('reads a choice from its top probability', () => {
    const answer = { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.4 }
    expect(scoreAnswer(answer, 'a')).toEqual({ predicted: 'a', correct: true, confidence: 0.7 })
    expect(scoreAnswer(answer, 'b').correct).toBe(false)
  })

  it('falls back to the stated confidence when a choice has no probabilities', () => {
    expect(scoreAnswer({ type: 'choice', choice: 'a', probabilities: null, confidence: 0.6 }, 'a').confidence).toBe(0.6)
    expect(scoreAnswer({ type: 'choice', choice: 'a', probabilities: null, confidence: null }, 'a').confidence).toBeNull()
  })

  it('reads a yes probability at one half and measures the distance from it', () => {
    expect(scoreAnswer({ type: 'noul', noul: 0.8 }, true)).toEqual({ predicted: true, correct: true, confidence: 0.8 })
    const low = scoreAnswer({ type: 'noul', noul: 0.1 }, true)
    expect(low.correct).toBe(false)
    expect(low.confidence).toBeCloseTo(0.9)
    expect(scoreAnswer({ type: 'noul', noul: 0.5 }, true).predicted).toBe(true)
  })

  it('rounds a score to a level and tracks answers within one level', () => {
    const result = scoreAnswer({ type: 'score', score: 1.6, confidence: 0.5 }, 3)
    expect(result.predicted).toBe(2)
    expect(result.correct).toBe(false)
    expect(result.near).toBe(true)
    expect(scoreAnswer({ type: 'score', score: 0.2 }, 3).near).toBe(false)
  })

  it('counts a missing answer as wrong with no confidence', () => {
    expect(scoreAnswer(undefined, 'a')).toEqual({ predicted: null, correct: false, confidence: null })
  })
})

describe('coverageAtError', () => {
  it('accepts answers from the most confident down while the error stays within the limit', () => {
    const records = [rec(true, 0.99), rec(true, 0.95), rec(true, 0.9), rec(false, 0.6), rec(true, 0.55), rec(false, 0.5)]
    expect(coverageAtError(records, 0.05)).toBe(3 / 6)
    expect(coverageAtError(records, 0.25)).toBe(5 / 6)
  })

  it('moves a whole group of equal confidence together', () => {
    const records = [rec(true, 0.9), rec(true, 0.9), rec(false, 0.9), rec(true, 0.9)]
    expect(coverageAtError(records, 0.05)).toBe(0)
    expect(coverageAtError(records, 0.3)).toBe(1)
  })

  it('counts answers with no confidence in the total and never accepts them', () => {
    expect(coverageAtError([rec(true, 0.9), rec(true, null), rec(true, null), rec(true, 0.8)], 0.05)).toBe(2 / 4)
  })

  it('is zero for no records', () => {
    expect(coverageAtError([])).toBe(0)
  })
})

describe('calibrationError', () => {
  it('is zero when confidence matches how often the answers are right', () => {
    const records = [...Array(8).fill(rec(true, 0.8)), ...Array(2).fill(rec(false, 0.8))]
    expect(calibrationError(records)).toBeCloseTo(0, 5)
  })

  it('is large for an overconfident model', () => {
    const records = [...Array(5).fill(rec(true, 0.95)), ...Array(5).fill(rec(false, 0.95))]
    expect(calibrationError(records)).toBeCloseTo(0.45, 5)
  })

  it('is null when no answer has a confidence', () => {
    expect(calibrationError([rec(true, null)])).toBeNull()
  })

  it('puts a confidence of exactly one in the last bin', () => {
    expect(calibrationError([rec(true, 1)])).toBeCloseTo(0, 5)
  })
})

describe('summaries', () => {
  it('collects the numbers of one question', () => {
    const summary = summarize([rec(true, 0.9), rec(false, 0.6)])
    expect(summary).toMatchObject({ n: 2, accuracy: 0.5, within1: null })
    expect(summary.coverage5).toBe(0.5)
  })

  it('adds the share within one level for scores', () => {
    const summary = summarize([{ correct: false, near: true, confidence: 0.5 }, { correct: true, near: true, confidence: 0.5 }])
    expect(summary.within1).toBe(1)
  })

  it('handles an empty list', () => {
    expect(summarize([])).toMatchObject({ n: 0, accuracy: null })
  })
})

describe('small helpers', () => {
  it('finds the median of an odd and an even list and ignores bad values', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, null, Number.NaN])).toBe(5)
    expect(median([])).toBeNull()
  })

  it('finds the top option', () => {
    expect(argmax({ a: 0.2, b: 0.7, c: 0.1 })).toEqual({ option: 'b', value: 0.7 })
    expect(argmax({})).toBeNull()
  })

  it('counts answers that changed between two runs', () => {
    const first = new Map([['a', 1], ['b', 2], ['c', 3]])
    const second = new Map([['a', 1], ['b', 9], ['d', 4]])
    expect(flipRate(first, second)).toBe(0.5)
    expect(flipRate(first, new Map())).toBeNull()
  })

  it('gives the share of the most common label', () => {
    expect(majorityAccuracy(['a', 'a', 'b', 'a'])).toBe(0.75)
    expect(majorityAccuracy([])).toBeNull()
  })
})
