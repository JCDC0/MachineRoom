import { DEFAULT_SETTINGS } from './settings.js'

export const SOUND_LIMIT = 8
export const SOUND_WINDOW_MS = 1000

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

export function beatDetector(levels, { window = 8, factor = 1.3, floor = 0.08 } = {}) {
  if (!Array.isArray(levels)) return false
  const clean = levels.filter((level) => Number.isFinite(level) && level >= 0)
  if (clean.length < 3) return false
  const current = clean[clean.length - 1]
  const from = Math.max(0, clean.length - 1 - Math.max(1, Math.floor(window)))
  const recent = clean.slice(from, clean.length - 1)
  if (recent.length === 0) return false
  const average = recent.reduce((sum, level) => sum + level, 0) / recent.length
  return current > floor && current > average * factor
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
  audio: null,
  mediaSource: null,
  limiter: createRateLimit(),
  levels: [],
  lastLevelAt: 0,
  lastBeatAt: 0,
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
      engine.levels.length = 0
      return 0
    }
    const stamp = Number.isFinite(now) ? now : Date.now()
    if (stamp - engine.lastLevelAt < 45) return 0
    engine.lastLevelAt = stamp
    engine.analyser.getByteFrequencyData(engine.bins)
    const bins = Math.min(12, engine.bins.length)
    if (bins === 0) return 0
    let total = 0
    for (let index = 0; index < bins; index += 1) total += engine.bins[index]
    const level = total / bins / 255
    engine.levels.push(level)
    if (engine.levels.length > 16) engine.levels.shift()
    if (stamp - engine.lastBeatAt < 220) return 0
    if (!beatDetector(engine.levels)) return 0
    engine.lastBeatAt = stamp
    return Math.min(1, Math.max(0.35, level * 2))
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
