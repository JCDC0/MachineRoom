import * as THREE from 'three'
import { WHITE, seeded, still, textSprite } from './sprites.js'

export const LATTICE_STEP = 2000
export const LATTICE_CELLS = 5
const TICK = 50
export const DUST = 1800
export const DUST_INNER = 4500
export const DUST_OUTER = 15500
export const MOTES = 12000
export const MOTE_INNER = 400
export const MOTE_OUTER = 6000
export const DRIFT_SPEED = 2.5
export const DRIFT_WANDER = 3
export const SPECK_BANDS = [
  { size: 12, fade: 1 },
  { size: 22, fade: 0.7 },
  { size: 38, fade: 0.45 },
]

const DRIFT_RATE = 0.35
const DRIFT_RATE_SPREAD = 0.25
const DRIFT_PACE = 0.4
const DRIFT_SEED = 7919
const DRIFT_FRAMES = 2

let fineDustOptions = { on: true, strength: 0.2, pulse: false }
const fineDustMaterials = new Set()
const fineDustGeometries = new Set()
let pulseLevel = 1

export function moteOpacity({ on, strength } = {}) {
  const value = Number(strength)
  if (!on || !Number.isFinite(value) || value <= 0) return 0
  return 0.7
}

export function moteCount({ on, strength } = {}, total = MOTES) {
  const value = Number(strength)
  if (!on || !Number.isFinite(value) || value <= 0) return 0
  return Math.round(total * Math.min(1, value))
}

export function dustPulse(seconds) {
  return 0.6 + 0.4 * Math.sin(seconds * 1.2)
}

export function motePoints(count = MOTES, seed = 1337, inner = MOTE_INNER, outer = MOTE_OUTER) {
  const next = seeded(seed)
  const points = []
  for (let index = 0; index < count; index += 1) {
    const direction = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1)
    if (direction.lengthSq() < 1e-6) direction.set(1, 0, 0)
    direction.normalize()
    const radius = Math.cbrt(inner ** 3 + next() * (outer ** 3 - inner ** 3))
    points.push(direction.multiplyScalar(radius))
  }
  return points
}

export function dustPoints(count = DUST, seed = 9001, inner = DUST_INNER, outer = DUST_OUTER) {
  const next = seeded(seed)
  const points = []
  for (let index = 0; index < count; index += 1) {
    const direction = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1)
    if (direction.lengthSq() < 1e-6) direction.set(1, 0, 0)
    direction.normalize()
    points.push(direction.multiplyScalar(inner + next() * (outer - inner)))
  }
  return points
}

export function speckBands(points, bands = SPECK_BANDS.length) {
  const out = Array.from({ length: bands }, () => [])
  points.forEach((point, index) => out[index % bands].push(point))
  return out
}

export function driftSpecks(count, seed, { inner = MOTE_INNER, outer = MOTE_OUTER, speed = DRIFT_SPEED } = {}) {
  const next = seeded(seed)
  const specks = []
  for (let index = 0; index < count; index += 1) {
    const vx = next() * 2 - 1
    const vy = next() * 2 - 1
    const vz = next() * 2 - 1
    const length = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
    const pace = speed * (DRIFT_PACE + (1 - DRIFT_PACE) * next())
    const wx = next() * 2 - 1
    const wy = next() * 2 - 1
    const wz = next() * 2 - 1
    const wanderLength = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1
    specks.push({
      vx: (vx / length) * pace,
      vy: (vy / length) * pace,
      vz: (vz / length) * pace,
      wx: wx / wanderLength,
      wy: wy / wanderLength,
      wz: wz / wanderLength,
      rate: DRIFT_RATE + next() * DRIFT_RATE_SPREAD,
      wander: DRIFT_WANDER * (0.4 + 0.6 * next()),
      inner,
      outer,
    })
  }
  return specks
}

export function bounceRadius(radius, inner, outer) {
  const span = outer - inner
  if (!(span > 0) || !Number.isFinite(radius)) return inner
  if (radius >= inner && radius <= outer) return radius
  const period = span * 2
  let folded = (radius - inner) % period
  if (folded < 0) folded += period
  if (folded > span) folded = period - folded
  return inner + folded
}

export function bouncePoint(x, y, z, inner, outer, out = [0, 0, 0], offset = 0) {
  const radius = Math.sqrt(x * x + y * y + z * z)
  if (!(radius > 1e-9)) {
    out[offset] = inner
    out[offset + 1] = 0
    out[offset + 2] = 0
    return out
  }
  const scale = bounceRadius(radius, inner, outer) / radius
  out[offset] = x * scale
  out[offset + 1] = y * scale
  out[offset + 2] = z * scale
  return out
}

export function driftPoint(base, index, drift, seconds, out = [0, 0, 0], offset = 0) {
  const swing = Math.sin(drift.rate * seconds) * drift.wander
  return bouncePoint(
    base[index] + drift.vx * seconds + drift.wx * swing,
    base[index + 1] + drift.vy * seconds + drift.wy * swing,
    base[index + 2] + drift.vz * seconds + drift.wz * swing,
    drift.inner,
    drift.outer,
    out,
    offset
  )
}

export function setFineDust(options = {}) {
  fineDustOptions = { ...fineDustOptions, ...options }
  if (!fineDustOptions.pulse) pulseLevel = 1
  for (const geometry of fineDustGeometries) {
    geometry.setDrawRange(0, moteCount(fineDustOptions, geometry.userData.total))
  }
  applyDustOpacity()
}

