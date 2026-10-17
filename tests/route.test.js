import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { folderRoute } from '../src/engine/route.js'
import { curvePoint } from '../src/engine/strings.js'

describe('folderRoute', () => {
  it('stays put when the folder does not change', () => {
    expect(folderRoute('src', 'src')).toEqual(['src'])
  })

  it('walks down to a child one folder at a time', () => {
    expect(folderRoute('', 'src/ui')).toEqual(['', 'src', 'src/ui'])
  })

  it('walks up to a parent', () => {
    expect(folderRoute('src/ui', 'src')).toEqual(['src/ui', 'src'])
  })

  it('goes up to the shared parent and then down for a sibling branch', () => {
    expect(folderRoute('src/ui/atoms', 'test/unit')).toEqual(['src/ui/atoms', 'src/ui', 'src', '', 'test', 'test/unit'])
  })

  it('turns at the nearest shared folder', () => {
    expect(folderRoute('src/a/x', 'src/b')).toEqual(['src/a/x', 'src/a', 'src', 'src/b'])
  })

  it('moves one folder per step', () => {
    const route = folderRoute('docs/api/v2', 'src/model/parsers')
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1]
      const b = route[i]
      const depthA = a === '' ? 0 : a.split('/').length
      const depthB = b === '' ? 0 : b.split('/').length
      expect(Math.abs(depthA - depthB)).toBe(1)
    }
  })
})

describe('curvePoint', () => {
  const a = new THREE.Vector3(0, 100, 0)
  const b = new THREE.Vector3(1000, 100, 0)
  const out = new THREE.Vector3()

  it('starts and ends on the two folders', () => {
    expect(curvePoint(a, b, 0, out).toArray()).toEqual([0, 100, 0])
    expect(curvePoint(a, b, 1, out).toArray()).toEqual([1000, 100, 0])
  })

  it('hangs below the straight line in the middle', () => {
    const middle = curvePoint(a, b, 0.5, out)
    expect(middle.x).toBeCloseTo(500)
    expect(middle.y).toBeLessThan(100)
  })

  it('never rises above the straight line', () => {
    for (let t = 0; t <= 1; t += 0.1) expect(curvePoint(a, b, t, out).y).toBeLessThanOrEqual(100)
  })

  it('limits the sag on a very long string', () => {
    const far = new THREE.Vector3(20000, 100, 0)
    expect(100 - curvePoint(a, far, 0.5, out).y).toBeLessThanOrEqual(520)
  })
})
