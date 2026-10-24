const CHAT_HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

export function visibleChatText(text) {
  return String(text).replace(CHAT_HIDDEN, (found) => {
    const code = found.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
    return `[U+${code}]`
  })
}

export const ORCH_MAX_CHARS = 8000
export const ORCH_COUNT_FROM = 7000
export const ORCH_REFRESH_MS = 10000
export const ORCH_MAX_LINES = 200

export const ORCH_START_CONFIRM =
  'The orchestrator runs Claude Code (Opus) on this project with full permissions. It plans, starts lanes, merges what passes on a branch and never pushes. It uses your Claude subscription.'

export const ORCH_STOP_CONFIRM =
  'Stop the orchestrator? The turn that is running stops now. The chat is kept.'

const STATUS_LINES = {
  working: 'Orchestrator is working',
  idle: 'Orchestrator is waiting for you',
  paused: 'Paused',
}

const FROM_VALUES = new Set(['owner', 'orchestrator', 'room'])

export function normalizeChat(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const state = source.state === 'working' || source.state === 'paused' ? source.state : 'idle'
  return {
    state,
    model: typeof source.model === 'string' ? visibleChatText(source.model.trim()) : '',
    project: typeof source.project === 'string' ? visibleChatText(source.project.trim()) : '',
    messages: Array.isArray(source.messages) ? source.messages : [],
  }
}

export function statusText(state) {
  return Object.hasOwn(STATUS_LINES, state) ? STATUS_LINES[state] : STATUS_LINES.idle
}

export function statusTone(state) {
  if (state === 'working') return 'working'
  if (state === 'paused') return 'paused'
  return 'waiting'
}

export function chatLines(chat, limit = ORCH_MAX_LINES) {
  const list = chat && Array.isArray(chat.messages) ? chat.messages : []
  const lines = []
  for (const message of list) {
    if (!message || typeof message !== 'object') continue
    const raw = typeof message.text === 'string' ? message.text : ''
    const text = visibleChatText(raw).trim()
    if (!text) continue
    const from = FROM_VALUES.has(message.from) ? message.from : 'orchestrator'
    lines.push({
      id: String(message.id ?? `${from}-${lines.length}`),
      from,
      text,
      at: message.at ?? null,
    })
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : ORCH_MAX_LINES
  return lines.slice(-cap)
}

export function charCount(text) {
  const length = typeof text === 'string' ? text.length : 0
  return length > ORCH_COUNT_FROM ? `${length} / ${ORCH_MAX_CHARS}` : ''
}

export function clampDraft(text) {
  return String(text ?? '').slice(0, ORCH_MAX_CHARS)
}

export function canSend(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= ORCH_MAX_CHARS
}

export function needsStartConfirm(chat) {
  const list = chat && Array.isArray(chat.messages) ? chat.messages : []
  return !list.some(
    (message) =>
      message &&
      message.from === 'owner' &&
      typeof message.text === 'string' &&
      message.text.trim() !== ''
  )
}

export function isSendKey(event) {
  if (!event || event.key !== 'Enter') return false
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
  if (event.isComposing === true || event.nativeEvent?.isComposing === true) return false
  return true
}

export function listsOrchestrator(agents) {
  const list = Array.isArray(agents) ? agents : []
  return list.some((agent) => {
    if (!agent || typeof agent !== 'object') return false
    if (agent.orchestrator === true || agent.role === 'ceo') return true
    return /orchestrat/i.test(`${agent.key ?? ''} ${agent.name ?? ''}`)
  })
}

export function orchestratorOn(health) {
  return Boolean(health && typeof health === 'object' && health.orchestrator === true)
}

export function errorText(error, fallback) {
  const text = error && typeof error.message === 'string' ? error.message.trim() : ''
  return visibleChatText(text) || fallback
}
