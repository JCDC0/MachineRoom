import { describe, expect, it } from 'vitest'
import { mapCosts } from '../server/control.js'
import { laneCosts } from '../server/lane-costs.js'
import { runRecord, summarizeRun } from '../src/briefs/run.js'
import { claudeHarness } from '../src/harnesses/claude.js'
import { codexHarness } from '../src/harnesses/codex.js'
import { opencodeHarness } from '../src/harnesses/opencode.js'

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime()

function lines(...items) {
  return items.map((item) => JSON.stringify(item)).join('\n')
}

function localIso(hour) {
  return new Date(2026, 9, 24, hour, 0, 0).toISOString()
}

describe('harness cache usage', () => {
  it('reads Claude cache reads and writes from result usage and modelUsage', () => {
    const fromUsage = lines({
      type: 'result',
      total_cost_usd: 0.12,
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 600,
        cache_creation_input_tokens: 150,
        output_tokens: 40,
      },
    })
    expect(claudeHarness.usage(fromUsage)).toEqual({
      costUsd: 0.12,
      inputTokens: 850,
      outputTokens: 40,
      cacheReadTokens: 600,
      cacheWriteTokens: 150,
      peakTokens: null,
    })

    const fromModelUsage = lines({
      type: 'result',
      total_cost_usd: 0.3,
      modelUsage: {
        a: { inputTokens: 50, cacheReadInputTokens: 300, cacheCreationInputTokens: 80, outputTokens: 20 },
        b: { inputTokens: 10, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, outputTokens: 5 },
      },
    })
    expect(claudeHarness.usage(fromModelUsage)).toEqual({
      costUsd: 0.3,
      inputTokens: 560,
      outputTokens: 25,
      cacheReadTokens: 400,
      cacheWriteTokens: 100,
      peakTokens: null,
    })
  })

  it('reads OpenCode cache reads and writes across steps', () => {
    const log = lines(
      { type: 'step_finish', part: { cost: 0.1, tokens: { input: 200, output: 10, cache: { read: 500, write: 50 } } } },
      { type: 'step_finish', part: { cost: 0.2, tokens: { input: 100, output: 15, cache: { read: 300, write: 25 } } } },
    )
    expect(opencodeHarness.usage(log)).toEqual({
      costUsd: 0.3,
      inputTokens: 1175,
      outputTokens: 25,
      cacheReadTokens: 800,
      cacheWriteTokens: 75,
      peakTokens: 750,
    })
  })

  it('reads Codex cached_input_tokens as reads with writes unknown', () => {
    const log = lines({
      type: 'turn.completed',
      usage: { input_tokens: 1500, cached_input_tokens: 500, output_tokens: 80 },
    })
    expect(codexHarness.usage(log)).toEqual({
      costUsd: null,
      inputTokens: 1500,
      outputTokens: 80,
      cacheReadTokens: 500,
      cacheWriteTokens: null,
    })
  })

  it('keeps missing cache fields null and never zero across harnesses', () => {
    const claudeNoCache = lines({ type: 'result', total_cost_usd: 0.05, usage: { input_tokens: 20, output_tokens: 5 } })
    expect(claudeHarness.usage(claudeNoCache).cacheReadTokens).toBeNull()
    expect(claudeHarness.usage(claudeNoCache).cacheWriteTokens).toBeNull()
    expect(claudeHarness.usage('').cacheReadTokens).toBeNull()
    expect(claudeHarness.usage('').cacheWriteTokens).toBeNull()

    const opencodeReadOnly = lines({ type: 'step_finish', part: { tokens: { input: 20, output: 5, cache: { read: 10 } } } })
    expect(opencodeHarness.usage(opencodeReadOnly).cacheReadTokens).toBe(10)
    expect(opencodeHarness.usage(opencodeReadOnly).cacheWriteTokens).toBeNull()
    const opencodeNoCache = lines({ type: 'step_finish', part: { tokens: { input: 20, output: 5 } } })
    expect(opencodeHarness.usage(opencodeNoCache).cacheReadTokens).toBeNull()
    expect(opencodeHarness.usage(opencodeNoCache).cacheWriteTokens).toBeNull()
    expect(opencodeHarness.usage('').cacheReadTokens).toBeNull()
    expect(opencodeHarness.usage('').cacheWriteTokens).toBeNull()

    const codexNoCache = lines({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } })
    expect(codexHarness.usage(codexNoCache).cacheReadTokens).toBeNull()
    expect(codexHarness.usage(codexNoCache).cacheWriteTokens).toBeNull()
    expect(codexHarness.usage('').cacheReadTokens).toBeNull()
    expect(codexHarness.usage('').cacheWriteTokens).toBeNull()
  })

  it('passes reported cache fields through summarizeRun and runRecord', () => {
    const claudeLog = lines({
      type: 'result',
      total_cost_usd: 0.1,
      usage: { input_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 40, output_tokens: 10 },
    })
    const summary = summarizeRun({ harness: 'claude', log: claudeLog, worktree: 'C:\\scratch' })
    expect(summary.cacheReadTokens).toBe(200)
    expect(summary.cacheWriteTokens).toBe(40)

    const kept = runRecord({
      lane: 'claude',
      cacheReadTokens: summary.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens,
    })
    expect(kept.cacheReadTokens).toBe(200)
    expect(kept.cacheWriteTokens).toBe(40)

    const zeroKept = runRecord({ lane: 'codex', cacheReadTokens: 0, cacheWriteTokens: null })
    expect(zeroKept.cacheReadTokens).toBe(0)
    expect(Object.hasOwn(zeroKept, 'cacheWriteTokens')).toBe(false)

    const omitted = runRecord({ lane: 'hermes', cacheReadTokens: null, cacheWriteTokens: -5 })
    expect(Object.hasOwn(omitted, 'cacheReadTokens')).toBe(false)
    expect(Object.hasOwn(omitted, 'cacheWriteTokens')).toBe(false)
  })
})

