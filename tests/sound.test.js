import { describe, expect, it } from 'vitest'
import { DANCE_SCALE, ORCHESTRATOR_DANCE_SCALE, danceScale } from '../src/engine/agents.js'
import {
  BAND_COUNT,
  LOCK_GRID_MS,
  SOUND_LIMIT,
  SOUND_WINDOW_MS,
  SWAY_MS,
  activitySounds,
  bandGroups,
  bandIndexForBin,
  beatDetector,
  beatLock,
  createBandBeatDetector,
  createDanceTracker,
  createRateLimit,
  findBeatGap,
  isDeleteCommand,
  onBeatGrid,
  panForScreen,
  sharpOnset,
  spatialSound,
  swayStep,
  swayTarget,
} from '../src/ui/sound.js'

describe('spatial beeps', () => {
  it('pans a place by its screen x', () => {
    expect(panForScreen(0, 100)).toBe(-1)
    expect(panForScreen(50, 100)).toBe(0)
    expect(panForScreen(100, 100)).toBe(1)
    expect(panForScreen(-20, 100)).toBe(-1)
    expect(panForScreen(120, 100)).toBe(1)
    expect(panForScreen(10, 0)).toBe(0)
  })

  it('keeps a card on screen and within twice the overview audible', () => {
    const near = spatialSound({ x: 50, y: 50, width: 100, height: 100, distance: 200, overviewDistance: 1000 })
    const far = spatialSound({ x: 50, y: 50, width: 100, height: 100, distance: 1600, overviewDistance: 1000 })
    expect(near.audible).toBe(true)
    expect(near.pan).toBe(0)
    expect(near.gain).toBeCloseTo(0.9, 6)
    expect(far.audible).toBe(true)
    expect(far.gain).toBeLessThan(near.gain)
    expect(spatialSound({ x: 50, y: 50, width: 100, height: 100, distance: 2100, overviewDistance: 1000 }).audible).toBe(false)
  })

  it('drops a card off screen or with a broken place', () => {
    expect(spatialSound({ x: -1, y: 50, width: 100, height: 100, distance: 10, overviewDistance: 1000 }).audible).toBe(false)
    expect(spatialSound({ x: 50, y: 110, width: 100, height: 100, distance: 10, overviewDistance: 1000 }).audible).toBe(false)
    expect(spatialSound({}).audible).toBe(false)
    expect(spatialSound({ x: 50, y: 50, width: 100, height: 100, distance: 10, overviewDistance: 0 }).audible).toBe(false)
  })
})

describe('beat detector', () => {
  it('finds a rise past the last second of levels', () => {
    expect(beatDetector([...Array(9).fill(0.1), 0.9])).toBe(true)
    expect(beatDetector(Array(10).fill(0.4))).toBe(false)
    expect(beatDetector([0.5, 0.6, 0.5, 0.6, 0.5, 0.6, 0.5, 0.6, 0.5, 0.55])).toBe(false)
  })

  it('hears the beat in soft music that never jumps 30 percent', () => {
    expect(beatDetector([0.5, 0.52, 0.49, 0.51, 0.5, 0.48, 0.52, 0.5, 0.49, 0.6])).toBe(true)
    expect(beatDetector([0.5, 0.52, 0.49, 0.51, 0.5, 0.48, 0.52, 0.5, 0.62, 0.6])).toBe(false)
  })

  it('needs enough samples and a level above the floor', () => {
    expect(beatDetector([])).toBe(false)
    expect(beatDetector([0.1, 0.9])).toBe(false)
    expect(beatDetector([...Array(9).fill(0.01), 0.05])).toBe(false)
    expect(beatDetector(null)).toBe(false)
  })
})

describe('delete commands', () => {
  it('sees each remove command the room knows', () => {
    expect(isDeleteCommand('rm -rf build')).toBe(true)
    expect(isDeleteCommand('del out.txt')).toBe(true)
    expect(isDeleteCommand('Remove-Item -Recurse .\\tmp')).toBe(true)
    expect(isDeleteCommand('git rm src/old.js')).toBe(true)
    expect(isDeleteCommand('git -C repo rm src/old.js')).toBe(true)
    expect(isDeleteCommand('$ rm src/old.js')).toBe(true)
    expect(isDeleteCommand('cd src && rm old.js')).toBe(true)
  })

  it('leaves other commands alone', () => {
    expect(isDeleteCommand('git status')).toBe(false)
    expect(isDeleteCommand('echo rm -rf build')).toBe(false)
    expect(isDeleteCommand('rmdir build')).toBe(false)
    expect(isDeleteCommand('npm run build')).toBe(false)
    expect(isDeleteCommand('')).toBe(false)
    expect(isDeleteCommand(null)).toBe(false)
  })
})

