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

export function projectName(project) {
  const name = cleanText(project?.name)
  if (name) return name
  const parts = String(project?.path ?? '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : 'Project'
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

function sessionEntry(source, group, current) {
  return {
    id: typeof source.id === 'string' ? source.id : '',
    title: sessionTitle(source.title),
    startedAt: source.startedAt ?? null,
    endedAt: current ? null : source.endedAt ?? null,
    pinned: current ? false : source.pinned === true,
    starred: current ? false : source.starred === true,
    count: Number.isFinite(Number(source.count)) ? Math.max(0, Math.floor(Number(source.count))) : null,
    current,
    group,
    at: current ? stamp(source.startedAt) : sessionStamp(source),
  }
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
    const group = raw.pinned === true ? 'pinned' : raw.starred === true ? 'starred' : 'recent'
    sessions.push(sessionEntry(raw, group, false))
  }
  sessions.sort((left, right) => right.at - left.at)
  return {
    current,
    pinned: sessions.filter((entry) => entry.group === 'pinned'),
    starred: sessions.filter((entry) => entry.group === 'starred'),
    recent: sessions.filter((entry) => entry.group === 'recent'),
  }
}

export function sessionRows(answer, { expanded = false, limit = SESSION_LIMIT } = {}) {
  const groups = groupSessions(answer)
  const all = [
    ...(groups.current ? [groups.current] : []),
    ...groups.pinned,
    ...groups.starred,
    ...groups.recent,
  ]
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SESSION_LIMIT
  const rows = expanded ? all : all.slice(0, cap)
  return {
    ...groups,
    rows,
    total: all.length,
    hidden: Math.max(0, all.length - rows.length),
  }
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

export function previewLines(answer, limit = PREVIEW_LIMIT) {
  const list = answer && Array.isArray(answer.messages) ? answer.messages : []
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
