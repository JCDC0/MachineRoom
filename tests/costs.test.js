import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { costBoard } from '../src/model/costs.js'

const fast = () => createMockClient({ latencyMs: 0, now: () => Date.parse('2026-10-20T00:00:00Z') })

async function mockBoard() {
  const client = fast()
  const [costs, agents] = await Promise.all([client.costs(), client.agents()])
  const roster = agents.map((agent) => ({ id: agent.id, key: agent.key, name: agent.name }))
  return { costs, roster, board: costBoard(costs, roster) }
}

describe('costBoard rows', () => {
  it('carries today cents beside the month for a lane that reports a cost', () => {
    const board = costBoard(
      {
        byAgent: [
          {
            agentId: 'agent-opencode',
            agentName: 'OpenCode',
            costCents: 350,
            todayCents: 125,
            inputTokens: 1000,
            outputTokens: 200,
          },
          { agentId: 'agent-agy', agentName: 'agy', costCents: 40, todayCents: 0 },
          { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 0, todayCents: 0, inputTokens: 0, outputTokens: 0 },
        ],
      },
      [
        { id: 'agent-opencode', key: 'opencode', name: 'OpenCode' },
        { id: 'agent-agy', key: 'agy', name: 'agy' },
        { id: 'agent-claude', key: 'claude', name: 'Claude Code' },
      ]
    )
    expect(board.rows.map((row) => [row.key, row.costCents, row.todayCents, row.reported])).toEqual([
      ['opencode', 350, 125, true],
      ['agy', 40, 0, true],
      ['claude', 0, 0, true],
    ])
  })

  it('gives one row per roster agent in roster order', async () => {
    const { board, roster } = await mockBoard()
    expect(board.rows.map((row) => row.key)).toEqual(roster.map((agent) => agent.key))
    expect(board.rows.map((row) => row.agentId)).toEqual(roster.map((agent) => agent.id))
    expect(board.rows[0]).toEqual({
      key: 'claude',
      agentId: 'agent-claude',
      name: 'Claude Code',
      costCents: 218,
      todayCents: null,
      inputTokens: 310000,
      outputTokens: 26000,
      reported: true,
      share: 0.445,
    })
  })

  it('marks a roster agent with no byAgent row as not reported', async () => {
    const { board } = await mockBoard()
    const lane = board.rows.find((row) => row.key === 'opencode4')
    expect(lane).toEqual({
      key: 'opencode4',
      agentId: 'agent-opencode4',
      name: 'OpenCode 4',
      costCents: null,
      todayCents: null,
      inputTokens: null,
      outputTokens: null,
      reported: false,
      share: null,
    })
  })

  it('keeps a row that reports 0 as reported', () => {
    const board = costBoard(
      { byAgent: [{ agentId: 'agent-agy', agentName: 'agy', costCents: 0, todayCents: 0, inputTokens: 0, outputTokens: 0 }] },
      [{ id: 'agent-agy', key: 'agy', name: 'agy' }],
    )
    expect(board.rows[0]).toEqual({
      key: 'agy',
      agentId: 'agent-agy',
      name: 'agy',
      costCents: 0,
      todayCents: 0,
      inputTokens: 0,
      outputTokens: 0,
      reported: true,
      share: null,
    })
  })

  it('puts byAgent rows with no roster agent after the roster rows, dearest first then by name', () => {
    const board = costBoard(
      {
        byAgent: [
          { agentId: 'agent-zed', agentName: 'Zed', costCents: 50, inputTokens: 1, outputTokens: 1 },
          { agentId: 'agent-amy', agentName: 'Amy', costCents: 250, inputTokens: 1, outputTokens: 1 },
          { agentId: 'agent-bob', agentName: 'Bob', costCents: 50, inputTokens: 1, outputTokens: 1 },
        ],
      },
      [{ id: 'agent-claude', key: 'claude-code', name: 'Claude Code' }],
    )
    expect(board.rows.map((row) => row.name)).toEqual(['Claude Code', 'Amy', 'Bob', 'Zed'])
    expect(board.rows.map((row) => row.key)).toEqual(['claude-code', null, null, null])
    expect(board.rows[1].costCents).toBe(250)
  })

  it('gives shares of the reported cost that add up to about one', async () => {
    const { board } = await mockBoard()
    const shares = board.rows.filter((row) => row.reported).map((row) => row.share)
    expect(shares).toEqual([0.445, 0.292, 0.178, 0.086])
    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 2)
  })

  it('keeps a repeated agentId once, with the first entry', () => {
    const board = costBoard(
      {
        byAgent: [
          { agentId: 'agent-a', agentName: 'First', costCents: 100, inputTokens: 5, outputTokens: 5 },
          { agentId: 'agent-a', agentName: 'Second', costCents: 900, inputTokens: 5, outputTokens: 5 },
        ],
      },
      [{ id: 'agent-a', key: 'a', name: 'Agent A' }],
    )
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0].name).toBe('Agent A')
    expect(board.rows[0].costCents).toBe(100)
    expect(board.rows[0].share).toBe(1)
  })

  it('turns numbers that are not finite or not negative into null', () => {
    const board = costBoard(
      {
        byAgent: [{ agentId: 'agent-a', agentName: 'A', costCents: -4, inputTokens: 'many', outputTokens: 12 }],
      },
      [{ id: 'agent-a', key: 'a', name: 'A' }],
    )
    expect(board.rows[0].costCents).toBeNull()
    expect(board.rows[0].inputTokens).toBeNull()
    expect(board.rows[0].outputTokens).toBe(12)
    expect(board.rows[0].reported).toBe(true)
  })

  it('names a row from the roster, then the byAgent name, then the agent id', () => {
    const board = costBoard(
      {
        byAgent: [
          { agentId: 'agent-a', agentName: 'From Costs', costCents: 1, inputTokens: 1, outputTokens: 1 },
          { agentId: 'agent-b', costCents: 1, inputTokens: 1, outputTokens: 1 },
        ],
      },
      [{ id: 'agent-a', key: 'a', name: 'From Roster' }],
    )
    expect(board.rows.map((row) => row.name)).toEqual(['From Roster', 'agent-b'])
  })
})

