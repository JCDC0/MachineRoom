import { describe, expect, it } from 'vitest'
import { ADAPTER_TYPES, AGENT_ROLES, CANNOT_TAKE_TASKS, cleanAgentDraft, cleanAgentPatch, hireSummary } from '../src/control/agents.js'

const base = { name: 'Planner', adapterType: 'claude_local' }

describe('constants', () => {
  it('follow the Paperclip lists', () => {
    expect(AGENT_ROLES).toHaveLength(12)
    expect(AGENT_ROLES).toContain('engineer')
    expect(ADAPTER_TYPES).toHaveLength(15)
    for (const adapter of ['claude_local', 'hermes_local', 'opencode_local', 'process']) expect(ADAPTER_TYPES).toContain(adapter)
    expect(CANNOT_TAKE_TASKS).toEqual(['pending_approval', 'terminated'])
  })
})

describe('cleanAgentDraft', () => {
  it('fills in the defaults', () => {
    expect(cleanAgentDraft(base)).toEqual({
      name: 'Planner',
      adapterType: 'claude_local',
      role: 'engineer',
      model: null,
      reasoningEffort: null,
      maxTurnsPerRun: null,
      timeoutSec: null,
      budgetMonthlyCents: 0,
      subagentsAllowed: false,
      subagentDepth: 0,
      instructions: '',
      reportsToAgentId: null,
    })
  })

  it('keeps every setting that was given', () => {
    const clean = cleanAgentDraft({
      name: '  Hermes Two ',
      adapterType: 'hermes_local',
      role: 'researcher',
      model: ' deepseek/deepseek-v4.1-flash-1017 ',
      reasoningEffort: 'high',
      maxTurnsPerRun: 14,
      timeoutSec: 420,
      budgetMonthlyCents: 500,
      subagentsAllowed: true,
      subagentDepth: 2,
      instructions: 'Be brief.',
      reportsToAgentId: 'agent-orchestrator',
    })
    expect(clean).toMatchObject({ name: 'Hermes Two', model: 'deepseek/deepseek-v4.1-flash-1017', reasoningEffort: 'high', maxTurnsPerRun: 14, timeoutSec: 420, subagentDepth: 2 })
  })

  it('gives allowed subagents a depth of one unless told otherwise, and none a depth of zero', () => {
    expect(cleanAgentDraft({ ...base, subagentsAllowed: true }).subagentDepth).toBe(1)
    expect(cleanAgentDraft({ ...base, subagentsAllowed: false, subagentDepth: 3 }).subagentDepth).toBe(0)
  })

  it('treats empty text for the optional text settings as none', () => {
    const clean = cleanAgentDraft({ ...base, model: '', reasoningEffort: '', reportsToAgentId: '' })
    expect(clean).toMatchObject({ model: null, reasoningEffort: null, reportsToAgentId: null })
  })

  it('needs a name and a harness', () => {
    expect(() => cleanAgentDraft({ adapterType: 'claude_local' })).toThrow('A name is required.')
    expect(() => cleanAgentDraft({ name: 'X' })).toThrow('Choose a harness.')
    expect(() => cleanAgentDraft({ name: '  ', adapterType: 'claude_local' })).toThrow(/name must be/)
    expect(() => cleanAgentDraft({ name: 'x'.repeat(81), adapterType: 'claude_local' })).toThrow(/name must be/)
  })

  it('refuses values outside the allowed lists and ranges, in plain words', () => {
    const cases = [
      [{ adapterType: 'telepathy' }, /harness from the list/],
      [{ role: 'wizard' }, /role from the list/],
      [{ reasoningEffort: 'max' }, /low, medium or high/],
      [{ maxTurnsPerRun: 0 }, /1 to 200/],
      [{ maxTurnsPerRun: 14.5 }, /1 to 200/],
      [{ maxTurnsPerRun: '14' }, /1 to 200/],
      [{ timeoutSec: 5 }, /10 to 7200/],
      [{ budgetMonthlyCents: -1 }, /cents/],
      [{ budgetMonthlyCents: 1000001 }, /cents/],
      [{ subagentsAllowed: 'yes' }, /yes or no/],
      [{ subagentsAllowed: true, subagentDepth: 4 }, /1, 2 or 3/],
      [{ instructions: 'x'.repeat(20001) }, /20,000/],
      [{ model: 'm'.repeat(121) }, /1 to 120/],
      [{ model: 5 }, /1 to 120/],
    ]
    for (const [extra, message] of cases) expect(() => cleanAgentDraft({ ...base, ...extra }), JSON.stringify(extra)).toThrow(message)
  })

  it('refuses a setting it does not know, a status, and a draft that is not an object', () => {
    expect(() => cleanAgentDraft({ ...base, permissions: {} })).toThrow('Unknown setting: permissions.')
    expect(() => cleanAgentDraft({ ...base, status: 'active' })).toThrow('Unknown setting: status.')
    expect(() => cleanAgentDraft(null)).toThrow(/object/)
    expect(() => cleanAgentDraft([])).toThrow(/object/)
  })

  it('ignores a setting that is undefined', () => {
    expect(cleanAgentDraft({ ...base, role: undefined }).role).toBe('engineer')
  })
})

describe('cleanAgentPatch', () => {
  it('keeps only what was given', () => {
    expect(cleanAgentPatch({ model: 'm', timeoutSec: 300 })).toEqual({ model: 'm', timeoutSec: 300 })
    expect(cleanAgentPatch({ status: 'paused' })).toEqual({ status: 'paused' })
    expect(cleanAgentPatch({ model: '' })).toEqual({ model: null })
  })

  it('needs at least one setting', () => {
    expect(() => cleanAgentPatch({})).toThrow('Change at least one setting.')
    expect(() => cleanAgentPatch({ model: undefined })).toThrow('Change at least one setting.')
  })

  it('does not let the harness change', () => {
    expect(() => cleanAgentPatch({ adapterType: 'hermes_local' })).toThrow('The harness cannot be changed. Hire a new agent.')
  })

  it('allows only active and paused as a status', () => {
    expect(() => cleanAgentPatch({ status: 'terminated' })).toThrow(/active or paused/)
    expect(() => cleanAgentPatch({ status: 'running' })).toThrow(/active or paused/)
  })

  it('refuses an unknown setting', () => {
    expect(() => cleanAgentPatch({ id: 'x' })).toThrow('Unknown setting: id.')
  })
})

describe('hireSummary', () => {
  it('says what is being hired in one line', () => {
    expect(hireSummary({ name: 'Planner', adapterType: 'claude_local', model: 'claude-sonnet-5-5', maxTurnsPerRun: 14, subagentsAllowed: false, subagentDepth: 0 })).toBe(
      'Hire "Planner" (claude_local, claude-sonnet-5-5, 14 turns, subagents off).'
    )
    expect(hireSummary({ name: 'Scout', adapterType: 'process', model: null, maxTurnsPerRun: null, subagentsAllowed: true, subagentDepth: 2 })).toBe('Hire "Scout" (process, subagents to depth 2).')
  })
})
