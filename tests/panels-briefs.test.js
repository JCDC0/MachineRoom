import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import {
  briefTarget,
  formatBriefTitle,
  getFirstOwner,
  groupBriefsByOwner,
  ownerToLane,
  runLaneFor,
  validLanes,
} from '../src/ui/panels/briefs.js'

const OWNER_LANES = ['hermes', 'opencode', 'agy', 'claude']

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
    expect(ownerToLane({ owners: ['hermes'] }, OWNER_LANES)).toBe('hermes')
    expect(ownerToLane({ owners: ['opencode'] }, OWNER_LANES)).toBe('opencode')
    expect(ownerToLane({ owners: ['agy'] }, OWNER_LANES)).toBe('agy')
    expect(ownerToLane({ owners: ['OpenCode', 'AGY'] }, OWNER_LANES)).toBe('opencode')
  })

  it('returns a lane for Claude and null for the owner or no valid lane', () => {
    expect(ownerToLane({ owners: ['claude'] }, OWNER_LANES)).toBe('claude')
    expect(ownerToLane({ owners: [] }, OWNER_LANES)).toBeNull()
    expect(ownerToLane('claude', OWNER_LANES)).toBe('claude')
    expect(ownerToLane('Claude', OWNER_LANES)).toBe('claude')
    expect(ownerToLane('owner', OWNER_LANES)).toBeNull()
    expect(ownerToLane('', OWNER_LANES)).toBeNull()
    expect(ownerToLane(null, OWNER_LANES)).toBeNull()
    expect(ownerToLane(undefined, OWNER_LANES)).toBeNull()
  })

  it('uses only the first owner even when another owner follows', () => {
    expect(ownerToLane({ owners: ['claude', 'agy'] }, OWNER_LANES)).toBe('claude')
    expect(ownerToLane({ owners: ['agy', 'claude'] }, OWNER_LANES)).toBe('agy')
  })

  it('answers no lane when no lanes are passed', () => {
    expect(ownerToLane({ owners: ['opencode'] })).toBeNull()
    expect(runLaneFor({ owners: ['opencode'] }, [])).toBeNull()
  })
})

describe('validLanes', () => {
  const AGENTS = [
    { key: 'opencode', name: 'OpenCode', parser: 'opencode' },
    { key: 'opencode2', name: 'OpenCode 2', parser: 'opencode' },
    { key: 'claude', name: 'Claude Code', parser: 'claude' },
    { key: 'claude-session', name: 'Claude Code session', parser: 'claude' },
    { key: 'orchestrator', name: 'Orchestrator', parser: 'claude' },
    { key: ' custom ', name: 'Custom', parser: 'custom' },
  ]

  it('lists the lanes in the agent list and leaves sessions and the orchestrator out', () => {
    expect(validLanes(AGENTS)).toEqual(['opencode', 'opencode2', 'claude'])
  })

  it('reads the lanes from the agent list when one is passed', () => {
    expect(ownerToLane({ owners: ['opencode2'] }, AGENTS)).toBe('opencode2')
    expect(ownerToLane({ owners: ['opencode3'] }, AGENTS)).toBeNull()
  })

  it('answers no lane with no agents', () => {
    expect(validLanes(null)).toEqual([])
    expect(validLanes([])).toEqual([])
  })
})

describe('runLaneFor', () => {
  const LANES = ['hermes', 'opencode', 'opencode2', 'agy', 'claude']

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
