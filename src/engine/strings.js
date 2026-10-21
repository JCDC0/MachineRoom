import * as THREE from 'three'
import { WHITE, YELLOW, glowTexture, lineMaterial, seeded } from './sprites.js'

const SEGMENTS = 16
const SAG = 0.12
const SAG_MAX = 520
export const STRING_LIFT = 30

const COLOR_WHITE = new THREE.Color(WHITE)
const COLOR_YELLOW = new THREE.Color(YELLOW)

export function curvePoint(a, b, t, out) {
  out.lerpVectors(a, b, t)
  out.y -= Math.min(SAG_MAX, a.distanceTo(b) * SAG) * 4 * t * (1 - t)
  return out
}

export function strandPoints(curve, spacing = 24, seed = 0) {
  if (!curve) return []
  let a = curve.a ?? curve.from ?? (Array.isArray(curve) ? curve[0] : null)
  let b = curve.b ?? curve.to ?? (Array.isArray(curve) ? curve[1] : null)
  let getPoint = null
  let len = 0

  if (a && b) {
    len = a.distanceTo(b)
    if (len === 0) return []
    getPoint = (t, out) => curvePoint(a, b, t, out)
  } else if (typeof curve.getPoint === 'function') {
    len = typeof curve.getLength === 'function' ? curve.getLength() : (curve.length ?? 0)
    if (len === 0) return []
    getPoint = (t, out) => curve.getPoint(t, out)
  } else if (typeof curve === 'function') {
    len = curve.length ?? 0
    if (len === 0) return []
    getPoint = (t, out) => curve(t, out)
  } else {
    return []
  }

  const count = spacing > 0 ? Math.max(0, Math.round(len / spacing)) : 0
  if (count === 0) return []
  const rand = seeded(seed)
  const points = []
  const pt = new THREE.Vector3()
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count
    getPoint(t, pt)
    const scatter = 10
    const x = pt.x + (rand() - 0.5) * scatter
    const y = pt.y + (rand() - 0.5) * scatter
    const z = pt.z + (rand() - 0.5) * scatter
    points.push(new THREE.Vector3(x, y, z))
  }
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

function fillStrand(strand, points) {
  const geometry = strand.mesh.geometry
  if (geometry.getAttribute('position')?.count === points.length) {
    geometry.setFromPoints(points)
    return
  }
  geometry.dispose()
  strand.mesh.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

export function createStrings(scene, { onPath = () => false } = {}) {
  const still = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
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
    }
    strands = []
  }

  function update(centerOf) {
    if (!line) return
    const array = line.geometry.attributes.position.array
    let k = 0
    for (let i = 0; i < ends.length; i += 1) {
      const link = ends[i]
      if (link.from === null) from.set(0, 0, 0)
      else from.copy(centerOf(link.from))
      to.copy(centerOf(link.to))
      from.y += STRING_LIFT
      to.y += STRING_LIFT
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        curvePoint(from, to, segment / SEGMENTS, start)
        curvePoint(from, to, (segment + 1) / SEGMENTS, end)
        array[k++] = start.x
        array[k++] = start.y
        array[k++] = start.z
        array[k++] = end.x
        array[k++] = end.y
        array[k++] = end.z
      }
      const strand = strands[i]
      if (strand) {
        strand.from.copy(from)
        strand.to.copy(to)
        const pts = strandPoints({ a: from, b: to }, 24, strand.seed)
        fillStrand(strand, pts)
      }
    }
    line.geometry.attributes.position.needsUpdate = true
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
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
      }
      mesh.onBeforeRender = () => {
        const now = performance.now()
        const delta = Math.min((now - lastTime) / 1000, 0.1)
        lastTime = now
        const active = onPath(strand.link.to)
        if (still) {
          strand.yellowLevel = active ? 1 : 0
        } else if (active) {
          strand.yellowLevel = 1
        } else if (strand.yellowLevel > 0) {
          strand.yellowLevel = Math.max(0, strand.yellowLevel - delta / 1.5)
        }
        if (strand.yellowLevel > 0) {
          material.color.lerpColors(COLOR_WHITE, COLOR_YELLOW, strand.yellowLevel)
          material.opacity = 0.35 + strand.yellowLevel * 0.55
        } else {
          material.color.setHex(WHITE)
          material.opacity = 0.35
        }
      }
      scene.add(mesh)
      return strand
    })

    update(centerOf)
  }

  return { build, update, dispose }
}
