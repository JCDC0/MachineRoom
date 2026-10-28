import { describe, expect, it } from 'vitest'
import {
  MAX_SUBS,
  TEAM_CODERS_MAX,
  TEAM_ORCHESTRATORS_MAX,
  teamDraft,
  teamHarnesses,
  teamLanePool,
  teamPlan,
} from '../src/ui/family.js'

const LANES = {
  lanes: [
    { key: 'idle-a', name: 'Idle A', active: false },
    { key: 'alpha', name: 'Alpha', active: true },
    { key: 'beta', name: 'Beta', active: true },
    { key: 'idle-b', name: 'Idle B', active: false },
  ],
}

const LADDER = {
  subs: [
    {
      id: 'frontend',
      name: 'Frontend',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      lanes: ['beta'],
      scope: ['**'],
      restricted: true,
      setBy: 'owner',
    },
  ],
}

const HARNESSES = {
  harnesses: [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
      efforts: ['low', 'max'],
    },
    { key: 'agy', name: 'Antigravity', available: false, models: [], efforts: [] },
  ],
}

function sub(id, name, lanes) {
  return { id, name, harness: 'opencode', model: 'm', lanes, scope: ['**'], restricted: false, setBy: 'owner' }
}

describe('the team lane pool', () => {
  it('takes the active lanes in picker order, then the idle lanes', () => {
    expect(teamLanePool(LANES, { subs: [] }).map((row) => row.key)).toEqual([
      'alpha',
      'beta',
      'idle-a',
      'idle-b',
    ])
  })

  it('never offers a lane that already belongs to a sub', () => {
    expect(teamLanePool(LANES, LADDER).map((row) => row.key)).toEqual([
      'alpha',
      'idle-a',
      'idle-b',
    ])
  })

  it('reads the lanes answer or a plain list, and skips a repeated key', () => {
    const list = [
      { key: 'alpha', name: 'Alpha', active: true },
      { key: 'alpha', name: 'Alpha again', active: false },
      { key: 'beta', active: false },
    ]
    expect(teamLanePool(list, null)).toEqual([
      { key: 'alpha', name: 'Alpha', active: true },
      { key: 'beta', name: 'beta', active: false },
    ])
  })
})

