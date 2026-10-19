import { describe, expect, it } from 'vitest'
import { cleanAgentDraft } from '../src/control/agents.js'
import { createMockClient } from '../src/control/mock.js'
import {
  ADAPTER_TYPES,
  AGENT_ROLES,
  EFFORTS,
  LIMITS,
  TEXT_LIMITS,
  draftFromForm,
  existingAgentForm,
  fieldProblem,
  formForAgent,
  groupModelsByTier,
  initialAgentForm,
  newAgentForm,
  patchFromChange,
} from '../src/ui/panels/agentForm.js'

const SAMPLE_AGENT = {
  id: 'agent-claude',
  key: 'claude-code',
  name: 'Claude Code',
  adapterType: 'claude_local',
  role: 'engineer',
  status: 'idle',
  model: 'claude-haiku-5-5',
  reasoningEffort: null,
  maxTurnsPerRun: 14,
  timeoutSec: 420,
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  subagentsAllowed: false,
  subagentDepth: 0,
  instructions: '',
  reportsToAgentId: null,
}

describe('initialAgentForm / newAgentForm / existingAgentForm', () => {
  it('creates starting state for a new agent', () => {
    const form = newAgentForm()
    expect(form).toEqual(initialAgentForm(null))
    expect(form).toEqual(formForAgent())
    expect(form).toEqual({
      name: '',
      adapterType: ADAPTER_TYPES[0],
      role: 'engineer',
      model: '',
      reasoningEffort: '',
      maxTurnsPerRun: '',
      timeoutSec: '',
      budgetDollars: '0',
      subagentsAllowed: false,
      subagentDepth: String(LIMITS.subagentDepth[0]),
      instructions: '',
      reportsToAgentId: '',
    })
  })

  it('creates starting state for an existing agent', () => {
    const form = existingAgentForm(SAMPLE_AGENT)
    expect(form).toEqual(initialAgentForm(SAMPLE_AGENT))
    expect(form).toEqual({
      name: 'Claude Code',
      adapterType: 'claude_local',
      role: 'engineer',
      model: 'claude-haiku-5-5',
      reasoningEffort: '',
      maxTurnsPerRun: '14',
      timeoutSec: '420',
      budgetDollars: '0',
      subagentsAllowed: false,
      subagentDepth: '1',
      instructions: '',
      reportsToAgentId: '',
    })
  })

  it('formats whole dollar and decimal budgets from cents and keeps subagent depth in range', () => {
    const whole = initialAgentForm({ ...SAMPLE_AGENT, budgetMonthlyCents: 500, subagentsAllowed: true, subagentDepth: 3 })
    expect(whole.budgetDollars).toBe('5')
    expect(whole.subagentsAllowed).toBe(true)
    expect(whole.subagentDepth).toBe('3')

    const cents = initialAgentForm({ ...SAMPLE_AGENT, budgetMonthlyCents: 1234 })
    expect(cents.budgetDollars).toBe('12.34')

    const smallCents = initialAgentForm({ ...SAMPLE_AGENT, budgetMonthlyCents: 29 })
    expect(smallCents.budgetDollars).toBe('0.29')
  })
})

