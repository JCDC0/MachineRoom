export const DEFAULT_CONTEXT_WINDOW = 200000

export const MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode/crouton-alpha-free', label: 'Crouton Alpha (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false, contextWindow: 1000000 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false, contextWindow: 1000000 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false, contextWindow: 1000000 },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'machineroom', tier: 'medium', free: false },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (OpenRouter)', harness: 'machineroom', tier: 'medium', free: false },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (OpenRouter)', harness: 'hermes', tier: 'medium', free: false },
  { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash (Go)', harness: 'opencode', tier: 'medium', free: false },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)', harness: 'agy', tier: 'large', free: false },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', harness: 'agy', tier: 'large', free: false },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', harness: 'agy', tier: 'large', free: false },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', harness: 'agy', tier: 'small', free: false },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', harness: 'agy', tier: 'small', free: false },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', harness: 'agy', tier: 'medium', free: false },
  { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)', harness: 'agy', tier: 'large', free: false },
  { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)', harness: 'agy', tier: 'large', free: false },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)', harness: 'agy', tier: 'large', free: false },
  { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)', harness: 'agy', tier: 'medium', free: false },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)', harness: 'agy', tier: 'medium', free: false },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)', harness: 'agy', tier: 'medium', free: false },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', harness: 'agy', tier: 'medium', free: false },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', harness: 'codex', tier: 'small', free: false },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', harness: 'codex', tier: 'medium', free: false },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', harness: 'codex', tier: 'large', free: false },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', harness: 'copilot', tier: 'small', free: false },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', harness: 'copilot', tier: 'medium', free: false },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', harness: 'copilot', tier: 'small', free: false },
  { id: 'gpt-5', label: 'GPT-5', harness: 'copilot', tier: 'large', free: false },
]

function matchDetailContextLength(detail, wanted, endpointName = '') {
  if (!detail || typeof detail !== 'object') return null
  const id = typeof detail.id === 'string' ? detail.id.trim() : ''
  if (!id) return null
  const matches =
    id === wanted ||
    (endpointName !== '' && `${endpointName}/${id}` === wanted) ||
    (wanted.includes('/') && wanted.slice(wanted.indexOf('/') + 1) === id) ||
    (wanted.includes('/') && id.includes('/') && wanted.endsWith(`/${id}`)) ||
    (id.includes('/') && wanted.endsWith(`/${id}`))
  if (matches && typeof detail.contextLength === 'number' && Number.isFinite(detail.contextLength) && detail.contextLength > 0) {
    return Math.round(detail.contextLength)
  }
  return null
}

function detailContextLength(details, wanted) {
  if (!details || !wanted) return null
  if (!Array.isArray(details) && typeof details === 'object') {
    if (Array.isArray(details.modelDetails)) {
      const endpointName = typeof details.name === 'string' ? details.name.trim() : ''
      for (const d of details.modelDetails) {
        const found = matchDetailContextLength(d, wanted, endpointName)
        if (found !== null) return found
      }
      return null
    }
    return matchDetailContextLength(details, wanted)
  }
  if (Array.isArray(details)) {
    for (const item of details) {
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item.modelDetails)) {
        const endpointName = typeof item.name === 'string' ? item.name.trim() : ''
        for (const d of item.modelDetails) {
          const found = matchDetailContextLength(d, wanted, endpointName)
          if (found !== null) return found
        }
      } else {
        const found = matchDetailContextLength(item, wanted)
        if (found !== null) return found
      }
    }
  }
  return null
}

export function resolveContextWindow(modelId, harnessKey = '', laneWindowOption = 0, modelDetailsOption = null) {
  let laneWindow = typeof laneWindowOption === 'number' ? laneWindowOption : 0
  let modelDetails = modelDetailsOption
  if (laneWindowOption && typeof laneWindowOption === 'object' && !Array.isArray(laneWindowOption)) {
    if ('laneWindow' in laneWindowOption || 'contextWindow' in laneWindowOption || 'modelDetails' in laneWindowOption) {
      laneWindow = laneWindowOption.laneWindow ?? laneWindowOption.contextWindow ?? 0
      modelDetails = laneWindowOption.modelDetails ?? modelDetailsOption
    }
  }

  if (typeof laneWindow === 'number' && Number.isFinite(laneWindow) && laneWindow > 0) {
    return Math.round(laneWindow)
  }

  const wanted = typeof modelId === 'string' ? modelId.trim() : ''
  const endpointWindow = detailContextLength(modelDetails, wanted)
  if (endpointWindow !== null) {
    return endpointWindow
  }

  const modelEntry =
    MODELS.find((m) => m.id === modelId && (!harnessKey || m.harness === harnessKey)) ??
    MODELS.find((m) => m.id === modelId)
  if (typeof modelEntry?.contextWindow === 'number' && modelEntry.contextWindow > 0) {
    return modelEntry.contextWindow
  }

  return DEFAULT_CONTEXT_WINDOW
}

export function harnessUnavailableProblem(harness) {
  if (harness === 'machineroom') return 'Add a Direct API key in Settings first.'
  return `The harness ${harness} is not available on this computer.`
}

export function modelUnavailableProblem(model, harness) {
  return `The model ${model} is not available for ${harness}.`
}
