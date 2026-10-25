import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_ENTRIES,
  REPLAY_LINE,
  currentSessionTitle,
  drawerEntry,
  lowerBreadcrumb,
  overviewEntries,
} from '../src/ui/lowerHalf.js'

describe('the lower half breadcrumb', () => {
  it('names the project in capitals and keeps the conversation title', () => {
    expect(lowerBreadcrumb('/agent-sandbox', 'Fix the header')).toBe(
      'AGENT-SANDBOX / Fix the header'
    )
    expect(lowerBreadcrumb('C:\\GitHub\\agent-sandbox', 'Ship it')).toBe(
      'AGENT-SANDBOX / Ship it'
    )
  })

  it('falls back to PROJECT and New conversation', () => {
    expect(lowerBreadcrumb('', '')).toBe('PROJECT / New conversation')
    expect(lowerBreadcrumb(null, null)).toBe('PROJECT / New conversation')
    expect(lowerBreadcrumb('/agent-sandbox', '   ')).toBe(
      'AGENT-SANDBOX / New conversation'
    )
  })

  it('collapses whitespace in the title and drops an empty title', () => {
    expect(lowerBreadcrumb('/room', '  A   long\n title  ')).toBe('ROOM / A long title')
    expect(lowerBreadcrumb('/room', 42)).toBe('ROOM / New conversation')
  })
})

describe('the current conversation title', () => {
  it('reads current.title from the sessions answer', () => {
    expect(currentSessionTitle({ current: { title: ' Fix the header ' } })).toBe('Fix the header')
    expect(currentSessionTitle({ current: { title: 'A\nB' } })).toBe('A B')
  })

  it('answers empty when the answer or title is missing', () => {
    expect(currentSessionTitle(null)).toBe('')
    expect(currentSessionTitle({})).toBe('')
    expect(currentSessionTitle({ current: null })).toBe('')
    expect(currentSessionTitle({ current: { title: 7 } })).toBe('')
    expect(currentSessionTitle({ current: { title: '  ' } })).toBe('')
  })
})

describe('the Overview entries', () => {
  it('holds Agent and Costs in that order, since Log and Settings open from the menu', () => {
    expect(overviewEntries()).toEqual([
      { id: 'agent', title: 'Agent' },
      { id: 'costs', title: 'Costs' },
    ])
    expect(OVERVIEW_ENTRIES.map((entry) => entry.id)).toEqual(['agent', 'costs'])
  })

  it('returns a fresh list each time', () => {
    const first = overviewEntries()
    first[0].title = 'Changed'
    first.push({ id: 'extra', title: 'Extra' })
    expect(overviewEntries()[0].title).toBe('Agent')
    expect(overviewEntries()).toHaveLength(2)
  })

  it('finds one entry by id and refuses an unknown id', () => {
    expect(drawerEntry('costs')).toEqual({ id: 'costs', title: 'Costs' })
    expect(drawerEntry('log')).toBeNull()
    expect(drawerEntry('missing')).toBeNull()
    expect(drawerEntry(null)).toBeNull()
  })
})

describe('the replay line', () => {
  it('names the recorded run and the Connect path', () => {
    expect(REPLAY_LINE).toBe(
      'This is a recorded run. Connect to your project to talk to the orchestrator.'
    )
  })
})
