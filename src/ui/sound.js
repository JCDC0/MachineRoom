import { DEFAULT_SETTINGS } from './settings.js'

export const SOUND_LIMIT = 8
export const SOUND_WINDOW_MS = 1000
export const BAND_COUNT = 5
export const BAND_WINDOW_MS = 45

export function bandIndexForBin(bin, binCount, bandCount = BAND_COUNT) {
  const index = Number(bin)
  const bins = Number(binCount)
  const bands = Math.max(1, Math.floor(Number(bandCount) || 0))
  if (!Number.isFinite(index) || !Number.isFinite(bins) || bins <= 0 || index < 0) return 0
  // Music holds most of its energy in the low bins, so the bands split the bins on a log scale.
  const band = Math.floor((Math.log2(1 + index) / Math.log2(1 + bins)) * bands)
  return Math.min(bands - 1, Math.max(0, band))
}

const TONES = {
  read: { frequency: 620, type: 'sine', duration: 0.07 },
  write: { frequency: 440, type: 'triangle', duration: 0.08 },
  created: { frequency: 880, type: 'sine', duration: 0.09 },
  deleted: { frequency: 220, type: 'sine', duration: 0.11 },
}

export function panForScreen(x, width) {
  const span = Number(width)
  const at = Number(x)
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(at)) return 0
  const share = Math.min(1, Math.max(0, at / span))
  return Math.min(1, Math.max(-1, share * 2 - 1))
}

export function spatialSound(place = {}) {
  const width = Number(place.width)
  const height = Number(place.height)
  const x = Number(place.x)
  const y = Number(place.y)
  const distance = Number(place.distance)
  const overviewDistance = Number(place.overviewDistance)
  if (![width, height, x, y, distance, overviewDistance].every(Number.isFinite)) {
    return { audible: false, pan: 0, gain: 0 }
  }
  if (width <= 0 || height <= 0 || distance < 0 || overviewDistance <= 0) {
    return { audible: false, pan: 0, gain: 0 }
  }
  const onScreen = x >= 0 && x <= width && y >= 0 && y <= height
  const tooFar = distance > overviewDistance * 2
  if (!onScreen || tooFar) return { audible: false, pan: 0, gain: 0 }
  const gain = Math.min(1, Math.max(0, 1 - distance / (overviewDistance * 2)))
  return { audible: gain > 0, pan: panForScreen(x, width), gain }
}

export const BEAT_WINDOW = 22
export const GROUP_REST_MS = 160
export const LOW_BANDS = Object.freeze([0, 1])
export const HIGH_BANDS = Object.freeze([2, 3, 4])

// Soft, compressed music never jumps 30 percent over its last moment, so a beat is a rise past the last second's spread instead.
export function beatDetector(levels, { window = BEAT_WINDOW, spread = 1.2, floor = 0.08, least = 8 } = {}) {
  if (!Array.isArray(levels)) return false
  const clean = levels.filter((level) => Number.isFinite(level) && level >= 0)
  if (clean.length < least + 1) return false
  const current = clean[clean.length - 1]
  const from = Math.max(0, clean.length - 1 - Math.max(1, Math.floor(window)))
  const recent = clean.slice(from, clean.length - 1)
  const average = recent.reduce((sum, level) => sum + level, 0) / recent.length
  const deviation = Math.sqrt(recent.reduce((sum, level) => sum + (level - average) ** 2, 0) / recent.length)
  return current > floor && current > recent[recent.length - 1] && current > average + spread * Math.max(deviation, 0.01)
}

function groupLevel(bands, indices) {
  let sum = 0
  let count = 0
  for (const index of indices) {
    const level = Number(bands[index])
    if (!Number.isFinite(level) || level < 0) continue
    sum += level
    count += 1
  }
  return count > 0 ? sum / count : 0
}

export function bandGroups(bands) {
  const list = Array.isArray(bands) ? bands : []
  return { low: groupLevel(list, LOW_BANDS), high: groupLevel(list, HIGH_BANDS) }
}

export function createBandBeatDetector({ rest = GROUP_REST_MS, window = BEAT_WINDOW, spread = 1.2, floor = 0.08, least = 8 } = {}) {
  const levels = { low: [], high: [] }
  const lastAt = { low: -Infinity, high: -Infinity }
  const span = Math.max(0, Number(rest) || 0)
  const keep = Math.max(1, Math.floor(Number(window) || BEAT_WINDOW)) + 1
  const options = { window, spread, floor, least }
  function reset() {
    levels.low.length = 0
    levels.high.length = 0
    lastAt.low = -Infinity
    lastAt.high = -Infinity
  }
  function push(bands, now) {
    const stamp = Number(now)
    const at = Number.isFinite(stamp) ? stamp : 0
    const groups = bandGroups(bands)
    const fired = { low: false, high: false }
    let strength = 0
    let group = ''
    for (const name of ['low', 'high']) {
      const history = levels[name]
      history.push(groups[name])
      while (history.length > keep) history.shift()
      if (at - lastAt[name] < span) continue
      if (!beatDetector(history, options)) continue
      lastAt[name] = at
      fired[name] = true
      const value = Math.min(1, Math.max(0.35, groups[name] * 2))
      if (value > strength) {
        strength = value
        group = name
      }
    }
    return { strength, group, low: fired.low, high: fired.high }
  }
  return { push, reset, levels }
}