describe('the team plan', () => {
  it('names each sub Team 1, Team 2 and gives it its coders in pool order', () => {
    const plan = teamPlan({
      lanes: LANES,
      ladder: { subs: [] },
      orchestrators: 2,
      coders: 2,
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
    expect(plan.problem).toBe('')
    expect(plan.needed).toBe(4)
    expect(plan.available).toBe(4)
    expect(plan.missing).toBe(0)
    expect(plan.teams).toEqual([
      { id: 'team-1', name: 'Team 1', lanes: ['alpha', 'beta'], laneNames: ['Alpha', 'Beta'] },
      { id: 'team-2', name: 'Team 2', lanes: ['idle-a', 'idle-b'], laneNames: ['Idle A', 'Idle B'] },
    ])
    expect(plan.subs).toEqual([
      {
        id: 'team-1',
        name: 'Team 1',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        lanes: ['alpha', 'beta'],
        scope: ['**'],
        restricted: false,
        setBy: 'owner',
      },
      {
        id: 'team-2',
        name: 'Team 2',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        lanes: ['idle-a', 'idle-b'],
        scope: ['**'],
        restricted: false,
        setBy: 'owner',
      },
    ])
  })

  it('keeps every existing sub and never reuses one of its lanes', () => {
    const plan = teamPlan({
      lanes: LANES,
      ladder: LADDER,
      orchestrators: 1,
      coders: 2,
      harness: 'opencode',
      model: 'm',
    })
    expect(plan.problem).toBe('')
    expect(plan.subs[0]).toBe(LADDER.subs[0])
    expect(plan.subs[0].lanes).toEqual(['beta'])
    expect(plan.teams).toEqual([
      { id: 'team-1', name: 'Team 1', lanes: ['alpha', 'idle-a'], laneNames: ['Alpha', 'Idle A'] },
    ])
  })

  it('shows how many lanes to turn on and keeps the partial preview', () => {
    const plan = teamPlan({ lanes: LANES, ladder: { subs: [] }, orchestrators: 2, coders: 2 })
    expect(plan.missing).toBe(0)

    const short = teamPlan({ lanes: LANES, ladder: LADDER, orchestrators: 2, coders: 2 })
    expect(short.problem).toBe('Turn on 1 more lane first.')
    expect(short.missing).toBe(1)
    expect(short.teams.map((team) => team.lanes)).toEqual([['alpha', 'idle-a'], ['idle-b']])

    const empty = teamPlan({ lanes: [], ladder: { subs: [] }, orchestrators: 1, coders: 3 })
    expect(empty.problem).toBe('Turn on 3 more lanes first.')
    expect(empty.teams.map((team) => team.lanes)).toEqual([[]])
  })

  it('refuses more subs than the ladder holds', () => {
    const subs = Array.from({ length: MAX_SUBS - 1 }, (_, index) => sub(`sub-${index + 1}`, `Sub ${index + 1}`, []))
    const plan = teamPlan({ lanes: LANES, ladder: { subs }, orchestrators: 2, coders: 1 })
    expect(plan.problem).toBe(`There are at most ${MAX_SUBS} sub orchestrators.`)
    expect(plan.teams).toEqual([])
    expect(plan.subs).toHaveLength(subs.length)
  })

  it('refuses a count outside 1 to 4 orchestrators or 1 to 3 coders', () => {
    for (const orchestrators of [0, 5, 1.5, 'two']) {
      expect(teamPlan({ lanes: LANES, ladder: { subs: [] }, orchestrators, coders: 1 }).problem).toBe(
        `Choose 1 to ${TEAM_ORCHESTRATORS_MAX} orchestrators.`
      )
    }
    for (const coders of [0, 4, 1.5, 'two']) {
      expect(teamPlan({ lanes: LANES, ladder: { subs: [] }, orchestrators: 1, coders }).problem).toBe(
        `Choose 1 to ${TEAM_CODERS_MAX} coders for each orchestrator.`
      )
    }
  })

  it('skips a Team number an existing sub already uses', () => {
    const plan = teamPlan({
      lanes: LANES,
      ladder: { subs: [sub('old-team', 'Team 1', [])] },
      orchestrators: 2,
      coders: 1,
    })
    expect(plan.teams.map((team) => team.name)).toEqual(['Team 2', 'Team 3'])
    expect(plan.teams.map((team) => team.id)).toEqual(['team-2', 'team-3'])
  })

  it('keeps a new sub id apart from a lane key and the earlier new ids', () => {
    const lanes = [
      { key: 'team-1', name: 'Team 1 lane', active: true },
      { key: 'alpha', name: 'Alpha', active: true },
      { key: 'beta', name: 'Beta', active: true },
    ]
    const plan = teamPlan({ lanes, ladder: { subs: [] }, orchestrators: 2, coders: 1 })
    expect(plan.teams.map((team) => team.id)).toEqual(['team-1-2', 'team-2'])
    expect(plan.teams.map((team) => team.lanes)).toEqual([['team-1'], ['alpha']])
  })

  it('copies the chosen harness and model and defaults them', () => {
    const chosen = teamPlan({
      lanes: LANES,
      ladder: { subs: [] },
      orchestrators: 1,
      coders: 1,
      harness: 'claude',
      model: 'sonnet',
    })
    expect(chosen.subs[0]).toMatchObject({ harness: 'claude', model: 'sonnet' })

    const plain = teamPlan({ lanes: LANES, ladder: { subs: [] }, orchestrators: 1, coders: 1 })
    expect(plain.subs[0]).toMatchObject({ harness: 'opencode', model: '' })
  })
})

describe('the team form defaults', () => {
  it('offers OpenCode first and picks it with its preferred model', () => {
    expect(teamHarnesses(HARNESSES).map((row) => row.key)).toEqual([
      'opencode',
      'claude',
      'machineroom',
    ])
    expect(teamHarnesses(HARNESSES).map((row) => row.available)).toEqual([true, true, true])
    expect(teamDraft(HARNESSES)).toEqual({
      orchestrators: 1,
      coders: 1,
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
  })

  it('leaves the harness empty when the list is not loaded', () => {
    expect(teamDraft(null, null)).toEqual({
      orchestrators: 1,
      coders: 1,
      harness: '',
      model: '',
    })
  })
})
