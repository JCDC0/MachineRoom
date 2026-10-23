import * as THREE from 'three'
import { SPHERE_CENTER } from './sphere.js'
import { WHITE, YELLOW, glowTexture, lineMaterial, reducedMotion, seeded } from './sprites.js'

const SEGMENTS = 16
const SAG = 0.12
const SAG_MAX = 520

const COLOR_WHITE = new THREE.Color(WHITE)
const COLOR_YELLOW = new THREE.Color(YELLOW)

export function curvePoint(a, b, t, out) {
  out.lerpVectors(a, b, t)
  out.y -= Math.min(SAG_MAX, a.distanceTo(b) * SAG) * 4 * t * (1 - t)
  return out
}

const scratchPt = new THREE.Vector3()

export function strandPoints(curve, spacing = 24, seed = 0, out = null) {
  if (!curve) return out ? (out.length = 0, out) : []
  let a = curve.a ?? curve.from ?? (Array.isArray(curve) ? curve[0] : null)
  let b = curve.b ?? curve.to ?? (Array.isArray(curve) ? curve[1] : null)
  let getPoint = null
  let len = 0

  if (a && b) {
    len = a.distanceTo(b)
    if (len === 0) return out ? (out.length = 0, out) : []
    const ax = a.x, ay = a.y, az = a.z
    const dx = b.x - ax, dy = b.y - ay, dz = b.z - az
    const count = spacing > 0 ? Math.max(0, Math.round(len / spacing)) : 0
    if (count === 0) return out ? (out.length = 0, out) : []
    const rand = seeded(seed)
    const points = out ?? []
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : (i + 0.5) / count
      const x = ax + dx * t + (rand() - 0.5) * 10
      const y = ay + dy * t + (rand() - 0.5) * 10
      const z = az + dz * t + (rand() - 0.5) * 10
      if (i < points.length) {
        points[i].set(x, y, z)
      } else {
        points.push(new THREE.Vector3(x, y, z))
      }
    }
    if (points.length > count) points.length = count
    return points
  } else if (typeof curve.getPoint === 'function') {
    len = typeof curve.getLength === 'function' ? curve.getLength() : (curve.length ?? 0)
    if (len === 0) return out ? (out.length = 0, out) : []
    getPoint = (t, pt) => curve.getPoint(t, pt)
  } else if (typeof curve === 'function') {
    len = curve.length ?? 0
    if (len === 0) return out ? (out.length = 0, out) : []
    getPoint = (t, pt) => curve(t, pt)
  } else {
    return out ? (out.length = 0, out) : []
  }

  const count = spacing > 0 ? Math.max(0, Math.round(len / spacing)) : 0
  if (count === 0) return out ? (out.length = 0, out) : []
  const rand = seeded(seed)
  const points = out ?? []
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count
    getPoint(t, scratchPt)
    const x = scratchPt.x + (rand() - 0.5) * 10
    const y = scratchPt.y + (rand() - 0.5) * 10
    const z = scratchPt.z + (rand() - 0.5) * 10
    if (i < points.length) {
      points[i].set(x, y, z)
    } else {
      points.push(new THREE.Vector3(x, y, z))
    }
  }
  if (points.length > count) points.length = count
  return points
}

function stringHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function getOffsets(strand, count) {
  if (strand.offsets && strand.offsetsCount === count) {
    return strand.offsets
  }
  const rand = seeded(strand.seed)
  const offsets = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const base = i * 3
    offsets[base] = (rand() - 0.5) * 10
    offsets[base + 1] = (rand() - 0.5) * 10
    offsets[base + 2] = (rand() - 0.5) * 10
  }
  strand.offsets = offsets
  strand.offsetsCount = count
  return offsets
}

function fillStrandDirect(strand, from, to) {
  const len = from.distanceTo(to)
  if (len === 0) return
  const count = Math.max(0, Math.round(len / 24))
  if (count === 0) return

  const geometry = strand.mesh.geometry
  const attr = geometry.getAttribute('position')
  const ax = from.x, ay = from.y, az = from.z
  const dx = to.x - ax, dy = to.y - ay, dz = to.z - az
  const offsets = getOffsets(strand, count)

  if (attr && attr.count === count) {
    const array = attr.array
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : (i + 0.5) / count
      const base = i * 3
      array[base] = ax + dx * t + offsets[base]
      array[base + 1] = ay + dy * t + offsets[base + 1]
      array[base + 2] = az + dz * t + offsets[base + 2]
    }
    attr.needsUpdate = true
    return
  }

  const array = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count
    const base = i * 3
    array[base] = ax + dx * t + offsets[base]
    array[base + 1] = ay + dy * t + offsets[base + 1]
    array[base + 2] = az + dz * t + offsets[base + 2]
  }

  geometry.dispose()
  const nextGeo = new THREE.BufferGeometry()
  nextGeo.setAttribute('position', new THREE.BufferAttribute(array, 3))
  strand.mesh.geometry = nextGeo
}

