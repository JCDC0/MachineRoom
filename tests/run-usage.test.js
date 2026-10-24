import { describe, expect, it } from 'vitest'
import { summarizeRun } from '../src/briefs/run.js'

const stepLine = (tokens, cost = 0) => JSON.stringify({
  type: 'step_finish',
  timestamp: 1792828410620,
  sessionID: 'ses_masked',
  part: {
    id: 'prt_masked',
    sessionID: 'ses_masked',
    messageID: 'msg_masked',
    type: 'step-finish',
    reason: 'tool-calls',
    snapshot: 'masked',
    cost,
    tokens,
  },
})

const summaryOf = (log) => summarizeRun({ harness: 'opencode', log, worktree: 'C:\\scratch' })

describe('OpenCode usage', () => {
  it('sums the tokens of two steps', () => {
    const log = [
      stepLine({ input: 5781, output: 112, reasoning: 25, cache: { read: 4096, write: 10 } }, 0.000961638),
      stepLine({ input: 384, output: 117, reasoning: 89, cache: { read: 9856, write: 20 } }, 0.000210768),
    ].join('\n')
    const summary = summaryOf(log)
    expect(summary.inputTokens).toBe(5781 + 4096 + 10 + 384 + 9856 + 20)
    expect(summary.outputTokens).toBe(112 + 25 + 117 + 89)
    expect(summary.costUsd).toBe(0.001172)
  })

  it('reports null for a log with no step', () => {
    const log = [
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'Done.' } }),
      'not json at all',
    ].join('\n')
    const summary = summaryOf(log)
    expect(summary.inputTokens).toBeNull()
    expect(summary.outputTokens).toBeNull()
    expect(summary.costUsd).toBeNull()
    expect(summaryOf('').inputTokens).toBeNull()
    expect(summaryOf('').outputTokens).toBeNull()
  })

  it('counts the fields a step carries', () => {
    const log = [
      stepLine({ output: 40 }),
      stepLine({ input: 12, cache: { read: 8 } }),
    ].join('\n')
    const summary = summaryOf(log)
    expect(summary.inputTokens).toBe(12 + 8)
    expect(summary.outputTokens).toBe(40)
  })
})
