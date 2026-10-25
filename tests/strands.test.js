import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HUB_CENTER } from '../src/engine/hub.js'
import { ROOT_DROP } from '../src/engine/sphere.js'
import { strandPoints } from '../src/engine/strings.js'

describe('strandPoints', () => {
  const a = new THREE.Vector3(0, 0, 0)
  const b = new THREE.Vector3(240, 0, 0)
  const curve = { a, b }

  it('pure strandPoints: the same input gives the same points', () => {
    const pts1 = strandPoints(curve, 24, 42)
    const pts2 = strandPoints(curve, 24, 42)
    expect(pts1.length).toBeGreaterThan(0)
    expect(pts1.length).toBe(pts2.length)
    for (let i = 0; i < pts1.length; i += 1) {
      expect(pts1[i].x).toBe(pts2[i].x)
      expect(pts1[i].y).toBe(pts2[i].y)
      expect(pts1[i].z).toBe(pts2[i].z)
    }
  })

  it('different seeds give different point spacing', () => {
    const pts1 = strandPoints(curve, 24, 1)
    const pts2 = strandPoints(curve, 24, 2)
    expect(pts1.length).toBe(pts2.length)
    const matchAll = pts1.every((p, i) => p.x === pts2[i].x && p.y === pts2[i].y && p.z === pts2[i].z)
    expect(matchAll).toBe(false)
  })

  it('the count follows the spacing', () => {
    const p12 = strandPoints(curve, 12, 100)
    const p24 = strandPoints(curve, 24, 100)
    const p48 = strandPoints(curve, 48, 100)
    expect(p24.length).toBe(10)
    expect(p12.length).toBe(20)
    expect(p48.length).toBe(5)
  })

  it('accepts array [a, b] and object with from/to', () => {
    const arr = [a, b]
    const fromTo = { from: a, to: b }
    const fromArr = strandPoints(arr, 24, 7)
    const fromObj = strandPoints(fromTo, 24, 7)
    expect(fromArr.length).toBe(10)
    expect(fromObj.length).toBe(10)
    expect(fromArr[0].x).toBe(fromObj[0].x)
  })

  it('accepts object with getPoint and getLength', () => {
    const custom = {
      getLength: () => 240,
      getPoint: (t, out) => out.lerpVectors(a, b, t),
    }
    const pts = strandPoints(custom, 24, 7)
    expect(pts.length).toBe(10)
  })

  it('handles zero length, empty, or negative spacing gracefully', () => {
    expect(strandPoints(null, 24, 0)).toEqual([])
    expect(strandPoints({ a, b: a }, 24, 0)).toEqual([])
    expect(strandPoints(curve, 0, 0)).toEqual([])
    expect(strandPoints(curve, -10, 0)).toEqual([])
  })

  it('keeps every point on the line', () => {
    const pts = strandPoints(curve, 24, 5)
    expect(pts.length).toBe(10)
    pts.forEach((pt) => {
      expect(pt.y).toBe(0)
      expect(pt.z).toBe(0)
      expect(pt.x).toBeGreaterThanOrEqual(0)
      expect(pt.x).toBeLessThanOrEqual(240)
    })
  })

  it('keeps every point on a diagonal line', () => {
    const from = new THREE.Vector3(-120, 40, 75)
    const to = new THREE.Vector3(300, -160, -225)
    const span = new THREE.Vector3().subVectors(to, from)
    strandPoints({ a: from, b: to }, 24, 9).forEach((pt) => {
      const offset = new THREE.Vector3().subVectors(pt, from)
      const cross = new THREE.Vector3().crossVectors(offset, span)
      expect(cross.length()).toBeLessThan(1e-6)
      const along = offset.dot(span) / span.lengthSq()
      expect(along).toBeGreaterThanOrEqual(0)
      expect(along).toBeLessThanOrEqual(1)
    })
  })

  it('runs a top-level string from the root card to the folder and no further', () => {
    const root = new THREE.Vector3(HUB_CENTER.x, HUB_CENTER.y - ROOT_DROP, HUB_CENTER.z)
    const folder = new THREE.Vector3(820, 640, -1060)
    const span = new THREE.Vector3().subVectors(folder, root)
    const pts = strandPoints({ a: root, b: folder }, 24, 11)
    expect(pts.length).toBeGreaterThan(4)
    pts.forEach((pt) => {
      const offset = new THREE.Vector3().subVectors(pt, root)
      const cross = new THREE.Vector3().crossVectors(offset, span)
      expect(cross.length()).toBeLessThan(1e-6)
      const along = offset.dot(span) / span.lengthSq()
      expect(along).toBeGreaterThan(0)
      expect(along).toBeLessThan(1)
    })
  })
})
