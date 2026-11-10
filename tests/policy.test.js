import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chooseRoute, escalate, readPolicy, tierFor, TIERS } from '../src/policy/route.js'

const POLICY_TEXT = readFileSync(new URL('../docs/agents/policy.json', import.meta.url), 'utf8')
const policyFile = () => JSON.parse(POLICY_TEXT)

const SMALL = { files: 2, hasTests: true, clarity: 'clear', reversible: true, touchesSecrets: false, touchesDeploy: false }
const MEDIUM = { files: 5, hasTests: true, clarity: 'clear', reversible: true, touchesSecrets: false, touchesDeploy: false }

const window = (usedPercent) => ({ label: 'week', usedPercent, resetsAt: null, detail: null })
const over = (provider, usedPercent = 95) => ({ provider, ok: true, windows: [window(usedPercent)] })

describe('tierFor', () => {
  it('sends an unclear task to large', () => {
    expect(tierFor({ ...SMALL, clarity: 'unclear' })).toBe('large')
  })

  it('sends a task that touches secrets to large', () => {
    expect(tierFor({ ...SMALL, touchesSecrets: true })).toBe('large')
  })

  it('sends a task that touches deployment to large', () => {
    expect(tierFor({ ...SMALL, touchesDeploy: true })).toBe('large')
  })

  it('sends a task that is not reversible to large', () => {
    expect(tierFor({ ...SMALL, reversible: false })).toBe('large')
  })

  it('keeps a clear task with two files and tests at small', () => {
    expect(tierFor(SMALL)).toBe('small')
  })

  it('keeps a clear task with one file and tests at small', () => {
    expect(tierFor({ ...SMALL, files: 1 })).toBe('small')
  })

  it('sends three files with tests to medium', () => {
    expect(tierFor(MEDIUM)).toBe('medium')
  })

  it('sends two files without tests to medium', () => {
    expect(tierFor({ ...SMALL, hasTests: false })).toBe('medium')
  })

  it('sends a task with no file count to medium', () => {
    expect(tierFor({ hasTests: true })).toBe('medium')
  })

  it('sends a task that needs a new test to medium', () => {
    expect(tierFor({ ...SMALL, newTest: true })).toBe('medium')
    expect(tierFor({ files: 1, hasTests: true, clarity: 'clear', reversible: true, newTest: true })).toBe('medium')
  })

  it('sends a design task and a task that touches data to large', () => {
    expect(tierFor({ ...SMALL, kind: 'design' })).toBe('large')
    expect(tierFor({ ...SMALL, touchesData: true })).toBe('large')
  })

  it('gives large the last word over small', () => {
    expect(tierFor({ files: 1, hasTests: true, clarity: 'unclear', reversible: true })).toBe('large')
  })

  it('takes junk as medium', () => {
    expect(tierFor(null)).toBe('medium')
    expect(tierFor('small')).toBe('medium')
  })
})

describe('escalate', () => {
  it('keeps the tier with no failures', () => {
    expect(escalate('small', 0)).toBe('small')
    expect(escalate('medium', 0)).toBe('medium')
  })

  it('moves up one tier per failure', () => {
    expect(escalate('small', 1)).toBe('medium')
    expect(escalate('medium', 1)).toBe('large')
  })

  it('stops at large', () => {
    expect(escalate('small', 2)).toBe('large')
    expect(escalate('small', 9)).toBe('large')
    expect(escalate('large', 1)).toBe('large')
  })

  it('keeps the tier for junk failures', () => {
    expect(escalate('medium', -1)).toBe('medium')
    expect(escalate('medium', '1')).toBe('medium')
    expect(escalate('medium', undefined)).toBe('medium')
  })
})

