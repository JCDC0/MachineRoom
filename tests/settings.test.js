import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { validateBridgeUrl } from '../src/ui/Connect.jsx'
import { readStorage, writeStorage } from '../src/storage.js'
import Settings, { EFFECTS } from '../src/ui/Settings.jsx'
import { RECORD_MINUTES_DEFAULT, RECORD_MINUTES_MAX, RECORD_MINUTES_MIN, clampRecordMinutes } from '../src/model/recordLimits.js'
import { DEFAULT_EFFECTS, DEFAULT_SETTINGS, clampFileLimit, effectSettings, FILE_LIMIT_DEFAULT, FILE_LIMIT_MAX, FILE_LIMIT_MIN, loadAssistantPosition, loadEffectSettings, loadSettings, loadSoundSettings, saveAssistantPosition, saveEffectSettings, saveSettings, saveSoundSettings, savedSource, SETTINGS_KEY, soundSettings } from '../src/ui/settings.js'
import { saveMusicSettings } from '../src/ui/musicQueue.js'

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
      source: 'bridge',
      bridge: 'http://127.0.0.1:9999',
      logOpen: true,
      speed: 4,
      helpSeen: true,
    })

    expect(updated).toEqual({
      source: 'bridge',
      bridge: 'http://127.0.0.1:9999',
      logOpen: true,
      speed: 4,
      helpSeen: true,
      sidebarTab: 'chat',
      recordMinutes: 10,
      sound: DEFAULT_SETTINGS.sound,
    })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY))).toEqual(updated)
    expect(loadSettings(storage)).toEqual(updated)
  })

  it('drops the Paperclip and company fields of an older setting', () => {
    const old = makeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        source: 'paperclip',
        bridge: 'http://127.0.0.1:5174',
        paperclip: 'http://127.0.0.1:3100',
        company: 'acme',
        speed: 2,
      }),
    })
    expect(loadSettings(old)).toEqual({
      ...DEFAULT_SETTINGS,
      source: 'bridge',
      speed: 2,
    })
    expect(savedSource(old)).toBeNull()
  })

  it('reads only a bridge or demo choice as a saved choice', () => {
    expect(savedSource(makeStorage())).toBeNull()
    expect(savedSource(makeStorage({ [SETTINGS_KEY]: JSON.stringify({ source: 'bridge' }) }))).toBe('bridge')
    expect(savedSource(makeStorage({ [SETTINGS_KEY]: JSON.stringify({ source: 'demo' }) }))).toBe('demo')
    expect(savedSource(makeStorage({ [SETTINGS_KEY]: JSON.stringify({ source: 'paperclip' }) }))).toBeNull()
    expect(savedSource(makeStorage({ [SETTINGS_KEY]: JSON.stringify({ connection: { source: 'bridge' } }) }))).toBe('bridge')
    expect(savedSource(makeStorage({ [SETTINGS_KEY]: '{not valid json' }))).toBeNull()
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

  it('keeps the sidebar tab to chat, projects or agents', () => {
    const saved = makeStorage({ [SETTINGS_KEY]: JSON.stringify({ sidebarTab: 'agents' }) })
    expect(loadSettings(saved).sidebarTab).toBe('agents')
    const unknown = makeStorage({ [SETTINGS_KEY]: JSON.stringify({ sidebarTab: 'somewhere' }) })
    expect(loadSettings(unknown).sidebarTab).toBe('chat')
    expect(saveSettings(makeStorage(), { sidebarTab: 'projects' }).sidebarTab).toBe('projects')
  })

  it('does not throw when storage getItem or setItem throws', () => {    const throwingStorage = {
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

  it('drops a saved dockOpen and loads the rest', () => {
    const storage = makeStorage({
      [SETTINGS_KEY]: JSON.stringify({ source: 'bridge', speed: 2, dockOpen: true }),
    })
    const loaded = loadSettings(storage)
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, speed: 2 })
    expect(loaded).not.toHaveProperty('dockOpen')
    expect(saveSettings(storage, { speed: 3 })).not.toHaveProperty('dockOpen')
    expect(JSON.parse(storage.getItem(SETTINGS_KEY))).not.toHaveProperty('dockOpen')
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

  it('keeps the music playlist, loop and shuffle through every settings save', () => {
    const storage = makeStorage()
    const music = { playlist: 'playlist:Lofi', shuffle: true, loop: 'all' }
    saveMusicSettings(music, storage)

    saveEffectSettings(storage, { bloom: { on: true } })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).music).toEqual(music)
    expect(loadSettings(storage).music).toEqual(music)

    saveSoundSettings(storage, { volume: 0.9 })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).music).toEqual(music)

    saveSettings(storage, { speed: 2 })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).music).toEqual(music)
    expect(loadSettings(storage).speed).toBe(2)
  })

  it('keeps a lens share, sidebar tab and record time while saving other keys', () => {
    const storage = makeStorage()
    saveSettings(storage, { lensShare: 0.6, sidebarTab: 'agents', recordMinutes: 45 })
    saveEffectSettings(storage, { vignette: { on: true, strength: 0.4 } })
    const saved = loadSettings(storage)
    expect(saved.lensShare).toBe(0.6)
    expect(saved.sidebarTab).toBe('agents')
    expect(saved.recordMinutes).toBe(45)
  })
})

