export const ORCHESTRATOR_ID = 'orchestrator'
export const SESSION_LIMIT = 6
export const SESSION_TITLE_MAX = 80
export const PREVIEW_LIMIT = 200
export const AGENT_NAME_MAX = 40

export const SIDEBAR_TABS = Object.freeze([
  { key: 'chat', label: 'Chat' },
  { key: 'projects', label: 'Projects' },
  { key: 'agents', label: 'Agents' },
])
export const SIDEBAR_TAB_DEFAULT = 'chat'

export function normalizeSidebarTab(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  return SIDEBAR_TABS.some((tab) => tab.key === key) ? key : SIDEBAR_TAB_DEFAULT
}

const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

export function cleanText(value, max = 0) {
  const text = String(value ?? '')
    .replace(HIDDEN, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return max > 0 && text.length > max ? text.slice(0, max).trimEnd() : text
}

function visibleText(value) {
  return String(value ?? '')
    .replace(HIDDEN, '')
    .trim()
}

export function sessionTitle(value) {
  return cleanText(value, SESSION_TITLE_MAX) || 'Untitled conversation'
}

export const SESSION_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'Name' },
])
export const SESSION_SORT_DEFAULT = 'newest'
export const SESSION_SORT_KEY = 'machineroom.sessionSort'

export function normalizeSessionSort(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SESSION_SORTS.some((sort) => sort.key === key) ? key : SESSION_SORT_DEFAULT
}

function localStore() {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null
  } catch {
    return null
  }
}

export function loadSessionSort(storage = localStore()) {
  try {
    return normalizeSessionSort(storage?.getItem(SESSION_SORT_KEY))
  } catch {
    return SESSION_SORT_DEFAULT
  }
}

export function saveSessionSort(value, storage = localStore()) {
  try {
    storage?.setItem(SESSION_SORT_KEY, normalizeSessionSort(value))
  } catch {}
}

