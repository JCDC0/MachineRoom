import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { passSound } from '../src/Stage.jsx'
import { bandIndexForBin, sound } from '../src/ui/sound.js'

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

class FakeGain {
  constructor() {
    this.gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  }
  connect() {}
  disconnect() {}
}

class FakeContext {
  constructor() {
    this.state = 'running'
    this.destination = {}
    this.currentTime = 0
  }
  createGain() {
    return new FakeGain()
  }
  createAnalyser() {
    return new FakeAnalyser()
  }
  createMediaElementSource() {
    return { connect() {}, disconnect() {} }
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect() {}, disconnect() {} }
  }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  resume() {
    return Promise.resolve()
  }
}

class FakeAudio {
  constructor() {
    this.paused = false
    this.ended = false
    this.volume = 1
    this.dataset = {}
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

describe('the sound engine with a fake analyser', () => {
  it('gives bands and a beat on a steady kick', () => {
    const results = drive(steadyKick(200))
    expect(results.every((result) => result.bands && result.bands.length === BAND_COUNT)).toBe(true)
    expect(results.some((result) => Math.max(...result.bands) > 0)).toBe(true)
    expect(results.filter((result) => result.beat > 0).length).toBeGreaterThan(0)
    expect(results.some((result) => result.sway > 0)).toBe(true)
  })

  it('gives bands on soft music that never locks', () => {
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