describe('draftFromForm', () => {
  it('turns empty text into null for model, effort, turn limit and time limit and passes cleanAgentDraft', async () => {
    const draft = draftFromForm({
      ...newAgentForm(),
      name: 'Planner',
      adapterType: 'claude_local',
      model: '   ',
      reasoningEffort: '',
      maxTurnsPerRun: '',
      timeoutSec: '  ',
      reportsToAgentId: '',
    })
    expect(draft).toEqual({
      name: 'Planner',
      adapterType: 'claude_local',
      role: 'engineer',
      model: null,
      reasoningEffort: null,
      maxTurnsPerRun: null,
      timeoutSec: null,
      budgetMonthlyCents: 0,
      subagentsAllowed: false,
      subagentDepth: LIMITS.subagentDepth[0],
      instructions: '',
      reportsToAgentId: null,
    })
    expect(cleanAgentDraft(draft)).toMatchObject({
      name: 'Planner',
      adapterType: 'claude_local',
      subagentsAllowed: false,
      subagentDepth: 0,
    })
    const client = createMockClient({ latencyMs: 0 })
    const hired = await client.hireAgent(draft)
    expect(hired.agent).toMatchObject({ name: 'Planner', status: 'pending_approval' })
    expect(hired.approval).toMatchObject({ type: 'hire_agent', status: 'pending' })
  })

  it('converts dollars into whole cents with Math.round', () => {
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: '12.34' }).budgetMonthlyCents).toBe(1234)
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: '0.29' }).budgetMonthlyCents).toBe(29)
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: '5' }).budgetMonthlyCents).toBe(500)
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: '' }).budgetMonthlyCents).toBe(0)
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: 12.34 }).budgetMonthlyCents).toBe(1234)
    expect(draftFromForm({ ...newAgentForm(), name: 'A', budgetDollars: 0.29 }).budgetMonthlyCents).toBe(29)
  })

  it('parses integer limits and subagent depth when allowed', () => {
    const draft = draftFromForm({
      name: '  Hermes Two ',
      adapterType: 'hermes_local',
      role: 'researcher',
      model: ' deepseek/deepseek-v4.1-flash-1017 ',
      reasoningEffort: 'high',
      maxTurnsPerRun: '25',
      timeoutSec: '600',
      budgetDollars: '3.50',
      subagentsAllowed: true,
      subagentDepth: '2',
      instructions: 'Stay focused.',
      reportsToAgentId: 'agent-orchestrator',
    })
    expect(draft).toEqual({
      name: 'Hermes Two',
      adapterType: 'hermes_local',
      role: 'researcher',
      model: 'deepseek/deepseek-v4.1-flash-1017',
      reasoningEffort: 'high',
      maxTurnsPerRun: 25,
      timeoutSec: 600,
      budgetMonthlyCents: 350,
      subagentsAllowed: true,
      subagentDepth: 2,
      instructions: 'Stay focused.',
      reportsToAgentId: 'agent-orchestrator',
    })
  })

  it('produces values that fieldProblem rejects when inputs are invalid', () => {
    const badTurns = draftFromForm({ ...newAgentForm(), name: 'X', maxTurnsPerRun: '0' })
    expect(fieldProblem('maxTurnsPerRun', badTurns.maxTurnsPerRun)).toBe(
      'Turns per run must be a whole number from 1 to 200.'
    )

    const badBudget = draftFromForm({ ...newAgentForm(), name: 'X', budgetDollars: '12.345' })
    expect(fieldProblem('budgetMonthlyCents', badBudget.budgetMonthlyCents)).toBe(
      'The budget must be a whole number of cents, from 0 to 1,000,000.'
    )
  })
})

describe('patchFromChange', () => {
  it('returns an empty object when nothing changed', () => {
    const form = initialAgentForm(SAMPLE_AGENT)
    expect(patchFromChange(SAMPLE_AGENT, form)).toEqual({})
  })

  it('includes only changed fields', () => {
    const form = initialAgentForm(SAMPLE_AGENT)
    expect(patchFromChange(SAMPLE_AGENT, { ...form, maxTurnsPerRun: '20' })).toEqual({
      maxTurnsPerRun: 20,
    })

    expect(patchFromChange(SAMPLE_AGENT, { ...form, model: '', budgetDollars: '2.50' })).toEqual({
      model: null,
      budgetMonthlyCents: 250,
    })
  })

  it('handles subagent toggle and depth changes cleanly', () => {
    const form = initialAgentForm(SAMPLE_AGENT)
    expect(patchFromChange(SAMPLE_AGENT, { ...form, subagentsAllowed: true, subagentDepth: '1' })).toEqual({
      subagentsAllowed: true,
    })

    expect(patchFromChange(SAMPLE_AGENT, { ...form, subagentsAllowed: true, subagentDepth: '3' })).toEqual({
      subagentsAllowed: true,
      subagentDepth: 3,
    })

    const withSubagents = { ...SAMPLE_AGENT, subagentsAllowed: true, subagentDepth: 2 }
    const subForm = initialAgentForm(withSubagents)
    expect(patchFromChange(withSubagents, subForm)).toEqual({})
    expect(patchFromChange(withSubagents, { ...subForm, subagentDepth: '3' })).toEqual({
      subagentDepth: 3,
    })
    expect(patchFromChange(withSubagents, { ...subForm, subagentsAllowed: false })).toEqual({
      subagentsAllowed: false,
    })
  })
})

describe('groupModelsByTier and re-exported constants', () => {
  it('groups models by small, medium and large tiers', () => {
    const groups = groupModelsByTier([
      { id: 'm1', label: 'M1', tier: 'small' },
      { id: 'm2', label: 'M2', tier: 'large' },
      { id: 'm3', label: 'M3', tier: 'medium' },
    ])
    expect(groups.map((g) => g.tier)).toEqual(['small', 'medium', 'large'])
  })

  it('re-exports lists and limits from control/agents.js', () => {
    expect(ADAPTER_TYPES.length).toBeGreaterThan(0)
    expect(AGENT_ROLES).toContain('engineer')
    expect(EFFORTS).toEqual(['low', 'medium', 'high'])
    expect(LIMITS.subagentDepth).toEqual([1, 3])
    expect(TEXT_LIMITS.name).toBe(80)
  })
})
