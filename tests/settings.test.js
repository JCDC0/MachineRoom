import { describe, expect, it } from 'vitest'
import { validateConnectUrl } from '../src/ui/Connect.jsx'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from '../src/ui/settings.js'

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