describe('the sound rate limit', () => {
  it('takes at most SOUND_LIMIT sounds in a rolling SOUND_WINDOW_MS', () => {
    const limit = createRateLimit()
    const start = 100
    for (let index = 0; index < SOUND_LIMIT; index += 1) {
      expect(limit.take(start + index)).toBe(true)
    }
    expect(limit.take(start + SOUND_LIMIT)).toBe(false)
    expect(limit.count(start + SOUND_LIMIT)).toBe(SOUND_LIMIT)
    const later = start + SOUND_WINDOW_MS + SOUND_LIMIT
    expect(limit.take(later)).toBe(true)
    expect(limit.count(later)).toBe(1)
  })

  it('can be reset', () => {
    const limit = createRateLimit({ limit: 1 })
    expect(limit.take(0)).toBe(true)
    expect(limit.take(1)).toBe(false)
    limit.reset()
    expect(limit.take(2)).toBe(true)
  })
})

describe('the sound of a file touch', () => {
  it('names a read, a write, a created file and a deleted file', () => {
    const known = new Set(['src/a.js'])
    expect(activitySounds({ type: 'tool.start', touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }] }, known)).toEqual([
      { path: 'src/a.js', kind: 'read' },
    ])
    expect(activitySounds({ type: 'tool.start', touches: [{ kind: 'file', path: 'src/a.js', mode: 'write' }] }, known)).toEqual([
      { path: 'src/a.js', kind: 'write' },
    ])
    expect(activitySounds({ type: 'tool.start', touches: [{ kind: 'file', path: 'src/new.js', mode: 'write' }] }, known)).toEqual([
      { path: 'src/new.js', kind: 'created' },
    ])
    expect(known.has('src/new.js')).toBe(true)
    expect(activitySounds({ type: 'tool.start', label: '$ rm src/a.js', touches: [{ kind: 'file', path: 'src/a.js', mode: 'write' }] }, known)).toEqual([
      { path: 'src/a.js', kind: 'deleted' },
    ])
    expect(activitySounds({ type: 'tool.start', touches: [{ kind: 'dir', path: 'src', mode: 'list' }] }, known)).toEqual([])
  })
})

describe('the sound bands', () => {
  it('runs from bass to treble across the analyser bins', () => {
    expect(bandIndexForBin(0, 100, BAND_COUNT)).toBe(0)
    expect(bandIndexForBin(1, 100, BAND_COUNT)).toBe(0)
    expect(bandIndexForBin(2, 100, BAND_COUNT)).toBe(1)
    expect(bandIndexForBin(20, 100, BAND_COUNT)).toBe(3)
    expect(bandIndexForBin(99, 100, BAND_COUNT)).toBe(BAND_COUNT - 1)
  })

  it('keeps a bin inside the bands and gives a broken one the bass', () => {
    expect(bandIndexForBin(-4, 100, BAND_COUNT)).toBe(0)
    expect(bandIndexForBin(100, 100, BAND_COUNT)).toBe(BAND_COUNT - 1)
    expect(bandIndexForBin(4, 0, BAND_COUNT)).toBe(0)
    expect(bandIndexForBin('x', 100, BAND_COUNT)).toBe(0)
    expect(bandIndexForBin(3, 10, 0)).toBe(0)
  })

  it('has five bands for the shapes to read', () => {
    expect(BAND_COUNT).toBe(5)
  })
})

