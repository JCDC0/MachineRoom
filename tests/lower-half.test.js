import { describe, expect, it } from 'vitest'
import {
  REPLAY_LINE,
  currentSessionTitle,
  lowerBreadcrumb,
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

describe('the replay line', () => {
  it('names the recorded run and the Connect path', () => {
    expect(REPLAY_LINE).toBe(
      'This is a recorded run. Connect to your project to talk to the orchestrator.'
    )
  })
})
