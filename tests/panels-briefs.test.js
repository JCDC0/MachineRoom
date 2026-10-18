import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import {
  chooseAssignee,
  formatBriefTitle,
  getFirstOwner,
  groupBriefsByOwner,
  laneForBrief,
  ownerToLane,
  pickAssignee,
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

  it('returns null when owned only by Claude or the owner or has no valid lane', () => {
    expect(ownerToLane({ owners: ['claude'] })).toBeNull()
    expect(ownerToLane({ owners: [] })).toBeNull()
    expect(ownerToLane('claude')).toBeNull()
    expect(ownerToLane('Claude')).toBeNull()
    expect(ownerToLane('owner')).toBeNull()
    expect(ownerToLane('')).toBeNull()
    expect(ownerToLane(null)).toBeNull()
    expect(ownerToLane(undefined)).toBeNull()
  })

  it('uses only the first owner even when another owner follows', () => {
    expect(ownerToLane({ owners: ['claude', 'agy'] })).toBeNull()
    expect(ownerToLane({ owners: ['agy', 'claude'] })).toBe('agy')
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
