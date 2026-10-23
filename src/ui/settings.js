import { readStorage, store, writeStorage } from '../storage.js'

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

export const DEFAULT_EFFECTS = Object.freeze({
  alwaysDepth: 2,
  fishEye: Object.freeze({ on: false, strength: 0.2 }),
  aberration: Object.freeze({ on: false, strength: 0.2 }),
  vignette: Object.freeze({ on: true, strength: 0.2 }),
  grain: Object.freeze({ on: false, strength: 0.2 }),
  dust: Object.freeze({ on: true, strength: 0.2 }),
})

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
  const fishEye = clampEffect(source.fishEye ?? source.fisheye, false, 0.2)
  const aberration = clampEffect(source.aberration ?? source.chromaticAberration, false, 0.2)
  const vignette = clampEffect(source.vignette, true, 0.2)
  const grain = clampEffect(source.grain, false, 0.2)
  const dust = clampEffect(source.dust ?? source.fineDust, true, 0.2)

  return {
    alwaysDepth,
    fishEye,
    fisheye: fishEye,
    aberration,
    chromaticAberration: aberration,
    vignette,
    grain,
    dust,
    fineDust: dust,
  }
}

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

  const depth = raw.alwaysDepth ?? raw.effects?.alwaysDepth
  if (depth !== undefined) {
    const num = Number(depth)
    if (Number.isFinite(num)) {
      out.alwaysDepth = Math.min(3, Math.max(1, Math.round(num)))
    }
  }

  if (raw.effects && typeof raw.effects === 'object') {
    const norm = effectSettings(raw.effects)
    out.effects = {
      fishEye: norm.fishEye,
      aberration: norm.aberration,
      vignette: norm.vignette,
      grain: norm.grain,
      dust: norm.dust,
    }
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

export function loadSettings(storage = store()) {
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
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
    ...(settings.effects ?? {}),
  })
}

export function saveEffectSettings(storage = store(), partial) {
  const current = loadEffectSettings(storage)
  const incoming = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const mergedEffects = {}
  for (const key of ['fishEye', 'aberration', 'vignette', 'grain', 'dust']) {
    const inc =
      incoming[key] ??
      (key === 'aberration'
        ? incoming.chromaticAberration
        : key === 'dust'
          ? incoming.fineDust
          : key === 'fishEye'
            ? incoming.fisheye
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
  const merged = effectSettings({
    alwaysDepth,
    ...mergedEffects,
  })
  saveSettings(storage, {
    alwaysDepth: merged.alwaysDepth,
    effects: {
      fishEye: merged.fishEye,
      aberration: merged.aberration,
      vignette: merged.vignette,
      grain: merged.grain,
      dust: merged.dust,
    },
  })
  return merged
}

