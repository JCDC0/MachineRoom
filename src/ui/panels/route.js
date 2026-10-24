import { HARNESSES } from '../../harnesses/index.js'
import { modelsFor } from './dispatchModels.js'

function harnessForLane(lane) {
  const name = lane.trim().toLowerCase()
  let numbered = null
  for (const harness of HARNESSES) {
    const key = harness.key.toLowerCase()
    if (name === key) return harness
    if (!name.startsWith(key)) continue
    if (!/^\d+$/.test(name.slice(key.length))) continue
    if (!numbered || key.length > numbered.key.length) numbered = harness
  }
  return numbered
}

function agentRunsHarness(agent, harness) {
  if (!agent || typeof agent !== 'object') return false
  if (agent.adapterType !== harness.adapterType) return false
  if (harness.parserByAdapter !== false) return true
  const parser = typeof agent.parser === 'string' ? agent.parser.trim().toLowerCase() : ''
  if (parser) return parser === harness.key
  const name = typeof agent.name === 'string' ? agent.name.trim().toLowerCase() : ''
  return name === harness.key
}

export function agentForLane(lane, agents) {
  if (!lane || typeof lane !== 'string' || !Array.isArray(agents)) {
    return null
  }
  const harness = harnessForLane(lane)
  if (!harness) return null
  return agents.find((agent) => agentRunsHarness(agent, harness)) || null
}

export function routeFields(choice, agents = [], models = []) {
  if (!choice || typeof choice !== 'object') {
    return { agentId: null, model: null, note: null }
  }
  if (choice.lane === 'owner') {
    return { agentId: null, model: null, note: null }
  }
  const agent = agentForLane(choice.lane, agents)
  if (!agent) {
    return {
      agentId: null,
      model: null,
      note: `The ${choice.lane} lane is not in docs/agents/lanes.json.`,
    }
  }
  const offered = modelsFor(agent, models)
  const isListed = Boolean(choice.model && offered.some((item) => item.id === choice.model))
  if (isListed) {
    return {
      agentId: agent.id ?? null,
      model: choice.model,
      note: null,
    }
  }
  return {
    agentId: agent.id ?? null,
    model: '',
    note: `This agent does not list ${choice.model}, so its default model stays.`,
  }
}
