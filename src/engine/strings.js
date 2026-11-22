import * as THREE from 'three'
import { WHITE, YELLOW, glowTexture, seeded, still } from './sprites.js'

const SEGMENTS = 16
const LINE_LEVEL = 0.1
const DIM_FACTOR = 0.25
const STRAND_JITTER = 0.6
const YELLOW_STEPS = 16
const FACTOR_STEPS = 8

const COLOR_WHITE = new THREE.Color(WHITE)
const COLOR_YELLOW = new THREE.Color(YELLOW)

const scratchPt = new THREE.Vector3()

function fractionAt(index, count, rand) {
  if (count <= 1) return 0.5
  const base = (index + 0.5) / count
  return base + (rand() - 0.5) * (STRAND_JITTER / count)
}

function strandFractions(count, seed) {
  const rand = seeded(seed)
  const fractions = new Float32Array(count)
  for (let i = 0; i < count; i += 1) fractions[i] = fractionAt(i, count, rand)
  return fractions
}

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
      const t = fractionAt(i, count, rand)
      const x = ax + dx * t
      const y = ay + dy * t
      const z = az + dz * t
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
    const t = fractionAt(i, count, rand)
    getPoint(t, scratchPt)
    const x = scratchPt.x
    const y = scratchPt.y
    const z = scratchPt.z
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

export function linkOnPath(link, mask) {
  if (!mask?.dimmed || !mask.lit) return false
  return mask.lit.has(link.from ?? '') && mask.lit.has(link.to ?? '')
}

function setLinkLevel(array, index, level) {
  const base = index * SEGMENTS * 6
  for (let value = 0; value < SEGMENTS * 6; value += 1) array[base + value] = level
}

function getFractions(strand, count) {
  if (strand.fractions && strand.fractionsCount === count) {
    return strand.fractions
  }
  strand.fractions = strandFractions(count, strand.seed)
  strand.fractionsCount = count
  return strand.fractions
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
  const fractions = getFractions(strand, count)

  if (attr && attr.count === count) {
    const array = attr.array
    for (let i = 0; i < count; i += 1) {
      const t = fractions[i]
      const base = i * 3
      array[base] = ax + dx * t
      array[base + 1] = ay + dy * t
      array[base + 2] = az + dz * t
    }
    attr.needsUpdate = true
    return
  }

  const array = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const t = fractions[i]
    const base = i * 3
    array[base] = ax + dx * t
    array[base + 1] = ay + dy * t
    array[base + 2] = az + dz * t
  }

  geometry.dispose()
  const nextGeo = new THREE.BufferGeometry()
  nextGeo.setAttribute('position', new THREE.BufferAttribute(array, 3))
  strand.mesh.geometry = nextGeo
}

function linkId(link) {
  return `${link.from ?? ''}>${link.to ?? ''}`
}

function writeLineSegments(array, index, from, to) {
  const ax = from.x, ay = from.y, az = from.z
  const dx = to.x - ax, dy = to.y - ay, dz = to.z - az
  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    const start = segment / SEGMENTS
    const end = (segment + 1) / SEGMENTS
    const base = (index * SEGMENTS + segment) * 6
    array[base] = ax + dx * start
    array[base + 1] = ay + dy * start
    array[base + 2] = az + dz * start
    array[base + 3] = ax + dx * end
    array[base + 4] = ay + dy * end
    array[base + 5] = az + dz * end
  }
}

function makeLineGeometry(count) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * SEGMENTS * 6), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * SEGMENTS * 6), 3))
  return geometry
}

