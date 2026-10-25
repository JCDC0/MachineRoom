import { readEndpoints } from './endpoints.js'

export const MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'machineroom', tier: 'medium', free: false },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (OpenRouter)', harness: 'machineroom', tier: 'medium', free: false },
  { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash (Go)', harness: 'opencode', tier: 'medium', free: false },
]

export function endpointModels(runsFolder) {
  const models = []
  for (const endpoint of readEndpoints(runsFolder)) {
    for (const id of endpoint.models) {
      models.push({
        id: `${endpoint.name}/${id}`,
        label: `${id} (${endpoint.name})`,
        harness: 'machineroom',
        tier: 'medium',
        free: false,
        endpoint: endpoint.name,
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
