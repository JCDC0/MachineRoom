import { DEFAULT_SETTINGS } from './settings.js'

export const SOUND_LIMIT = 12
export const SOUND_WINDOW_MS = 1000
export const BAND_COUNT = 5
const BAND_WINDOW_MS = 45

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
  read: [1319],
  write: [1175],
  created: [1568],
  deleted: [880],
  list: [1047],
  message: [988, 1319],
}
const BEEP = { duration: 0.05, gap: 0.07, peak: 0.07 }
const FAULT = { notes: [392, 277], type: 'triangle', duration: 0.12, gap: 0.15, peak: 0.055 }
const WOOSHES = {
  folderOpen: { from: 320, to: 2200, duration: 0.35, clickAt: 0 },
  folderClose: { from: 1900, to: 240, duration: 0.3, clickAt: 0.286 },
}
const WOOSH_PEAK = 0.09
const CLICK_PEAK = 0.03
const NOISE_SECONDS = 1
const STAR_AIR = { from: 900, to: 300, q: 0.9, level: 0.035 }
const STAR_TONE = { from: 150, to: 72, beat: 1.027, cutoff: 520, level: 0.08 }
const WHIR_LEVEL = 0.04
const STAR_LIMIT = 4
const WHIR_LIMIT = 3
const VOICE_IDLE = 0.5
const GLIDE = 0.012
const RELEASE = 0.06

export function fillNoise(samples, seed = 1) {
  let state = seed >>> 0
  for (let index = 0; index < samples.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    samples[index] = state / 2147483648 - 1
  }
  return samples
}

export function folderSweep(kind) {
  return Object.hasOwn(WOOSHES, kind) ? WOOSHES[kind] : null
}

export function computerBeep(kind) {
  if (kind === 'failed') {
    return FAULT.notes.map((frequency, index) => ({ frequency, type: FAULT.type, at: index * FAULT.gap, duration: FAULT.duration, peak: FAULT.peak }))
  }
  if (!Object.hasOwn(TONES, kind)) return []
  return TONES[kind].map((frequency, index) => ({
    frequency,
    type: 'sine',
    at: index * BEEP.gap,
    duration: BEEP.duration,
  }))
}

export function starSweep(seconds = 0.45) {
  const length = Number.isFinite(seconds) && seconds > 0 ? seconds : 0.45
  return [
    { at: 0, frequency: STAR_TONE.from },
    { at: length, frequency: STAR_TONE.to },
  ]
}

export function loudestWhirs(voices) {
  return [...voices]
    .filter((voice) => voice.level * voice.spatial.gain > 0)
    .sort((a, b) => b.level * b.spatial.gain - a.level * a.spatial.gain)
    .slice(0, WHIR_LIMIT)
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
  if (tooFar) return { audible: false, pan: 0, gain: 0 }
  if (!onScreen) return { audible: true, pan: x < width / 2 ? -1 : 1, gain: 0.35 }
  const gain = Math.max(0.35, 1 - distance / (overviewDistance * 2))
  return { audible: true, pan: panForScreen(x, width), gain }
}

const BEAT_WINDOW = 22
const GROUP_REST_MS = 160
const LOW_BANDS = Object.freeze([0, 1])
const HIGH_BANDS = Object.freeze([2, 3, 4])
const ONSET_STEPS = 2
const ONSET_SHARE = 0.6
const ONSET_LOOK = 10

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
      const before = history.slice(0, -1)
      const average = before.reduce((sum, level) => sum + level, 0) / Math.max(1, before.length)
      const rise = Math.max(0, groups[name] - average)
      const value = Math.min(1, Math.max(0.35, rise * 2))
      if (value > strength) {
        strength = value
        group = name
      }
    }
    return { strength, group, low: fired.low, high: fired.high }
  }
  return { push, reset, levels }
}

const LOCK_WINDOW_MS = 8000
const LOCK_MIN_GAP_MS = 300
const LOCK_MAX_GAP_MS = 1500
const LOCK_MIN_ONSETS = 6
const LOCK_TOLERANCE = 0.2
export const LOCK_GRID_MS = 90
const LOCK_STALE_GAPS = 4
const LOCK_MIN_GAPS = 3
const GAP_STEP_MS = 10
export const SWAY_MS = 1500
const SWAY_GAIN = 1.5