export function createStrings(scene) {
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const glow = glowTexture()
  const materials = new Map()
  let line = null
  let ends = []
  let strands = []
  let lineLevels = []
  let dimLevel = 0
  let currentMask = null

  function materialFor(yellowLevel, lit, dim) {
    const factor = lit ? 1 : 1 - (1 - DIM_FACTOR) * dim
    const yellowStep = Math.round(yellowLevel * YELLOW_STEPS)
    const factorStep = Math.round(((factor - DIM_FACTOR) / (1 - DIM_FACTOR)) * FACTOR_STEPS)
    const key = `${yellowStep}|${factorStep}`
    let material = materials.get(key)
    if (!material) {
      const y = yellowStep / YELLOW_STEPS
      const f = DIM_FACTOR + (1 - DIM_FACTOR) * (factorStep / FACTOR_STEPS)
      material = new THREE.PointsMaterial({
        color: new THREE.Color().lerpColors(COLOR_WHITE, COLOR_YELLOW, y),
        size: 8,
        map: glow,
        transparent: true,
        opacity: (0.35 + y * 0.55) * f,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      materials.set(key, material)
    }
    return material
  }

  function makeStrand(link) {
    const seed = stringHash(linkId(link))
    const mesh = new THREE.Points(new THREE.BufferGeometry(), materialFor(0, false, 0))
    mesh.frustumCulled = false
    scene.add(mesh)
    return {
      link,
      seed,
      mesh,
      yellowLevel: 0,
      paintedYellow: -1,
      paintedLit: false,
      paintedDim: -1,
      from: new THREE.Vector3(NaN, NaN, NaN),
      to: new THREE.Vector3(NaN, NaN, NaN),
      fromStamp: undefined,
      toStamp: undefined,
      stampBasis: undefined,
      fractions: null,
      fractionsCount: 0,
    }
  }

  function clear() {
    if (line) {
      scene.remove(line)
      line.geometry.dispose()
      line.material.dispose()
      line = null
    }
    for (const strand of strands) {
      scene.remove(strand.mesh)
      strand.mesh.geometry.dispose()
      strand.fractions = null
    }
    for (const material of materials.values()) material.dispose()
    materials.clear()
    strands = []
    ends = []
    lineLevels = []
  }

  function dispose() {
    clear()
    glow.dispose()
  }

  function update(anchorOf, mask = null, delta = 0) {
    currentMask = mask
    const isStill = still()
    const dimGoal = mask?.dimmed ? 1 : 0
    if (isStill) {
      dimLevel = dimGoal
    } else if (dimLevel < dimGoal) {
      dimLevel = Math.min(dimGoal, dimLevel + delta)
    } else if (dimLevel > dimGoal) {
      dimLevel = Math.max(dimGoal, dimLevel - delta)
    }
    if (!line) return 0
    const array = line.geometry.attributes.position.array
    const colors = line.geometry.attributes.color.array
    let lineChanged = false
    let colorChanged = false
    let written = 0
    for (let i = 0; i < ends.length; i += 1) {
      const link = ends[i]
      const strand = strands[i]

      const onPath = linkOnPath(link, mask)
      const level = LINE_LEVEL + ((onPath ? 1 : LINE_LEVEL * DIM_FACTOR) - LINE_LEVEL) * dimLevel
      if (lineLevels[i] !== level) {
        lineLevels[i] = level
        setLinkLevel(colors, i, level)
        colorChanged = true
      }

      if (strand) {
        if (isStill) {
          strand.yellowLevel = onPath ? 1 : 0
        } else if (onPath) {
          strand.yellowLevel = 1
        } else if (strand.yellowLevel > 0) {
          strand.yellowLevel = Math.max(0, strand.yellowLevel - delta / 1.5)
        }
        if (strand.paintedYellow !== strand.yellowLevel || strand.paintedLit !== onPath || strand.paintedDim !== dimLevel) {
          strand.paintedYellow = strand.yellowLevel
          strand.paintedLit = onPath
          strand.paintedDim = dimLevel
          const nextMaterial = materialFor(strand.yellowLevel, onPath, dimLevel)
          if (strand.mesh.material !== nextMaterial) strand.mesh.material = nextMaterial
        }
      }

      const fromValue = anchorOf(link.from ?? '', from)
      if (fromValue && fromValue !== from) {
        from.copy(fromValue)
        from.anchorStamp = undefined
        from.anchorBasis = undefined
      }
      const toValue = anchorOf(link.to ?? '', to)
      if (toValue && toValue !== to) {
        to.copy(toValue)
        to.anchorStamp = undefined
        to.anchorBasis = undefined
      }

      const fromStamp = from.anchorStamp
      const toStamp = to.anchorStamp
      const stampBasis = from.anchorBasis
      if (
        strand &&
        fromStamp !== undefined &&
        strand.fromStamp === fromStamp &&
        strand.toStamp === toStamp &&
        strand.stampBasis === stampBasis
      ) {
        continue
      }
      if (strand) {
        strand.fromStamp = fromStamp
        strand.toStamp = toStamp
        strand.stampBasis = stampBasis
      }

      const moved = !strand || Number.isNaN(strand.from.x) || Number.isNaN(strand.to.x) ||
        strand.from.distanceToSquared(from) > 0.01 ||
        strand.to.distanceToSquared(to) > 0.01

      if (moved) {
        written += 1
        lineChanged = true
        writeLineSegments(array, i, from, to)
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
    if (colorChanged) {
      line.geometry.attributes.color.needsUpdate = true
    }
    return written
  }

  function build(links, anchorOf) {
    const list = links ? [...links] : []
    if (list.length === 0) {
      clear()
      return
    }
    const existing = new Map()
    for (let i = 0; i < strands.length; i += 1) {
      const strand = strands[i]
      const key = linkId(strand.link)
      let bucket = existing.get(key)
      if (!bucket) {
        bucket = []
        existing.set(key, bucket)
      }
      bucket.push({ strand, index: i })
    }

    const nextStrands = []
    let orderChanged = list.length !== ends.length
    for (let i = 0; i < list.length; i += 1) {
      const link = list[i]
      const key = linkId(link)
      const bucket = existing.get(key)
      if (bucket && bucket.length > 0) {
        const entry = bucket.shift()
        entry.strand.link = link
        if (entry.index !== i) orderChanged = true
        nextStrands.push(entry.strand)
      } else {
        orderChanged = true
        nextStrands.push(makeStrand(link))
      }
    }

    for (const bucket of existing.values()) {
      for (const entry of bucket) {
        scene.remove(entry.strand.mesh)
        entry.strand.mesh.geometry.dispose()
        entry.strand.fractions = null
      }
    }

    ends = list
    strands = nextStrands
    lineLevels = new Array(ends.length).fill(-1)

    let lineRebuilt = false
    if (!line) {
      line = new THREE.LineSegments(
        makeLineGeometry(ends.length),
        new THREE.LineBasicMaterial({
          color: WHITE,
          vertexColors: true,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
      line.frustumCulled = false
      scene.add(line)
      lineRebuilt = true
    } else if (line.geometry.attributes.position.count !== ends.length * SEGMENTS * 2) {
      line.geometry.dispose()
      line.geometry = makeLineGeometry(ends.length)
      lineRebuilt = true
    }

    if (lineRebuilt || orderChanged) {
      const posArray = line.geometry.attributes.position.array
      let seededPos = false
      for (let i = 0; i < strands.length; i += 1) {
        const strand = strands[i]
        if (Number.isNaN(strand.from.x) || Number.isNaN(strand.to.x)) continue
        writeLineSegments(posArray, i, strand.from, strand.to)
        seededPos = true
      }
      if (seededPos) line.geometry.attributes.position.needsUpdate = true
    }

    update(anchorOf, currentMask, 0)
  }

  return { build, update, dispose }
}