describe('the record time setting', () => {
  it('saves RECORD_MINUTES_DEFAULT by default and keeps a saved value', () => {
    expect(DEFAULT_SETTINGS.recordMinutes).toBe(RECORD_MINUTES_DEFAULT)

    const storage = makeStorage()
    expect(loadSettings(storage).recordMinutes).toBe(RECORD_MINUTES_DEFAULT)
    expect(saveSettings(storage, { speed: 2 }).recordMinutes).toBe(RECORD_MINUTES_DEFAULT)

    const saved = saveSettings(storage, { recordMinutes: 45 })
    expect(saved.recordMinutes).toBe(45)
    expect(loadSettings(storage).recordMinutes).toBe(45)
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).recordMinutes).toBe(45)
  })

  it('clamps a bad or out of range record time', () => {
    const saved = (value) =>
      loadSettings(makeStorage({ [SETTINGS_KEY]: JSON.stringify({ recordMinutes: value }) })).recordMinutes

    expect(saved(0)).toBe(RECORD_MINUTES_MIN)
    expect(saved(-5)).toBe(RECORD_MINUTES_MIN)
    expect(saved(1)).toBe(RECORD_MINUTES_MIN)
    expect(saved(45.9)).toBe(45)
    expect(saved('45')).toBe(45)
    expect(saved(RECORD_MINUTES_MAX)).toBe(RECORD_MINUTES_MAX)
    expect(saved(RECORD_MINUTES_MAX + 1)).toBe(RECORD_MINUTES_MAX)
    expect(saved('soon')).toBe(RECORD_MINUTES_DEFAULT)
    expect(saved(null)).toBe(RECORD_MINUTES_DEFAULT)

    expect(clampRecordMinutes(0)).toBe(RECORD_MINUTES_MIN)
    expect(clampRecordMinutes(999)).toBe(RECORD_MINUTES_MAX)
  })

  it('reads an old saved file with no record time as RECORD_MINUTES_DEFAULT', () => {
    const old = makeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        source: 'bridge',
        bridge: 'http://127.0.0.1:5174',
        speed: 2,
        effects: { vignette: { on: false, strength: 0 } },
      }),
    })
    expect(loadSettings(old).recordMinutes).toBe(RECORD_MINUTES_DEFAULT)
  })

  it('renders the Replay section row with its hint and limits', () => {
    const html = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(html).toContain('Replay')
    expect(html).toContain('Record time')
    expect(html).toContain('Replay keeps this many minutes, starting at the first conversation.')
    expect(html).toContain('aria-label="Record time in minutes"')
    expect(html).toContain(`min="${RECORD_MINUTES_MIN}"`)
    expect(html).toContain(`max="${RECORD_MINUTES_MAX}"`)
    expect(html).toContain(`value="${RECORD_MINUTES_DEFAULT}"`)
  })
})

