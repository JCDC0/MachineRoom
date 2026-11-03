import { describe, expect, it } from 'vitest'
import { DANCE_SCALE, ORCHESTRATOR_DANCE_SCALE, danceScale } from '../src/engine/agents.js'
import {
  BAND_COUNT,
  GROUP_REST_MS,
  activitySounds,
  bandGroups,
  bandIndexForBin,
  beatDetector,
  createBandBeatDetector,
  createRateLimit,
  isDeleteCommand,
  panForScreen,
  spatialSound,
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
  it('takes at most eight sounds in a rolling second', () => {
    const limit = createRateLimit()
    for (let index = 0; index < 8; index += 1) {
      expect(limit.take(100 + index)).toBe(true)
    }
    expect(limit.take(108)).toBe(false)
    expect(limit.count(108)).toBe(8)
    expect(limit.take(1200)).toBe(true)
    expect(limit.count(1200)).toBe(1)
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
    expect(bandIndexForBin(0, 100, 5)).toBe(0)
    expect(bandIndexForBin(1, 100, 5)).toBe(0)
    expect(bandIndexForBin(2, 100, 5)).toBe(1)
    expect(bandIndexForBin(20, 100, 5)).toBe(3)
    expect(bandIndexForBin(99, 100, 5)).toBe(4)
  })

  it('keeps a bin inside the bands and gives a broken one the bass', () => {
    expect(bandIndexForBin(-4, 100, 5)).toBe(0)
    expect(bandIndexForBin(100, 100, 5)).toBe(4)
    expect(bandIndexForBin(4, 0, 5)).toBe(0)
    expect(bandIndexForBin('x', 100, 5)).toBe(0)
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

  it('gives each group its own 160 ms rest', () => {
    expect(GROUP_REST_MS).toBe(160)
    const found = beats([...Array(9).fill(quiet), kick, hats])
    expect(found.map((beat) => beat.group)).toEqual(['low', 'high'])
  })

  it('holds a group back until its rest is over', () => {
    const found = beats([...Array(9).fill(quiet), kick, quiet, kick, quiet, quiet, kick])
    expect(found.map((beat) => beat.at)).toEqual([405, 630])
  })
})

describe('the dance pulse', () => {
  it('stays within eight percent and gives the orchestrator less', () => {
    expect(danceScale(0)).toBe(1)
    expect(danceScale(1)).toBeCloseTo(1 + DANCE_SCALE, 10)
    expect(danceScale(2)).toBeCloseTo(1 + DANCE_SCALE, 10)
    expect(danceScale(1, true)).toBeCloseTo(1 + ORCHESTRATOR_DANCE_SCALE, 10)
    expect(danceScale(1, true)).toBeLessThan(danceScale(1))
  })
})