const REMOVE_COMMANDS = new Set(['rm', 'del', 'remove-item'])

function commandTokens(segment) {
  return String(segment ?? '')
    .trim()
    .replace(/^\$\s*/, '')
    .split(/\s+/)
    .filter(Boolean)
}

function lowerToken(token) {
  return String(token ?? '').toLowerCase()
}

export function isDeleteCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return false
  for (const segment of command.split(/&&|\|\||[;\n|]/)) {
    const tokens = commandTokens(segment)
    let index = 0
    while (index < tokens.length && ['sudo', 'do', 'then', '&'].includes(lowerToken(tokens[index]))) index += 1
    if (index >= tokens.length) continue
    const first = lowerToken(tokens[index])
    if (REMOVE_COMMANDS.has(first)) return true
    if (first !== 'git') continue
    index += 1
    while (index < tokens.length) {
      const token = lowerToken(tokens[index])
      if (token === '-c' || token === '-C') {
        index += 2
        continue
      }
      if (token.startsWith('-')) {
        index += 1
        continue
      }
      break
    }
    if (index < tokens.length && lowerToken(tokens[index]) === 'rm') return true
  }
  return false
}

export function createRateLimit({ limit = SOUND_LIMIT, windowMs = SOUND_WINDOW_MS, now = () => Date.now() } = {}) {
  const times = []
  const max = Math.max(1, Math.floor(limit))
  const span = Math.max(1, Number(windowMs) || SOUND_WINDOW_MS)
  function prune(at) {
    while (times.length > 0 && at - times[0] >= span) times.shift()
  }
  return {
    take(at = now()) {
      const stamp = Number.isFinite(Number(at)) ? Number(at) : now()
      prune(stamp)
      if (times.length >= max) return false
      times.push(stamp)
      return true
    },
    count(at = now()) {
      prune(Number.isFinite(Number(at)) ? Number(at) : now())
      return times.length
    },
    reset() {
      times.length = 0
    },
  }
}

export function activitySounds(activity, known) {
  if (!activity || activity.type !== 'tool.start' || !Array.isArray(activity.touches)) return []
  const remembered = known instanceof Set ? known : new Set()
  const removes = isDeleteCommand(activity.label)
  const sounds = []
  for (const touch of activity.touches) {
    if (!touch || touch.kind !== 'file' || typeof touch.path !== 'string') continue
    const existed = remembered.has(touch.path)
    let kind = touch.mode === 'read' ? 'read' : 'write'
    if (touch.mode !== 'read' && removes) kind = 'deleted'
    else if (touch.mode !== 'read' && !existed) kind = 'created'
    remembered.add(touch.path)
    sounds.push({ path: touch.path, kind })
  }
  return sounds
}

function browserWindow() {
  return typeof window === 'undefined' ? null : window
}

function audioContextFor() {
  const win = browserWindow()
  if (!win) return null
  return win.AudioContext ?? win.webkitAudioContext ?? null
}

const engine = {
  settings: { ...DEFAULT_SETTINGS.sound },
  armed: false,
  gestureBound: false,
  context: null,
  master: null,
  musicGain: null,
  analyser: null,
  bins: null,
  bands: new Float32Array(BAND_COUNT),
  bandSums: new Float32Array(BAND_COUNT),
  bandCounts: new Uint16Array(BAND_COUNT),
  lastBandsAt: -Infinity,
  audio: null,
  mediaSource: null,
  limiter: createRateLimit(),
  bandBeats: createBandBeatDetector(),
  lastLevelAt: 0,
  musicTrack: '',
  endedListeners: new Set(),
}

function ensureContext() {
  const Context = audioContextFor()
  if (!Context) return null
  if (!engine.context) {
    engine.context = new Context()
    engine.master = engine.context.createGain()
    engine.master.gain.value = 1
    engine.master.connect(engine.context.destination)
    engine.musicGain = engine.context.createGain()
    engine.musicGain.gain.value = 1
    engine.analyser = engine.context.createAnalyser()
    engine.analyser.fftSize = 256
    engine.analyser.smoothingTimeConstant = 0.75
    engine.bins = new Uint8Array(engine.analyser.frequencyBinCount)
    engine.musicGain.connect(engine.analyser)
    engine.analyser.connect(engine.context.destination)
  }
  if (engine.context.state === 'suspended') {
    engine.context.resume().catch(() => {})
  }
  return engine.context
}

function ensureAudio() {
  if (engine.audio) return engine.audio
  const win = browserWindow()
  if (!win || typeof win.Audio !== 'function') return null
  const audio = new win.Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.addEventListener('ended', () => {
    for (const listener of engine.endedListeners) listener()
  })
  engine.audio = audio
  return audio
}

