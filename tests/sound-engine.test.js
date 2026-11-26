import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { passSound } from '../src/Stage.jsx'
import { bandIndexForBin, createDanceTracker, sound } from '../src/ui/sound.js'

const BINS = 64
const BAND_COUNT = 5
const STEP_MS = 45
const QUIET = [0.08, 0.08, 0, 0, 0]
const KICK = [0.9, 0.9, 0, 0, 0]

let rows = []
let sampled = 0
let clock = 0

function levelAt(index) {
  const row = rows[Math.min(index, rows.length - 1)]
  return row ?? [0, 0, 0, 0, 0]
}

function steadyKick(count) {
  return Array.from({ length: count }, (_, index) => (index > 8 && index % 14 === 0 ? KICK : QUIET))
}

function drive(levelRows) {
  rows = levelRows
  sampled = 0
  const results = []
  for (let index = 0; index < levelRows.length; index += 1) {
    clock += STEP_MS
    const bands = sound.bands(clock)
    const dance = sound.dance(clock)
    results.push({
      bands: bands ? Array.from(bands) : null,
      beat: dance.beat,
      sway: dance.sway,
    })
  }
  return results
}

class FakeAnalyser {
  constructor() {
    this.fftSize = 256
    this.smoothingTimeConstant = 0.4
    this.frequencyBinCount = BINS
  }
  connect() {}
  disconnect() {}
  getByteFrequencyData(array) {
    const levels = levelAt(sampled)
    sampled += 1
    for (let bin = 0; bin < array.length; bin += 1) {
      const band = bandIndexForBin(bin, BINS, BAND_COUNT)
      array[bin] = Math.round(Math.min(1, Math.max(0, levels[band])) * 255)
    }
  }
}

function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  }
}

class FakeContext {
  constructor() {
    FakeContext.last = this
    this.state = 'running'
    this.destination = {}
    this.currentTime = 0
    this.sampleRate = 8000
    this.nodes = []
    this.buffers = []
  }
  node(kind, fields) {
    const node = { kind, disconnect: vi.fn(), ...fields }
    node.connect = (target) => { node.output = target }
    this.nodes.push(node)
    return node
  }
  createGain() {
    return this.node('gain', { gain: param(1) })
  }
  createDynamicsCompressor() {
    return this.node('compressor', {
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    })
  }
  createBiquadFilter() {
    return this.node('filter', { frequency: param(), Q: param() })
  }
  createBuffer(channels, length) {
    expect(channels).toBe(1)
    const samples = new Float32Array(length)
    const buffer = { getChannelData: vi.fn(() => samples) }
    this.buffers.push(buffer)
    return buffer
  }
  createBufferSource() {
    return this.node('noise', { start: vi.fn(), stop: vi.fn() })
  }
  createAnalyser() {
    return new FakeAnalyser()
  }
  createMediaElementSource() {
    return { connect() {}, disconnect() {} }
  }
  createStereoPanner() {
    return this.node('panner', { pan: param() })
  }
  createOscillator() {
    return this.node('oscillator', { frequency: param(), start: vi.fn(), stop: vi.fn() })
  }
  resume() {
    return Promise.resolve()
  }
}