describe('costBoard summary', () => {
  it('reads the mock summary as lane spend with no budget', async () => {
    const { board } = await mockBoard()
    expect(board.summary).toEqual({ spendCents: 490, budgetCents: 0, percent: 0, over: false })
  })

  it('works out the percent from spend over budget when utilization is missing', () => {
    const board = costBoard({ summary: { spendCents: 1, budgetCents: 3 } }, [])
    expect(board.summary).toEqual({ spendCents: 1, budgetCents: 3, percent: 33.3, over: false })
  })

  it('flags a spend over the budget', () => {
    const board = costBoard({ summary: { spendCents: 1200, budgetCents: 1000, utilizationPercent: 120 } }, [])
    expect(board.summary).toEqual({ spendCents: 1200, budgetCents: 1000, percent: 120, over: true })
  })

  it('has no percent and no over flag without a budget', () => {
    const board = costBoard({ summary: { spendCents: 40, budgetCents: 0 } }, [])
    expect(board.summary).toEqual({ spendCents: 40, budgetCents: 0, percent: null, over: false })
  })

  it('uses 0 for numbers that are missing or not finite', () => {
    const board = costBoard({ summary: { spendCents: 'a lot', budgetCents: Infinity } }, [])
    expect(board.summary).toEqual({ spendCents: 0, budgetCents: 0, percent: null, over: false })
  })
})

describe('costBoard quota', () => {
  it('gives no rows for lane records, which carry no quota windows', async () => {
    const { board } = await mockBoard()
    expect(board.quota).toEqual([])
  })

  it('says Not available. when a failed provider has no error', () => {
    const board = costBoard({ quota: [{ provider: 'openai', ok: false, windows: [] }] }, [])
    expect(board.quota).toEqual([{ provider: 'openai', label: null, usedPercent: null, resetsAt: null, error: 'Not available.' }])
  })

  it('gives no rows for a provider that is ok with no windows', () => {
    const board = costBoard({ quota: [{ provider: 'anthropic', ok: true }] }, [])
    expect(board.quota).toEqual([])
  })
})

describe('costBoard junk input', () => {
  it('gives empty parts and never throws', () => {
    const empty = { summary: { spendCents: 0, budgetCents: 0, percent: null, over: false }, rows: [], quota: [] }
    expect(costBoard(null, null)).toEqual(empty)
    expect(costBoard(undefined, undefined)).toEqual(empty)
    expect(costBoard('nope', 'nope')).toEqual(empty)
    expect(costBoard(42, 42)).toEqual(empty)
    expect(costBoard([], [])).toEqual(empty)
    expect(costBoard({ summary: [], byAgent: {}, quota: 'x' }, {})).toEqual(empty)
  })

  it('never matches a cost row with no agentId to a roster agent with no id', () => {
    const board = costBoard(
      { byAgent: [{ agentName: 'Ghost', costCents: 9, inputTokens: 1, outputTokens: 1 }] },
      [{ key: 'x', name: 'X' }],
    )
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0]).toMatchObject({ key: 'x', name: 'X', reported: false, costCents: null })
  })

  it('skips entries that are not objects', () => {
    const board = costBoard(
      {
        byAgent: [null, 'x', 4, [], { agentId: 'agent-a', agentName: 'A', costCents: 3, inputTokens: 1, outputTokens: 1 }],
        quota: [null, 'x', { provider: 'anthropic', ok: true, windows: [null, 3, { label: 'Week', usedPercent: 7 }] }],
      },
      [null, 'x', { id: 'agent-b', key: 'b', name: 'B' }],
    )
    expect(board.rows.map((row) => row.agentId)).toEqual(['agent-b', 'agent-a'])
    expect(board.quota).toEqual([{ provider: 'anthropic', label: 'Week', usedPercent: 7, resetsAt: null, error: null }])
  })
})
