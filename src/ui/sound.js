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
export const ONSET_STEPS = 2
export const ONSET_SHARE = 0.6
export const ONSET_LOOK = 10

export function sharpOnset(levels, { steps = ONSET_STEPS, share = ONSET_SHARE, look = ONSET_LOOK, floor = 0.02 } = {}) {
  if (!Array.isArray(levels)) return false
  const clean = levels.filter((level) => Number.isFinite(level) && level >= 0)
  const stride = Math.max(1, Math.floor(Number(steps) || ONSET_STEPS))
  if (clean.length < stride + 2) return false
  const current = clean[clean.length - 1]
  const before = clean[clean.length - 1 - stride]
  const start = Math.max(0, clean.length - 1 - stride - Math.max(1, Math.floor(Number(look) || ONSET_LOOK)))
  let baseline = before
  for (let index = start; index < clean.length - 1 - stride; index += 1) {
    baseline = Math.min(baseline, clean[index])
  }
  const rise = current - baseline
  const burst = current - before
  if (!(rise > 0) || !(burst > 0) || rise < Math.max(0, Number(floor) || 0)) return false
  return burst >= rise * Math.min(1, Math.max(0, Number(share) || 0))
}

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
  const list = bands && typeof bands === 'object' && Number.isFinite(bands.length) ? bands : []
  return { low: groupLevel(list, LOW_BANDS), high: groupLevel(list, HIGH_BANDS) }
}

export function createBandBeatDetector({ rest = GROUP_REST_MS, window = BEAT_WINDOW, spread = 1.2, floor = 0.08, least = 8, steps = ONSET_STEPS, share = ONSET_SHARE } = {}) {
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
      if (!sharpOnset(history, { steps, share })) continue
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

export const LOCK_WINDOW_MS = 8000
export const LOCK_MIN_GAP_MS = 300
export const LOCK_MAX_GAP_MS = 1500
export const LOCK_MIN_ONSETS = 6
export const LOCK_TOLERANCE = 0.2
export const LOCK_GRID_MS = 90
export const LOCK_STALE_GAPS = 4
export const LOCK_MIN_GAPS = 3
export const GAP_STEP_MS = 10
export const SWAY_MS = 1500
export const SWAY_GAIN = 1.5

function cleanOnsets(onsets) {
  const times = []
  for (const value of Array.isArray(onsets) ? onsets : []) {
    const at = Number(value)
    if (Number.isFinite(at) && at >= 0 && !times.includes(at)) times.push(at)
  }
  return times.sort((a, b) => a - b)
}

export function recentOnsets(onsets, at, window = LOCK_WINDOW_MS) {
  const stamp = Number(at)
  const span = Math.max(1, Number(window) || LOCK_WINDOW_MS)
  const times = cleanOnsets(onsets)
  if (!Number.isFinite(stamp)) return times
  return times.filter((time) => time <= stamp && stamp - time <= span)
}

function gapStats(onsets, min = LOCK_MIN_GAP_MS, max = LOCK_MAX_GAP_MS) {
  const times = cleanOnsets(onsets)
  const low = Math.max(1, Number(min) || LOCK_MIN_GAP_MS)
  const high = Math.max(low, Number(max) || LOCK_MAX_GAP_MS)
  const counts = new Map()
  const sums = new Map()
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index] - times[index - 1]
    if (gap < low || gap > high) continue
    const key = Math.round(gap / GAP_STEP_MS) * GAP_STEP_MS
    counts.set(key, (counts.get(key) ?? 0) + 1)
    sums.set(key, (sums.get(key) ?? 0) + gap)
  }
  let best = 0
  let bestCount = 0
  for (const [gap, count] of counts) {
    if (count > bestCount || (count === bestCount && gap < best)) {
      best = gap
      bestCount = count
    }
  }
  return { gap: bestCount > 0 ? sums.get(best) / bestCount : 0, count: bestCount }
}

export function findBeatGap(onsets, options = {}) {
  return gapStats(onsets, options.min, options.max).gap
}

