import { rankPaths } from '../assistant/intent.js'
import { choice, noul, score } from './wire.js'

export const NONE = 'none'

export const ACTION_GUIDE = {
  focus_agent: 'Show one agent, fly to it, or see what it is doing.',
  focus_terminal: 'Show the terminal or the printed output of one agent.',
  focus_path: 'Go to a folder or a file of the project.',
  overview: 'Zoom out to see the whole room.',
  follow: 'Make the camera follow whichever agent is working, or stop doing that.',
  open_panel: 'Open a panel: costs, tasks or the new task form.',
  open_issue: 'Open one task by its identifier, such as JC-12.',
  open_config: 'Open the settings, model, budget, subagents or keys page of one agent.',
  open_log: 'Show the event log, or what is happening overall.',
  open_help: 'Explain the commands or the keys.',
  replay: 'Control the replay: play, pause or change the speed.',
  unknown: 'None of these, or the request is unclear, or it asks for something this room cannot do.',
}

export const TAB_GUIDE = {
  dispatch: 'Create a new task.',
  tasks: 'List tasks and read their threads.',
  meters: 'Costs, spend, quota and budgets.',
  agents: 'Hire a new agent or change an existing one.',
  [NONE]: 'No panel is asked for.',
}

export const SECTION_GUIDE = {
  general: 'The general settings of the agent.',
  model: 'Which model the agent uses.',
  budget: 'The spending budget of the agent.',
  subagents: 'Whether the agent may start subagents.',
  keys: 'The API keys or credentials of the agent.',
  [NONE]: 'No settings page is asked for.',
}

export const ASSISTANT_QUESTIONS = ['action', 'agent', 'path', 'tab', 'section']
export const ROUTING_QUESTIONS = ['tier', 'coordination', 'uncertainty', 'consequence', 'splits', 'effort', 'shape']

export const TIER_GUIDE = {
  small: 'A mechanical or local change with a clear target. A small, cheap model can do it.',
  medium: 'A feature, a fix or an investigation inside one area, with a bounded scope.',
  large: 'Work across many parts of the system, an open-ended investigation, or a change where a mistake would be costly.',
}

export const SHAPE_GUIDE = {
  one_off: 'A single piece of work to do once, now.',
  recurring: 'Work to repeat on a schedule.',
  conditional: 'Work to do only when something happens.',
  not_a_task: 'A question, a thanks or a comment that needs an answer and no queued work.',
}

export const EFFORT_LEVELS = [
  'Answer directly. No deliberation is needed.',
  'Light reasoning. A few steps.',
  'Careful reasoning. Weigh options and check the work.',
  'Deep reasoning. A hard problem with many interacting constraints.',
]

export function assistantRequest(text, context) {
  const agents = { [NONE]: 'No agent is named or meant.' }
  for (const agent of context.agents) agents[agent.key] = `${agent.name}.`
  const paths = { [NONE]: 'The request names no folder and no file.' }
  for (const path of rankPaths(text, context.paths, 20)) paths[path] = `The path ${path}.`
  return {
    state: `Request from a user of a 3D control room for coding agents:\n${text}`,
    questions: {
      action: choice('What does the user want the control room to do?', ACTION_GUIDE),
      agent: choice('Which agent does the request name or clearly mean?', agents),
      path: choice('Which folder or file does the request name or clearly mean?', paths),
      tab: choice('Which panel does the user want to open?', TAB_GUIDE),
      section: choice('Which settings page of an agent does the user want?', SECTION_GUIDE),
    },
  }
}

export function routingRequest(text, agents = null) {
  const questions = {
    tier: choice('How capable a model does this task need?', TIER_GUIDE),
    coordination: noul(
      'Does the work require reasoning about how several parts of the system interact, beyond separate local edits?',
      'Changes in one place depend on the behaviour of other modules.',
      'The edits are local and independent of each other.'
    ),
    uncertainty: noul(
      'Does the work require open-ended investigation to find an unknown cause, design or strategy, rather than following a known procedure?',
      'The way forward has to be found out first.',
      'The steps are known, or a bounded check will find them.'
    ),
    consequence: noul(
      'Would a wrong result cause serious harm, such as broad regressions, compatibility breaks, security problems or lost data?',
      'A mistake would be costly or hard to undo.',
      'A mistake would be small and easy to undo.'
    ),
    splits: noul(
      'Can the work be split into parts that different agents could do at the same time without waiting for each other?',
      'There are independent parts.',
      'The steps depend on each other, or the work is too small to split.'
    ),
    effort: score('How much reasoning effort does this task need?', EFFORT_LEVELS),
    shape: choice('What kind of request is this?', SHAPE_GUIDE),
  }
  if (agents && agents.length) {
    const options = {}
    for (const agent of agents) options[agent.key] = agent.profile ?? agent.name
    questions.harness = choice('Which agent is the best fit for this task?', options)
  }
  return { state: `Task for a coding agent:\n${text}`, questions }
}

export function requestFor(probe, context) {
  return probe.set === 'assistant' ? assistantRequest(probe.text, context) : routingRequest(probe.text)
}