describe('chooseRoute', () => {
  it('takes the first small choice', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, quotas: [], spent: {} })
    expect(route.tier).toBe('small')
    expect(route.choice).toEqual({ lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' })
    expect(route.reason).toBe('The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.')
  })

  it('takes the first medium choice', () => {
    const route = chooseRoute({ policy: policyFile(), profile: MEDIUM, quotas: [] })
    expect(route.choice.lane).toBe('opencode')
    expect(route.choice.reasoning).toBe('max')
  })

  it('skips a provider above its quota and takes the next choice', () => {
    const route = chooseRoute({ policy: policyFile(), profile: MEDIUM, quotas: [over('opencode', 91)] })
    expect(route.tier).toBe('medium')
    expect(route.choice.lane).toBe('agy2')
    expect(route.choice.model).toBe('gemini-3.8-flash-high')
  })

  it('does not skip a provider at exactly the skip percent', () => {
    const route = chooseRoute({ policy: policyFile(), profile: MEDIUM, quotas: [over('opencode', 90)] })
    expect(route.choice.lane).toBe('opencode')
  })

  it('does not skip a window with no percent', () => {
    const quotas = [{ provider: 'opencode', ok: true, windows: [window(null)] }]
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, quotas })
    expect(route.choice.model).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('does not skip a provider that could not be read', () => {
    const quotas = [{ provider: 'opencode', ok: false, error: 'Not available.', windows: [window(99)] }]
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, quotas })
    expect(route.choice.model).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('gives no choice when every choice is skipped', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, quotas: [over('opencode'), over('antigravity')] })
    expect(route.tier).toBe('small')
    expect(route.choice).toBeNull()
    expect(route.reason).toBe('Every choice for the small tier is above its quota.')
  })

  it('falls back to the owner when the large provider is over', () => {
    const route = chooseRoute({ policy: policyFile(), profile: { ...SMALL, touchesDeploy: true }, quotas: [over('opencode', 99)] })
    expect(route.tier).toBe('large')
    expect(route.choice).toEqual({ lane: 'owner', model: null, reasoning: null, provider: null })
    expect(route.reason).toBe('The large tier asks the owner.')
  })

  it('uses the escalated tier', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, failures: 1, quotas: [] })
    expect(route.tier).toBe('medium')
    expect(route.choice.lane).toBe('opencode')
    expect(route.reason).toBe('The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max. Escalated from the small tier after 1 failure.')
  })

  it('says how many failures moved the tier up', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, failures: 3 })
    expect(route.tier).toBe('large')
    expect(route.reason).toContain('Escalated from the small tier after 3 failures.')
  })

  it('gives no choice when the run is at its limit', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent: { runUsd: 0.25 } })
    expect(route.choice).toBeNull()
    expect(route.reason).toBe('The run has spent $0.25 of its $0.25 limit.')
  })

  it('gives no choice when the issue is over its limit', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent: { issueUsd: 1.5 } })
    expect(route.reason).toBe('The issue has spent $1.50 of its $1.00 limit.')
  })

  it('gives no choice when the agent is at its monthly limit', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent: { agentMonthlyUsd: 10 } })
    expect(route.reason).toBe('The agent has spent $10.00 of its $10.00 monthly limit.')
  })

  it('gives no choice when the company is over its monthly limit', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent: { companyMonthlyUsd: 42 } })
    expect(route.reason).toBe('The company has spent $42.00 of its $30.00 monthly limit.')
  })

  it('names the nearest limit first', () => {
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent: { runUsd: 0.3, issueUsd: 2 } })
    expect(route.reason).toBe('The run has spent $0.30 of its $0.25 limit.')
  })

  it('routes when spend is under every limit', () => {
    const spent = { runUsd: 0.24, issueUsd: 0.99, agentMonthlyUsd: 9.99, companyMonthlyUsd: 29.99 }
    const route = chooseRoute({ policy: policyFile(), profile: SMALL, spent })
    expect(route.choice.lane).toBe('opencode2')
  })

  it('takes a policy that readPolicy already read', () => {
    const policy = readPolicy(policyFile())
    const route = chooseRoute({ policy, profile: SMALL, quotas: [] })
    expect(route.choice.model).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('gives the same answer for the same input', () => {
    const args = { policy: policyFile(), profile: MEDIUM, failures: 1, quotas: [over('opencode')], spent: { runUsd: 0.1 } }
    expect(chooseRoute(args)).toEqual(chooseRoute(args))
  })
})

