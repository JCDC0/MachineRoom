import { ADAPTER_TYPES, AGENT_ROLES, EFFORTS, LIMITS, TEXT_LIMITS, fieldProblem } from '../../control/agents.js'

export { ADAPTER_TYPES, AGENT_ROLES, EFFORTS, LIMITS, TEXT_LIMITS, fieldProblem }

export function initialAgentForm(agent = null) {
  if (!agent) {
    return {
      name: '',
      adapterType: ADAPTER_TYPES[0] ?? 'claude_local',
      role: AGENT_ROLES.includes('engineer') ? 'engineer' : AGENT_ROLES[0],
      model: '',
      reasoningEffort: '',
      maxTurnsPerRun: '',
      timeoutSec: '',
      budgetDollars: '0',
      subagentsAllowed: false,
      subagentDepth: String(LIMITS.subagentDepth[0]),
      instructions: '',
      reportsToAgentId: '',
    }
  }

  const cents = agent.budgetMonthlyCents ?? 0
  const budgetDollars =
    cents === 0
      ? '0'
      : cents % 100 === 0
        ? String(cents / 100)
        : (cents / 100).toFixed(2)

  const rawDepth = Number(agent.subagentDepth)
  const validDepth =
    Number.isInteger(rawDepth) && rawDepth >= LIMITS.subagentDepth[0] && rawDepth <= LIMITS.subagentDepth[1]
      ? rawDepth
      : LIMITS.subagentDepth[0]

  return {
    name: agent.name != null ? String(agent.name) : '',
    adapterType: agent.adapterType != null ? String(agent.adapterType) : (ADAPTER_TYPES[0] ?? 'claude_local'),
    role: agent.role != null ? String(agent.role) : (AGENT_ROLES.includes('engineer') ? 'engineer' : AGENT_ROLES[0]),
    model: agent.model != null ? String(agent.model) : '',
    reasoningEffort: agent.reasoningEffort != null ? String(agent.reasoningEffort) : '',
    maxTurnsPerRun: agent.maxTurnsPerRun != null ? String(agent.maxTurnsPerRun) : '',
    timeoutSec: agent.timeoutSec != null ? String(agent.timeoutSec) : '',
    budgetDollars,
    subagentsAllowed: Boolean(agent.subagentsAllowed),
    subagentDepth: String(validDepth),
    instructions: agent.instructions != null ? String(agent.instructions) : '',
    reportsToAgentId: agent.reportsToAgentId != null ? String(agent.reportsToAgentId) : '',
  }
}

export function newAgentForm() {
  return initialAgentForm(null)
}

export function existingAgentForm(agent) {
  return initialAgentForm(agent)
}

export function formForAgent(agent = null) {
  return initialAgentForm(agent)
}

function parseOptionalWhole(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return raw
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  return Number(trimmed)
}

function parseDollarsToCents(raw) {
  if (raw === null || raw === undefined) return 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : NaN
  const trimmed = String(raw).trim()
  if (trimmed === '') return 0
  if (!/^-?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(trimmed)) return NaN
  return Math.round(Number(trimmed) * 100)
}

function parseDepth(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return LIMITS.subagentDepth[0]
  return Number(String(raw).trim())
}

export function draftFromForm(form = {}) {
  const name = typeof form.name === 'string' ? form.name.trim() : ''
  const adapterType = typeof form.adapterType === 'string' ? form.adapterType.trim() : ''
  const role = typeof form.role === 'string' && form.role.trim() !== ''
    ? form.role.trim()
    : (AGENT_ROLES.includes('engineer') ? 'engineer' : AGENT_ROLES[0])

  const rawModel = typeof form.model === 'string' ? form.model.trim() : (form.model ?? '')
  const model = rawModel === '' || rawModel === null ? null : String(rawModel).trim()

  const rawEffort = typeof form.reasoningEffort === 'string' ? form.reasoningEffort.trim() : (form.reasoningEffort ?? '')
  const reasoningEffort = rawEffort === '' || rawEffort === null ? null : String(rawEffort).trim()

  const maxTurnsPerRun = parseOptionalWhole(form.maxTurnsPerRun)
  const timeoutSec = parseOptionalWhole(form.timeoutSec)

  const budgetRaw = form.budgetDollars !== undefined ? form.budgetDollars : (form.budget !== undefined ? form.budget : form.budgetMonthlyDollars)
  const budgetMonthlyCents =
    budgetRaw === undefined && typeof form.budgetMonthlyCents === 'number'
      ? form.budgetMonthlyCents
      : parseDollarsToCents(budgetRaw)

  const subagentsAllowed = Boolean(form.subagentsAllowed)
  const subagentDepth = subagentsAllowed ? parseDepth(form.subagentDepth) : LIMITS.subagentDepth[0]

  const instructions = typeof form.instructions === 'string' ? form.instructions : ''

  const rawReportsTo = typeof form.reportsToAgentId === 'string' ? form.reportsToAgentId.trim() : (form.reportsToAgentId ?? '')
  const reportsToAgentId = rawReportsTo === '' || rawReportsTo === null ? null : String(rawReportsTo).trim()

  return {
    name,
    adapterType,
    role,
    model,
    reasoningEffort,
    maxTurnsPerRun,
    timeoutSec,
    budgetMonthlyCents,
    subagentsAllowed,
    subagentDepth,
    instructions,
    reportsToAgentId,
  }
}

export function patchFromChange(agent, form) {
  if (!agent || !form) return {}
  const draft = draftFromForm(form)
  const base = draftFromForm(initialAgentForm(agent))
  const patch = {}

  const keys = [
    'name',
    'role',
    'model',
    'reasoningEffort',
    'maxTurnsPerRun',
    'timeoutSec',
    'budgetMonthlyCents',
    'subagentsAllowed',
    'instructions',
    'reportsToAgentId',
  ]

  for (const key of keys) {
    if (!Object.is(draft[key], base[key])) {
      patch[key] = draft[key]
    }
  }

  if (draft.subagentsAllowed) {
    const prevAllowed = Boolean(agent.subagentsAllowed)
    const prevDepth = prevAllowed ? (agent.subagentDepth ?? LIMITS.subagentDepth[0]) : 0
    if (prevAllowed) {
      if (!Object.is(draft.subagentDepth, prevDepth)) {
        patch.subagentDepth = draft.subagentDepth
      }
    } else {
      if (draft.subagentDepth !== LIMITS.subagentDepth[0]) {
        patch.subagentDepth = draft.subagentDepth
      }
    }
  }

  return patch
}

export function groupModelsByTier(models = []) {
  if (!Array.isArray(models)) return []
  const tiers = [
    { tier: 'small', label: 'Small' },
    { tier: 'medium', label: 'Medium' },
    { tier: 'large', label: 'Large' },
  ]
  const groups = []
  for (const { tier, label } of tiers) {
    const list = models.filter((item) => item?.tier === tier)
    if (list.length > 0) {
      groups.push({ tier, label, models: list })
    }
  }
  const other = models.filter((item) => item && !['small', 'medium', 'large'].includes(item.tier))
  if (other.length > 0) {
    groups.push({ tier: 'other', label: 'Other', models: other })
  }
  return groups
}