function attachAudio() {
  if (!engine.audio || !engine.context || engine.mediaSource) return
  try {
    engine.mediaSource = engine.context.createMediaElementSource(engine.audio)
    engine.mediaSource.connect(engine.musicGain)
  } catch {
    engine.mediaSource = null
  }
}

function sampleBins(now) {
  if (!engine.analyser || !engine.bins) return false
  if (now - engine.lastBandsAt < BAND_WINDOW_MS) return true
  engine.lastBandsAt = now
  engine.analyser.getByteFrequencyData(engine.bins)
  const bins = engine.bins.length
  if (bins === 0) return false
  for (let band = 0; band < BAND_COUNT; band += 1) {
    engine.bandSums[band] = 0
    engine.bandCounts[band] = 0
  }
  for (let bin = 0; bin < bins; bin += 1) {
    const band = bandIndexForBin(bin, bins, BAND_COUNT)
    engine.bandSums[band] += engine.bins[bin]
    engine.bandCounts[band] += 1
  }
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const count = engine.bandCounts[band]
    engine.bands[band] = count > 0 ? engine.bandSums[band] / count / 255 : 0
  }
  return true
}

export const sound = {
  setSettings(next) {
    if (!next || typeof next !== 'object') return engine.settings
    engine.settings = { ...engine.settings, ...next }
    if (engine.audio) engine.audio.volume = Math.min(1, Math.max(0, Number(engine.settings.musicVolume) || 0))
    return engine.settings
  },
  settings: () => ({ ...engine.settings }),
  arm() {
    engine.armed = true
    ensureContext()
  },
  armOnGesture() {
    const win = browserWindow()
    if (!win || engine.gestureBound) return
    engine.gestureBound = true
    const once = () => {
      sound.arm()
      win.removeEventListener('pointerdown', once, true)
      win.removeEventListener('keydown', once, true)
    }
    win.addEventListener('pointerdown', once, true)
    win.addEventListener('keydown', once, true)
  },
  armed: () => engine.armed,
  beep(kind, place) {
    if (!engine.armed || !engine.settings.on) return false
    const tone = TONES[kind]
    if (!tone) return false
    const spatial = spatialSound(place)
    if (!spatial.audible) return false
    if (!engine.limiter.take()) return false
    const context = ensureContext()
    if (!context || !engine.master) return false
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tone.type
    oscillator.frequency.value = tone.frequency
    const now = context.currentTime
    const peak = Math.max(0.0001, 0.08 * engine.settings.volume * spatial.gain)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration)
    oscillator.connect(gain)
    let tail = gain
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner()
      panner.pan.value = spatial.pan
      gain.connect(panner)
      tail = panner
    }
    tail.connect(engine.master)
    oscillator.start(now)
    oscillator.stop(now + tone.duration + 0.02)
    return true
  },
  beat(now = typeof performance === 'undefined' ? Date.now() : performance.now()) {
    if (!engine.settings.dance || !engine.analyser || !engine.bins || !sound.musicPlaying()) {
      engine.bandBeats.reset()
      return 0
    }
    const stamp = Number.isFinite(now) ? now : Date.now()
    if (stamp - engine.lastLevelAt < BAND_WINDOW_MS) return 0
    engine.lastLevelAt = stamp
    if (!sampleBins(stamp)) return 0
    return engine.bandBeats.push(engine.bands, stamp).strength
  },
  bands(now = typeof performance === 'undefined' ? Date.now() : performance.now()) {
    if (!engine.settings.pulse || !engine.analyser || !engine.bins || !sound.musicPlaying()) return null
    const stamp = Number.isFinite(now) ? now : Date.now()
    return sampleBins(stamp) ? engine.bands : null
  },
  playMusic(url) {
    const audio = ensureAudio()
    if (!audio) return Promise.resolve(false)
    const context = ensureContext()
    if (context) attachAudio()
    if (typeof url === 'string' && url && audio.dataset?.mrSrc !== url) {
      audio.src = url
      if (audio.dataset) audio.dataset.mrSrc = url
    }
    if (typeof url === 'string' && url) engine.musicTrack = url
    audio.volume = Math.min(1, Math.max(0, Number(engine.settings.musicVolume) || 0))
    try {
      return Promise.resolve(audio.play()).then(() => true).catch(() => false)
    } catch {
      return Promise.resolve(false)
    }
  },
  pauseMusic() {
    engine.audio?.pause()
  },
  musicTrack() {
    return engine.musicTrack
  },
  musicPlaying() {
    return Boolean(engine.audio && !engine.audio.paused && !engine.audio.ended)
  },
  setMusicVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0))
    engine.settings = { ...engine.settings, musicVolume: volume }
    if (engine.audio) engine.audio.volume = volume
    return volume
  },
  onMusicEnded(listener) {
    if (typeof listener !== 'function') return () => {}
    engine.endedListeners.add(listener)
    return () => engine.endedListeners.delete(listener)
  },
  resetLimit() {
    engine.limiter.reset()
  },
}
