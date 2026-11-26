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
  fillNoise,
  findBeatGap,
  folderSweep,
  isDeleteCommand,
  labelBlip,
  loudestWhirs,
  onBeatGrid,
  panForScreen,
  sharpOnset,
  spatialSound,
  starGlitter,
  swayStep,
  swayTarget,
  touchSoundKind,
} from '../src/ui/sound.js'

describe('room sound shapes', () => {
  it('fills a noise channel with the same samples for the same seed', () => {
    const first = fillNoise(new Float32Array(64), 17)
    expect(fillNoise(new Float32Array(64), 17)).toEqual(first)
    expect(fillNoise(new Float32Array(64), 18)).not.toEqual(first)
    expect(new Set(first).size).toBe(64)
    expect(first.every((value) => value >= -1 && value <= 1)).toBe(true)
  })

  it('sweeps up with an opening click and down with a closing click', () => {
    const open = folderSweep('folderOpen')
    const close = folderSweep('folderClose')
    expect(open.from).toBeLessThan(open.to)
    expect(open.duration).toBeCloseTo(0.35)
    expect(open.clickAt).toBe(0)
    expect(close.from).toBeGreaterThan(close.to)
    expect(close.duration).toBeCloseTo(0.3)
    expect(close.duration - close.clickAt).toBeCloseTo(0.014)
  })

  it('gives each label two distinct square notes in at most 120 milliseconds', () => {
    const pairs = ['read', 'write', 'created', 'deleted', 'list'].map((kind) => {
      const notes = labelBlip(kind)
      expect(notes).toHaveLength(2)
      expect(notes.every((note) => note.type === 'square')).toBe(true)
      expect(notes[1].at).toBeGreaterThanOrEqual(notes[0].at + notes[0].duration)
      expect(notes[1].at + notes[1].duration).toBeLessThanOrEqual(0.12)
      expect(notes[0].frequency).not.toBe(notes[1].frequency)
      return notes.map((note) => note.frequency).join(',')
    })
    expect(new Set(pairs).size).toBe(5)
  })

  it('scatters high glitter pings through the flight, rising overall, never closer than a ping lasts', () => {
    for (const seconds of [0.0625, 0.25, 0.9]) {
      const notes = starGlitter(seconds)
      expect(notes.length).toBeGreaterThanOrEqual(2)
      expect(notes.length).toBeLessThanOrEqual(Math.max(2, Math.floor(seconds / 0.06)))
      expect(notes.every((note) => note.frequency > 2000)).toBe(true)
      expect(notes.at(-1).frequency).toBeGreaterThan(notes[0].frequency)
      for (let index = 1; index < notes.length; index += 1) {
        expect(notes[index].at - notes[index - 1].at).toBeGreaterThanOrEqual(0.045)
      }
      expect(notes[0].at).toBeGreaterThanOrEqual(0)
      expect(notes.at(-1).at).toBeLessThan(seconds)
    }
    expect(starGlitter(0.9)).toEqual(starGlitter(0.9))
  })

  it('picks the three loudest whirs after distance loss', () => {
    const voices = [
      { id: 'far', level: 1, spatial: { gain: 0.35 } },
      { id: 'hidden', level: 1, spatial: { gain: 0 } },
      { id: 'near', level: 0.65, spatial: { gain: 0.9 } },
      { id: 'low', level: 0.2, spatial: { gain: 0.95 } },
      { id: 'close', level: 0.8, spatial: { gain: 0.96 } },
    ]
    expect(loudestWhirs(voices).map(({ id }) => id)).toEqual(['close', 'near', 'far'])
  })
})

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
    expect(far.gain).toBe(0.35)
    expect(spatialSound({ x: 50, y: 50, width: 100, height: 100, distance: 2100, overviewDistance: 1000 }).audible).toBe(false)
  })

  it('pans an off-screen place to the side at the minimum gain', () => {
    const place = { y: 50, width: 100, height: 100, distance: 10, overviewDistance: 1000 }
    expect(spatialSound({ ...place, x: -1 })).toEqual({ audible: true, pan: -1, gain: 0.35 })
    expect(spatialSound({ ...place, x: 101 })).toEqual({ audible: true, pan: 1, gain: 0.35 })
    expect(spatialSound({ ...place, x: 25, y: 110 })).toEqual({ audible: true, pan: -1, gain: 0.35 })
    expect(spatialSound({ ...place, x: -1, distance: 2100 }).audible).toBe(false)
  })

  it('drops a broken place', () => {
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
    expect(SOUND_LIMIT).toBe(12)
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

describe('the sound of an activity', () => {
  it('names a read, a write, a created file and a deleted file', () => {
    const missing = new Set(['src/old.js'])
    const files = new Map([['src/a.js', { exists: true }]])
    const kind = (touch, removes = false) => touchSoundKind(touch, removes, missing, () => Boolean(files.get(touch.path)?.exists))
    expect(kind({ kind: 'file', path: 'src/a.js', mode: 'read' })).toBe('read')
    expect(kind({ kind: 'file', path: 'src/a.js', mode: 'write' })).toBe('write')
    expect(kind({ kind: 'file', path: 'src/old.js', mode: 'write' })).toBe('created')
    expect(missing.has('src/old.js')).toBe(false)
    files.set('src/old.js', { exists: true })
    expect(kind({ kind: 'file', path: 'src/old.js', mode: 'write' })).toBe('write')
    expect(kind({ kind: 'file', path: 'src/new.js', mode: 'write' })).toBe('created')
    expect(kind({ kind: 'file', path: 'src/a.js', mode: 'write' }, true)).toBe('deleted')
    expect(missing.has('src/a.js')).toBe(true)
  })

  it('makes a list sound for a directory touch and none for another kind', () => {
    expect(touchSoundKind({ kind: 'dir', path: 'src', mode: 'list' }, false, new Set(), () => true)).toBe('list')
    expect(touchSoundKind({ kind: 'url', path: 'https://example.test' }, false, new Set(), () => true)).toBe(null)
  })

  it('asks whether a file exists only for a write that is not a known new file', () => {
    const asked = []
    const exists = () => {
      asked.push('asked')
      return true
    }
    expect(touchSoundKind({ kind: 'file', path: 'src/a.js', mode: 'read' }, false, new Set(), exists)).toBe('read')
    expect(touchSoundKind({ kind: 'file', path: 'src/b.js', mode: 'write' }, false, new Set(['src/b.js']), exists)).toBe('created')
    expect(asked).toEqual([])
    expect(touchSoundKind({ kind: 'file', path: 'src/c.js', mode: 'write' }, false, new Set(), exists)).toBe('write')
    expect(asked).toEqual(['asked'])
  })

  it('makes a message sound for the recipient and nothing for a file touch', () => {
    expect(activitySounds({ type: 'agent.message', agent: 'claude', to: 'codex' })).toEqual([
      { agent: 'codex', kind: 'message' },
    ])
    expect(activitySounds({ type: 'tool.start', touches: [{ kind: 'file', path: 'src/a.js', mode: 'read' }] })).toEqual([])
  })

  it('stays silent for a message with no recipient', () => {
    expect(activitySounds({ type: 'agent.message', agent: 'claude', to: '' })).toEqual([])
    expect(activitySounds({ type: 'agent.message', agent: 'claude', to: undefined })).toEqual([])
    expect(activitySounds({ type: 'agent.message', agent: 'claude', to: '   ' })).toEqual([])
    expect(activitySounds({ type: 'agent.message', agent: 'claude', to: 'agy2' })).toEqual([
      { agent: 'agy2', kind: 'message' },
    ])
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
    for (let index = 0; index < 400; index += 1) {
      const level = 0.08 + 0.62 * Math.min(1, index / 400)
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

  it('beats on each clear onset at random and sways while it is not locked', () => {
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
    expect(beats).toBeGreaterThan(0)
    expect(beats).toBe(tracker.onsets().length)
    expect(tracker.lock().locked).toBe(false)
    expect(tracker.sway()).toBeGreaterThan(0.2)
  })

  it('scales the beat by how far the rise is above the average', () => {
    function strengthOf(level) {
      const detector = createBandBeatDetector()
      let at = 0
      for (let index = 0; index < 10; index += 1) {
        detector.push([0.2, 0.2, 0, 0, 0], at)
        at += 45
      }
      return detector.push([level, level, 0, 0, 0], at).strength
    }
    const soft = strengthOf(0.32)
    const hard = strengthOf(0.9)
    expect(soft).toBeGreaterThan(0)
    expect(hard).toBeGreaterThan(soft)
    expect(hard).toBe(1)
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
    expect(SWAY_MS).toBe(1500)
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