class FakeAudio {
  constructor() {
    FakeAudio.last = this
    this.paused = false
    this.ended = false
    this.volume = 1
    this.dataset = {}
    this.currentTime = 0
    this.duration = 0
  }
  addEventListener() {}
  removeEventListener() {}
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

let savedWindow

beforeAll(() => {
  savedWindow = globalThis.window
  globalThis.window = { AudioContext: FakeContext, Audio: FakeAudio }
  sound.setSettings({ on: true, dance: true, pulse: true, volume: 0.3, musicVolume: 0.5 })
  sound.arm()
})

afterAll(() => {
  sound.pauseMusic()
  sound.setSettings({ on: true, dance: true, pulse: true, volume: 0.3, musicVolume: 0.5 })
  if (savedWindow === undefined) delete globalThis.window
  else globalThis.window = savedWindow
})

beforeEach(async () => {
  sound.pauseMusic()
  clock += 100000
  sound.dance(clock)
  rows = []
  sampled = 0
  sound.setSettings({ on: true, dance: true, pulse: true, volume: 0.3, musicVolume: 0.5 })
  await sound.playMusic(`/music/track-${clock}.mp3`)
})

describe('the stereo room sounds', () => {
  const left = { x: 10, y: 50, width: 100, height: 100, distance: 100, overviewDistance: 1000 }
  const right = { ...left, x: 90 }
  let context
  let first

  function made(kind) {
    return context.nodes.slice(first).filter((node) => node.kind === kind)
  }

  function outputOf(node) {
    return node.output
  }

  function routing(node) {
    const chain = []
    for (let next = node; next !== context.destination; next = outputOf(next)) chain.push(next.kind)
    return chain
  }

  beforeEach(() => {
    vi.useFakeTimers()
    sound.resetLimit()
    context = FakeContext.last
    context.currentTime = 0
    first = context.nodes.length
  })

  afterEach(() => {
    sound.setSettings({ on: false })
    vi.useRealTimers()
  })

  it('routes computer beeps, wooshes and held voices through panners, one compressor and the master', () => {
    expect(sound.play('read', left)).toBe(true)
    expect(sound.play('folderOpen', left)).toBe(true)
    expect(sound.play('folderClose', right)).toBe(true)
    expect(sound.beep('message', right)).toBe(true)
    sound.voice('star', 'star', left)
    sound.voice('think', 'whir', right, 0.7)
    const [read, openClick, , messageFirst, messageSecond, starTone, whir] = made('oscillator')
    const [, , starNoise] = made('noise')
    const panners = made('panner')
    const filters = made('filter')
    const bus = outputOf(panners[0])
    const master = outputOf(bus)
    expect([read.type, messageFirst.type, messageSecond.type, starTone.type, whir.type]).toEqual([
      'sine', 'sine', 'sine', 'sine', 'triangle',
    ])
    expect(openClick.type).toBe('triangle')
    expect(starNoise.loop).toBe(true)
    expect(messageFirst.frequency.value).not.toBe(messageSecond.frequency.value)
    expect(starTone.frequency.setValueAtTime).toHaveBeenCalledWith(130, 0)
    expect(starTone.frequency.exponentialRampToValueAtTime.mock.calls.map(([value]) => value)).toEqual([300, 170])
    expect(routing(read)).toEqual(['oscillator', 'gain', 'gain', 'panner', 'compressor', 'gain'])
    expect(routing(starTone)).toEqual(['oscillator', 'filter', 'gain', 'gain', 'gain', 'panner', 'compressor', 'gain'])
    expect(routing(starNoise)).toEqual(['noise', 'filter', 'gain', 'gain', 'gain', 'panner', 'compressor', 'gain'])
    expect(routing(whir)).toContain('filter')
    expect(filters.map((filter) => filter.type)).toEqual(['bandpass', 'bandpass', 'bandpass', 'lowpass', 'lowpass'])
    expect(filters[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(2200, 0.35)
    expect(filters[1].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(240, 0.3)
    expect(filters[2].frequency.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(1500)
    expect(filters[2].frequency.exponentialRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(0.315)
    expect(outputOf(filters[0]).gain.linearRampToValueAtTime.mock.calls[0][0]).toBe(0.09)
    expect(outputOf(openClick).gain.linearRampToValueAtTime.mock.calls[0][0]).toBe(0.03)
    expect(outputOf(read).gain.linearRampToValueAtTime.mock.calls[0][0]).toBe(0.07)
    expect(outputOf(whir).gain.value).toBe(0.04)
    expect(outputOf(filters[2]).gain.value).toBe(0.045)
    expect(outputOf(filters[3]).gain.value).toBe(0.09)
    expect(made('noise').map((node) => node.buffer)).toEqual([context.buffers[0], context.buffers[0], context.buffers[0]])
    expect(context.buffers).toHaveLength(1)
    expect(context.buffers[0].getChannelData).toHaveBeenCalledTimes(1)
    expect(panners).toHaveLength(6)
    expect(panners.every((panner) => outputOf(panner) === bus)).toBe(true)
    expect(panners[0].pan.value).toBe(-0.8)
    expect(panners[2].pan.value).toBeCloseTo(0.8)
    sound.setSettings({ volume: 0.6 })
    expect(master.gain.value).toBe(0.6)
    sound.setSettings({ on: false })
    expect(master.gain.value).toBe(0)
    expect([starNoise, starTone, whir].every((source) => source.stop.mock.lastCall[0] === 0)).toBe(true)
    expect(sound.play('read', left)).toBe(false)
    sound.voice('new', 'star', left)
    expect(made('panner')).toHaveLength(6)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('moves a held voice without replacing it and fades it on explicit stop', () => {
    sound.voice('s', 'star', left, 1)
    const [panner] = made('panner')
    const [source] = made('oscillator')
    const gate = outputOf(outputOf(outputOf(source)))
    const gain = outputOf(gate)
    context.currentTime = 0.2
    sound.voice('s', 'star', { ...right, distance: 300 }, 0.5)
    expect(made('panner')).toHaveLength(1)
    expect(panner.pan.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0.2, expect.any(Number))
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.425, 0.2, expect.any(Number))
    sound.stopVoice('s')
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.2, expect.any(Number))
    expect(source.stop.mock.lastCall[0]).toBeCloseTo(0.26)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renews the watchdog on movement and releases after half a second without a frame', () => {
    sound.voice('s', 'star', left)
    const [source] = made('oscillator')
    const gate = outputOf(outputOf(outputOf(source)))
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.5, expect.any(Number))
    vi.advanceTimersByTime(300)
    context.currentTime = 0.3
    sound.voice('s', 'star', right)
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.8, expect.any(Number))
    expect(source.stop.mock.lastCall[0]).toBeCloseTo(0.86)
    vi.advanceTimersByTime(499)
    expect(vi.getTimerCount()).toBe(1)
    expect(source.stop).toHaveBeenCalledTimes(2)
    context.currentTime = 0.8
    vi.advanceTimersByTime(1)
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.8, expect.any(Number))
    expect(source.stop).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    sound.voice('s', 'star', right)
    expect(made('panner')).toHaveLength(2)
  })

  it('shares one rolling limit across twelve one-shots', () => {
    for (let index = 0; index < 11; index += 1) expect(sound.play('list', left)).toBe(true)
    expect(sound.beep('message', left)).toBe(true)
    expect(sound.play('folderClose', left)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(sound.play('folderClose', left)).toBe(true)
  })

  it('replaces the oldest of four stars and keeps it silent on later moves', () => {
    for (let index = 0; index < 5; index += 1) sound.voice(index, 'star', left)
    const sources = made('oscillator').filter((node) => node.type === 'sine')
    expect(sources).toHaveLength(5)
    expect(sources[0].stop.mock.lastCall[0]).toBeLessThan(0.1)
    expect(sources.slice(1).every((source) => source.stop.mock.lastCall[0] > 0.5)).toBe(true)
    sound.voice(0, 'star', right)
    expect(made('panner')).toHaveLength(5)
  })

  it('keeps three whirs by level and distance and changes the filter as the rings turn', () => {
    sound.voice('a', 'whir', left, 1)
    sound.voice('b', 'whir', left, 0.8)
    sound.voice('c', 'whir', left, 0.6)
    sound.voice('d', 'whir', { ...left, distance: 1900 }, 1)
    expect(made('filter')).toHaveLength(3)
    sound.voice('d', 'whir', right, 1)
    const sources = made('oscillator')
    expect(sources).toHaveLength(4)
    expect(sources[2].stop.mock.lastCall[0]).toBeLessThan(0.1)
    expect([sources[0], sources[1], sources[3]].every((source) => source.stop.mock.lastCall[0] > 0.5)).toBe(true)
    const filter = made('filter')[3]
    const before = filter.frequency.setTargetAtTime.mock.lastCall[0]
    const gain = outputOf(outputOf(filter))
    const beforeGain = gain.gain.setTargetAtTime.mock.lastCall[0]
    sound.voice('d', 'whir', { ...right, orbit: 1, loop: 2 }, 1)
    expect(filter.frequency.setTargetAtTime.mock.lastCall[0]).not.toBe(before)
    expect(gain.gain.setTargetAtTime.mock.lastCall[0]).not.toBe(beforeGain)
  })
})

describe('the sound engine with a fake analyser', () => {
  it('gives bands and a beat on a steady kick', () => {
    const results = drive(steadyKick(200))
    expect(results.every((result) => result.bands && result.bands.length === BAND_COUNT)).toBe(true)
    expect(results.some((result) => Math.max(...result.bands) > 0)).toBe(true)
    expect(results.filter((result) => result.beat > 0).length).toBeGreaterThan(0)
    expect(results.some((result) => result.sway > 0)).toBe(true)
  })

  it('gives bands and beats on soft music that never locks', () => {
    let seed = 1
    const nextSeed = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const loFi = []
    let next = 10
    let bump = 0
    for (let step = 0; step < 240; step += 1) {
      if (step >= next) {
        bump = 2
        next = step + 6 + Math.floor(nextSeed() * 19)
      }
      const low = bump > 0 ? 0.42 : 0.22
      const high = bump > 0 ? 0.3 : 0.2
      loFi.push([low, low * 0.9, high, high, high])
      if (bump > 0) bump -= 1
    }
    const results = drive(loFi)
    expect(results.every((result) => result.bands && result.bands.length === BAND_COUNT)).toBe(true)
    expect(results.some((result) => Math.max(...result.bands) > 0.1)).toBe(true)
    expect(results.filter((result) => result.beat > 0).length).toBeGreaterThan(2)

    const tracker = createDanceTracker()
    loFi.forEach((row, index) => tracker.push(row, (index + 1) * STEP_MS))
    expect(tracker.lock().locked).toBe(false)
  })

  it('turns the beat and the sway off when the Dance switch is off', () => {
    drive(steadyKick(200))
    sound.setSettings({ dance: false })
    const rest = drive(Array.from({ length: 160 }, () => QUIET))
    expect(rest.every((result) => result.beat === 0)).toBe(true)
    expect(rest[rest.length - 1].sway).toBeLessThan(0.05)
  })

  it('turns the bands off when the Pulse switch is off', () => {
    sound.setSettings({ pulse: false })
    clock += STEP_MS
    expect(sound.bands(clock)).toBe(null)
    sound.setSettings({ pulse: true })
    clock += STEP_MS
    expect(sound.bands(clock)).not.toBe(null)
  })
})

describe('the music seek', () => {
  it('does nothing and answers 0 while the track length is not known', () => {
    const audio = FakeAudio.last
    expect(audio).not.toBeNull()
    audio.currentTime = 7
    audio.duration = 0
    expect(sound.seekMusic(30)).toBe(0)
    expect(audio.currentTime).toBe(7)

    audio.duration = 120
    expect(sound.seekMusic(30)).toBe(30)
    expect(audio.currentTime).toBe(30)
  })
})

describe('the room gets the sound each frame', () => {
  it('passes the bands, a beat and the sway to the room', () => {
    const calls = []
    const room = {
      setBands: (value) => calls.push(['bands', value]),
      setBeat: (value) => calls.push(['beat', value]),
      setSway: (value) => calls.push(['sway', value]),
    }
    const bands = [0.1, 0.2, 0.3, 0.4, 0.5]
    passSound(room, bands, { beat: 0.7, sway: 0.4 })
    expect(calls).toEqual([
      ['bands', bands],
      ['beat', 0.7],
      ['sway', 0.4],
    ])
  })

  it('sends no beat at rest and tolerates a missing room', () => {
    const calls = []
    const room = {
      setBands: (value) => calls.push(['bands', value]),
      setBeat: (value) => calls.push(['beat', value]),
      setSway: (value) => calls.push(['sway', value]),
    }
    passSound(room, null, { beat: 0, sway: 0 })
    expect(calls).toEqual([
      ['bands', null],
      ['sway', 0],
    ])
    expect(() => passSound(null, [1], { beat: 1, sway: 1 })).not.toThrow()
  })
})
