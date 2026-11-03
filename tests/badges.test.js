import { describe, expect, it } from 'vitest'
import {
  actionBadges,
  orchestratorBadgeCount,
  proposalBadgeCount,
  reviewBadgeCount,
} from '../src/ui/badges.js'

describe('reviewBadgeCount', () => {
  it('counts the lanes whose branch is ahead', () => {
    expect(
      reviewBadgeCount([
        { lane: 'opencode', ahead: 2 },
        { lane: 'agy', ahead: 1 },
        { lane: 'claude', ahead: 0 },
      ])
    ).toBe(2)
  })

  it('leaves out an error row and a missing count', () => {
    expect(
      reviewBadgeCount([
        { lane: 'opencode', ahead: 2 },
        { lane: 'agy', ahead: 3, error: 'The branch is gone.' },
        { lane: 'claude' },
        null,
      ])
    ).toBe(1)
  })

  it('reads a reviews answer and a missing answer', () => {
    expect(reviewBadgeCount({ reviews: [{ ahead: 4 }] })).toBe(1)
    expect(reviewBadgeCount(null)).toBe(0)
  })
})

describe('proposalBadgeCount', () => {
  it('counts each proposal once', () => {
    expect(
      proposalBadgeCount({
        proposals: [{ id: 'p1' }, { id: 'p2' }, { id: 'p1' }, { id: '' }, null],
      })
    ).toBe(2)
  })

  it('reads a plain list and a missing answer', () => {
    expect(proposalBadgeCount([{ id: 'p1' }])).toBe(1)
    expect(proposalBadgeCount(undefined)).toBe(0)
  })
})

describe('orchestratorBadgeCount', () => {
  it('counts the orchestrators that wait or are paused', () => {
    expect(
      orchestratorBadgeCount([
        { id: 'orchestrator', state: 'idle' },
        { id: 'frontend', state: 'working' },
        { id: 'backend', state: 'paused' },
      ])
    ).toBe(2)
  })

  it('treats a missing state as waiting and reads an answer object', () => {
    expect(orchestratorBadgeCount({ orchestrators: [{ id: 'orchestrator' }] })).toBe(1)
    expect(orchestratorBadgeCount(null)).toBe(0)
  })
})

describe('actionBadges', () => {
  it('puts reviews on Control and proposals plus waiting orchestrators on Orchestrator', () => {
    const counts = actionBadges({
      reviews: [{ ahead: 2 }, { ahead: 0 }],
      proposals: [{ id: 'p1' }, { id: 'p2' }],
      orchestrators: [{ state: 'idle' }, { state: 'paused' }, { state: 'working' }],
    })
    expect(counts).toEqual({ control: 1, orchestrator: 4 })
  })

  it('shows nothing for empty answers', () => {
    expect(actionBadges()).toEqual({ control: 0, orchestrator: 0 })
  })
})
