import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import {
  briefTarget,
  chooseAssignee,
  formatBriefTitle,
  getFirstOwner,
  groupBriefsByOwner,
  laneForBrief,
  ownerToLane,
  pickAssignee,
  runLaneFor,
} from '../src/ui/panels/briefs.js'

const SAMPLE_AGENTS = [
  { id: 'agent-claude', key: 'claude-code', name: 'Claude Code', role: 'engineer' },
  { id: 'agent-hermes', key: 'hermes', name: 'Hermes', role: 'engineer' },
  { id: 'agent-opencode', key: 'opencode-go', name: 'OpenCode Go', role: 'engineer' },
  { id: 'agent-agy', key: 'agy', name: 'agy', role: 'designer' },
  { id: 'agent-orchestrator', key: 'orchestrator', name: 'Orchestrator', role: 'ceo' },
]

describe('formatBriefTitle', () => {
  it('formats a brief as ID title', () => {
    expect(formatBriefTitle({ id: 'C3e', title: 'HUD polish' })).toBe('C3e HUD polish')
    expect(formatBriefTitle({ id: 'T1b', title: 'Briefs menu in the dispatch panel' })).toBe(
      'T1b Briefs menu in the dispatch panel'
    )
  })

  it('handles missing or whitespace fields safely', () => {
    expect(formatBriefTitle({ id: ' B6 ', title: ' Late join replay ' })).toBe('B6 Late join replay')
    expect(formatBriefTitle({ id: 'B6', title: '' })).toBe('B6')
    expect(formatBriefTitle({ id: '', title: 'Only title' })).toBe('Only title')
    expect(formatBriefTitle(null)).toBe('')
    expect(formatBriefTitle(undefined)).toBe('')
  })
})

describe('ownerToLane', () => {
  it('maps the first owner in lower case to hermes, opencode, or agy', () => {
    expect(ownerToLane({ owners: ['hermes'] })).toBe('hermes')
    expect(ownerToLane({ owners: ['opencode'] })).toBe('opencode')
    expect(ownerToLane({ owners: ['agy'] })).toBe('agy')
    expect(ownerToLane({ owners: ['OpenCode', 'AGY'] })).toBe('opencode')
    expect(laneForBrief('Hermes')).toBe('hermes')
    expect(laneForBrief('OpenCode')).toBe('opencode')
    expect(laneForBrief('AGY')).toBe('agy')
  })

  it('returns a lane for Claude and null for the owner or no valid lane', () => {
    expect(ownerToLane({ owners: ['claude'] })).toBe('claude')
    expect(ownerToLane({ owners: [] })).toBeNull()
    expect(ownerToLane('claude')).toBe('claude')
    expect(ownerToLane('Claude')).toBe('claude')
    expect(ownerToLane('owner')).toBeNull()
    expect(ownerToLane('')).toBeNull()
    expect(ownerToLane(null)).toBeNull()
    expect(ownerToLane(undefined)).toBeNull()
  })

  it('uses only the first owner even when another owner follows', () => {
    expect(ownerToLane({ owners: ['claude', 'agy'] })).toBe('claude')
    expect(ownerToLane({ owners: ['agy', 'claude'] })).toBe('agy')
  })
})

describe('runLaneFor', () => {
  const LANES = ['hermes', 'opencode', 'opencode2', 'agy']

  it('keeps the owner lane when it is free', () => {
    expect(runLaneFor({ owners: ['opencode'] }, [], LANES)).toBe('opencode')
    expect(runLaneFor({ owners: ['opencode'] }, [{ lane: 'opencode2' }], LANES)).toBe('opencode')
  })

  it('gives the free lane of the same harness when the owner lane runs', () => {
    expect(runLaneFor({ owners: ['opencode'] }, [{ lane: 'opencode' }], LANES)).toBe('opencode2')
    expect(runLaneFor({ owners: ['opencode2'] }, ['opencode2'], LANES)).toBe('opencode')
    expect(runLaneFor({ owners: ['opencode'] }, ['opencode'], { opencode: {}, opencode2: {} })).toBe('opencode2')
  })

  it('keeps the owner lane when both lanes run', () => {
    expect(runLaneFor({ owners: ['opencode'] }, ['opencode', 'opencode2'], LANES)).toBe('opencode')
    expect(runLaneFor({ owners: ['opencode2'] }, [{ lane: 'opencode' }, { lane: 'opencode2' }], LANES)).toBe('opencode2')
  })

  it('keeps a lane that has no twin', () => {
    expect(runLaneFor({ owners: ['agy'] }, ['agy'], LANES)).toBe('agy')
    expect(runLaneFor({ owners: ['agy'] }, ['agy'], ['agy'])).toBe('agy')
  })

  it('keeps the lane for Claude and answers null for a brief with no owner lane', () => {
    expect(runLaneFor({ owners: ['claude'] }, [], LANES)).toBe('claude')
    expect(runLaneFor({}, ['opencode'], LANES)).toBeNull()
    expect(runLaneFor(null, [], LANES)).toBeNull()
  })
})