function fillStrand(strand, points) {
  const geometry = strand.mesh.geometry
  const attr = geometry.getAttribute('position')
  if (attr && attr.count === points.length) {
    const array = attr.array
    for (let i = 0; i < points.length; i += 1) {
      const pt = points[i]
      const base = i * 3
      array[base] = pt.x
      array[base + 1] = pt.y
      array[base + 2] = pt.z
    }
    attr.needsUpdate = true
    return
  }
  geometry.dispose()
  strand.mesh.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

export function createStrings(scene, { onPath = () => false } = {}) {
  const motion = reducedMotion()
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  let line = null
  let ends = []
  let strands = []

  function dispose() {
    if (line) {
      scene.remove(line)
      line.geometry.dispose()
      line.material.dispose()
      line = null
    }
    for (const strand of strands) {
      scene.remove(strand.mesh)
      strand.mesh.geometry.dispose()
      strand.mesh.material.dispose()
      strand.offsets = null
    }
    strands = []
  }

  function update(centerOf) {
    if (!line) return
    const array = line.geometry.attributes.position.array
    let lineChanged = false
    for (let i = 0; i < ends.length; i += 1) {
      const link = ends[i]
      if (link.from === null) from.copy(SPHERE_CENTER)
      else from.copy(centerOf(link.from))
      to.copy(centerOf(link.to))

      const strand = strands[i]
      const moved = !strand || Number.isNaN(strand.from.x) ||
        strand.from.distanceToSquared(from) > 0.01 ||
        strand.to.distanceToSquared(to) > 0.01

      if (moved) {
        lineChanged = true
        const ax = from.x, ay = from.y, az = from.z
        const dx = to.x - ax, dy = to.y - ay, dz = to.z - az
        for (let segment = 0; segment < SEGMENTS; segment += 1) {
          const start = segment / SEGMENTS
          const end = (segment + 1) / SEGMENTS
          const base = (i * SEGMENTS + segment) * 6
          array[base] = ax + dx * start
          array[base + 1] = ay + dy * start
          array[base + 2] = az + dz * start
          array[base + 3] = ax + dx * end
          array[base + 4] = ay + dy * end
          array[base + 5] = az + dz * end
        }
        if (strand) {
          strand.from.copy(from)
          strand.to.copy(to)
          fillStrandDirect(strand, from, to)
        }
      }
    }
    if (lineChanged) {
      line.geometry.attributes.position.needsUpdate = true
    }
  }

  function build(links, centerOf, anchor = true) {
    dispose()
    ends = anchor ? [{ from: null, to: '' }, ...links] : [...links]
    if (ends.length === 0) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ends.length * SEGMENTS * 6), 3))
    line = new THREE.LineSegments(geometry, lineMaterial(WHITE, 0.22))
    line.frustumCulled = false
    scene.add(line)

    const texture = glowTexture()
    strands = ends.map((link) => {
      const seed = stringHash(`${link.from ?? ''}>${link.to ?? ''}`)
      const material = new THREE.PointsMaterial({
        color: WHITE,
        size: 8,
        map: texture,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Points(new THREE.BufferGeometry(), material)
      mesh.frustumCulled = false
      let lastTime = performance.now()
      const strand = {
        link,
        seed,
        mesh,
        yellowLevel: 0,
        lastYellowLevel: 0,
        from: new THREE.Vector3(NaN, NaN, NaN),
        to: new THREE.Vector3(NaN, NaN, NaN),
        offsets: null,
        offsetsCount: 0,
      }
      mesh.onBeforeRender = () => {
        const now = performance.now()
        const delta = Math.min((now - lastTime) / 1000, 0.1)
        lastTime = now
        const active = onPath(strand.link.to)
        if (motion.still()) {
          strand.yellowLevel = active ? 1 : 0
        } else if (active) {
          strand.yellowLevel = 1
        } else if (strand.yellowLevel > 0) {
          strand.yellowLevel = Math.max(0, strand.yellowLevel - delta / 1.5)
        }
        if (strand.yellowLevel > 0) {
          material.color.lerpColors(COLOR_WHITE, COLOR_YELLOW, strand.yellowLevel)
          material.opacity = 0.35 + strand.yellowLevel * 0.55
          strand.lastYellowLevel = strand.yellowLevel
        } else if (strand.lastYellowLevel !== 0) {
          material.color.setHex(WHITE)
          material.opacity = 0.35
          strand.lastYellowLevel = 0
        }
      }
      scene.add(mesh)
      return strand
    })

    update(centerOf)
  }

  return { build, update, dispose }
}
