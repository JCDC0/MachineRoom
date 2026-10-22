import { modelsFor } from './dispatchModels.js'

export function agentForLane(lane, agents) {
  if (!lane || typeof lane !== 'string' || !Array.isArray(agents)) {
    return null
  }
  const normLane = lane.trim().toLowerCase()
  if (normLane === 'hermes') {
    return agents.find((agent) => agent?.adapterType === 'hermes_local') || null
  }
  if (normLane === 'opencode' || normLane === 'opencode2') {
    return agents.find((agent) => agent?.adapterType === 'opencode_local') || null
  }
  if (normLane === 'agy') {
    return (
      agents.find(
        (agent) =>
          agent?.adapterType === 'process' &&
          typeof agent?.name === 'string' &&
          agent.name.trim().toLowerCase() === 'agy'
      ) || null
    )
  }
  return null
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
      note: `No agent in Paperclip runs the ${choice.lane} lane.`,
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