function cleanOnsets(onsets) {
  const times = []
  for (const value of Array.isArray(onsets) ? onsets : []) {
    const at = Number(value)
    if (Number.isFinite(at) && at >= 0 && !times.includes(at)) times.push(at)
  }
  return times.sort((a, b) => a - b)
}

function recentOnsets(onsets, at, window = LOCK_WINDOW_MS) {
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

function beatGrid(onsets, gap, { tolerance = LOCK_TOLERANCE } = {}) {
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
    const onGrid = onBeatGrid(stamp, lock)
    const beat = result.strength > 0 && (!lock.locked || onGrid) ? result.strength : 0
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

export function activitySounds(activity) {
  if (activity?.type !== 'agent.message') return []
  if (typeof activity.to !== 'string' || activity.to.trim() === '') return []
  return [{ agent: activity.to, kind: 'message' }]
}

export function touchSoundKind(touch, removes, missing, exists) {
  if (touch.kind === 'dir') return 'list'
  if (touch.kind !== 'file') return null
  if (touch.mode === 'read') return 'read'
  if (removes) {
    missing.add(touch.path)
    return 'deleted'
  }
  return missing.delete(touch.path) || !exists() ? 'created' : 'write'
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
  bus: null,
  noise: null,
  voices: new Map(),
  oneShots: new Set(),
  voiceTimer: null,
  musicGain: null,
  analyser: null,
  bins: null,
  bands: new Float32Array(BAND_COUNT),
  bandSums: new Float32Array(BAND_COUNT),
  bandCounts: new Uint16Array(BAND_COUNT),
  lastBandsAt: -Infinity,
  lastLevelAt: 0,
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
    applyRoomVolume()
    engine.master.connect(engine.context.destination)
    engine.bus = engine.context.createDynamicsCompressor()
    engine.bus.threshold.value = -18
    engine.bus.knee.value = 8
    engine.bus.ratio.value = 12
    engine.bus.attack.value = 0
    engine.bus.release.value = 0.14
    engine.bus.connect(engine.master)
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

function applyRoomVolume() {
  if (engine.master) {
    engine.master.gain.value = engine.settings.on ? Math.min(1, Math.max(0, Number(engine.settings.volume) || 0)) : 0
  }
}

function spatialOutput(context, spatial, level) {
  const gain = context.createGain()
  const panner = context.createStereoPanner()
  gain.gain.value = spatial.gain * level
  panner.pan.value = spatial.pan
  gain.connect(panner)
  panner.connect(engine.bus)
  return { gain, panner }
}

function envelope(param, at, duration, peak, attack) {
  param.setValueAtTime(0, at)
  param.linearRampToValueAtTime(peak, at + attack)
  param.exponentialRampToValueAtTime(0.0001, at + duration)
}

function playNote(context, output, at, note, peak, attack, onEnd) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = note.type
  oscillator.frequency.value = note.frequency
  envelope(gain.gain, at, note.duration, peak, attack)
  oscillator.connect(gain)
  gain.connect(output)
  oscillator.onended = () => {
    oscillator.disconnect()
    gain.disconnect()
    onEnd()
  }
  oscillator.start(at)
  oscillator.stop(at + note.duration)
  return oscillator
}

function noiseBuffer(context) {
  if (!engine.noise) {
    const rate = context.sampleRate
    engine.noise = context.createBuffer(1, Math.ceil(rate * NOISE_SECONDS), rate)
    fillNoise(engine.noise.getChannelData(0))
  }
  return engine.noise
}

function playSweep(context, output, at, sweep, onEnd) {
  const noise = context.createBufferSource()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()
  noise.buffer = noiseBuffer(context)
  filter.type = 'bandpass'
  filter.Q.value = 0.8
  filter.frequency.setValueAtTime(sweep.from, at)
  filter.frequency.exponentialRampToValueAtTime(sweep.to, at + sweep.duration)
  envelope(gain.gain, at, sweep.duration, WOOSH_PEAK, sweep.duration * 0.33)
  noise.connect(filter)
  filter.connect(gain)
  gain.connect(output)
  noise.onended = () => {
    noise.disconnect()
    filter.disconnect()
    gain.disconnect()
    onEnd()
  }
  noise.start(at)
  noise.stop(at + sweep.duration)
  const click = playNote(context, output, at + sweep.clickAt, { type: 'triangle', frequency: 1560, duration: 0.014 }, CLICK_PEAK, 0.001, onEnd)
  return [noise, click]
}

function moveVoice(voice, now) {
  const { gain, panner, gate, filter, sources } = voice.nodes
  const orbit = Number(voice.place.orbit) || 0
  const loop = Number(voice.place.loop) || 0
  const wobble = filter ? 0.84 + 0.10 * Math.sin(loop) + 0.06 * Math.sin(orbit) : 1
  gain.gain.setTargetAtTime(voice.spatial.gain * voice.level * wobble, now, GLIDE)
  panner.pan.setTargetAtTime(voice.spatial.pan, now, GLIDE)
  if (filter) filter.frequency.setTargetAtTime(260 + 70 * Math.sin(orbit) + 60 * Math.cos(loop), now, GLIDE)
  gate.gain.cancelScheduledValues(now)
  gate.gain.setTargetAtTime(0, now + VOICE_IDLE, GLIDE)
  for (const source of sources) source.stop(now + VOICE_IDLE + RELEASE)
}

function startVoice(voice, context) {
  const now = context.currentTime
  const { gain, panner } = spatialOutput(context, voice.spatial, 0)
  const gate = context.createGain()
  gate.connect(gain)
  const { sources, nodes, filter = null } = voice.kind === 'whir'
    ? whirParts(context, gate, now)
    : starParts(context, gate, now, voice.place.flightSeconds)
  sources[0].onended = () => {
    for (const node of [...sources, ...nodes]) node.disconnect()
    gate.disconnect()
    gain.disconnect()
    panner.disconnect()
  }
  voice.nodes = { gain, panner, gate, filter, sources }
  moveVoice(voice, now)
}

function whirParts(context, gate, now) {
  const filter = context.createBiquadFilter()
  const source = context.createOscillator()
  const tone = context.createGain()
  filter.type = 'lowpass'
  filter.frequency.value = 260
  filter.connect(gate)
  source.type = 'triangle'
  source.frequency.setValueAtTime(116, now)
  tone.gain.value = WHIR_LEVEL
  source.connect(tone)
  tone.connect(filter)
  source.start(now)
  return { sources: [source], nodes: [tone, filter], filter }
}

function starParts(context, gate, now, flightSeconds) {
  const flight = Number.isFinite(flightSeconds) && flightSeconds > 0 ? flightSeconds : 0.45
  const noise = context.createBufferSource()
  const band = context.createBiquadFilter()
  const air = context.createGain()
  noise.buffer = noiseBuffer(context)
  noise.loop = true
  band.type = 'bandpass'
  band.Q.value = STAR_AIR.q
  band.frequency.setValueAtTime(STAR_AIR.from, now)
  band.frequency.exponentialRampToValueAtTime(STAR_AIR.to, now + flight)
  air.gain.value = STAR_AIR.level
  noise.connect(band)
  band.connect(air)
  air.connect(gate)
  const muffle = context.createBiquadFilter()
  const body = context.createGain()
  muffle.type = 'lowpass'
  muffle.frequency.value = STAR_TONE.cutoff
  body.gain.value = STAR_TONE.level
  muffle.connect(body)
  body.connect(gate)
  const tones = [1, STAR_TONE.beat].map((ratio) => {
    const tone = context.createOscillator()
    tone.type = 'sine'
    for (const [index, point] of starSweep(flight).entries()) {
      if (index === 0) tone.frequency.setValueAtTime(point.frequency * ratio, now)
      else tone.frequency.exponentialRampToValueAtTime(point.frequency * ratio, now + point.at)
    }
    tone.connect(muffle)
    tone.start(now)
    return tone
  })
  noise.start(now)
  return { sources: [noise, ...tones], nodes: [band, air, muffle, body] }
}

function retireVoice(voice, immediate = false) {
  if (!voice.nodes) return
  const now = engine.context.currentTime
  const { gate, sources } = voice.nodes
  gate.gain.cancelScheduledValues(now)
  gate.gain.setTargetAtTime(0, now, GLIDE)
  for (const source of sources) source.stop(immediate ? now : now + RELEASE)
  voice.nodes = null
}

function watchVoices() {
  if (engine.voices.size === 0) {
    clearTimeout(engine.voiceTimer)
    engine.voiceTimer = null
  } else if (engine.voiceTimer === null) {
    const nextExpiry = Math.min(...Array.from(engine.voices.values(), (voice) => voice.expires))
    engine.voiceTimer = setTimeout(() => {
      engine.voiceTimer = null
      expireVoices(Date.now())
      watchVoices()
    }, Math.max(0, nextExpiry - Date.now()))
  }
}

function expireVoices(now) {
  for (const [id, voice] of engine.voices) {
    if (now < voice.expires) continue
    retireVoice(voice)
    engine.voices.delete(id)
  }
}

function chooseWhirs(context) {
  const candidates = [...engine.voices.values()].filter((voice) => voice.kind === 'whir')
  const chosen = loudestWhirs(candidates)
  for (const voice of candidates) {
    if (!chosen.includes(voice)) retireVoice(voice)
  }
  for (const voice of chosen) {
    if (!voice.nodes) startVoice(voice, context)
  }
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
    applyRoomVolume()
    if (!engine.settings.on) {
      for (const voice of engine.voices.values()) retireVoice(voice, true)
      engine.voices.clear()
      watchVoices()
    }
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
    return sound.play(kind, place)
  },
  play(kind, place) {
    if (!engine.armed || !engine.settings.on || globalThis.document?.hidden) return false
    const sweep = folderSweep(kind)
    const notes = computerBeep(kind)
    if (!sweep && notes.length === 0) return false
    const spatial = spatialSound(place)
    if (!spatial.audible) return false
    const context = ensureContext()
    if (!context || !engine.limiter.take()) return false
    const { gain, panner } = spatialOutput(context, spatial, 1)
    const now = context.currentTime
    const shot = { gain, sources: [] }
    engine.oneShots.add(shot)
    let remaining = sweep ? 2 : notes.length
    function onEnd() {
      remaining -= 1
      if (remaining === 0) {
        engine.oneShots.delete(shot)
        gain.disconnect()
        panner.disconnect()
      }
    }
    if (sweep) shot.sources = playSweep(context, gain, now, sweep, onEnd)
    else {
      for (const note of notes) shot.sources.push(playNote(context, gain, now + note.at, note, note.peak ?? BEEP.peak, 0.004, onEnd))
    }
    return true
  },
  voice(id, kind, place = {}, level = 1) {
    if (!engine.armed || !engine.settings.on || (kind !== 'star' && kind !== 'whir')) return
    const context = ensureContext()
    if (!context) return
    const now = Date.now()
    expireVoices(now)
    const current = engine.voices.get(id)
    const voice = current ?? { kind, nodes: null }
    voice.place = place
    voice.level = Math.min(1, Math.max(0, Number(level) || 0))
    voice.spatial = spatialSound(place)
    voice.expires = now + VOICE_IDLE * 1000
    if (!current) engine.voices.set(id, voice)
    if (voice.nodes) moveVoice(voice, context.currentTime)
    if (voice.kind === 'whir') chooseWhirs(context)
    else if (!current) {
      const active = [...engine.voices.values()].filter((item) => item.kind === 'star' && item.nodes)
      if (active.length >= STAR_LIMIT) retireVoice(active[0])
      startVoice(voice, context)
    }
    watchVoices()
  },
  stopRoom() {
    for (const shot of engine.oneShots) {
      shot.gain.disconnect()
      for (const source of shot.sources) source.stop()
    }
    engine.oneShots.clear()
    for (const voice of engine.voices.values()) retireVoice(voice, true)
    engine.voices.clear()
    watchVoices()
  },
  stopVoice(id) {
    const voice = engine.voices.get(id)
    if (!voice) return
    retireVoice(voice)
    engine.voices.delete(id)
    watchVoices()
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
    engine.settings = { ...engine.settings, musicMuted: engine.musicMuted }
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
    if (!(length > 0)) return 0
    const at = Math.min(length, Math.max(0, Number(value) || 0))
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
