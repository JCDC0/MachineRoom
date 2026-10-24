export const AGENT_ROLES = ['ceo', 'cto', 'cmo', 'cfo', 'security', 'engineer', 'designer', 'pm', 'qa', 'devops', 'researcher', 'general']

export const ADAPTER_TYPES = [
  'process',
  'http',
  'claude_local',
  'codex_local',
  'cursor_cloud',
  'gemini_local',
  'grok_local',
  'hermes_gateway',
  'hermes_local',
  'kimi_local',
  'opencode_local',
  'pi_local',
  'cursor',
  'openclaw_gateway',
]

export const EFFORTS = ['low', 'medium', 'high']
export const PRIORITIES = ['critical', 'high', 'medium', 'low']
export const TASK_OVERRIDE_KEYS = ['model', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed']
export const SETTABLE_STATUS = ['active', 'paused']
export const CANNOT_TAKE_TASKS = ['pending_approval', 'terminated']

export const LIMITS = Object.freeze({ maxTurnsPerRun: [1, 200], timeoutSec: [10, 7200], budgetMonthlyCents: [0, 1000000], subagentDepth: [1, 3] })
export const TEXT_LIMITS = Object.freeze({ name: 80, model: 120, instructions: 20000 })

function fail(message) {
  throw new Error(message)
}

function whole(value, name, message) {
  const [low, high] = LIMITS[name]
  return Number.isInteger(value) && value >= low && value <= high ? value : fail(message)
}

const text = (value) => (typeof value === 'string' ? value.trim() : value)
const blank = (value) => value === null || text(value) === ''

const CHECKS = {
  name: (value) => (typeof value === 'string' && text(value).length >= 1 && text(value).length <= TEXT_LIMITS.name ? text(value) : fail('The name must be 1 to 80 characters.')),
  adapterType: (value) => (ADAPTER_TYPES.includes(value) ? value : fail('Choose a harness from the list.')),
  role: (value) => (AGENT_ROLES.includes(value) ? value : fail('Choose a role from the list.')),
  model: (value) => (blank(value) ? null : typeof value === 'string' && text(value).length <= TEXT_LIMITS.model ? text(value) : fail('The model must be 1 to 120 characters, or empty.')),
  reasoningEffort: (value) => (blank(value) ? null : EFFORTS.includes(value) ? value : fail('Effort must be low, medium or high.')),
  maxTurnsPerRun: (value) => (value === null ? null : whole(value, 'maxTurnsPerRun', 'Turns per run must be a whole number from 1 to 200.')),
  timeoutSec: (value) => (value === null ? null : whole(value, 'timeoutSec', 'The time limit must be a whole number of seconds from 10 to 7200.')),
  budgetMonthlyCents: (value) => whole(value, 'budgetMonthlyCents', 'The budget must be a whole number of cents, from 0 to 1,000,000.'),
  subagentsAllowed: (value) => (typeof value === 'boolean' ? value : fail('Subagents must be yes or no.')),
  subagentDepth: (value) => whole(value, 'subagentDepth', 'The subagent depth must be 1, 2 or 3.'),
  instructions: (value) => (typeof value === 'string' && value.length <= TEXT_LIMITS.instructions ? value : fail('The instructions must be text of at most 20,000 characters.')),
  reportsToAgentId: (value) => (blank(value) ? null : typeof value === 'string' ? text(value) : fail('Reports to must name an agent, or be empty.')),
  status: (value) => (SETTABLE_STATUS.includes(value) ? value : fail('The status must be active or paused.')),
}

export function fieldProblem(key, value) {
  if (!Object.hasOwn(CHECKS, key)) return null
  try {
    CHECKS[key](value)
    return null
  } catch (error) {
    return error.message
  }
}

export function taskDraftProblem(draft) {
  const priority = draft?.priority
  if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) return 'The priority must be critical, high, medium or low.'
  for (const key of TASK_OVERRIDE_KEYS) {
    const value = draft?.[key]
    if (value === undefined || value === null || value === '') continue
    const problem = fieldProblem(key, value)
    if (problem) return problem
  }
  return null
}

const DRAFT_KEYS = ['name', 'adapterType', 'role', 'model', 'reasoningEffort', 'maxTurnsPerRun', 'timeoutSec', 'budgetMonthlyCents', 'subagentsAllowed', 'subagentDepth', 'instructions', 'reportsToAgentId']
const PATCH_KEYS = DRAFT_KEYS.filter((key) => key !== 'adapterType').concat('status')

function readFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Send the settings as an object.')
  const clean = {}
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) continue
    if (key === 'adapterType' && !allowed.includes(key)) fail('The harness cannot be changed. Hire a new agent.')
    if (!allowed.includes(key)) fail(`Unknown setting: ${key}.`)
    clean[key] = CHECKS[key](input[key])
  }
  return clean
}

export function cleanAgentDraft(draft) {
  const clean = readFields(draft, DRAFT_KEYS)
  if (clean.name === undefined) fail('A name is required.')
  if (clean.adapterType === undefined) fail('Choose a harness.')
  const subagentsAllowed = clean.subagentsAllowed ?? false
  return {
    name: clean.name,
    adapterType: clean.adapterType,
    role: clean.role ?? 'engineer',
    model: clean.model ?? null,
    reasoningEffort: clean.reasoningEffort ?? null,
    maxTurnsPerRun: clean.maxTurnsPerRun ?? null,
    timeoutSec: clean.timeoutSec ?? null,
    budgetMonthlyCents: clean.budgetMonthlyCents ?? 0,
    subagentsAllowed,
    subagentDepth: subagentsAllowed ? (clean.subagentDepth ?? 1) : 0,
    instructions: clean.instructions ?? '',
    reportsToAgentId: clean.reportsToAgentId ?? null,
  }
}

export function cleanAgentPatch(patch) {
  const clean = readFields(patch, PATCH_KEYS)
  if (Object.keys(clean).length === 0) fail('Change at least one setting.')
  return clean
}

export function hireSummary(agent) {
  const parts = [agent.adapterType]
  if (agent.model) parts.push(agent.model)
  if (agent.maxTurnsPerRun) parts.push(`${agent.maxTurnsPerRun} turns`)
  parts.push(agent.subagentsAllowed ? `subagents to depth ${agent.subagentDepth}` : 'subagents off')
  return `Hire "${agent.name}" (${parts.join(', ')}).`
}