export function beatGrid(onsets, gap, { tolerance = LOCK_TOLERANCE } = {}) {
  const times = cleanOnsets(onsets)
  const span = Number(gap)
  if (!(span > 0) || times.length === 0) return { anchor: 0, count: 0 }
  const slack = Math.max(1, span * Math.min(1, Math.max(0, Number(tolerance) || LOCK_TOLERANCE)))
  let anchor = times[0]
  let count = 0
  for (const base of times) {
    let fitted = 0
    for (const at of times) {
      const steps = Math.round((at - base) / span)
      if (Math.abs(at - (base + steps * span)) <= slack) fitted += 1
    }
    if (fitted > count) {
      anchor = base
      count = fitted
    }
  }
  return { anchor, count }
}

export function beatLock(onsets, { at = Infinity, window = LOCK_WINDOW_MS, tolerance = LOCK_TOLERANCE, minOnsets = LOCK_MIN_ONSETS, staleGaps = LOCK_STALE_GAPS } = {}) {
  const times = recentOnsets(onsets, at, window)
  const stats = gapStats(times)
  const gap = stats.gap
  if (times.length < Math.max(2, Number(minOnsets) || LOCK_MIN_ONSETS) || !(gap > 0) || stats.count < LOCK_MIN_GAPS) {
    return { locked: false, gap: 0, anchor: 0, count: 0 }
  }
  const grid = beatGrid(times, gap, { tolerance })
  let steady = gap
  if (grid.count > 0) {
    const slack = gap * Math.min(1, Math.max(0, Number(tolerance) || LOCK_TOLERANCE))
    let farthest = grid.anchor
    for (const time of times) {
      const steps = Math.round((time - grid.anchor) / gap)
      if (Math.abs(time - (grid.anchor + steps * gap)) <= slack) farthest = Math.max(farthest, time)
    }
    const steps = Math.round((farthest - grid.anchor) / gap)
    if (steps > 0) steady = (farthest - grid.anchor) / steps
  }
  const last = times[times.length - 1]
  const stamp = Number(at)
  const stale = Number.isFinite(stamp) && last < stamp - steady * Math.max(1, Number(staleGaps) || LOCK_STALE_GAPS)
  const locked = !stale && grid.count >= Math.max(2, Number(minOnsets) || LOCK_MIN_ONSETS)
  return { locked, gap: steady, anchor: grid.anchor, count: grid.count }
}

export function onBeatGrid(at, lock, tolerance = LOCK_GRID_MS) {
  if (!lock || lock.locked !== true) return false
  const stamp = Number(at)
  const gap = Number(lock.gap)
  const anchor = Number(lock.anchor)
  if (!Number.isFinite(stamp) || !(gap > 0) || !Number.isFinite(anchor)) return false
  const steps = Math.round((stamp - anchor) / gap)
  return Math.abs(stamp - (anchor + steps * gap)) <= Math.max(0, Number(tolerance) || 0)
}

export function swayTarget(bands, { gain = SWAY_GAIN } = {}) {
  const list = bands && typeof bands === 'object' && Number.isFinite(bands.length) ? bands : []
  let sum = 0
  let count = 0
  for (let index = 0; index < list.length; index += 1) {
    const level = Number(list[index])
    if (!Number.isFinite(level) || level < 0) continue
    sum += level
    count += 1
  }
  if (count === 0) return 0
  return Math.min(1, Math.max(0, (sum / count) * Math.max(0, Number(gain) || 0)))
}

export function swayStep(previous, target, deltaMs, span = SWAY_MS) {
  const from = Math.min(1, Math.max(0, Number(previous) || 0))
  const to = Math.min(1, Math.max(0, Number(target) || 0))
  const elapsed = Number(deltaMs)
  const duration = Math.max(1, Number(span) || SWAY_MS)
  if (!Number.isFinite(elapsed) || elapsed <= 0) return from
  return from + (to - from) * Math.min(1, elapsed / duration)
}

