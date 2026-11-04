import * as THREE from 'three'
import { WHITE, seeded, still } from './sprites.js'

export const LATTICE_STEP = 2000
export const LATTICE_CELLS = 5
export const LATTICE_LAYER = 1
const TICK = 50
export const DUST = 1800
export const DUST_INNER = 4500
export const DUST_OUTER = 15500
export const MOTES = 12000
export const MOTE_INNER = 400
export const MOTE_OUTER = 6000
export const DRIFT_SPEED = 14
export const DRIFT_WANDER = 18
export const SPECK_BANDS = [
  { size: 12, fade: 1 },
  { size: 22, fade: 0.7 },
  { size: 38, fade: 0.45 },
]

const DRIFT_RATE = 0.35
const DRIFT_RATE_SPREAD = 0.25
const DRIFT_SEED = 7919
const DRIFT_FRAMES = 2
const TAU = Math.PI * 2

let fineDustOptions = { on: true, strength: 0.2, pulse: false }
const fineDustMaterials = new Set()
const fineDustGeometries = new Set()

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

export function speckPulse(seconds, phase = 0, rate = 1.2) {
  return 0.2 + 0.8 * (0.5 + 0.5 * Math.sin((Number(seconds) || 0) * rate + phase))
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
    const pace = (0.5 + next() * 0.8) * speed
    specks.push({
      vx: (vx / length) * pace,
      vy: (vy / length) * pace,
      vz: (vz / length) * pace,
      rx: 0.4 + next() * 0.9,
      ry: 0.4 + next() * 0.9,
      rz: 0.4 + next() * 0.9,
      px: next() * TAU,
      py: next() * TAU,
      pz: next() * TAU,
      rate: DRIFT_RATE + next() * DRIFT_RATE_SPREAD,
      phase: next() * TAU,
      wander: DRIFT_WANDER * (0.4 + 0.6 * next()),
      pulsePhase: next() * Math.PI * 2,
      pulseRate: 0.6 + next() * 1.4,
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

export function driftPoint(base, index, speck, seconds, out = [0, 0, 0], offset = 0) {
  const t = Number(seconds) || 0
  const wander = speck.wander ?? DRIFT_WANDER
  const wx = Math.sin(t * (speck.rx ?? speck.rate ?? 0.5) + (speck.px ?? speck.phase ?? 0)) * wander
  const wy = Math.sin(t * (speck.ry ?? (speck.rate ?? 0.5) * 0.8) + (speck.py ?? (speck.phase ?? 0) + 1.7)) * wander
  const wz = Math.sin(t * (speck.rz ?? (speck.rate ?? 0.5) * 0.6) + (speck.pz ?? (speck.phase ?? 0) + 3.1)) * wander
  return bouncePoint(
    base[index] + speck.vx * t + wx,
    base[index + 1] + speck.vy * t + wy,
    base[index + 2] + speck.vz * t + wz,
    speck.inner,
    speck.outer,
    out,
    offset
  )
}

function resetLayerColor(layer) {
  const colorAttr = layer.userData.colorAttr
  if (!colorAttr) return
  colorAttr.array.fill(1)
  colorAttr.needsUpdate = true
}

export function setFineDust(options = {}) {
  fineDustOptions = { ...fineDustOptions, ...options }
  for (const geometry of fineDustGeometries) {
    geometry.setDrawRange(0, moteCount(fineDustOptions, geometry.userData.total))
    if (!fineDustOptions.pulse) resetLayerColor(geometry)
  }
  applyDustOpacity()
}

function applyDustOpacity() {
  for (const mat of fineDustMaterials) {
    mat.opacity = moteOpacity(fineDustOptions) * (mat.userData.fade ?? 1)
    mat.visible = mat.opacity > 0
  }
}

export function latticeLines(step = LATTICE_STEP, cells = LATTICE_CELLS) {
  const extent = step * cells
  const layer = LATTICE_LAYER * step
  const values = []
  for (let a = -cells; a <= cells; a++) {
    for (let b = -cells; b <= cells; b++) {
      const u = a * step
      const v = b * step
      if (Math.abs(a) === LATTICE_LAYER) values.push(-extent, u, v, extent, u, v)
      values.push(u, -layer, v, u, layer, v)
      if (Math.abs(b) === LATTICE_LAYER) values.push(u, v, -extent, u, v, extent)
    }
  }
  return values
}

export function latticeTicks(step = LATTICE_STEP, cells = LATTICE_CELLS) {
  const values = []
  for (const layer of [-LATTICE_LAYER, LATTICE_LAYER]) {
    for (let x = -cells; x <= cells; x++) {
      for (let z = -cells; z <= cells; z++) {
        const px = x * step
        const py = layer * step
        const pz = z * step
        values.push(px - TICK, py, pz, px + TICK, py, pz)
        values.push(px, py, pz - TICK, px, py, pz + TICK)
      }
    }
  }
  return values
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

  const dustGeometry = new THREE.BufferGeometry().setFromPoints(dustPoints())
  dustGeometry.userData.base = new Float32Array(dustGeometry.attributes.position.array)
  dustGeometry.userData.drift = driftSpecks(DUST, DRIFT_SEED + 9001, { inner: DUST_INNER, outer: DUST_OUTER, speed: 28 })
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({ color: WHITE, size: 10, map: texture, transparent: true, opacity: 0.45, depthWrite: false })
  )
  group.add(dust)

  const fineDust = new THREE.Group()
  const fineGeometries = []
  const motes = motePoints()
  const fineDrift = speckBands(driftSpecks(motes.length, DRIFT_SEED + 1337))
  let driftSeconds = 0
  let frame = 0
  let colorsPulsed = false
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
      vertexColors: true,
    })
    material.userData.fade = band.fade
    material.visible = material.opacity > 0
    fineDustMaterials.add(material)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    geometry.userData.total = points.length
    geometry.userData.base = new Float32Array(geometry.attributes.position.array)
    geometry.userData.drift = fineDrift[index]
    geometry.userData.colorAttr = new THREE.Float32BufferAttribute(new Float32Array(points.length * 3).fill(1), 3)
    geometry.setAttribute('color', geometry.userData.colorAttr)
    geometry.setDrawRange(0, moteCount(fineDustOptions, points.length))
    fineDustGeometries.add(geometry)
    fineGeometries.push(geometry)
    fineDust.add(new THREE.Points(geometry, material))
    return material
  })
  group.add(fineDust)

  scene.add(group)

  function driftLayer(layer, seconds = driftSeconds) {
    const attribute = layer.attributes.position
    const values = attribute.array
    const base = layer.userData.base
    const drift = layer.userData.drift
    const colorAttr = layer.userData.colorAttr
    const colors = colorAttr?.array
    const pulsing = Boolean(colors) && fineDustOptions.pulse && !still()
    const drawn = Math.min(layer.drawRange.count, drift.length)
    for (let index = 0; index < drawn; index += 1) {
      const speck = drift[index]
      driftPoint(base, index * 3, speck, seconds, values, index * 3)
      if (colors) {
        const b = pulsing ? speckPulse(seconds, speck.pulsePhase, speck.pulseRate) : 1
        colors[index * 3] = b
        colors[index * 3 + 1] = b
        colors[index * 3 + 2] = b
      }
    }
    attribute.needsUpdate = true
    if (colorAttr) colorAttr.needsUpdate = true
    if (colors) colorsPulsed = pulsing
  }

  function update(delta) {
    if (still()) {
      if (colorsPulsed) {
        colorsPulsed = false
        for (const geometry of fineGeometries) resetLayerColor(geometry)
      }
      return
    }
    driftSeconds += delta
    frame += 1
    if (frame % DRIFT_FRAMES === 0) {
      driftLayer(dustGeometry, driftSeconds)
      for (const geometry of fineGeometries) driftLayer(geometry, driftSeconds)
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

