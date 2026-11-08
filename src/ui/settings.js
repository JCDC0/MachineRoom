import { readStorage, store, writeStorage } from '../storage.js'
import { RECORD_MINUTES_DEFAULT, clampRecordMinutes } from '../model/recordLimits.js'
import { clampLensShare } from './lensResize.js'
import { SIDEBAR_TAB_DEFAULT, normalizeSidebarTab } from './sidebar.js'

export const SETTINGS_KEY = 'machineroom.settings'

const VALID_SOURCES = new Set(['bridge', 'demo'])

export const DEFAULT_SETTINGS = Object.freeze({
  source: 'bridge',
  bridge: 'http://127.0.0.1:5174',
  logOpen: false,
  speed: 1,
  helpSeen: false,
  sidebarTab: SIDEBAR_TAB_DEFAULT,
  recordMinutes: RECORD_MINUTES_DEFAULT,
  sound: Object.freeze({
    on: true,
    volume: 0.3,
    musicVolume: 0.5,
    musicMuted: false,
    dance: true,
    pulse: true,
  }),
})

export const FILE_LIMIT_MIN = 4
export const FILE_LIMIT_MAX = 20
export const FILE_LIMIT_DEFAULT = 6

export function clampFileLimit(value) {
  if (value == null) return FILE_LIMIT_DEFAULT
  const num = Number(value)
  if (!Number.isFinite(num)) return FILE_LIMIT_DEFAULT
  return Math.min(FILE_LIMIT_MAX, Math.max(FILE_LIMIT_MIN, Math.round(num)))
}

export const DEFAULT_EFFECTS = Object.freeze({
  alwaysDepth: 2,
  maxFiles: FILE_LIMIT_DEFAULT,
  aberration: Object.freeze({ on: false, strength: 0.2 }),
  vignette: Object.freeze({ on: true, strength: 0.2 }),
  grain: Object.freeze({ on: false, strength: 0.2 }),
  dust: Object.freeze({ on: true, strength: 0.2, pulse: false }),
  bloom: Object.freeze({ on: false, strength: 0.4 }),
})

function clampVolume(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(1, Math.max(0, num))
}

export function soundSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    on: typeof source.on === 'boolean' ? source.on : DEFAULT_SETTINGS.sound.on,
    volume: clampVolume(source.volume, DEFAULT_SETTINGS.sound.volume),
    musicVolume: clampVolume(source.musicVolume, DEFAULT_SETTINGS.sound.musicVolume),
    musicMuted: typeof source.musicMuted === 'boolean' ? source.musicMuted : DEFAULT_SETTINGS.sound.musicMuted,
    dance: typeof source.dance === 'boolean' ? source.dance : DEFAULT_SETTINGS.sound.dance,
    pulse: typeof source.pulse === 'boolean' ? source.pulse : DEFAULT_SETTINGS.sound.pulse,
  }
}

export function effectSettings(saved) {
  const root = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  const source = root.effects && typeof root.effects === 'object' && !Array.isArray(root.effects)
    ? { ...root, ...root.effects }
    : root

  function clampDepth(value) {
    if (value == null) return 2
    const num = Number(value)
    if (!Number.isFinite(num)) return 2
    return Math.min(3, Math.max(1, Math.round(num)))
  }

  function clampEffect(raw, defaultOn, defaultStrength = 0.2) {
    if (raw == null) return { on: defaultOn, strength: defaultStrength }
    if (typeof raw === 'boolean') {
      return { on: raw, strength: defaultStrength }
    }
    if (typeof raw === 'number') {
      const s = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : defaultStrength
      return { on: s > 0, strength: s }
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { on: defaultOn, strength: defaultStrength }
    }
    const on = typeof raw.on === 'boolean' ? raw.on : defaultOn
    const strengthRaw = Number(raw.strength)
    const strength = Number.isFinite(strengthRaw)
      ? Math.min(1, Math.max(0, strengthRaw))
      : defaultStrength
    return { on, strength }
  }

  const alwaysDepth = clampDepth(source.alwaysDepth ?? root.alwaysDepth)
  const maxFiles = clampFileLimit(source.maxFiles ?? root.maxFiles)
  const aberration = clampEffect(source.aberration ?? source.chromaticAberration, false, 0.2)
  const vignette = clampEffect(source.vignette, true, 0.2)
  const grain = clampEffect(source.grain, false, 0.2)
  const dustRaw = source.dust ?? source.fineDust
  const dust = { ...clampEffect(dustRaw, true, 0.2), pulse: dustRaw?.pulse === true }
  const bloom = clampEffect(source.bloom, false, 0.4)

  return {
    alwaysDepth,
    maxFiles,
    aberration,
    chromaticAberration: aberration,
    vignette,
    grain,
    dust,
    fineDust: dust,
    bloom,
  }
}

