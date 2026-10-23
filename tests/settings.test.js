import { describe, expect, it } from 'vitest'
import { validateConnectUrl } from '../src/ui/Connect.jsx'
import { readStorage, writeStorage } from '../src/storage.js'
import { barrelPixels } from '../src/ui/barrel.js'
import { DEFAULT_EFFECTS, DEFAULT_SETTINGS, effectSettings, loadAssistantPosition, loadEffectSettings, loadSettings, saveAssistantPosition, saveEffectSettings, saveSettings, SETTINGS_KEY } from '../src/ui/settings.js'

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
  }
}

describe('settings', () => {
  it('returns the defaults when storage is empty or missing', () => {
    const storage = makeStorage()
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('saves partial settings under machineroom.settings and loads them back', () => {
    const storage = makeStorage()
    const updated = saveSettings(storage, {
      source: 'paperclip',
      paperclip: 'http://127.0.0.1:3100',
      company: 'acme',
      logOpen: true,
      speed: 4,
      helpSeen: true,
    })

    expect(updated).toEqual({
      source: 'paperclip',
      bridge: 'http://127.0.0.1:5174',
      paperclip: 'http://127.0.0.1:3100',
      company: 'acme',
      logOpen: true,
      speed: 4,
      helpSeen: true,
    })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY))).toEqual(updated)
    expect(loadSettings(storage)).toEqual(updated)
  })

  it('falls back to defaults when the stored string is broken or invalid', () => {
    const corrupted = makeStorage({ [SETTINGS_KEY]: '{not valid json' })
    expect(loadSettings(corrupted)).toEqual(DEFAULT_SETTINGS)

    const wrongTypes = makeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        source: 'unknown',
        bridge: 123,
        speed: -5,
        logOpen: 'yes',
        helpSeen: true,
      }),
    })
    expect(loadSettings(wrongTypes)).toEqual({
      ...DEFAULT_SETTINGS,
      helpSeen: true,
    })
  })

  it('does not throw when storage getItem or setItem throws', () => {
    const throwingStorage = {
      getItem() {
        throw new Error('Storage is blocked')
      },
      setItem() {
        throw new Error('Quota exceeded')
      },
    }

    expect(() => loadSettings(throwingStorage)).not.toThrow()
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS)

    expect(() => saveSettings(throwingStorage, { speed: 2, logOpen: true })).not.toThrow()
    expect(saveSettings(throwingStorage, { speed: 2, logOpen: true })).toEqual({
      ...DEFAULT_SETTINGS,
      speed: 2,
      logOpen: true,
    })
  })

  it('saves and loads assistantPosition when provided', () => {
    const storage = makeStorage()
    expect(loadAssistantPosition(storage)).toBeNull()

    const saved = saveAssistantPosition(storage, { x: 240, y: 120 })
    expect(saved).toEqual({ x: 240, y: 120 })
    expect(loadAssistantPosition(storage)).toEqual({ x: 240, y: 120 })

    const updated = saveSettings(storage, { speed: 4 })
    expect(updated.speed).toBe(4)
    expect(updated.assistantPosition).toEqual({ x: 240, y: 120 })
  })
})

describe('validateConnectUrl', () => {
  it('accepts valid bridge URLs and rejects empty or malformed ones', () => {
    expect(validateConnectUrl('bridge', 'http://127.0.0.1:5174')).toBeNull()
    expect(validateConnectUrl('bridge', 'https://localhost:5174')).toBeNull()
    expect(validateConnectUrl('bridge', '')).toBe('Enter the bridge URL.')
    expect(validateConnectUrl('bridge', '127.0.0.1:5174')).toBe('Enter a full http:// or https:// URL.')
  })

  it('accepts proxy paths or full URLs for Paperclip directly', () => {
    expect(validateConnectUrl('paperclip', '/paperclip')).toBeNull()
    expect(validateConnectUrl('paperclip', 'http://127.0.0.1:3100')).toBeNull()
    expect(validateConnectUrl('paperclip', '')).toBe('Enter the Paperclip URL or proxy path.')
    expect(validateConnectUrl('paperclip', '/')).toBe('Enter a proxy path such as /paperclip.')
  })
})

