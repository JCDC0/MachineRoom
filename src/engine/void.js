import * as THREE from 'three'
import { WHITE, seeded, still, textSprite } from './sprites.js'

export const LATTICE_STEP = 2000
export const LATTICE_CELLS = 5
const TICK = 50
const DUST = 1800
export const MOTES = 1400
export const MOTE_INNER = 400
export const MOTE_OUTER = 9000
export const SPECK_BANDS = [
  { size: 12, fade: 1 },
  { size: 22, fade: 0.7 },
  { size: 38, fade: 0.45 },
]

let fineDustOptions = { on: true, strength: 0.2 }
const fineDustMaterials = new Set()

export function moteOpacity({ on, strength } = {}) {
  const value = Number(strength)
  if (!on || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, 0.25 + value * 0.75)
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

export function speckBands(points, bands = SPECK_BANDS.length) {
  const out = Array.from({ length: bands }, () => [])
  points.forEach((point, index) => out[index % bands].push(point))
  return out
}

export function setFineDust(options = {}) {
  fineDustOptions = { ...fineDustOptions, ...options }
  for (const mat of fineDustMaterials) {
    mat.opacity = moteOpacity(fineDustOptions) * (mat.userData.fade ?? 1)
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

  const next = seeded(9001)
  const dust = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: DUST }, () => {
        const direction = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize()
        return direction.multiplyScalar(4500 + next() * 11000)
      })
    ),
    new THREE.PointsMaterial({ color: WHITE, size: 10, map: texture, transparent: true, opacity: 0.45, depthWrite: false })
  )
  group.add(dust)

  const fineDust = new THREE.Group()
  const fineMaterials = speckBands(motePoints()).map((points, index) => {
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
    fineDust.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(points), material))
    return material
  })
  group.add(fineDust)

  scene.add(group)

  function update(delta) {
    if (!still()) {
      dust.rotation.y += delta * 0.004
      fineDust.rotation.y += delta * 0.002
      fineDust.rotation.x += delta * 0.001
    }
  }

  function dispose() {
    for (const material of fineMaterials) fineDustMaterials.delete(material)
    scene.remove(group)
    group.traverse((object) => {
      object.geometry?.dispose()
      if (object.isSprite) object.material.map?.dispose()
      object.material?.dispose?.()
    })
  }

  return { group, update, dispose }
}