describe('readPolicy', () => {
  it('reads the real policy file', () => {
    const policy = readPolicy(POLICY_TEXT)
    expect(Object.keys(policy.tiers)).toEqual(TIERS)
    expect(policy.tiers.small).toHaveLength(3)
    expect(policy.tiers.medium).toHaveLength(3)
    expect(policy.tiers.large).toHaveLength(3)
    expect(policy.limits).toEqual({ runUsd: 0.25, issueUsd: 1, agentMonthlyUsd: 10, companyMonthlyUsd: 30, maxTurnsPerRun: 200, timeoutSec: 3600 })
    expect(policy.quotaSkipPercent).toBe(90)
  })

  it('reads the real policy file from its text and from its object the same way', () => {
    expect(readPolicy(POLICY_TEXT)).toEqual(readPolicy(policyFile()))
  })

  it('keeps the owner choice with no model, reasoning or provider', () => {
    const policy = readPolicy(policyFile())
    expect(policy.tiers.large[2]).toEqual({ lane: 'owner', model: null, reasoning: null, provider: null })
  })

  it('reads a policy that readPolicy already read', () => {
    const policy = readPolicy(policyFile())
    expect(readPolicy(policy)).toEqual(policy)
  })

  it('refuses text that is not JSON', () => {
    expect(() => readPolicy('{ tiers: ')).toThrow('The policy file is not JSON.')
  })

  it('refuses a policy that is not an object', () => {
    expect(() => readPolicy(null)).toThrow('policy must be an object.')
    expect(() => readPolicy([])).toThrow('policy must be an object.')
  })

  const BAD = [
    ['no tiers', (p) => delete p.tiers, 'policy.tiers must be an object.'],
    ['a tier that is not known', (p) => { p.tiers.tiny = p.tiers.small }, 'policy.tiers.tiny is not a tier.'],
    ['no small tier', (p) => delete p.tiers.small, 'policy.tiers.small must be a list of choices.'],
    ['a tier that is not a list', (p) => { p.tiers.small = {} }, 'policy.tiers.small must be a list of choices.'],
    ['an empty tier', (p) => { p.tiers.small = [] }, 'policy.tiers.small must hold at least one choice.'],
    ['a choice that is not an object', (p) => { p.tiers.small[0] = 'hermes' }, 'policy.tiers.small[0] must be an object.'],
    ['no lane', (p) => delete p.tiers.small[0].lane, 'policy.tiers.small[0].lane must be text.'],
    ['a blank lane', (p) => { p.tiers.small[0].lane = ' ' }, 'policy.tiers.small[0].lane must be text.'],
    ['no model', (p) => delete p.tiers.small[0].model, 'policy.tiers.small[0].model must be text.'],
    ['a model that is not text', (p) => { p.tiers.small[0].model = 42 }, 'policy.tiers.small[0].model must be text.'],
    ['no reasoning', (p) => delete p.tiers.small[0].reasoning, 'policy.tiers.small[0].reasoning must be text.'],
    ['no provider', (p) => delete p.tiers.small[0].provider, 'policy.tiers.small[0].provider must be text.'],
    ['a choice field that is not known', (p) => { p.tiers.small[0].effort = 'high' }, 'policy.tiers.small[0].effort is not a choice field.'],
    ['no limits', (p) => delete p.limits, 'policy.limits must be an object.'],
    ['a limit that is not known', (p) => { p.limits.budgetUsd = 1 }, 'policy.limits.budgetUsd is not a limit.'],
    ['a run limit of zero', (p) => { p.limits.runUsd = 0 }, 'policy.limits.runUsd must be a number above 0.'],
    ['a run limit that is text', (p) => { p.limits.runUsd = '0.25' }, 'policy.limits.runUsd must be a number above 0.'],
    ['no issue limit', (p) => delete p.limits.issueUsd, 'policy.limits.issueUsd must be a number above 0.'],
    ['an agent limit below zero', (p) => { p.limits.agentMonthlyUsd = -1 }, 'policy.limits.agentMonthlyUsd must be a number above 0.'],
    ['a company limit that is null', (p) => { p.limits.companyMonthlyUsd = null }, 'policy.limits.companyMonthlyUsd must be a number above 0.'],
    ['a turn limit of zero', (p) => { p.limits.maxTurnsPerRun = 0 }, 'policy.limits.maxTurnsPerRun must be a whole number above 0.'],
    ['a turn limit that is not whole', (p) => { p.limits.maxTurnsPerRun = 200.5 }, 'policy.limits.maxTurnsPerRun must be a whole number above 0.'],
    ['a time limit that is text', (p) => { p.limits.timeoutSec = '3600' }, 'policy.limits.timeoutSec must be a whole number above 0.'],
    ['no quota skip percent', (p) => delete p.quotaSkipPercent, 'policy.quotaSkipPercent must be a number from 0 to 100.'],
    ['a quota skip percent above 100', (p) => { p.quotaSkipPercent = 101 }, 'policy.quotaSkipPercent must be a number from 0 to 100.'],
    ['a quota skip percent that is text', (p) => { p.quotaSkipPercent = '90' }, 'policy.quotaSkipPercent must be a number from 0 to 100.'],
  ]

  for (const [name, breakPolicy, sentence] of BAD) {
    it(`refuses ${name}`, () => {
      const policy = policyFile()
      breakPolicy(policy)
      expect(() => readPolicy(policy)).toThrow(sentence)
    })
  }
})