export function createDanceTracker({ window = LOCK_WINDOW_MS, swaySpan = SWAY_MS, detector = createBandBeatDetector() } = {}) {
  let onsets = []
  let lock = { locked: false, gap: 0, anchor: 0, count: 0 }
  let sway = 0
  let lastAt = 0
  function reset() {
    onsets = []
    lock = { locked: false, gap: 0, anchor: 0, count: 0 }
    sway = 0
    lastAt = 0
    detector.reset?.()
  }
  function push(bands, now) {
    const stamp = Number.isFinite(Number(now)) ? Number(now) : lastAt
    const delta = lastAt > 0 ? Math.max(0, stamp - lastAt) : 0
    lastAt = stamp
    const result = detector.push(bands, stamp)
    if (result.strength > 0) {
      if (!lock.locked || onBeatGrid(stamp, lock)) onsets.push(stamp)
    }
    onsets = recentOnsets(onsets, stamp, window)
    lock = beatLock(onsets, { at: stamp, window })
    sway = swayStep(sway, lock.locked ? 0 : swayTarget(bands), delta, swaySpan)
    const beat = result.strength > 0 && lock.locked && onBeatGrid(stamp, lock) ? result.strength : 0
    return { beat, sway, locked: lock.locked, lock: { ...lock } }
  }
  return { push, reset, onsets: () => [...onsets], lock: () => ({ ...lock }), sway: () => sway }
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
  danceTracker: createDanceTracker(),
  sway: 0,
  lastDanceAt: 0,
  lastDance: { beat: 0, sway: 0 },
  musicTrack: '',
  musicMuted: false,
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
    // At 0.75 a kick's rise spread over too many readings to pass the sharp onset test, so drum tracks seldom locked.
    engine.analyser.smoothingTimeConstant = 0.4
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

function applyMusicVolume() {
  const volume = Math.min(1, Math.max(0, Number(engine.settings.musicVolume) || 0))
  if (engine.audio) engine.audio.volume = engine.musicMuted ? 0 : volume
  if (engine.musicGain) engine.musicGain.gain.value = engine.musicMuted ? 0 : 1
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
    if (typeof next.musicMuted === 'boolean') engine.musicMuted = next.musicMuted
    applyMusicVolume()
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
  dance(now = typeof performance === 'undefined' ? Date.now() : performance.now()) {
    const stamp = Number.isFinite(now) ? now : Date.now()
    if (!engine.settings.dance || !engine.analyser || !engine.bins || !sound.musicPlaying()) {
      engine.danceTracker.reset()
      const delta = engine.lastDanceAt > 0 ? Math.max(0, stamp - engine.lastDanceAt) : 0
      engine.lastDanceAt = stamp
      engine.sway = swayStep(engine.sway, 0, delta)
      engine.lastDance.beat = 0
      engine.lastDance.sway = engine.sway
      return engine.lastDance
    }
    if (stamp - engine.lastLevelAt < BAND_WINDOW_MS) {
      engine.lastDance.beat = 0
      engine.lastDance.sway = engine.sway
      return engine.lastDance
    }
    engine.lastLevelAt = stamp
    if (!sampleBins(stamp)) {
      engine.lastDance.beat = 0
      engine.lastDance.sway = engine.sway
      return engine.lastDance
    }
    engine.lastDanceAt = stamp
    const result = engine.danceTracker.push(engine.bands, stamp)
    engine.sway = result.sway
    engine.lastDance.beat = result.beat
    engine.lastDance.sway = result.sway
    return engine.lastDance
  },
  beat(now = typeof performance === 'undefined' ? Date.now() : performance.now()) {
    return sound.dance(now).beat
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
    applyMusicVolume()
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
    applyMusicVolume()
    return volume
  },
  setMusicMuted(value) {
    engine.musicMuted = value === true
    applyMusicVolume()
    return engine.musicMuted
  },
  musicMuted() {
    return engine.musicMuted
  },
  musicPosition() {
    const at = Number(engine.audio?.currentTime)
    return Number.isFinite(at) && at > 0 ? at : 0
  },
  musicDuration() {
    const length = Number(engine.audio?.duration)
    return Number.isFinite(length) && length > 0 ? length : 0
  },
  seekMusic(value) {
    const audio = engine.audio
    if (!audio) return 0
    const length = sound.musicDuration()
    const at = Math.min(length > 0 ? length : Infinity, Math.max(0, Number(value) || 0))
    try {
      audio.currentTime = at
    } catch {
      return sound.musicPosition()
    }
    return sound.musicPosition()
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