describe('effectSettings', () => {
  it('fills defaults when saved settings are empty or invalid', () => {
    const defaults = effectSettings()
    expect(defaults.alwaysDepth).toBe(2)
    expect(defaults.fishEye).toEqual({ on: false, strength: 0.2 })
    expect(defaults.aberration).toEqual({ on: false, strength: 0.2 })
    expect(defaults.chromaticAberration).toEqual({ on: false, strength: 0.2 })
    expect(defaults.vignette).toEqual({ on: true, strength: 0.2 })
    expect(defaults.grain).toEqual({ on: true, strength: 0.2 })
    expect(defaults.dust).toEqual({ on: true, strength: 0.2 })
    expect(defaults.fineDust).toEqual({ on: true, strength: 0.2 })

    expect(effectSettings(null)).toEqual(defaults)
    expect(effectSettings({})).toEqual(defaults)
    expect(effectSettings('invalid')).toEqual(defaults)
  })

  it('clamps alwaysDepth between 1 and 3', () => {
    expect(effectSettings({ alwaysDepth: 0 }).alwaysDepth).toBe(1)
    expect(effectSettings({ alwaysDepth: 1 }).alwaysDepth).toBe(1)
    expect(effectSettings({ alwaysDepth: 2 }).alwaysDepth).toBe(2)
    expect(effectSettings({ alwaysDepth: 3 }).alwaysDepth).toBe(3)
    expect(effectSettings({ alwaysDepth: 4 }).alwaysDepth).toBe(3)
    expect(effectSettings({ alwaysDepth: -10 }).alwaysDepth).toBe(1)
    expect(effectSettings({ alwaysDepth: 100 }).alwaysDepth).toBe(3)
    expect(effectSettings({ alwaysDepth: 2.6 }).alwaysDepth).toBe(3)
    expect(effectSettings({ alwaysDepth: 'invalid' }).alwaysDepth).toBe(2)
  })

  it('clamps effect strengths between 0 and 1', () => {
    const res = effectSettings({
      fishEye: { on: true, strength: 2.5 },
      vignette: { on: false, strength: -1 },
      grain: { on: true, strength: 0.75 },
    })
    expect(res.fishEye).toEqual({ on: true, strength: 1 })
    expect(res.vignette).toEqual({ on: false, strength: 0 })
    expect(res.grain).toEqual({ on: true, strength: 0.75 })
  })

  it('accepts boolean and numeric shortcuts', () => {
    const res = effectSettings({
      fishEye: true,
      grain: false,
      dust: 0.85,
    })
    expect(res.fishEye).toEqual({ on: true, strength: 0.2 })
    expect(res.grain).toEqual({ on: false, strength: 0.2 })
    expect(res.dust).toEqual({ on: true, strength: 0.85 })
  })

  it('recognizes aliases for effect names', () => {
    const res = effectSettings({
      fisheye: { on: true, strength: 0.4 },
      chromaticAberration: { on: true, strength: 0.5 },
      fineDust: { on: false, strength: 0.1 },
    })
    expect(res.fishEye).toEqual({ on: true, strength: 0.4 })
    expect(res.aberration).toEqual({ on: true, strength: 0.5 })
    expect(res.chromaticAberration).toEqual({ on: true, strength: 0.5 })
    expect(res.dust).toEqual({ on: false, strength: 0.1 })
    expect(res.fineDust).toEqual({ on: false, strength: 0.1 })
  })

  it('reads nested effects and persists to storage', () => {
    const storage = makeStorage()
    const initial = loadEffectSettings(storage)
    expect(initial.alwaysDepth).toBe(2)
    expect(initial.vignette.on).toBe(true)

    const updated = saveEffectSettings(storage, {
      alwaysDepth: 3,
      fishEye: { on: true, strength: 0.6 },
      vignette: { on: false, strength: 0 },
    })
    expect(updated.alwaysDepth).toBe(3)
    expect(updated.fishEye).toEqual({ on: true, strength: 0.6 })
    expect(updated.vignette).toEqual({ on: false, strength: 0 })

    const reloaded = loadEffectSettings(storage)
    expect(reloaded.alwaysDepth).toBe(3)
    expect(reloaded.fishEye).toEqual({ on: true, strength: 0.6 })
    expect(reloaded.vignette).toEqual({ on: false, strength: 0 })

    const raw = JSON.parse(storage.getItem(SETTINGS_KEY))
    expect(raw.alwaysDepth).toBe(3)
    expect(raw.effects.fishEye).toEqual({ on: true, strength: 0.6 })
    expect(raw.source).toBe('bridge')
  })

  it('preserves existing effect values on partial effect patches', () => {
    const storage = makeStorage()
    saveEffectSettings(storage, {
      fishEye: { on: false, strength: 0.85 },
      grain: { on: true, strength: 0.7 },
    })

    const afterOn = saveEffectSettings(storage, {
      fishEye: { on: true },
    })
    expect(afterOn.fishEye).toEqual({ on: true, strength: 0.85 })

    const afterStrength = saveEffectSettings(storage, {
      grain: { strength: 0.4 },
    })
    expect(afterStrength.grain).toEqual({ on: true, strength: 0.4 })
  })
})

describe('storage helpers', () => {
  it('safely reads from and writes to storage', () => {
    const storage = makeStorage()
    expect(readStorage('missing', storage)).toBeNull()
    expect(readStorage('key', null)).toBeNull()

    expect(writeStorage('test', '123', storage)).toBe(true)
    expect(readStorage('test', storage)).toBe('123')
    expect(writeStorage('test', '123', null)).toBe(false)
  })

  it('safely handles throwing storage implementations', () => {
    const throwing = {
      getItem() {
        throw new Error('Blocked')
      },
      setItem() {
        throw new Error('Quota')
      },
    }
    expect(readStorage('key', throwing)).toBeNull()
    expect(writeStorage('key', 'val', throwing)).toBe(false)
  })
})


describe('barrelPixels', () => {
  const size = 16
  const pixels = barrelPixels(size)
  const at = (x, y) => [...pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 4)]

  it('leaves the corners where they are', () => {
    expect(at(0, 0)).toEqual([128, 128, 128, 255])
  })

  it('pulls a point right of the centre towards it', () => {
    const [red, green] = at(12, 8)
    expect(red).toBeLessThan(128)
    expect(Math.abs(green - 128)).toBeLessThanOrEqual(8)
  })
})