describe('the band beat groups', () => {
  const quiet = [0.1, 0.1, 0, 0, 0]
  const kick = [0.9, 0.9, 0, 0, 0]
  const hats = [0, 0, 0.9, 0.9, 0.9]
  const both = [0.9, 0.9, 0.9, 0.9, 0.9]

  function beats(levels, options = {}) {
    const detector = createBandBeatDetector(options)
    const found = []
    levels.forEach((bands, index) => {
      const at = index * 45
      const result = detector.push(bands, at)
      if (result.strength > 0) found.push({ ...result, at })
    })
    return found
  }

  it('splits the five bands into a low group and a high group', () => {
    const groups = bandGroups([0.2, 0.4, 0.6, 0.8, 1])
    expect(groups.low).toBeCloseTo(0.3, 10)
    expect(groups.high).toBeCloseTo(0.8, 10)
    const typed = bandGroups(new Float32Array([0.2, 0.4, 0.6, 0.8, 1]))
    expect(typed.low).toBeCloseTo(0.3, 6)
    expect(typed.high).toBeCloseTo(0.8, 6)
    expect(bandGroups([])).toEqual({ low: 0, high: 0 })
    expect(bandGroups(null)).toEqual({ low: 0, high: 0 })
    const mixed = bandGroups([0.5, 'x', 0.4, -1, 0.2])
    expect(mixed.low).toBeCloseTo(0.5, 10)
    expect(mixed.high).toBeCloseTo(0.3, 10)
  })

  it('hears a kick alone in the low group', () => {
    const found = beats([...Array(9).fill(quiet), kick])
    expect(found).toHaveLength(1)
    expect(found[0].low).toBe(true)
    expect(found[0].high).toBe(false)
    expect(found[0].group).toBe('low')
    expect(found[0].strength).toBeGreaterThan(0.35)
  })

  it('hears hats alone in the high group', () => {
    const found = beats([...Array(9).fill(quiet), hats])
    expect(found).toHaveLength(1)
    expect(found[0].low).toBe(false)
    expect(found[0].high).toBe(true)
    expect(found[0].group).toBe('high')
    expect(found[0].strength).toBeGreaterThan(0.35)
  })

  it('hears a kick and hats together as one strong beat', () => {
    const found = beats([...Array(9).fill(quiet), both])
    expect(found).toHaveLength(1)
    expect(found[0].low).toBe(true)
    expect(found[0].high).toBe(true)
    expect(found[0].strength).toBe(1)
  })

  it('gives each group its own rest', () => {
    const found = beats([...Array(9).fill(quiet), kick, hats])
    expect(found.map((beat) => beat.group)).toEqual(['low', 'high'])
  })

  it('holds a group back until its rest is over', () => {
    const found = beats([...Array(9).fill(quiet), kick, quiet, kick, quiet, quiet, kick])
    expect(found.map((beat) => beat.at)).toEqual([405, 630])
  })
})