describe('laneCosts cache totals', () => {
  const agents = [
    { id: 'agent-claude', key: 'claude', name: 'Claude Code' },
    { id: 'agent-codex', key: 'codex', name: 'Codex' },
    { id: 'agent-hermes', key: 'hermes', name: 'Hermes' },
  ]

  it('sums cache tokens and tracks cacheKnownRuns and reporting input per lane', () => {
    const costs = laneCosts({
      records: [
        { lane: 'claude', startedAt: localIso(9), costUsd: 0.2, inputTokens: 1000, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 100 },
        { lane: 'claude', startedAt: localIso(10), costUsd: 0.3, inputTokens: 1000, outputTokens: 60, cacheReadTokens: 600, cacheWriteTokens: 50 },
        { lane: 'claude', startedAt: localIso(11), costUsd: 0.1, inputTokens: 5000, outputTokens: 20 },
        { lane: 'codex', startedAt: localIso(11), costUsd: null, inputTokens: 1500, outputTokens: 40, cacheReadTokens: 500 },
        { lane: 'hermes', startedAt: localIso(11), costUsd: 0.05, inputTokens: 300, outputTokens: 30 },
      ],
      agents,
      now: NOW,
    })

    const mapped = mapCosts(costs)
    const claude = mapped.byAgent.find((row) => row.agentId === 'agent-claude')
    expect(claude).toMatchObject({
      inputTokens: 7000,
      cacheReadTokens: 1000,
      cacheWriteTokens: 150,
      cacheInputTokens: 2000,
      cacheKnownRuns: 2,
      runs: 3,
    })

    const codex = mapped.byAgent.find((row) => row.agentId === 'agent-codex')
    expect(codex).toMatchObject({
      inputTokens: 1500,
      cacheReadTokens: 500,
      cacheWriteTokens: null,
      cacheInputTokens: 1500,
      cacheKnownRuns: 1,
      runs: 1,
    })

    const hermes = mapped.byAgent.find((row) => row.agentId === 'agent-hermes')
    expect(hermes).toMatchObject({
      inputTokens: 300,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cacheInputTokens: null,
      cacheKnownRuns: 0,
      runs: 1,
    })
  })
})
