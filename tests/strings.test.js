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

describe('strands share one material per colour', () => {
  it('switches shared materials only when the look moves and shares them across links', () => {
    const scene = fakeScene()
    const centres = new Map([
      ['a', new THREE.Vector3(0, 0, 0)],
      ['b', new THREE.Vector3(100, 0, 0)],
      ['c', new THREE.Vector3(200, 0, 0)],
      ['d', new THREE.Vector3(300, 0, 0)],
    ])
    const centreOf = (key) => centres.get(key)
    const strings = createStrings(scene)
    strings.build([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'a', to: 'd' },
    ], centreOf)
    const points = scene.children.filter((child) => child.isPoints)
    const restMaterial = points[0].material
    expect(points[1].material).toBe(restMaterial)
    expect(points[2].material).toBe(restMaterial)

    strings.update(centreOf, null, 0.016)
    expect(points[0].material).toBe(restMaterial)

    const lit = { dimmed: true, lit: new Set(['a', 'b']) }
    strings.update(centreOf, lit, 1)
    const litMaterial = points[0].material
    const dimmedMaterial = points[1].material
    expect(litMaterial).not.toBe(restMaterial)
    expect(dimmedMaterial).not.toBe(restMaterial)
    expect(dimmedMaterial).not.toBe(litMaterial)
    expect(points[2].material).toBe(dimmedMaterial)

    strings.update(centreOf, lit, 0.016)
    expect(points[0].material).toBe(litMaterial)
    expect(points[1].material).toBe(dimmedMaterial)

    const offPath = { dimmed: true, lit: new Set(['a']) }
    strings.update(centreOf, offPath, 2)
    expect(points[0].material).toBe(dimmedMaterial)

    strings.dispose()
  })

  it('keeps unchanged strands on rebuild and bounds materials regardless of link count', () => {
    const scene = fakeScene()
    const centres = new Map([['', new THREE.Vector3(0, 0, 0)]])
    const links = []
    for (let i = 0; i < 10; i += 1) {
      const name = `f${i}`
      centres.set(name, new THREE.Vector3(100 + i * 20, 0, 0))
      links.push({ from: '', to: name })
    }
    centres.set('f10', new THREE.Vector3(400, 0, 0))
    const centreOf = (key) => centres.get(key)
    const addSpy = vi.spyOn(scene, 'add')
    const removeSpy = vi.spyOn(scene, 'remove')
    const strings = createStrings(scene)
    try {
      strings.build(links, centreOf)
      const beforeMeshes = scene.children.filter((child) => child.isPoints)
      expect(beforeMeshes).toHaveLength(10)
      expect(new Set(beforeMeshes.map((mesh) => mesh.material)).size).toBe(1)

      addSpy.mockClear()
      removeSpy.mockClear()

      const nextLinks = [...links.slice(0, 9), { from: '', to: 'f10' }]
      strings.build(nextLinks, centreOf)
      const afterMeshes = scene.children.filter((child) => child.isPoints)
      expect(afterMeshes).toHaveLength(10)
      expect(addSpy).toHaveBeenCalledTimes(1)
      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(removeSpy).toHaveBeenCalledWith(beforeMeshes[9])
      for (let i = 0; i < 9; i += 1) {
        expect(afterMeshes[i]).toBe(beforeMeshes[i])
      }
      expect(afterMeshes[9]).not.toBe(beforeMeshes[9])

      const many = []
      for (let i = 0; i < 40; i += 1) {
        const name = `m${i}`
        centres.set(name, new THREE.Vector3(100 + i * 10, 0, 0))
        many.push({ from: '', to: name })
      }
      strings.build(many, centreOf)
      strings.update(centreOf, { dimmed: true, lit: new Set(['', 'm0', 'm1', 'm2']) }, 1)
      const mats = new Set(scene.children.filter((child) => child.isPoints).map((mesh) => mesh.material))
      expect(mats.size).toBe(2)
    } finally {
      strings.dispose()
    }
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

  it('answers how many strings it wrote, and none when the ends stay put', () => {
    const scene = fakeScene()
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(100, 0, 0)
    const centreOf = (key) => (key === 'a' ? a : b)
    const strings = createStrings(scene)
    try {
      strings.build([{ from: 'a', to: 'b' }], centreOf)
      expect(strings.update(centreOf)).toBe(0)
      b.set(200, 0, 0)
      expect(strings.update(centreOf)).toBe(1)
    } finally {
      strings.dispose()
    }
  })

  it('calls anchorOf at most once per end over ten idle frames when stamped, and refreshes only moved strands', () => {
    const scene = fakeScene()
    const places = new Map([
      ['', new THREE.Vector3(0, 0, 0)],
      ['a', new THREE.Vector3(100, 0, 0)],
      ['b', new THREE.Vector3(200, 0, 0)],
      ['c', new THREE.Vector3(300, 0, 0)],
    ])
    let stamp = 1
    const anchorOf = vi.fn((key, out) => out.copy(places.get(key)))
    anchorOf.stamp = () => stamp
    const strings = createStrings(scene)
    try {
      const links = [
        { from: '', to: 'a' },
        { from: '', to: 'b' },
        { from: '', to: 'c' },
      ]
      strings.build(links, anchorOf)
      expect(anchorOf).toHaveBeenCalledTimes(6)

      for (let frame = 0; frame < 10; frame += 1) {
        expect(strings.update(anchorOf, null, 0.016)).toBe(0)
      }
      expect(anchorOf).toHaveBeenCalledTimes(6)

      const geometries = scene.children.filter((child) => child.isPoints).map((mesh) => mesh.geometry)
      const versionsBefore = geometries.map((geometry) => geometry.getAttribute('position').version)

      places.set('b', new THREE.Vector3(200, 12, 0))
      stamp += 1
      expect(strings.update(anchorOf, null, 0.016)).toBe(1)

      const geometriesAfter = scene.children.filter((child) => child.isPoints).map((mesh) => mesh.geometry)
      expect(geometriesAfter[0]).toBe(geometries[0])
      expect(geometriesAfter[1]).toBe(geometries[1])
      expect(geometriesAfter[2]).toBe(geometries[2])
      const versionsAfter = geometriesAfter.map((geometry) => geometry.getAttribute('position').version)
      expect(versionsAfter[0]).toBe(versionsBefore[0])
      expect(versionsAfter[1]).toBeGreaterThan(versionsBefore[1])
      expect(versionsAfter[2]).toBe(versionsBefore[2])
    } finally {
      strings.dispose()
    }
  })
})
