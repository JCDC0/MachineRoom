import { describe, expect, it } from 'vitest'
import { AGENT_COLORS, agentColor } from '../src/engine/sprites.js'
import {
  STAR_MAX_SECONDS,
  STAR_MIN_SECONDS,
  STAR_SPEED,
  starAdvance,
  starDuration,
  starEase,
  starPoint,
  starRoute,
  starSlot,
} from '../src/engine/stars.js'

describe('agentColor', () => {
  it('gives each roster place its own colour from the eight-colour palette', () => {
    expect(AGENT_COLORS).toEqual([0xffb347, 0xff5ad1, 0xa98bff, 0x3ee6e6, 0xff8a3d, 0xff8fb1, 0xc8d94a, 0x4fd1b5])
    AGENT_COLORS.forEach((color, index) => expect(agentColor(index)).toBe(color))
  })

  it('starts the palette again after eight and reads a bad index as the first', () => {
    expect(agentColor(8)).toBe(AGENT_COLORS[0])
    expect(agentColor(17)).toBe(AGENT_COLORS[1])
    expect(agentColor(-1)).toBe(AGENT_COLORS[0])
    expect(agentColor('x')).toBe(AGENT_COLORS[0])
  })
})

describe('the star route', () => {
  const centre = { x: 0, y: 300, z: 0 }
  const end = { x: 1400, y: 40, z: 0 }
  const anchors = {
    '': { x: 0, y: -160, z: 300 },
    src: { x: 900, y: 0, z: 0 },
    'src/ui': { x: 1300, y: 0, z: 0 },
  }
  const anchorOf = (path) => anchors[path]

  it('leaves the centre, passes each lit tab and lands at the end', () => {
    const points = starRoute(centre, ['', 'src', 'src/ui'], anchorOf, end)
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual(centre)
    expect(points[1]).toEqual(anchors[''])
    expect(points[2]).toEqual(anchors.src)
    expect(points[3]).toEqual(anchors['src/ui'])
    expect(points[4]).toEqual(end)
  })

  it('goes straight from the centre to the end when no folder is lit', () => {
    expect(starRoute(centre, [], anchorOf, end)).toHaveLength(2)
    expect(starRoute(centre, null, anchorOf, end)).toHaveLength(2)
  })
})

describe('the star duration', () => {
  it('travels at the fixed speed and keeps its floor and ceiling', () => {
    expect(STAR_SPEED).toBe(1800)
    expect(STAR_MIN_SECONDS).toBe(0.25)
    expect(STAR_MAX_SECONDS).toBe(0.9)
    expect(starDuration(0)).toBe(0.25)
    expect(starDuration(-20)).toBe(0.25)
    expect(starDuration(450)).toBeCloseTo(0.25, 10)
    expect(starDuration(900)).toBeCloseTo(0.5, 10)
    expect(starDuration(1800)).toBe(0.9)
    expect(starDuration(9000)).toBe(0.9)
    expect(starDuration('x')).toBe(0.25)
  })
})

describe('the star position', () => {
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ]

  it('eases out at the end', () => {
    expect(starEase(-1)).toBe(0)
    expect(starEase(0)).toBe(0)
    expect(starEase(0.5)).toBeCloseTo(0.875, 10)
    expect(starEase(1)).toBe(1)
    expect(starEase(4)).toBe(1)
  })

  it('walks the path by its share', () => {
    expect(starPoint(path, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(starPoint(path, 0.5)).toEqual({ x: 87.5, y: 0, z: 0 })
    expect(starPoint(path, 1)).toEqual({ x: 100, y: 0, z: 0 })
    expect(starPoint([{ x: 5, y: 6, z: 7 }], 0.4)).toEqual({ x: 5, y: 6, z: 7 })
  })
})

describe('the star clock', () => {
  it('holds at speed zero and runs at the replay speed', () => {
    expect(starAdvance(0.2, 0.1, 0)).toBeCloseTo(0.2, 10)
    expect(starAdvance(0.2, 0.1, 1)).toBeCloseTo(0.3, 10)
    expect(starAdvance(0.2, 0.1, 4)).toBeCloseTo(0.6, 10)
    expect(starAdvance(0.2, 0.1, 'x')).toBeCloseTo(0.2, 10)
    expect(starAdvance('x', 0.1, 1)).toBeCloseTo(0.1, 10)
  })
})

describe('the star pool', () => {
  it('takes a free slot first', () => {
    expect(starSlot([{ active: true, start: 2 }, { active: false, start: 1 }])).toBe(1)
  })

  it('lands the oldest star when every slot is busy', () => {
    expect(starSlot([{ active: true, start: 4 }, { active: true, start: 2 }, { active: true, start: 3 }])).toBe(1)
    expect(starSlot([])).toBe(-1)
  })
})
