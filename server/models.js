import { readEndpoints } from './endpoints.js'
import { MODELS } from './model-list.js'

export { DEFAULT_CONTEXT_WINDOW, MODELS, resolveContextWindow } from './model-list.js'

export function endpointModels(runsFolder) {
  const models = []
  for (const endpoint of readEndpoints(runsFolder)) {
    for (const id of endpoint.models) {
      const detail = endpoint.modelDetails?.find((d) => d.id === id)
      const contextWindow = typeof detail?.contextLength === 'number' && detail.contextLength > 0 ? detail.contextLength : undefined
      models.push({
        id: `${endpoint.name}/${id}`,
        label: `${endpoint.name}/${id}`,
        harness: 'machineroom',
        tier: 'medium',
        free: false,
        endpoint: endpoint.name,
        ...(contextWindow ? { contextWindow } : {}),
      })
    }
  }
  return models
}

export function modelsFor(runsFolder) {
  const seen = new Set(MODELS.map((model) => model.id))
  const models = [...MODELS]
  for (const model of endpointModels(runsFolder)) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    models.push(model)
  }
  return models
}
