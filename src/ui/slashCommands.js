import { visibleChatText } from './orchestratorChat.js'

const SLASH_COMMAND_LIMIT = 200
const SLASH_DESCRIPTION_LIMIT = 160
export const GRANT_USAGE = 'Use /grant LANES [SUBS] with whole numbers from 0, for example /grant 3 1.'
export const REVOKE_USAGE = 'Use /revoke with no arguments.'

const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/
const SOURCES = new Set(['room', 'command', 'skill'])
const ROOM = new Set(['compact', 'new', 'clear', 'stop', 'help', 'seats', 'grant', 'revoke', 'agents'])

export function commandQuery(text) {
  if (typeof text !== 'string' || !text.startsWith('/')) return null
  const rest = text.slice(1)
  if (/[\s]/.test(rest)) return null
  return rest
}

export function filterCommands(commands, query = '', limit = SLASH_COMMAND_LIMIT) {
  const list = Array.isArray(commands) ? commands : []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SLASH_COMMAND_LIMIT
  const wanted = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.replace(/^\/+/, '').trim() : ''
    if (!NAME.test(name)) continue
    const description = visibleChatText(typeof entry.description === 'string' ? entry.description : '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SLASH_DESCRIPTION_LIMIT)
    const source = SOURCES.has(entry.source) ? entry.source : 'command'
    rows.push({ name, description, source })
  }
  if (!wanted) return rows.slice(0, cap)
  const start = []
  const inside = []
  const text = []
  for (const row of rows) {
    const name = row.name.toLowerCase()
    if (name.startsWith(wanted)) start.push(row)
    else if (name.includes(wanted)) inside.push(row)
    else if (row.description.toLowerCase().includes(wanted)) text.push(row)
  }
  return [...start, ...inside, ...text].slice(0, cap)
}

export function nextCommandIndex(index, count, step = 1) {
  const size = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (size === 0) return 0
  const current = Number.isFinite(index) ? Math.floor(index) : 0
  const by = Number.isFinite(step) && step !== 0 ? Math.trunc(step) : 1
  return ((current + by) % size + size) % size
}

export function commandKeyAction(event, { items = [], index = 0, draft = '' } = {}) {
  if (!event || typeof event.key !== 'string') return { type: 'none' }
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return { type: 'none' }
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return { type: 'none' }
  const last = list.length - 1
  if (event.key === 'Escape') return { type: 'close' }
  if (event.key === 'ArrowDown') return { type: 'move', index: nextCommandIndex(index, list.length, 1) }
  if (event.key === 'ArrowUp') return { type: 'move', index: nextCommandIndex(index, list.length, -1) }
  if (event.key === 'Tab') return { type: 'pick', index: Math.min(Math.max(0, index), last) }
  if (event.key === 'Enter') {
    const text = typeof draft === 'string' ? draft.trim() : ''
    if (list.some((entry) => entry && `/${entry.name}` === text)) return { type: 'send' }
    return { type: 'pick', index: Math.min(Math.max(0, index), last) }
  }
  return { type: 'none' }
}

export function parseRoomCommand(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  const match = /^\/([A-Za-z]+)(?:[ \t]+([\s\S]*))?$/.exec(value)
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!ROOM.has(name)) return null
  const rest = (match[2] ?? '').trim()
  if (name === 'compact') return { kind: 'compact', keep: rest }
  if (name === 'new' || name === 'clear') return { kind: 'new' }
  if (name === 'stop') return { kind: 'stop' }
  if (name === 'seats') return { kind: 'seats' }
  if (name === 'agents') return { kind: 'agents' }
  if (name === 'revoke') {
    return rest ? { kind: 'revoke', error: REVOKE_USAGE } : { kind: 'revoke' }
  }
  if (name === 'grant') {
    const parts = rest ? rest.split(/\s+/) : []
    if (parts.length < 1 || parts.length > 2 || !parts.every((part) => /^\d+$/.test(part))) {
      return { kind: 'grant', error: GRANT_USAGE }
    }
    const lanes = Number(parts[0])
    const subs = parts.length === 2 ? Number(parts[1]) : 0
    if (!Number.isSafeInteger(lanes) || !Number.isSafeInteger(subs)) {
      return { kind: 'grant', error: GRANT_USAGE }
    }
    return { kind: 'grant', lanes, subs }
  }
  return { kind: 'help' }
}

export function commandPickText(name) {
  const text = typeof name === 'string' ? name.replace(/^\/+/, '').trim() : ''
  return NAME.test(text) ? `/${text} ` : ''
}