function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS }
  }
  const conn = raw.connection && typeof raw.connection === 'object' ? raw.connection : {}
  const source = raw.source ?? conn.source
  const bridge = raw.bridge ?? conn.bridge

  const out = {
    source: VALID_SOURCES.has(source) ? source : DEFAULT_SETTINGS.source,
    bridge: typeof bridge === 'string' ? bridge : DEFAULT_SETTINGS.bridge,
    logOpen: typeof raw.logOpen === 'boolean' ? raw.logOpen : DEFAULT_SETTINGS.logOpen,
    speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) && raw.speed > 0 ? raw.speed : DEFAULT_SETTINGS.speed,
    helpSeen: typeof raw.helpSeen === 'boolean' ? raw.helpSeen : DEFAULT_SETTINGS.helpSeen,
    sidebarTab: normalizeSidebarTab(raw.sidebarTab),
    recordMinutes: clampRecordMinutes(raw.recordMinutes),
    sound: soundSettings(raw.sound),
  }

  if (raw.lensSplit !== undefined && Number.isFinite(Number(raw.lensSplit))) {
    out.lensSplit = clampLensShare(raw.lensSplit)
  }

  const depth = raw.alwaysDepth ?? raw.effects?.alwaysDepth
  if (depth !== undefined) {
    const num = Number(depth)
    if (Number.isFinite(num)) {
      out.alwaysDepth = Math.min(3, Math.max(1, Math.round(num)))
    }
  }

  const maxFiles = raw.maxFiles ?? raw.effects?.maxFiles
  if (maxFiles !== undefined) {
    out.maxFiles = clampFileLimit(maxFiles)
  }

  if (raw.effects && typeof raw.effects === 'object') {
    const norm = effectSettings(raw.effects)
    out.effects = {
      aberration: norm.aberration,
      vignette: norm.vignette,
      grain: norm.grain,
      dust: norm.dust,
      bloom: norm.bloom,
    }
  }

  if (raw.assistantPosition && typeof raw.assistantPosition === 'object') {
    const x = Number(raw.assistantPosition.x)
    const y = Number(raw.assistantPosition.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.assistantPosition = { x, y }
    }
  }

  if (raw.music && typeof raw.music === 'object' && !Array.isArray(raw.music)) {
    out.music = { ...raw.music }
  }

  return out
}

export function loadSettings(storage = store()) {
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function savedSource(storage = store()) {
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const connection = parsed.connection && typeof parsed.connection === 'object' && !Array.isArray(parsed.connection)
      ? parsed.connection
      : {}
    const source = parsed.source ?? connection.source
    return VALID_SOURCES.has(source) ? source : null
  } catch {
    return null
  }
}

export function saveSettings(storage = store(), partial) {
  const current = loadSettings(storage)
  const incoming = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const merged = normalizeSettings({ ...current, ...incoming })
  writeStorage(SETTINGS_KEY, JSON.stringify(merged), storage)
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

export function loadEffectSettings(storage = store()) {
  const settings = loadSettings(storage)
  return effectSettings({
    alwaysDepth: settings.alwaysDepth,
    maxFiles: settings.maxFiles,
    ...(settings.effects ?? {}),
  })
}

export function loadSoundSettings(storage = store()) {
  return soundSettings(loadSettings(storage).sound)
}

export function saveSoundSettings(storage = store(), partial) {
  const current = loadSoundSettings(storage)
  const incoming = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const merged = soundSettings({ ...current, ...incoming })
  saveSettings(storage, { sound: merged })
  return merged
}

export function saveEffectSettings(storage = store(), partial) {
  const current = loadEffectSettings(storage)
  const incoming = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const mergedEffects = {}
  for (const key of ['aberration', 'vignette', 'grain', 'dust', 'bloom']) {
    const inc =
      incoming[key] ??
      (key === 'aberration'
        ? incoming.chromaticAberration
        : key === 'dust'
          ? incoming.fineDust
          : undefined)
    if (inc && typeof inc === 'object' && !Array.isArray(inc)) {
      mergedEffects[key] = { ...(current[key] ?? {}), ...inc }
    } else if (inc !== undefined) {
      mergedEffects[key] = inc
    } else {
      mergedEffects[key] = current[key]
    }
  }
  const alwaysDepth = incoming.alwaysDepth !== undefined ? incoming.alwaysDepth : current.alwaysDepth
  const maxFiles = incoming.maxFiles !== undefined ? incoming.maxFiles : current.maxFiles
  const merged = effectSettings({
    alwaysDepth,
    maxFiles,
    ...mergedEffects,
  })
  saveSettings(storage, {
    alwaysDepth: merged.alwaysDepth,
    maxFiles: merged.maxFiles,
    effects: {
      aberration: merged.aberration,
      vignette: merged.vignette,
      grain: merged.grain,
      dust: merged.dust,
      bloom: merged.bloom,
    },
  })
  return merged
}

