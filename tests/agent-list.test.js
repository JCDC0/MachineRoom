import { describe, expect, it } from 'vitest'
import { agentForNumber, agentList, displayName } from '../src/ui/agentList.js'

const orchestrator = { key: 'orchestrator', name: 'Orchestrator', status: 'idle' }
const alpha = { key: 'alpha', name: 'Alpha', status: 'idle' }
const beta = { key: 'beta', name: 'Beta', status: 'working' }
const gamma = { key: 'gamma', name: 'Gamma', status: 'queued' }
const delta = { key: 'delta', name: 'Delta', status: 'entered' }

const keys = (rows) => rows.map((row) => row.agent.key)

describe('agentList', () => {
  it('puts the orchestrator first, then the active lanes, then the idle lanes', () => {
    const list = agentList([alpha, beta, orchestrator, gamma])
    expect(keys(list.rows)).toEqual(['orchestrator', 'beta', 'gamma', 'alpha'])
    expect(list.rows.map((row) => row.group)).toEqual(['orchestrator', 'active', 'active', 'idle'])
    expect(list.rows.map((row) => row.visible)).toEqual([true, true, true, false])
    expect(list.rows.map((row) => row.number)).toEqual([1, 2, 3, null])
    expect(list.idleCount).toBe(1)
  })

  it('keeps done and failed agents beside the working ones', () => {
    const list = agentList([
      { key: 'done', name: 'Done', status: 'done' },
      { key: 'failed', name: 'Failed', status: 'error' },
      { key: 'working', name: 'Working', status: 'working' },
    ])
    expect(keys(list.rows)).toEqual(['done', 'failed', 'working'])
    expect(list.idleCount).toBe(0)
  })

  it('counts idle lanes, not their children', () => {
    const child = { key: 'alpha~1', name: 'Scout', status: 'idle', parent: 'alpha', depth: 1 }
    const list = agentList([alpha, child, { key: 'other', name: 'Other', status: 'idle' }])
    expect(list.idleCount).toBe(2)
    expect(list.rows.filter((row) => row.group === 'idle').map((row) => row.agent.key)).toEqual([
      'alpha',
      'alpha~1',
      'other',
    ])
  })

  it('shows the idle lanes and numbers them when the idle row is open', () => {
    const list = agentList([alpha, beta, orchestrator], true)
    expect(keys(list.rows)).toEqual(['orchestrator', 'beta', 'alpha'])
    expect(list.rows.map((row) => row.number)).toEqual([1, 2, 3])
    expect(list.top.map((agent) => agent.key)).toEqual(['orchestrator', 'beta', 'alpha'])
  })

  it('picks number keys from the order shown', () => {
    const closed = agentList([alpha, beta, orchestrator, gamma])
    expect(agentForNumber(closed, '1')).toBe(orchestrator)
    expect(agentForNumber(closed, '2')).toBe(beta)
    expect(agentForNumber(closed, '3')).toBe(gamma)
    expect(agentForNumber(closed, '4')).toBeNull()

    const open = agentList([alpha, beta, orchestrator, gamma], true)
    expect(agentForNumber(open, 4)).toBe(alpha)
    expect(agentForNumber(open, '5')).toBeNull()
    expect(agentForNumber(open, '0')).toBeNull()
    expect(agentForNumber(open, 'x')).toBeNull()
  })

  it('moves an agent up when it leaves idle', () => {
    const before = agentList([orchestrator, alpha, beta])
    expect(keys(before.rows.filter((row) => row.visible))).toEqual(['orchestrator', 'beta'])
    expect(before.idleCount).toBe(1)

    const after = agentList([orchestrator, { ...alpha, status: 'working' }, beta])
    expect(keys(after.rows.filter((row) => row.visible))).toEqual(['orchestrator', 'alpha', 'beta'])
    expect(after.rows.map((row) => row.number)).toEqual([1, 2, 3])
    expect(after.idleCount).toBe(0)
  })

  it('shows a parent when a working child sits under it', () => {
    const child = { key: 'alpha~1', name: 'Scout', status: 'working', parent: 'alpha', depth: 1 }
    const list = agentList([orchestrator, alpha, child])
    expect(keys(list.rows)).toEqual(['orchestrator', 'alpha', 'alpha~1'])
    expect(list.rows.map((row) => row.depth)).toEqual([0, 0, 1])
    expect(list.rows.map((row) => row.number)).toEqual([1, 2, null])
    expect(list.idleCount).toBe(0)
  })

  it('treats unknown status as idle', () => {
    const list = agentList([delta])
    expect(list.idleCount).toBe(1)
    expect(list.rows[0].visible).toBe(false)
  })
})

describe('displayName', () => {
  it('shows the label when one is set', () => {
    expect(displayName('opencode', new Map([['opencode', 'Bridge Coder']]))).toBe('Bridge Coder')
    expect(displayName('opencode', { opencode: 'Bridge Coder' })).toBe('Bridge Coder')
  })

  it('shows the key when the label is missing, empty or no map is given', () => {
    expect(displayName('opencode', new Map())).toBe('opencode')
    expect(displayName('opencode', new Map([['claude', 'Lead']]))).toBe('opencode')
    expect(displayName('opencode', { opencode: '' })).toBe('opencode')
    expect(displayName('opencode', null)).toBe('opencode')
  })

  it('does not read a prototype name as a label', () => {
    expect(displayName('toString', {})).toBe('toString')
    expect(displayName('orchestrator', Object.create({ orchestrator: 'Borrowed' }))).toBe('orchestrator')
  })

  it('answers empty text for no key', () => {
    expect(displayName(null, new Map([['orchestrator', 'Lead']]))).toBe('')
    expect(displayName(undefined, null)).toBe('')
  })
})
