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

describe('one glow texture for every strand', () => {
  it('reuses the texture over two builds and frees it once', () => {
    const scene = fakeScene()
    const centres = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
    ])
    const centreOf = (key) => centres.get(key)
    const strings = createStrings(scene, { onPath: () => false })
    let freed = 0

    strings.build([{ from: 'a', to: 'b' }], centreOf, false)
    const texture = strandMesh(scene).material.map
    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    texture.addEventListener('dispose', () => {
      freed += 1
    })

    strings.build([{ from: 'a', to: 'b' }], centreOf, false)
    expect(strandMesh(scene).material.map).toBe(texture)
    expect(freed).toBe(0)

    strings.dispose()
    expect(freed).toBe(1)
  })
})

describe('strands write only when their look changes', () => {
  it('skips the colour and opacity writes until the yellow, dim or lit value moves', () => {
    const scene = fakeScene()
    const centres = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
    ])
    const centreOf = (key) => centres.get(key)
    let active = false
    const strings = createStrings(scene, { onPath: () => active })
    strings.build([{ from: 'a', to: 'b' }], centreOf, false)
    const mesh = strandMesh(scene)
    const material = mesh.material
    const colour = vi.spyOn(material.color, 'lerpColors')
    let opacity = material.opacity
    let writes = 0
    Object.defineProperty(material, 'opacity', {
      configurable: true,
      get: () => opacity,
      set: (value) => {
        writes += 1
        opacity = value
      },
    })

    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(1)
    expect(writes).toBe(1)

    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(1)
    expect(writes).toBe(1)

    active = true
    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(2)
    expect(writes).toBe(2)

    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(2)
    expect(writes).toBe(2)

    const mask = { dimmed: true, lit: new Set(['a', 'b']) }
    strings.update(centreOf, mask, 0.1)
    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(3)
    expect(writes).toBe(3)

    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(3)
    expect(writes).toBe(3)

    strings.update(centreOf, mask, 0.1)
    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(4)
    expect(writes).toBe(4)

    strings.dispose()
  })
})
