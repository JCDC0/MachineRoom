export const SETTINGS_KEY = 'machineroom.settings'

const VALID_SOURCES = new Set(['bridge', 'paperclip', 'demo'])

export const DEFAULT_SETTINGS = Object.freeze({
  source: 'bridge',
  bridge: 'http://127.0.0.1:5174',
  paperclip: '/paperclip',
  company: '',
  logOpen: false,
  speed: 1,
  helpSeen: false,
})

function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS }
  }
  const conn = raw.connection && typeof raw.connection === 'object' ? raw.connection : {}
  const source = raw.source ?? conn.source
  const bridge = raw.bridge ?? conn.bridge
  const paperclip = raw.paperclip ?? conn.paperclip
  const company = raw.company ?? conn.company

  const out = {
    source: VALID_SOURCES.has(source) ? source : DEFAULT_SETTINGS.source,
    bridge: typeof bridge === 'string' ? bridge : DEFAULT_SETTINGS.bridge,
    paperclip: typeof paperclip === 'string' ? paperclip : DEFAULT_SETTINGS.paperclip,
    company: typeof company === 'string' ? company : DEFAULT_SETTINGS.company,
    logOpen: typeof raw.logOpen === 'boolean' ? raw.logOpen : DEFAULT_SETTINGS.logOpen,
    speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) && raw.speed > 0 ? raw.speed : DEFAULT_SETTINGS.speed,
    helpSeen: typeof raw.helpSeen === 'boolean' ? raw.helpSeen : DEFAULT_SETTINGS.helpSeen,
  }

  if (raw.assistantPosition && typeof raw.assistantPosition === 'object') {
    const x = Number(raw.assistantPosition.x)
    const y = Number(raw.assistantPosition.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.assistantPosition = { x, y }
    }
  }

  return out
}

export function loadSettings(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') {
      return { ...DEFAULT_SETTINGS }
    }
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(storage, partial) {
  const current = loadSettings(storage)
  const incoming = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const merged = normalizeSettings({ ...current, ...incoming })
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(merged))
    }
  } catch {
    return merged
  }
  return merged
}

export function loadAssistantPosition(storage) {
  const settings = loadSettings(storage)
  return settings.assistantPosition ?? null
}

export function saveAssistantPosition(storage, pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null
  const saved = saveSettings(storage, { assistantPosition: { x: pos.x, y: pos.y } })
  return saved.assistantPosition ?? null
}