function applyDustOpacity() {
  for (const mat of fineDustMaterials) {
    mat.opacity = moteOpacity(fineDustOptions) * (mat.userData.fade ?? 1) * pulseLevel
    mat.visible = mat.opacity > 0
  }
}

export function latticeLines(step = LATTICE_STEP, cells = LATTICE_CELLS) {
  const extent = step * cells
  const values = []
  for (let a = -cells; a <= cells; a++) {
    for (let b = -cells; b <= cells; b++) {
      const u = a * step
      const v = b * step
      values.push(-extent, u, v, extent, u, v)
      values.push(u, -extent, v, u, extent, v)
      values.push(u, v, -extent, u, v, extent)
    }
  }
  return values
}

export function latticeTicks(step = LATTICE_STEP, cells = LATTICE_CELLS) {
  const values = []
  for (let x = -cells; x <= cells; x++) {
    for (let y = -cells; y <= cells; y++) {
      for (let z = -cells; z <= cells; z++) {
        const px = x * step
        const py = y * step
        const pz = z * step
        values.push(px - TICK, py, pz, px + TICK, py, pz, px, py - TICK, pz, px, py + TICK, pz, px, py, pz - TICK, px, py, pz + TICK)
      }
    }
  }
  return values
}

export function labelPoints(step = LATTICE_STEP, cells = LATTICE_CELLS) {
  const points = []
  for (let x = -cells; x <= cells; x++) {
    for (let y = -2; y <= 2; y++) {
      for (let z = -cells; z <= cells; z++) {
        const far = Math.max(Math.abs(x), Math.abs(z))
        if (far >= 2 && (x * 7 + y * 3 + z * 5) % 9 === 0) points.push([x * step, y * step, z * step])
      }
    }
  }
  return points
}

function lineSet(values, opacity) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity, depthWrite: false }))
}

export function createVoid(scene, texture) {
  const group = new THREE.Group()
  group.add(lineSet(latticeLines(), 0.035))
  group.add(lineSet(latticeTicks(), 0.12))
  for (const [x, y, z] of labelPoints()) {
    const label = textSprite(`${x},${y},${z}`, { color: 'rgba(255,255,255,.32)', scale: 3.2 })
    label.position.set(x, y + 90, z)
    group.add(label)
  }

  const dustGeometry = new THREE.BufferGeometry().setFromPoints(dustPoints())
  dustGeometry.userData.base = new Float32Array(dustGeometry.attributes.position.array)
  dustGeometry.userData.drift = driftSpecks(DUST, DRIFT_SEED + 9001, { inner: DUST_INNER, outer: DUST_OUTER })
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({ color: WHITE, size: 10, map: texture, transparent: true, opacity: 0.45, depthWrite: false })
  )
  group.add(dust)

  const fineDust = new THREE.Group()
  const fineGeometries = []
  const motes = motePoints()
  const fineDrift = speckBands(driftSpecks(motes.length, DRIFT_SEED + 1337))
  let elapsed = 0
  let driftSeconds = 0
  let frame = 0
  const fineMaterials = speckBands(motes).map((points, index) => {
    const band = SPECK_BANDS[index]
    const material = new THREE.PointsMaterial({
      color: WHITE,
      size: band.size,
      map: texture,
      sizeAttenuation: true,
      transparent: true,
      opacity: moteOpacity(fineDustOptions) * band.fade,
      depthWrite: false,
    })
    material.userData.fade = band.fade
    material.visible = material.opacity > 0
    fineDustMaterials.add(material)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    geometry.userData.total = points.length
    geometry.userData.base = new Float32Array(geometry.attributes.position.array)
    geometry.userData.drift = fineDrift[index]
    geometry.setDrawRange(0, moteCount(fineDustOptions, points.length))
    fineDustGeometries.add(geometry)
    fineGeometries.push(geometry)
    fineDust.add(new THREE.Points(geometry, material))
    return material
  })
  group.add(fineDust)

  scene.add(group)

  function driftLayer(geometry) {
    const attribute = geometry.attributes.position
    const values = attribute.array
    const base = geometry.userData.base
    const drift = geometry.userData.drift
    const drawn = Math.min(geometry.drawRange.count, drift.length)
    for (let index = 0; index < drawn; index += 1) {
      driftPoint(base, index * 3, drift[index], driftSeconds, values, index * 3)
    }
    attribute.needsUpdate = true
  }

  function update(delta) {
    if (still()) {
      if (pulseLevel !== 1) {
        pulseLevel = 1
        applyDustOpacity()
      }
      return
    }
    dust.rotation.y += delta * 0.004
    fineDust.rotation.y += delta * 0.002
    fineDust.rotation.x += delta * 0.001
    driftSeconds += delta
    frame += 1
    if (frame % DRIFT_FRAMES === 0) {
      driftLayer(dustGeometry)
      for (const geometry of fineGeometries) driftLayer(geometry)
    }
    if (fineDustOptions.pulse) {
      elapsed += delta
      pulseLevel = dustPulse(elapsed)
      applyDustOpacity()
    }
  }

  function dispose() {
    for (const material of fineMaterials) fineDustMaterials.delete(material)
    for (const geometry of fineGeometries) fineDustGeometries.delete(geometry)
    scene.remove(group)
    group.traverse((object) => {
      object.geometry?.dispose()
      if (object.isSprite) object.material.map?.dispose()
      object.material?.dispose?.()
    })
  }

  return { group, update, dispose }
}