describe('the beat a dancer hears', () => {
  const QUIET = [0.08, 0.08, 0, 0, 0]
  const KICK = [0.9, 0.9, 0, 0, 0]
  const STRINGS = [0.18, 0.26, 0.34, 0.3, 0.22]

  function warm(tracker, bands = QUIET, count = 9) {
    let time = 0
    for (let index = 0; index < count; index += 1) {
      tracker.push(bands, time)
      time += 45
    }
    return time
  }

  it('counts a sharp rise and never a slow swell', () => {
    expect(sharpOnset([...Array(9).fill(0.1), 0.9])).toBe(true)
    const swell = Array.from({ length: 14 }, (_, index) => 0.1 + 0.5 * (index / 13))
    expect(sharpOnset(swell)).toBe(false)
    expect(sharpOnset([...Array(9).fill(0.1)])).toBe(false)
    expect(sharpOnset(null)).toBe(false)
  })

  it('finds the common gap between onsets', () => {
    expect(findBeatGap([0, 600, 1200, 1800, 2400, 3000])).toBeCloseTo(600, 6)
    expect(findBeatGap([0, 190, 380, 570])).toBe(0)
    expect(findBeatGap([])).toBe(0)
  })

  it('locks a steady kick at 100 beats a minute and moves on its grid', () => {
    const tracker = createDanceTracker()
    const start = warm(tracker)
    const plan = Array.from({ length: 14 }, (_, beat) => start + Math.round((beat * 600) / 45) * 45)
    const beats = []
    let time = start
    let next = 0
    while (time <= plan[plan.length - 1] + 90) {
      const kick = next < plan.length && time === plan[next]
      const result = tracker.push(kick ? KICK : QUIET, time)
      if (result.beat > 0) beats.push(time)
      if (kick) next += 1
      time += 45
    }
    const lock = tracker.lock()
    expect(lock.locked).toBe(true)
    expect(lock.gap).toBeGreaterThan(560)
    expect(lock.gap).toBeLessThan(640)
    expect(beats.length).toBeGreaterThanOrEqual(5)
    for (const at of beats) expect(onBeatGrid(at, lock)).toBe(true)

    const off = tracker.push(KICK, plan[plan.length - 1] + 300)
    expect(off.locked).toBe(true)
    expect(off.beat).toBe(0)
  })

  it('never counts a slow swell as a beat', () => {
    const tracker = createDanceTracker()
    let time = warm(tracker)
    let beats = 0
    for (let index = 0; index < 24; index += 1) {
      const level = 0.1 + 0.6 * Math.min(1, index / 12)
      const result = tracker.push([level, level * 0.8, 0, 0, 0], time)
      if (result.beat > 0) beats += 1
      time += 45
    }
    for (let index = 0; index < 10; index += 1) {
      const result = tracker.push([0.7, 0.56, 0, 0, 0], time)
      if (result.beat > 0) beats += 1
      time += 45
    }
    expect(beats).toBe(0)
    expect(tracker.lock().locked).toBe(false)
    expect(tracker.sway()).toBeGreaterThan(0.05)
  })

  it('never locks on onsets at random and sways instead', () => {
    const random = [0, 410, 1130, 1650, 2630, 2990, 4230, 4850, 5300, 6660, 7180, 7900]
    expect(beatLock(random, { at: 8000 }).locked).toBe(false)

    const tracker = createDanceTracker()
    let time = warm(tracker, STRINGS)
    let beats = 0
    for (const at of random) {
      while (time < at) {
        tracker.push(STRINGS, time)
        time += 45
      }
      const result = tracker.push(KICK, time)
      if (result.beat > 0) beats += 1
      time += 45
    }
    expect(beats).toBe(0)
    expect(tracker.lock().locked).toBe(false)
    expect(tracker.sway()).toBeGreaterThan(0.2)
  })

  it('goes from beat-locked to sway when the drums stop', () => {
    const tracker = createDanceTracker()
    const start = warm(tracker)
    let time = start
    let beats = 0
    for (let index = 0; index < 10; index += 1) {
      const result = tracker.push(KICK, time)
      if (result.beat > 0) beats += 1
      for (let rest = 1; rest < 14; rest += 1) {
        tracker.push(QUIET, time + rest * 45)
      }
      time += 14 * 45
    }
    expect(tracker.lock().locked).toBe(true)
    expect(beats).toBeGreaterThan(0)

    let after = 0
    for (let index = 0; index < 90; index += 1) {
      const result = tracker.push(STRINGS, time)
      if (!result.locked && result.beat > 0) after += 1
      time += 45
    }
    expect(after).toBe(0)
    expect(tracker.lock().locked).toBe(false)
    expect(tracker.sway()).toBeGreaterThan(0.2)
  })

  it('eases the sway over SWAY_MS', () => {
    expect(swayStep(0, 1, 0)).toBe(0)
    expect(swayStep(0, 1, SWAY_MS / 2)).toBeCloseTo(0.5, 6)
    expect(swayStep(0, 1, SWAY_MS)).toBe(1)
    expect(swayStep(0.4, 0.1, SWAY_MS)).toBeCloseTo(0.1, 6)
    expect(swayTarget([0.2, 0.4, 0.4, 0.2, 0.3])).toBeCloseTo(0.45, 6)
    expect(swayTarget(null)).toBe(0)
    expect(LOCK_GRID_MS).toBe(90)
  })
})

describe('the dance pulse', () => {
  it('stays within DANCE_SCALE and gives the orchestrator less', () => {
    expect(danceScale(0)).toBe(1)
    expect(danceScale(1)).toBeCloseTo(1 + DANCE_SCALE, 10)
    expect(danceScale(2)).toBeCloseTo(1 + DANCE_SCALE, 10)
    expect(danceScale(1, true)).toBeCloseTo(1 + ORCHESTRATOR_DANCE_SCALE, 10)
    expect(danceScale(1, true)).toBeLessThan(danceScale(1))
  })
})