describe('the content files setting', () => {
  it('clamps a content file limit above 3 and inside 4 to 20', () => {
    expect(FILE_LIMIT_MIN).toBe(4)
    expect(FILE_LIMIT_MAX).toBe(20)
    expect(FILE_LIMIT_DEFAULT).toBe(6)
    expect(DEFAULT_EFFECTS.maxFiles).toBe(FILE_LIMIT_DEFAULT)

    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 'soon']) {
      expect(clampFileLimit(value)).toBe(FILE_LIMIT_DEFAULT)
    }
    expect(clampFileLimit(-20)).toBe(4)
    expect(clampFileLimit(0)).toBe(4)
    expect(clampFileLimit(1)).toBe(4)
    expect(clampFileLimit(3)).toBe(4)
    expect(clampFileLimit(4)).toBe(4)
    expect(clampFileLimit(4.4)).toBe(4)
    expect(clampFileLimit(4.6)).toBe(5)
    expect(clampFileLimit('9')).toBe(9)
    expect(clampFileLimit(12)).toBe(12)
    expect(clampFileLimit(20)).toBe(20)
    expect(clampFileLimit(21)).toBe(20)
    expect(clampFileLimit(100)).toBe(20)
    expect(clampFileLimit(3.9) > 3).toBe(true)
  })

  it('saves and loads the content file limit', () => {
    const storage = makeStorage()
    expect(loadEffectSettings(storage).maxFiles).toBe(FILE_LIMIT_DEFAULT)

    const saved = saveEffectSettings(storage, { maxFiles: 9 })
    expect(saved.maxFiles).toBe(9)
    expect(loadEffectSettings(storage).maxFiles).toBe(9)
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).maxFiles).toBe(9)

    expect(saveEffectSettings(storage, { maxFiles: 2 }).maxFiles).toBe(FILE_LIMIT_MIN)
    expect(loadEffectSettings(storage).maxFiles).toBe(FILE_LIMIT_MIN)
    expect(saveEffectSettings(storage, { maxFiles: 50 }).maxFiles).toBe(FILE_LIMIT_MAX)
    expect(loadEffectSettings(storage).maxFiles).toBe(FILE_LIMIT_MAX)
  })

  it('reads a saved or nested content file limit and keeps a default', () => {
    expect(effectSettings().maxFiles).toBe(FILE_LIMIT_DEFAULT)
    expect(effectSettings({ maxFiles: 8 }).maxFiles).toBe(8)
    expect(effectSettings({ effects: { maxFiles: 15 } }).maxFiles).toBe(15)
    expect(effectSettings({ maxFiles: 1 }).maxFiles).toBe(FILE_LIMIT_MIN)

    const flat = makeStorage({ [SETTINGS_KEY]: JSON.stringify({ maxFiles: 11 }) })
    expect(loadEffectSettings(flat).maxFiles).toBe(11)
    const nested = makeStorage({ [SETTINGS_KEY]: JSON.stringify({ effects: { maxFiles: 17 } }) })
    expect(loadEffectSettings(nested).maxFiles).toBe(17)
    expect(loadEffectSettings(makeStorage()).maxFiles).toBe(FILE_LIMIT_DEFAULT)
  })

  it('renders the Content files slider below Folder depth', () => {
    const html = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(html).toContain('Content files')
    expect(html).toContain('aria-label="Content files"')
    expect(html).toContain(`min="${FILE_LIMIT_MIN}"`)
    expect(html).toContain(`max="${FILE_LIMIT_MAX}"`)
    expect(html).toContain(`value="${FILE_LIMIT_DEFAULT}"`)
    expect(html).toContain(
      `<span>${FILE_LIMIT_MIN}</span><span>${(FILE_LIMIT_MIN + FILE_LIMIT_MAX) / 2}</span><span>${FILE_LIMIT_MAX}</span>`
    )
    expect(html.indexOf('Content files')).toBeGreaterThan(html.indexOf('Folder depth'))
  })

  it('gives every effect, Beeps, Dance and Pulse switch an accessible name', () => {
    const html = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    for (const label of ['Chromatic aberration', 'Vignette', 'Grain', 'Fine dust', 'Bloom', 'Beeps', 'Dance', 'Pulse']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toContain('aria-label="Bloom strength"')
  })

  it('gives the Beeps volume a 0 to 100 slider with its percent beside it and one dim line', () => {
    const html = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(html).toContain('aria-label="Beep volume"')
    expect(html).toContain('type="range"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="100"')
    expect(html).toContain('value="30"')
    expect(html).toContain('30<!-- -->%')
    expect(html).toContain('A short tone when an agent reads, writes, makes or deletes a file.')
    expect(html.indexOf('Beeps')).toBeLessThan(html.indexOf('Beep volume'))
    expect(html.indexOf('Beep volume')).toBeLessThan(html.indexOf('A short tone when an agent'))
  })
})

describe('validateBridgeUrl', () => {
  it('accepts valid bridge URLs and rejects empty or malformed ones', () => {
    expect(validateBridgeUrl('http://127.0.0.1:5174')).toBeNull()
    expect(validateBridgeUrl('https://localhost:5174')).toBeNull()
    expect(validateBridgeUrl('')).toBe('Enter the bridge URL.')
    expect(validateBridgeUrl('127.0.0.1:5174')).toBe('Enter a full http:// or https:// URL.')
    expect(validateBridgeUrl('ftp://127.0.0.1')).toBe('Bridge URL must start with http:// or https://.')
  })
})

