export const TABS = ['dispatch', 'tasks', 'meters', 'agents']
export const SECTIONS = ['general', 'model', 'budget', 'subagents', 'keys']
export const SPEEDS = [1, 2, 4, 8]

const VIEWS = ['wide', 'close']
const FOLLOWS = ['wide', 'close', 'off']
const REPLAY_OPS = ['play', 'pause', 'faster', 'slower', 'speed']
const IDENTIFIER = /^[A-Z]{1,8}-\d{1,6}$/

export const CONFIRMED = new Set([])
export const ACTION_TYPES = [
  'focus_agent',
  'focus_terminal',
  'focus_path',
  'overview',
  'follow',
  'open_panel',
  'open_issue',
  'open_config',
  'open_log',
  'open_help',
  'replay',
]

const known = (context, key) => context.agents.some((agent) => agent.key === key)

const CHECKS = {
  focus_agent: (a, c) => known(c, a.agent) && VIEWS.includes(a.view) && { agent: a.agent, view: a.view },
  focus_terminal: (a, c) => known(c, a.agent) && { agent: a.agent },
  focus_path: (a, c) => typeof a.path === 'string' && c.paths.includes(a.path) && { path: a.path },
  overview: () => ({}),
  follow: (a) => FOLLOWS.includes(a.mode) && { mode: a.mode },
  open_panel: (a) => TABS.includes(a.tab) && { tab: a.tab },
  open_issue: (a) => typeof a.identifier === 'string' && IDENTIFIER.test(a.identifier) && { identifier: a.identifier },
  open_config: (a, c) => known(c, a.agent) && SECTIONS.includes(a.section) && { agent: a.agent, section: a.section },
  open_log: () => ({}),
  open_help: () => ({}),
  replay: (a) => {
    if (!REPLAY_OPS.includes(a.op)) return false
    if (a.op !== 'speed') return { op: a.op }
    return SPEEDS.includes(a.value) && { op: 'speed', value: a.value }
  },
}

export function validateAction(action, context) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { ok: false, error: 'No action.' }
  if (!ACTION_TYPES.includes(action.type)) return { ok: false, error: `Unknown action: ${action.type}` }
  const cleaned = CHECKS[action.type](action, context)
  if (!cleaned) return { ok: false, error: `Bad fields for ${action.type}.` }
  return { ok: true, action: { type: action.type, ...cleaned }, confirm: CONFIRMED.has(action.type) }
}

export function cardFirst(result) {
  return result
}
