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
  { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)', harness: 'agy', tier: 'small', free: false },
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)', harness: 'agy', tier: 'small', free: false },
  { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)', harness: 'agy', tier: 'medium', free: false },
  { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)', harness: 'agy', tier: 'large', free: false },
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

function detailId(detail) {
  return detail && typeof detail === 'object' && typeof detail.id === 'string' ? detail.id.trim() : ''
}

function detailWindow(detail) {
  if (detailId(detail) === '') return null
  if (typeof detail.contextLength === 'number' && Number.isFinite(detail.contextLength) && detail.contextLength > 0) {
    return Math.round(detail.contextLength)
  }
  return null
}

function detailGroups(details) {
  const groups = []
  if (!details || typeof details !== 'object') return groups
  if (Array.isArray(details)) {
    for (const item of details) {
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item.modelDetails)) {
        groups.push({ name: typeof item.name === 'string' ? item.name.trim() : '', details: item.modelDetails })
      } else {
        groups.push({ name: '', details: [item] })
      }
    }
    return groups
  }
  if (Array.isArray(details.modelDetails)) {
    groups.push({ name: typeof details.name === 'string' ? details.name.trim() : '', details: details.modelDetails })
    return groups
  }
  groups.push({ name: '', details: [details] })
  return groups
}

function detailContextLength(details, wanted) {
  if (!details || !wanted) return null
  const groups = detailGroups(details)

  for (const group of groups) {
    if (group.name === '' || !wanted.startsWith(`${group.name}/`)) continue
    const id = wanted.slice(group.name.length + 1)
    for (const detail of group.details) {
      if (detailId(detail) !== id) continue
      const window = detailWindow(detail)
      if (window !== null) return window
    }
    return null
  }

  for (const group of groups) {
    for (const detail of group.details) {
      if (detailId(detail) !== wanted) continue
      const window = detailWindow(detail)
      if (window !== null) return window
    }
  }

  const matches = []
  for (const group of groups) {
    for (const detail of group.details) {
      const id = detailId(detail)
      if (id === '' || !wanted.endsWith(`/${id}`)) continue
      const window = detailWindow(detail)
      if (window !== null) matches.push(window)
    }
  }
  return matches.length === 1 ? matches[0] : null
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