describe('effectSettings', () => {
  it('lists five screen effects without a fish eye row', () => {
    expect(EFFECTS.map((effect) => effect.label)).toEqual([
      'Chromatic aberration',
      'Vignette',
      'Grain',
      'Fine dust',
      'Bloom',
    ])
  })

  it('fills defaults when saved settings are empty or invalid', () => {
    const defaults = effectSettings()
    expect(defaults.alwaysDepth).toBe(2)
    expect(defaults.fishEye).toBeUndefined()
    expect(defaults.fisheye).toBeUndefined()
    expect(defaults.aberration).toEqual({ on: false, strength: 0.2 })
    expect(defaults.chromaticAberration).toEqual({ on: false, strength: 0.2 })
    expect(defaults.vignette).toEqual({ on: true, strength: 0.2 })
    expect(defaults.grain).toEqual({ on: false, strength: 0.2 })
    expect(defaults.dust).toEqual({ on: true, strength: 0.2, pulse: false })
    expect(defaults.fineDust).toEqual({ on: true, strength: 0.2, pulse: false })
    expect(defaults.bloom).toEqual({ on: false, strength: 0.4 })

    expect(effectSettings(null)).toEqual(defaults)
    expect(effectSettings({})).toEqual(defaults)
    expect(effectSettings('invalid')).toEqual(defaults)
  })

  it('starts bloom off at 0.4 and clamps its strength between 0 and 1', () => {
    expect(DEFAULT_EFFECTS.bloom).toEqual({ on: false, strength: 0.4 })
    expect(effectSettings({ bloom: { on: true } }).bloom).toEqual({ on: true, strength: 0.4 })
    expect(effectSettings({ bloom: { on: true, strength: 4 } }).bloom).toEqual({ on: true, strength: 1 })
    expect(effectSettings({ bloom: { on: true, strength: -2 } }).bloom).toEqual({ on: true, strength: 0 })
    expect(effectSettings({ bloom: { on: 'yes', strength: 'soon' } }).bloom).toEqual({ on: false, strength: 0.4 })
    expect(effectSettings({ bloom: true }).bloom).toEqual({ on: true, strength: 0.4 })
    expect(effectSettings({ bloom: 0.6 }).bloom).toEqual({ on: true, strength: 0.6 })
    expect(effectSettings({ bloom: 'invalid' }).bloom).toEqual({ on: false, strength: 0.4 })
    expect(effectSettings({ effects: { bloom: { on: true, strength: 0.25 } } }).bloom).toEqual({ on: true, strength: 0.25 })
  })

  it('saves and loads bloom beside the other screen effects', () => {
    const storage = makeStorage()
    expect(loadEffectSettings(storage).bloom).toEqual({ on: false, strength: 0.4 })

    const saved = saveEffectSettings(storage, { bloom: { on: true } })
    expect(saved.bloom).toEqual({ on: true, strength: 0.4 })
    expect(loadEffectSettings(storage).bloom).toEqual({ on: true, strength: 0.4 })
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)).effects.bloom).toEqual({ on: true, strength: 0.4 })

    const weaker = saveEffectSettings(storage, { bloom: { strength: 0.6 } })
    expect(weaker.bloom).toEqual({ on: true, strength: 0.6 })
    expect(saveEffectSettings(storage, { bloom: { on: false } }).bloom).toEqual({ on: false, strength: 0.6 })
    expect(loadEffectSettings(storage).vignette.on).toBe(true)
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
      aberration: { on: true, strength: 2.5 },
      vignette: { on: false, strength: -1 },
      grain: { on: true, strength: 0.75 },
    })
    expect(res.aberration).toEqual({ on: true, strength: 1 })
    expect(res.vignette).toEqual({ on: false, strength: 0 })
    expect(res.grain).toEqual({ on: true, strength: 0.75 })
  })

  it('accepts boolean and numeric shortcuts', () => {
    const res = effectSettings({
      aberration: true,
      grain: false,
      dust: 0.85,
    })
    expect(res.aberration).toEqual({ on: true, strength: 0.2 })
    expect(res.grain).toEqual({ on: false, strength: 0.2 })
    expect(res.dust).toEqual({ on: true, strength: 0.85, pulse: false })
  })

  it('recognizes aliases for effect names and ignores a saved fish eye', () => {
    const res = effectSettings({
      fishEye: { on: true, strength: 0.4 },
      fisheye: { on: true, strength: 0.4 },
      chromaticAberration: { on: true, strength: 0.5 },
      fineDust: { on: false, strength: 0.1 },
    })
    expect(res.fishEye).toBeUndefined()
    expect(res.fisheye).toBeUndefined()
    expect(res.aberration).toEqual({ on: true, strength: 0.5 })
    expect(res.chromaticAberration).toEqual({ on: true, strength: 0.5 })
    expect(res.dust).toEqual({ on: false, strength: 0.1, pulse: false })
    expect(res.fineDust).toEqual({ on: false, strength: 0.1, pulse: false })
  })

  it('reads nested effects and persists to storage', () => {
    const storage = makeStorage()
    const initial = loadEffectSettings(storage)
    expect(initial.alwaysDepth).toBe(2)
    expect(initial.vignette.on).toBe(true)

    const updated = saveEffectSettings(storage, {
      alwaysDepth: 3,
      aberration: { on: true, strength: 0.6 },
      vignette: { on: false, strength: 0 },
    })
    expect(updated.alwaysDepth).toBe(3)
    expect(updated.aberration).toEqual({ on: true, strength: 0.6 })
    expect(updated.vignette).toEqual({ on: false, strength: 0 })

    const reloaded = loadEffectSettings(storage)
    expect(reloaded.alwaysDepth).toBe(3)
    expect(reloaded.aberration).toEqual({ on: true, strength: 0.6 })
    expect(reloaded.vignette).toEqual({ on: false, strength: 0 })

    const raw = JSON.parse(storage.getItem(SETTINGS_KEY))
    expect(raw.alwaysDepth).toBe(3)
    expect(raw.effects.aberration).toEqual({ on: true, strength: 0.6 })
    expect(raw.effects.fishEye).toBeUndefined()
    expect(raw.source).toBe('bridge')
  })

  it('preserves existing effect values on partial effect patches', () => {
    const storage = makeStorage()
    saveEffectSettings(storage, {
      aberration: { on: false, strength: 0.85 },
      grain: { on: true, strength: 0.7 },
    })

    const afterOn = saveEffectSettings(storage, {
      aberration: { on: true },
    })
    expect(afterOn.aberration).toEqual({ on: true, strength: 0.85 })

    const afterStrength = saveEffectSettings(storage, {
      grain: { strength: 0.4 },
    })
    expect(afterStrength.grain).toEqual({ on: true, strength: 0.4 })
  })

  it('drops a fish eye value from an older saved setting', () => {
    const storage = makeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        effects: {
          fishEye: { on: true, strength: 1 },
          aberration: { on: true, strength: 0.4 },
        },
      }),
    })
    const loaded = loadEffectSettings(storage)
    expect(loaded.fishEye).toBeUndefined()
    expect(loaded.aberration).toEqual({ on: true, strength: 0.4 })

    saveEffectSettings(storage, { alwaysDepth: 2 })
    const raw = JSON.parse(storage.getItem(SETTINGS_KEY))
    expect(raw.effects.fishEye).toBeUndefined()
    expect(raw.effects.aberration).toEqual({ on: true, strength: 0.4 })
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


