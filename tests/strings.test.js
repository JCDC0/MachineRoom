import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createStrings, strandPoints } from '../src/engine/strings.js'

const context2d = {
  fillStyle: '',
  createRadialGradient: () => ({ addColorStop: () => {} }),
  fillRect: () => {},
}

let saved

beforeAll(() => {
  saved = globalThis.document
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context2d,
    }),
  }
})

afterAll(() => {
  globalThis.document = saved
})

function fakeScene() {
  const children = []
  return {
    children,
    add(object) {
      children.push(object)
    },
    remove(object) {
      const index = children.indexOf(object)
      if (index >= 0) children.splice(index, 1)
    },
  }
}

function strandMesh(scene) {
  return scene.children.find((child) => child.isPoints)
}

function pointCount(a, b) {
  return strandPoints({ a, b }, 24).length
}

describe('strands keep up with longer strings', () => {
  it('replaces the geometry when the point count grows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = fakeScene()
    const near = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
    ])
    const far = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(1000, 0, 0)],
    ])
    let centres = near
    const centreOf = (key) => centres.get(key)
    const strings = createStrings(scene, { onPath: () => false })
    try {
      strings.build([{ from: 'a', to: 'b' }], centreOf, false)
      const mesh = strandMesh(scene)
      const firstGeometry = mesh.geometry
      const disposed = vi.fn()
      firstGeometry.addEventListener('dispose', disposed)
      expect(firstGeometry.getAttribute('position').count).toBe(pointCount(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0)))

      centres = far
      strings.update(centreOf)

      const farCount = pointCount(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0))
      expect(mesh.geometry).not.toBe(firstGeometry)
      expect(mesh.geometry.getAttribute('position').count).toBe(farCount)
      expect(farCount).toBeGreaterThan(4)
      expect(disposed).toHaveBeenCalledTimes(1)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      strings.dispose()
      warn.mockRestore()
    }
  })

  it('keeps the geometry when the point count stays the same', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = fakeScene()
    const start = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
    ])
    const moved = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(104, 0, 0)],
    ])
    let centres = start
    const centreOf = (key) => centres.get(key)
    const strings = createStrings(scene, { onPath: () => false })
    try {
      strings.build([{ from: 'a', to: 'b' }], centreOf, false)
      const mesh = strandMesh(scene)
      const firstGeometry = mesh.geometry
      const firstPosition = mesh.geometry.getAttribute('position')
      const firstVersion = firstPosition.version
      const firstX = firstPosition.getX(0)
      const disposed = vi.fn()
      firstGeometry.addEventListener('dispose', disposed)

      centres = moved
      strings.update(centreOf)

      expect(mesh.geometry).toBe(firstGeometry)
      expect(mesh.geometry.getAttribute('position').count).toBe(4)
      expect(mesh.geometry.getAttribute('position').version).toBeGreaterThan(firstVersion)
      expect(mesh.geometry.getAttribute('position').getX(0)).not.toBe(firstX)
      expect(disposed).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      strings.dispose()
      warn.mockRestore()
    }
  })
})
