import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createStrings, linkOnPath, strandPoints } from '../src/engine/strings.js'

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
    const strings = createStrings(scene)
    try {
      strings.build([{ from: 'a', to: 'b' }], centreOf)
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
    const strings = createStrings(scene)
    try {
      strings.build([{ from: 'a', to: 'b' }], centreOf)
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

describe('the strings the room builds', () => {
  it('draws only the links it is given, with no line down to the root', () => {
    const scene = fakeScene()
    const centres = new Map([
      ['', new THREE.Vector3(0, -160, 0)],
      ['src', new THREE.Vector3(1100, 200, 0)],
    ])
    const strings = createStrings(scene)
    strings.build([{ from: '', to: 'src' }], (key) => centres.get(key))
    expect(scene.children.filter((child) => child.isLineSegments)).toHaveLength(1)
    expect(scene.children.filter((child) => child.isPoints)).toHaveLength(1)
    strings.dispose()
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
    const strings = createStrings(scene)
    let freed = 0

    strings.build([{ from: 'a', to: 'b' }], centreOf)
    const texture = strandMesh(scene).material.map
    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    texture.addEventListener('dispose', () => {
      freed += 1
    })

    strings.build([{ from: 'a', to: 'b' }], centreOf)
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
    const strings = createStrings(scene)
    strings.build([{ from: 'a', to: 'b' }], centreOf)
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

    const lit = { dimmed: true, lit: new Set(['a', 'b']) }
    strings.update(centreOf, lit, 1)
    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(2)
    expect(writes).toBe(2)

    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(2)
    expect(writes).toBe(2)

    const offPath = { dimmed: true, lit: new Set(['a']) }
    strings.update(centreOf, offPath, 1)
    mesh.onBeforeRender()
    expect(colour).toHaveBeenCalledTimes(3)
    expect(writes).toBe(3)

    strings.dispose()
  })
})

describe('linkOnPath', () => {
  const mask = { dimmed: true, lit: new Set(['', 'src', 'src/ui']) }

  it('lights a link only when both ends are on a working path', () => {
    expect(linkOnPath({ from: '', to: 'src' }, mask)).toBe(true)
    expect(linkOnPath({ from: 'src', to: 'src/ui' }, mask)).toBe(true)
    expect(linkOnPath({ from: '', to: 'docs' }, mask)).toBe(false)
    expect(linkOnPath({ from: 'src', to: 'src/model' }, mask)).toBe(false)
  })

  it('does not light a link when no agent works, even if a path is listed', () => {
    expect(linkOnPath({ from: '', to: 'src' }, { dimmed: false, lit: new Set(['', 'src']) })).toBe(false)
    expect(linkOnPath({ from: '', to: 'src' }, null)).toBe(false)
  })
})

describe('link endpoints', () => {
  it('reads both anchors every update and writes only when one moves', () => {
    const scene = fakeScene()
    const places = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
    ])
    let calls = 0
    const anchorOf = (key, out) => {
      calls += 1
      return out.copy(places.get(key))
    }
    const strings = createStrings(scene)
    try {
      strings.build([{ from: 'a', to: 'b' }], anchorOf)
      const line = scene.children.find((child) => child.isLineSegments)
      const position = line.geometry.attributes.position
      const strandPosition = strandMesh(scene).geometry.attributes.position
      const version = position.version
      const strandVersion = strandPosition.version
      const before = position.getX(1)
      calls = 0
      strings.update(anchorOf, null, 0.016)
      strings.update(anchorOf, null, 0.016)
      expect(calls).toBe(4)
      expect(position.version).toBe(version)
      expect(strandPosition.version).toBe(strandVersion)
      expect(position.getX(1)).toBe(before)

      places.set('b', new THREE.Vector3(104, 0, 0))
      strings.update(anchorOf, null, 0.016)
      expect(calls).toBe(6)
      expect(position.version).toBeGreaterThan(version)
      expect(strandPosition.version).toBeGreaterThan(strandVersion)
      expect(position.getX(1)).not.toBe(before)
    } finally {
      strings.dispose()
    }
  })
})
