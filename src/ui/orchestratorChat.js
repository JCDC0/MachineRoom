import { createContext } from 'react'

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

export const OrchestratorActivity = createContext('')

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/
const BULLET = /^\s{0,3}[-*+][ \t]+(.*)$/
const NUMBERED = /^\s{0,3}(\d{1,9})[.)][ \t]+(.*)$/
const CONTINUATION = /^\s{2,}\S/
const ALNUM = /[A-Za-z0-9]/
const MARKER_DEPTH = 4

function isOrchestratorAgent(agent) {
  if (!agent || typeof agent !== 'object') return false
  if (agent.orchestrator === true || agent.role === 'ceo') return true
  return /orchestrat/i.test(`${agent.key ?? ''} ${agent.name ?? ''}`)
}

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

export function statusDetail(state, command) {
  const line = statusText(state)
  const text = typeof command === 'string' ? visibleChatText(command).trim() : ''
  if (state !== 'working' || !text) return line
  return `${line}: ${text}`
}

export function orchestratorDoing(agents) {
  const list = Array.isArray(agents) ? agents : []
  for (const agent of list) {
    if (!isOrchestratorAgent(agent)) continue
    if (agent.status !== 'working' && agent.status !== 'queued') return ''
    return typeof agent.label === 'string' ? visibleChatText(agent.label).trim() : ''
  }
  return ''
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

function findCodeClose(text, from, run) {
  let index = from
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    let count = 1
    while (text[index + count] === '`') count += 1
    if (count === run) return index
    index += count
  }
  return -1
}

function findMarkerClose(text, from, marker, run, underscore) {
  let index = from
  while (index < text.length) {
    if (text[index] !== marker) {
      index += 1
      continue
    }
    let count = 1
    while (text[index + count] === marker) count += 1
    if (run === 1 ? count === 1 : count >= run) {
      const start = run === 1 ? index : index + count - run
      const after = start + run
      if (!underscore || after >= text.length || !ALNUM.test(text[after])) return start
    }
    index += count
  }
  return -1
}

function markerAt(text, index) {
  const marker = text[index]
  let run = 1
  while (text[index + run] === marker) run += 1
  if (run > 3) return null
  const underscore = marker === '_'
  if (underscore && index > 0 && ALNUM.test(text[index - 1])) return null
  const close = findMarkerClose(text, index + run, marker, run, underscore)
  if (close < 0) return null
  const inner = text.slice(index + run, close)
  if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) return null
  return { inner, end: close + run }
}

function inlineSpans(text, depth = 0) {
  const spans = []
  let plain = ''

  function flush() {
    if (!plain) return
    spans.push({ kind: 'text', text: plain })
    plain = ''
  }

  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '`') {
      let run = 1
      while (text[index + run] === '`') run += 1
      const close = findCodeClose(text, index + run, run)
      if (close < 0) {
        plain += text.slice(index, index + run)
        index += run
        continue
      }
      flush()
      spans.push({ kind: 'code', text: text.slice(index + run, close) })
      index = close + run
      continue
    }
    if (char === '*' || char === '_') {
      let run = 1
      while (text[index + run] === char) run += 1
      const marker = depth < MARKER_DEPTH ? markerAt(text, index) : null
      if (marker) {
        flush()
        for (const span of inlineSpans(marker.inner, depth + 1)) spans.push(span)
        index = marker.end
        continue
      }
      plain += text.slice(index, index + run)
      index += run
      continue
    }
    plain += char
    index += 1
  }
  flush()
  return spans
}

function closesFence(line, marker) {
  const found = FENCE_CLOSE.exec(line)
  if (!found) return false
  return found[1][0] === marker[0] && found[1].length >= marker.length
}

export function chatBlocks(text) {
  const source = visibleChatText(String(text ?? '')).replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const blocks = []
  let paragraph = []
  let list = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', spans: inlineSpans(paragraph.join('\n')) })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      start: list.start,
      items: list.items.map((item) => ({ spans: inlineSpans(item) })),
    })
    list = null
  }

  function flushAll() {
    flushParagraph()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      flushAll()
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      flushAll()
      const marker = fence[1]
      const code = []
      index += 1
      while (index < lines.length && !closesFence(lines[index], marker)) {
        code.push(lines[index])
        index += 1
      }
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushAll()
      blocks.push({ kind: 'heading', level: heading[1].length, spans: inlineSpans(heading[2]) })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      const item = bullet ? bullet[1] : numbered[2]
      const start = numbered ? Number(numbered[1]) : 1
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, start, items: [] }
      }
      list.items.push(item)
      continue
    }
    if (list && CONTINUATION.test(line)) {
      list.items[list.items.length - 1] += `\n${line.trim()}`
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushAll()
  return blocks
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
  return list.some(isOrchestratorAgent)
}

export function orchestratorOn(health) {
  return Boolean(health && typeof health === 'object' && health.orchestrator === true)
}

export function errorText(error, fallback) {
  const text = error && typeof error.message === 'string' ? error.message.trim() : ''
  return visibleChatText(text) || fallback
}
