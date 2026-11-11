import { describe, expect, it } from 'vitest'
import { routeLane } from '../src/policy/route.js'

const LIMITS = {
  runUsd: 0.25,
  issueUsd: 1,
  agentMonthlyUsd: 10,
  companyMonthlyUsd: 30,
  maxTurnsPerRun: 200,
  timeoutSec: 3600,
}

function choice(lane, model, provider = 'opencode') {
  return { lane, model, reasoning: 'max', provider }
}

const OWNER = { lane: 'owner', model: null, reasoning: null, provider: null }

function policyOf(small, medium = [choice('x', 'm-x')], large = [choice('z', 'm-z'), OWNER]) {
  return { tiers: { small, medium, large }, limits: { ...LIMITS }, quotaSkipPercent: 90 }
}

const SMALL = { files: 1, hasTests: true, clarity: 'clear', reversible: true }
const lane = (key, extra = {}) => ({ key, eligible: true, active: true, busy: false, ...extra })
const over = (provider, usedPercent = 95) => ({ provider, ok: true, windows: [{ usedPercent }] })

describe('routeLane', () => {
  it('takes the first choice whose lane is eligible, active and free', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a'), choice('b', 'm-b')]),
      profile: SMALL,
      lanes: [lane('a')],
    })
    expect(answer).toEqual({
      lane: 'a',
      model: 'm-a',
      reasoning: 'max',
      tier: 'small',
      reason: 'The small tier runs a on m-a at max.',
      skipped: [],
    })
  })

  it('skips a busy choice and takes the next, with the reason', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a'), choice('b', 'm-b')]),
      profile: SMALL,
      lanes: [lane('a', { busy: true }), lane('b')],
    })
    expect(answer.lane).toBe('b')
    expect(answer.skipped).toEqual([{ lane: 'a', why: 'The lane a is busy.' }])
  })

  it('gives a reason for each kind of skip, in the tier order', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a'), choice('b', 'm-b'), choice('c', 'm-c'), choice('d', 'm-d')]),
      profile: SMALL,
      lanes: [
        lane('b', { eligible: false }),
        lane('c', { active: false }),
        lane('d', { busy: true }),
      ],
    })
    expect(answer.skipped).toEqual([
      { lane: 'a', why: 'The lane a is not in this room.' },
      { lane: 'b', why: 'The lane b is retired or has no command line.' },
      { lane: 'c', why: 'The lane c is turned off.' },
      { lane: 'd', why: 'The lane d is busy.' },
    ])
    expect(answer.lane).toBeNull()
    expect(answer.reason).toBe('Every lane is busy or turned off.')
  })

  it('skips a choice whose provider is over its quota', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a', 'open'), choice('b', 'm-b', 'other')]),
      profile: SMALL,
      quotas: [over('open', 95)],
      lanes: [lane('a'), lane('b')],
    })
    expect(answer.lane).toBe('b')
    expect(answer.skipped).toEqual([{ lane: 'a', why: 'The open provider is over its quota.' }])
  })

  it('skips the owner choice, which is not a lane', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      failures: 2,
      lanes: [lane('a')],
    })
    expect(answer.tier).toBe('large')
    expect(answer.lane).toBe('a')
    expect(answer.reason).toBe('No lane of the large tier is free, so the first free lane was taken.')
    expect(answer.skipped).toEqual([
      { lane: 'z', why: 'The lane z is not in this room.' },
      { lane: 'owner', why: 'The owner is not a lane.' },
    ])
  })

  it('falls to the first free lane of the list when no choice of the tier is free', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a'), choice('b', 'm-b')]),
      profile: SMALL,
      lanes: [lane('a', { busy: true }), lane('b', { active: false }), lane('c'), lane('d')],
    })
    expect(answer).toMatchObject({ lane: 'c', model: null, reasoning: null, tier: 'small' })
    expect(answer.reason).toBe('No lane of the small tier is free, so the first free lane was taken.')
    expect(answer.skipped).toHaveLength(2)
  })

  it('answers no lane when every lane is busy or turned off', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      lanes: [lane('a', { busy: true }), lane('b', { active: false }), lane('c', { eligible: false })],
    })
    expect(answer).toEqual({
      lane: null,
      model: null,
      reasoning: null,
      tier: 'small',
      reason: 'Every lane is busy or turned off.',
      skipped: [{ lane: 'a', why: 'The lane a is busy.' }],
    })
  })

  it('answers no lane over a spend limit with the limit sentence', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      spent: { companyMonthlyUsd: 30 },
      lanes: [lane('a')],
    })
    expect(answer.lane).toBeNull()
    expect(answer.reason).toBe('The company has spent $30.00 of its $30.00 monthly limit.')
    expect(answer.skipped).toEqual([])
  })

  it('uses the escalated tier and says so', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      failures: 1,
      lanes: [lane('x')],
    })
    expect(answer.tier).toBe('medium')
    expect(answer.lane).toBe('x')
    expect(answer.reason).toBe('The medium tier runs x on m-x at max. Escalated from the small tier after 1 failure.')
  })

  it('takes the first free lane in the list order, not the tier order', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      lanes: [lane('d'), lane('c'), lane('a')],
    })
    expect(answer.lane).toBe('a')
  })

  it('treats a lane with no flag as not eligible, not active and free', () => {
    const answer = routeLane({
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      lanes: [{ key: 'a' }],
    })
    expect(answer.lane).toBeNull()
    expect(answer.skipped[0].why).toBe('The lane a is retired or has no command line.')
  })

  it('ignores junk lanes and takes the same answer twice', () => {
    const args = {
      policy: policyOf([choice('a', 'm-a')]),
      profile: SMALL,
      lanes: [null, 'a', { key: '' }, { key: 'a', eligible: true, active: true }],
    }
    expect(routeLane(args)).toEqual(routeLane(args))
    expect(routeLane(args).lane).toBe('a')
  })

  it('refuses a policy it cannot read', () => {
    expect(() => routeLane({ policy: { tiers: {} }, profile: SMALL, lanes: [] })).toThrow('policy.tiers.small must be a list of choices.')
  })
})