describe('chooseAssignee', () => {
  it('matches exact agent name case-insensitively', () => {
    const exactAgents = [
      { id: 'a1', name: 'Hermes' },
      { id: 'a2', name: 'OpenCode' },
      { id: 'a3', name: 'AGY' },
    ]
    expect(chooseAssignee({ owners: ['hermes'] }, exactAgents)).toBe('a1')
    expect(chooseAssignee({ owners: ['opencode'] }, exactAgents)).toBe('a2')
    expect(chooseAssignee({ owners: ['agy'] }, exactAgents)).toBe('a3')
    expect(pickAssignee('HERMES', exactAgents)).toBe('a1')
  })

  it('matches agent names in the mock client and picks the first owner when multiple owners exist', () => {
    expect(chooseAssignee({ owners: ['hermes'] }, SAMPLE_AGENTS)).toBe('agent-hermes')
    expect(chooseAssignee({ owners: ['agy'] }, SAMPLE_AGENTS)).toBe('agent-agy')
    expect(chooseAssignee({ owners: ['opencode'] }, SAMPLE_AGENTS)).toBe('agent-opencode')
    expect(chooseAssignee({ owners: ['opencode', 'agy'] }, SAMPLE_AGENTS)).toBe('agent-opencode')
    expect(chooseAssignee({ owners: ['claude'] }, SAMPLE_AGENTS)).toBe('agent-claude')
  })

  it('returns empty string when no agent matches or brief has no owner', () => {
    expect(chooseAssignee({ owners: [] }, SAMPLE_AGENTS)).toBe('')
    expect(chooseAssignee({ owners: ['unknown'] }, SAMPLE_AGENTS)).toBe('')
    expect(chooseAssignee({ owners: ['hermes'] }, [{ id: 'a1', name: 'agy' }])).toBe('')
    expect(chooseAssignee({ owners: ['hermes'] }, [])).toBe('')
    expect(chooseAssignee(null, SAMPLE_AGENTS)).toBe('')
  })

  it('supports reversed argument order (agents, brief)', () => {
    expect(chooseAssignee(SAMPLE_AGENTS, { owners: ['hermes'] })).toBe('agent-hermes')
  })
})

describe('groupBriefsByOwner', () => {
  it('filters out done briefs and groups open briefs by first owner in file order', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const all = await client.briefs()
    const groups = groupBriefsByOwner(all)

    expect(groups.map((g) => ({ owner: g.owner, label: g.label, ids: g.briefs.map((b) => b.id) }))).toEqual([
      { owner: 'opencode', label: 'OpenCode', ids: ['B6', 'U4'] },
      { owner: 'agy', label: 'AGY', ids: ['C3e'] },
      { owner: 'hermes', label: 'Hermes', ids: ['P5'] },
      { owner: 'claude', label: 'Claude', ids: ['M1'] },
    ])
  })

  it('groups briefs without an agent owner under Owner', () => {
    const items = [
      { id: 'P4', title: 'Release decisions', owners: [], done: false },
      { id: 'G2', title: 'Licence and names', owners: [], done: false },
      { id: 'C2', title: 'Control client', owners: ['opencode'], done: true },
    ]
    const groups = groupBriefsByOwner(items)
    expect(groups).toEqual([
      {
        owner: 'owner',
        label: 'Owner',
        briefs: [items[0], items[1]],
      },
    ])
  })

  it('returns empty array when all briefs are done or input is empty', () => {
    expect(groupBriefsByOwner([{ id: 'C2', title: 'Done task', owners: ['opencode'], done: true }])).toEqual([])
    expect(groupBriefsByOwner([])).toEqual([])
    expect(groupBriefsByOwner(null)).toEqual([])
  })

  it('extracts first owner from string, array, or brief object', () => {
    expect(getFirstOwner(' OpenCode ')).toBe('opencode')
    expect(getFirstOwner(['AGY', 'Hermes'])).toBe('agy')
    expect(getFirstOwner({ owners: ['Hermes'] })).toBe('hermes')
    expect(getFirstOwner({ owner: 'Claude' })).toBe('claude')
    expect(getFirstOwner({})).toBe('')
  })
})

describe('briefTarget', () => {
  const LIST = [
    { id: 'C7a', title: 'Add the plan route', owner: 'opencode' },
    { id: 'C7b', title: 'Read the plan', owner: 'hermes' },
  ]

  it('finds the brief by id', () => {
    expect(briefTarget(LIST, 'C7b')).toEqual({ brief: LIST[1] })
    expect(briefTarget(LIST, ' C7a ')).toEqual({ brief: LIST[0] })
  })

  it('names a missing id', () => {
    expect(briefTarget(LIST, 'C9z')).toEqual({ problem: 'Brief C9z is not in the brief list.' })
    expect(briefTarget([], 'C7a')).toEqual({ problem: 'Brief C7a is not in the brief list.' })
  })

  it('answers a problem for junk ids and junk lists without throwing', () => {
    for (const id of [undefined, null, 42, {}, [], '', '   ']) {
      expect(briefTarget(LIST, id)).toHaveProperty('problem')
    }
    for (const list of [null, undefined, 'C7a', 7, {}, [null, 3, 'x']]) {
      expect(briefTarget(list, 'C7a')).toEqual({ problem: 'Brief C7a is not in the brief list.' })
    }
    expect(briefTarget(Object.create(null), '__proto__')).toHaveProperty('problem')
  })
})