describe('soundSettings', () => {
  it('starts beeps on at a low volume and dance on', () => {
    expect(soundSettings()).toEqual({ on: true, volume: 0.3, musicVolume: 0.5, dance: true, pulse: true })
    expect(soundSettings(null)).toEqual(soundSettings())
    expect(soundSettings('invalid')).toEqual(soundSettings())
  })

  it('clamps both volumes and keeps booleans', () => {
    expect(soundSettings({ on: false, volume: 2, music: true, musicVolume: -1, dance: false, pulse: false })).toEqual({
      on: false,
      volume: 1,
      musicVolume: 0,
      dance: false,
      pulse: false,
    })
    expect(soundSettings({ on: 'yes', volume: 'loud', dance: 'no', pulse: 'no' })).toEqual(soundSettings())
  })

  it('drops a music flag that no player reads', () => {
    expect(soundSettings({ music: true })).not.toHaveProperty('music')
  })

  it('saves the sound block under machineroom.settings and keeps the rest', () => {
    const storage = makeStorage()
    saveSettings(storage, { speed: 2 })
    const updated = saveSoundSettings(storage, { on: false, volume: 0.8, dance: false })
    expect(updated).toEqual({ on: false, volume: 0.8, musicVolume: 0.5, dance: false, pulse: true })
    expect(loadSoundSettings(storage)).toEqual(updated)
    const loaded = loadSettings(storage)
    expect(loaded.speed).toBe(2)
    expect(loaded.sound).toEqual(updated)
  })
})
