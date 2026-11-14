import { KEY_MASK, maskKeys } from '../briefs/audit.js'
import { maskProfilePaths } from '../briefs/run.js'
import { terminalText } from '../harnesses/common.js'
import { parseJson } from './parsers/common.js'
import { createParser } from './parsers/index.js'

export const CONVERSATION_ENTRY_LIMIT = 2000
export const CONVERSATION_TEXT_LIMIT = 4000

const READERS = new Set(['claude', 'opencode', 'codex', 'agy'])
const SECRET_FIELD = /(?:key|token|secret|password|authorization)/i

function maskText(text) {
  return maskProfilePaths(maskKeys(text).text)
}

function clean(value) {
  const text = String(value ?? '')
  if (text === '') return ''
  return maskText(terminalText(text)).slice(0, CONVERSATION_TEXT_LIMIT)
}

function maskData(value) {
  if (typeof value === 'string') return maskText(value)
  if (Array.isArray(value)) return value.map(maskData)
  if (value === null || typeof value !== 'object') return value
  const safe = {}
  for (const [name, item] of Object.entries(value)) {
    safe[name] = SECRET_FIELD.test(name) && typeof item === 'string' ? KEY_MASK : maskData(item)
  }
  return safe
}

function jsonLine(json) {
  return clean(JSON.stringify(maskData(json))).trim()
}

function timeOf(json) {
  const stamp = json?.timestamp
  return typeof stamp === 'number' && Number.isFinite(stamp) ? new Date(stamp).toISOString() : null
}

function entry(role, text, tool, at) {
  return { role, text, tool, at }
}

function textBlocks(harness, json) {
  if (harness === 'claude') {
    if (json?.type !== 'assistant') return []
    const content = json.message?.content
    if (typeof content === 'string') return content.trim() ? [content] : []
    if (!Array.isArray(content)) return []
    return content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '')
      .map((item) => item.text)
  }
  if (harness === 'opencode') {
    if (json?.type !== 'text') return []
    const text = json.part?.text
    return typeof text === 'string' && text.trim() !== '' ? [text] : []
  }
  if (harness === 'codex') {
    if (json?.type !== 'item.completed') return []
    const item = json.item
    if (!item || item.type !== 'agent_message') return []
    const text =
      typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : typeof item.message === 'string'
            ? item.message
            : ''
    return text.trim() !== '' ? [text] : []
  }
  return []
}

function endText(harness, json) {
  if (harness === 'claude' && json?.type === 'result') {
    if (typeof json.result === 'string' && json.result.trim() !== '') return json.result
    return json.is_error === true ? 'The run failed.' : 'The run ended.'
  }
  if (harness === 'opencode' && json?.type === 'step_finish') {
    return 'The run ended.'
  }
  if (harness === 'opencode' && json?.type === 'error') {
    const message =
      typeof json.error?.message === 'string' && json.error.message.trim() !== ''
        ? json.error.message
        : typeof json.error === 'string' && json.error.trim() !== ''
          ? json.error
          : 'The run failed.'
    return message
  }
  if (harness === 'codex' && json?.type === 'turn.completed') return 'The run ended.'
  if (harness === 'codex' && json?.type === 'turn.failed') {
    return typeof json.error?.message === 'string' && json.error.message.trim() !== ''
      ? json.error.message
      : 'The run failed.'
  }
  if (harness === 'agy' && json?.event === 'result') {
    const response = json.result?.response
    return typeof response === 'string' && response.trim() !== '' ? response : 'The run ended.'
  }
  return null
}

function knownEvent(harness, json) {
  const type = json?.type
  if (harness === 'claude') {
    return ['system', 'assistant', 'user', 'result', 'rate_limit_event', 'stream_event', 'acpx.tool_call'].includes(type)
  }
  if (harness === 'opencode') return ['step_start', 'step_finish', 'text', 'tool_use', 'error'].includes(type)
  if (harness === 'codex') {
    return ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed'].includes(type)
  }
  if (harness === 'agy') return json?.event === 'step_update' || json?.event === 'result'
  return false
}

export function conversationFromLog(harness, text, prompt = '') {
  const reader = typeof harness === 'string' ? harness.trim().toLowerCase() : ''
  const entries = []
  const promptText = clean(prompt).trim()
  if (promptText !== '') entries.push(entry('prompt', promptText, null, null))

  if (!READERS.has(reader)) {
    for (const line of String(text ?? '').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const json = parseJson(trimmed)
      const shown = json && typeof json === 'object' ? jsonLine(json) : clean(trimmed).trim()
      if (shown !== '') entries.push(entry('line', shown, null, null))
    }
    return entries.slice(-CONVERSATION_ENTRY_LIMIT)
  }

  const parser = createParser({ parser: reader }, { rootName: '', files: [], dirs: [] })
  let ended = null
  let agyPending = null

  function flushAgy() {
    if (!agyPending) return
    const shown = clean(agyPending.text).trim()
    if (shown !== '') entries.push(entry('agent', shown, null, agyPending.at))
    agyPending = null
  }

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const json = parseJson(line)
    if (!json || typeof json !== 'object') {
      flushAgy()
      const shown = clean(line.trim()).trim()
      if (shown !== '') entries.push(entry('line', shown, null, null))
      continue
    }

    const at = timeOf(json)
    const step = json.event === 'step_update' ? json.step_update : null
    const delta = typeof step?.text_delta === 'string' ? step.text_delta : ''
    if (delta !== '') {
      const key = `${step.conversation_id ?? ''}:${step.step_index ?? ''}`
      if (agyPending && agyPending.key !== key) flushAgy()
      if (!agyPending) agyPending = { key, text: '', at }
      agyPending.text += delta
    } else {
      flushAgy()
    }

    for (const block of textBlocks(reader, json)) {
      const shown = clean(block).trim()
      if (shown !== '') entries.push(entry('agent', shown, null, at))
    }

    const activities = parser.push(`${line}\n`, at === null ? 0 : Date.parse(at))
    for (const activity of activities) {
      if (activity?.type !== 'tool.start') continue
      const label = clean(activity.label).replace(/\s+/g, ' ').trim()
      entries.push(entry('tool', label, typeof activity.tool === 'string' ? activity.tool : 'other', at))
    }

    const endedText = endText(reader, json)
    if (endedText !== null) {
      const shown = clean(endedText).trim()
      if (shown !== '') ended = { text: shown, at }
      continue
    }
    if (!knownEvent(reader, json)) {
      const shown = jsonLine(json)
      if (shown !== '') entries.push(entry('line', shown, null, at))
    }
  }

  flushAgy()
  if (ended) entries.push(entry('result', ended.text, null, ended.at))
  return entries.slice(-CONVERSATION_ENTRY_LIMIT)
}
