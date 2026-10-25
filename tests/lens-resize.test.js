import { describe, expect, it } from 'vitest'
import { distanceFromShare, fitView, shareFromDistance } from '../src/engine/camera.js'
import {
  LENS_SHARE_DEFAULT,
  LENS_SHARE_MAX,
  LENS_SHARE_MIN,
  clampLensShare,
  heightRailShare,
  lensHeightValue,
  lensShareAfterWheel,
  lensShareFromRail,
  multiplierText,
  railShareFromPointer,
  railStep,
} from '../src/ui/lensResize.js'
import { loadSettings, saveSettings } from '../src/ui/settings.js'

function memoryStore() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

describe('lens rails', () => {
  it('clamps the lens share and falls back to the default', () => {
    expect(clampLensShare(0.1)).toBe(LENS_SHARE_MIN)
    expect(clampLensShare(2)).toBe(LENS_SHARE_MAX)
    expect(clampLensShare('x')).toBe(LENS_SHARE_DEFAULT)
    expect(clampLensShare(0.6)).toBe(0.6)
  })

  it('reads a rail share from the pointer, top full and bottom empty', () => {
    const rect = { top: 100, height: 200 }
    expect(railShareFromPointer(100, rect)).toBe(1)
    expect(railShareFromPointer(300, rect)).toBe(0)
    expect(railShareFromPointer(200, rect)).toBe(0.5)
    expect(railShareFromPointer(50, rect)).toBe(1)
    expect(railShareFromPointer(200, { top: 0, height: 0 })).toBe(0)
  })

  it('steps a rail with the keys and ignores others', () => {
    expect(railStep(0.5, 'ArrowUp')).toBeCloseTo(0.55)
    expect(railStep(0.5, 'ArrowDown')).toBeCloseTo(0.45)
    expect(railStep(0.5, 'PageUp')).toBeCloseTo(0.7)
    expect(railStep(0.98, 'PageUp')).toBe(1)
    expect(railStep(0.5, 'Home')).toBe(0)
    expect(railStep(0.5, 'End')).toBe(1)
    expect(railStep(0.5, 'a')).toBeNull()
  })

  it('maps the height rail to the lens share both ways', () => {
    expect(heightRailShare(LENS_SHARE_MIN)).toBe(0)
    expect(heightRailShare(LENS_SHARE_MAX)).toBe(1)
    expect(lensShareFromRail(0)).toBe(LENS_SHARE_MIN)
    expect(lensShareFromRail(1)).toBe(LENS_SHARE_MAX)
    expect(lensShareFromRail(heightRailShare(0.6))).toBeCloseTo(0.6)
  })

  it('grows the lens when the wheel turns up and shrinks it when it turns down', () => {
    expect(lensShareAfterWheel(0.5, -100)).toBeCloseTo(0.53)
    expect(lensShareAfterWheel(0.5, 100)).toBeCloseTo(0.47)
    expect(lensShareAfterWheel(0.79, -1000)).toBe(LENS_SHARE_MAX)
  })

  it('writes a CSS height with a floor and a multiplier', () => {
    expect(lensHeightValue(0.52)).toBe('max(240px, 52.0vh)')
    expect(multiplierText(1)).toBe('1.0x')
    expect(multiplierText(2.46)).toBe('2.5x')
    expect(multiplierText(12.4)).toBe('12x')
    expect(multiplierText(0)).toBe('1.0x')
  })

  it('maps the zoom share to a camera distance on a log scale', () => {
    expect(distanceFromShare(0)).toBeCloseTo(26000)
    expect(distanceFromShare(1)).toBeCloseTo(500)
    expect(shareFromDistance(26000)).toBeCloseTo(0)
    expect(shareFromDistance(500)).toBeCloseTo(1)
    expect(shareFromDistance(distanceFromShare(0.37))).toBeCloseTo(0.37)
    expect(distanceFromShare(0.5)).toBeCloseTo(Math.sqrt(500 * 26000))
  })

  it('keeps the lens share in the saved settings', () => {
    const storage = memoryStore()
    expect(loadSettings(storage).lensShare).toBeUndefined()
    saveSettings(storage, { lensShare: 0.7 })
    expect(loadSettings(storage).lensShare).toBe(0.7)
    saveSettings(storage, { lensShare: 5 })
    expect(loadSettings(storage).lensShare).toBe(LENS_SHARE_MAX)
  })
})

describe('the overview aims at the hub centre', () => {
  it('keeps the target on the given centre and still fits every sphere', () => {
    const spheres = [
      { x: 0, y: 0, z: 0, r: 300 },
      { x: 0, y: -360, z: 0, r: 200 },
      { x: 2000, y: 400, z: -1500, r: 250 },
    ]
    const free = fitView(spheres, { width: 1600, height: 700 })
    const centred = fitView(spheres, { width: 1600, height: 700, center: { x: 0, y: 0, z: 0 } })
    expect(centred.target).toEqual({ x: 0, y: 0, z: 0 })
    expect(free.target).not.toEqual({ x: 0, y: 0, z: 0 })
    expect(centred.dist).toBeGreaterThanOrEqual(free.dist)
  })
})