export function projectName(project) {
  const name = cleanText(project?.name)
  if (name) return name
  const parts = String(project?.path ?? '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : 'Project'
}

export const NO_GIT_PROJECT_TEXT = 'Not a git repository. Run git init here.'
export const GIT_INIT_COMMAND = 'git init'

export async function copyGitInit({ clipboard = globalThis.navigator?.clipboard } = {}) {
  try {
    if (!clipboard || typeof clipboard.writeText !== 'function') return false
    await clipboard.writeText(GIT_INIT_COMMAND)
    return true
  } catch {
    return false
  }
}

function stamp(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(number) && number > 0) return number
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function sessionStamp(session) {
  return stamp(session?.endedAt) || stamp(session?.startedAt) || stamp(session?.at)
}

export function sessionAge(session, now = Date.now()) {
  const at = sessionStamp(session)
  const current = Number(now)
  if (!at || !Number.isFinite(current)) return ''
  const diff = Math.max(0, current - at)
  const minute = 60000
  if (diff < minute) return 'now'
  const minutes = Math.floor(diff / minute)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

function isPinned(source) {
  return source?.pinned === true || source?.starred === true
}

function sessionEntry(source, group, current) {
  return {
    id: typeof source.id === 'string' ? source.id : '',
    sessionId: typeof source.sessionId === 'string' ? source.sessionId.trim() : '',
    title: sessionTitle(source.title),
    startedAt: source.startedAt ?? null,
    endedAt: current ? null : source.endedAt ?? null,
    pinned: isPinned(source),
    starred: source?.starred === true,
    unread: source?.unread === true,
    archived: source?.archived === true,
    count: Number.isFinite(Number(source.count)) ? Math.max(0, Math.floor(Number(source.count))) : null,
    current,
    group,
    at: current ? stamp(source.startedAt) : sessionStamp(source),
  }
}

export function sessionRowIdentity(row) {
  if (!row || typeof row !== 'object') return ''
  if (row.current !== true) return typeof row.id === 'string' && row.id ? `saved:${row.id}` : ''
  const sessionId = typeof row.sessionId === 'string' ? row.sessionId.trim() : ''
  if (sessionId) return `current:session:${sessionId}`
  if (typeof row.id === 'string' && row.id && row.id !== 'current') return `current:${row.id}`
  return `current:${stamp(row.startedAt)}:${sessionTitle(row.title)}`
}

export function groupSessions(answer) {
  const source = answer && typeof answer === 'object' ? answer : {}
  const currentSource = source.current && typeof source.current === 'object' ? source.current : null
  const current = currentSource ? sessionEntry(currentSource, 'current', true) : null
  const used = new Set(current && current.id ? [current.id] : [])
  const sessions = []
  for (const raw of Array.isArray(source.sessions) ? source.sessions : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!id) continue
    if (used.has(id)) continue
    used.add(id)
    const group = raw.archived === true ? 'archived' : isPinned(raw) ? 'pinned' : 'recent'
    sessions.push(sessionEntry(raw, group, false))
  }
  return {
    current,
    pinned: sessions.filter((entry) => entry.group === 'pinned'),
    recent: sessions.filter((entry) => entry.group === 'recent'),
    archived: sessions.filter((entry) => entry.group === 'archived'),
  }
}

export function sortSessionRows(rows, sort = SESSION_SORT_DEFAULT) {
  const order = normalizeSessionSort(sort)
  return [...rows].sort((left, right) => {
    if (order === 'name') {
      const byName = left.title.localeCompare(right.title)
      if (byName !== 0) return byName
    } else {
      const byTime = order === 'oldest' ? left.at - right.at : right.at - left.at
      if (byTime !== 0) return byTime
    }
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
  })
}

export function sessionRows(
  answer,
  { expanded = false, limit = SESSION_LIMIT, query = '', sort = SESSION_SORT_DEFAULT, showArchived = false } = {}
) {
  const groups = groupSessions(answer)
  const needle = cleanText(query).toLowerCase()
  const matches = (row) => !needle || row.title.toLowerCase().includes(needle)
  const current = groups.current && matches(groups.current) ? groups.current : null
  const pinned = sortSessionRows(groups.pinned.filter(matches), sort)
  const recent = sortSessionRows(groups.recent.filter(matches), sort)
  const archived = sortSessionRows(groups.archived.filter(matches), sort)
  const active = [...(current ? [current] : []), ...pinned, ...recent]
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SESSION_LIMIT
  const activeRows = expanded || needle ? active : active.slice(0, cap)
  const archivedRows = showArchived ? archived : []
  return {
    current,
    pinned,
    recent,
    archived,
    rows: [...activeRows, ...archivedRows],
    total: active.length,
    hidden: Math.max(0, active.length - activeRows.length),
    archivedTotal: archived.length,
    showArchived,
  }
}

export const SESSION_MENU_KEYS = Object.freeze({
  pin: 'P',
  rename: 'R',
  fork: 'F',
  export: 'E',
  unread: 'U',
  archive: 'A',
  delete: 'D',
})

export function sessionMenuItems(row, { busy = false } = {}) {
  const current = row?.current === true
  const archived = row?.archived === true
  const saved = Boolean(row?.id)
  const count = Number(row?.count)
  const noMessages = !Number.isFinite(count) || count < 1
  const currentLock = 'The current conversation cannot be archived or deleted.'
  return [
    {
      action: 'pin',
      label: row?.pinned ? 'Unpin' : 'Pin',
      key: SESSION_MENU_KEYS.pin,
      disabled: busy || (current && !saved),
      reason: 'The current conversation is not in the list yet.',
    },
    {
      action: 'rename',
      label: 'Rename',
      key: SESSION_MENU_KEYS.rename,
      disabled: busy || (current && !saved),
      reason: 'The current conversation is not in the list yet.',
    },
    {
      action: 'fork',
      label: 'Fork',
      key: SESSION_MENU_KEYS.fork,
      disabled: busy || noMessages,
      reason: 'This conversation has no messages to fork.',
    },
    {
      action: 'export',
      label: 'Export',
      key: SESSION_MENU_KEYS.export,
      disabled: busy || noMessages,
      reason: 'This conversation has no messages to export.',
    },
    {
      action: 'unread',
      label: 'Mark as unread',
      key: SESSION_MENU_KEYS.unread,
      disabled: busy || !saved,
      reason: 'This conversation is not in the list yet.',
    },
    {
      action: 'archive',
      label: archived ? 'Unarchive' : 'Archive',
      key: SESSION_MENU_KEYS.archive,
      disabled: busy || current,
      reason: currentLock,
    },
    {
      action: 'delete',
      label: 'Delete',
      key: SESSION_MENU_KEYS.delete,
      disabled: busy || current,
      reason: currentLock,
      danger: true,
    },
  ]
}

export function sessionMenuItemForKey(items, key) {
  const letter = String(key ?? '').toLowerCase()
  if (!letter) return null
  return (Array.isArray(items) ? items : []).find(
    (item) => item.key.toLowerCase() === letter
  ) ?? null
}

export function sessionMenuActionForKey(items, key) {
  const item = sessionMenuItemForKey(items, key)
  return item && !item.disabled ? item : null
}

export function agentCountLine(activeCount, maxCount) {
  const active = Math.max(0, Math.floor(Number(activeCount) || 0))
  const max = Math.max(active, Math.floor(Number(maxCount) || 0))
  return `${active} of ${max} active`
}

export function laneSummary(answer) {
  const source = answer && typeof answer === 'object' ? answer : {}
  const seen = new Set()
  const lanes = []
  for (const lane of Array.isArray(source.lanes) ? source.lanes : []) {
    if (!lane || typeof lane !== 'object') continue
    const key = cleanText(lane.key, 80)
    if (!key || seen.has(key)) continue
    seen.add(key)
    lanes.push({ ...lane, key })
  }
  const active = lanes.filter((lane) => lane.active !== false)
  const inactive = lanes.filter((lane) => lane.active === false)
  const max = Number.isFinite(Number(source.max))
    ? Math.max(0, Math.floor(Number(source.max)))
    : lanes.length
  return {
    lanes,
    active,
    inactive,
    max,
    chosen: source.chosen === true,
    line: agentCountLine(active.length, max),
  }
}

export function laneChoice(lanes, { add = [], remove = [] } = {}) {
  const list = []
  const seen = new Set()
  for (const lane of Array.isArray(lanes) ? lanes : []) {
    if (!lane || typeof lane !== 'object') continue
    const key = cleanText(lane.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push({ ...lane, key })
  }
  const chosen = new Set(list.filter((lane) => lane.active !== false).map((lane) => lane.key))
  const known = new Set(list.map((lane) => lane.key))
  for (const key of Array.isArray(add) ? add : []) {
    const value = cleanText(key)
    if (known.has(value)) chosen.add(value)
  }
  for (const key of Array.isArray(remove) ? remove : []) chosen.delete(cleanText(key))
  return list.map((lane) => lane.key).filter((key) => chosen.has(key))
}

function laneEntry(lanes, key) {
  if (Array.isArray(lanes)) {
    return lanes.find((lane) => lane && lane.key === key) ?? null
  }
  if (Array.isArray(lanes?.lanes)) {
    return lanes.lanes.find((lane) => lane && lane.key === key) ?? null
  }
  return lanes && typeof lanes === 'object' ? lanes[key] ?? null : null
}

function laneLabel(lanes, key) {
  const lane = laneEntry(lanes, key)
  return cleanText(lane?.label, 80) || cleanText(lane?.name, 80) || cleanText(key, 80)
}

export function previewLines(answer, limit = PREVIEW_LIMIT, options = {}) {
  const list = answer && Array.isArray(answer.messages) ? answer.messages : []
  const lanes = options?.lanes ?? answer?.lanes ?? {}
  const lines = []
  for (const message of list) {
    if (!message || typeof message !== 'object') continue
    const text = visibleText(message.text)
    if (!text) continue
    const raw = typeof message.from === 'string' ? message.from : ''
    const from = raw === 'owner' || raw === 'room'
      ? raw
      : raw.startsWith('sub:')
        ? `sub ${cleanText(raw.slice(4), 40)}`.trim()
        : raw.startsWith('lane:')
          ? laneLabel(lanes, raw.slice(5))
          : laneEntry(lanes, raw)
            ? laneLabel(lanes, raw)
            : 'orchestrator'
    lines.push({
      id: String(message.id ?? `${from}-${lines.length}`),
      from,
      text,
    })
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : PREVIEW_LIMIT
  return lines.slice(-cap)
}

export const EXPORT_MESSAGE_LIMIT = 200
const UNSAFE_FILENAME = /[<>:"/\\|?*\u0000-\u001F]/g

function exportTime(value) {
  const at = stamp(value)
  if (!at) return ''
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function exportFileName(title, startedAt) {
  const name = sessionTitle(title)
    .replace(UNSAFE_FILENAME, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  const at = stamp(startedAt)
  const date = at ? new Date(at).toISOString().slice(0, 10) : 'undated'
  return `${name || 'Conversation'} ${date}.md`
}

export function conversationMarkdown(conversation, { project = '', limit = EXPORT_MESSAGE_LIMIT } = {}) {
  const source = conversation && typeof conversation === 'object' ? conversation : {}
  const messages = []
  for (const message of Array.isArray(source.messages) ? source.messages : []) {
    if (!message || typeof message !== 'object') continue
    const text = visibleText(message.text)
    if (!text) continue
    const raw = typeof message.from === 'string' ? message.from : ''
    const role = raw === 'owner' || raw === 'room'
      ? raw
      : raw.startsWith('sub:')
        ? `sub ${cleanText(raw.slice(4), 40)}`.trim()
        : 'orchestrator'
    messages.push({ role, at: exportTime(message.at), text })
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : EXPORT_MESSAGE_LIMIT
  const kept = messages.slice(-cap)
  const lines = [
    `# ${sessionTitle(source.title)}`,
    '',
    `Project: ${projectName({ path: project })}`,
    `Started: ${exportTime(source.startedAt) || 'not recorded'}`,
    `Messages: ${kept.length} (the room keeps at most ${EXPORT_MESSAGE_LIMIT} per conversation).`,
    '',
  ]
  const summary = visibleText(source.summary)
  if (summary) lines.push('## Summary', '', summary, '')
  for (const message of kept) {
    lines.push(`### ${message.role}${message.at ? ` at ${message.at}` : ''}`, '', message.text, '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export async function waitForBridge(
  client,
  { path = '', intervalMs = 500, timeoutMs = 30000, setTimer = setTimeout } = {}
) {
  if (typeof client?.health !== 'function') return false
  const started = Date.now()
  const wanted = cleanText(path)
  for (;;) {
    try {
      await client.health()
      let ready = true
      if (wanted && typeof client.projects === 'function') {
        try {
          const answer = await client.projects()
          const current = cleanText(answer?.current?.path)
          ready = current === wanted
        } catch {
          ready = false
        }
      }
      if (ready) return true
    } catch {}
    if (Date.now() - started >= timeoutMs) return false
    await new Promise((resolve) => setTimer(resolve, intervalMs))
  }
}
