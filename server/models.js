export const DEFAULT_CONTEXT_WINDOW = 200000

export const MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
  { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false, contextWindow: 1000000 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false, contextWindow: 1000000 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false, contextWindow: 1000000 },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (OpenRouter)', harness: 'hermes', tier: 'medium', free: false },
  { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash (Go)', harness: 'opencode', tier: 'medium', free: false },
]

export function resolveContextWindow(modelId, harnessKey = '', fallbackWindow = 0) {
  const modelEntry =
    MODELS.find((m) => m.id === modelId && (!harnessKey || m.harness === harnessKey)) ??
    MODELS.find((m) => m.id === modelId)
  if (typeof modelEntry?.contextWindow === 'number' && modelEntry.contextWindow > 0) {
    return modelEntry.contextWindow
  }
  if (typeof fallbackWindow === 'number' && Number.isFinite(fallbackWindow) && fallbackWindow > 0) {
    return Math.round(fallbackWindow)
  }
  return DEFAULT_CONTEXT_WINDOW
}

