import { harnessByAdapter } from '../../harnesses/index.js'

function normalizeAgent(agent) {
  if (!agent) return null
  if (typeof agent === 'string') {
    const trimmed = agent.trim()
    return trimmed ? { adapterType: trimmed, model: null } : null
  }
  if (typeof agent === 'object') {
    return agent
  }
  return null
}

export function defaultModelLabel(agent) {
  const norm = normalizeAgent(agent)
  if (!norm) return 'Default model'
  const model = typeof norm.model === 'string' ? norm.model.trim() : ''
  if (model) return `Default model (${model})`
  return 'Default model (set in the harness)'
}

export function modelsFor(agent, options = []) {
  const norm = normalizeAgent(agent)
  const defaultOption = {
    id: '',
    label: defaultModelLabel(norm),
  }
  if (!norm) {
    return [defaultOption]
  }
  if (!norm.adapterType || !Object.hasOwn(harnessByAdapter, norm.adapterType)) {
    return [defaultOption]
  }
  const harness = harnessByAdapter[norm.adapterType]
  const list = Array.isArray(options) ? options : []
  const matching = list.filter((item) => item && item.harness === harness.key)
  return [defaultOption, ...matching]
}

export function modelFits(agent, modelId, options = []) {
  if (!modelId) return true
  const offered = modelsFor(agent, options)
  return offered.some((item) => item.id === modelId)
}

export function resetModel(agent, currentModel, options = []) {
  if (!currentModel) return ''
  return modelFits(agent, currentModel, options) ? currentModel : ''
}
