import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { HUB_CENTER, ORCHESTRATOR_HOME } from './hub.js'
import { RED, WEB, easeRate, seeded, still, textSprite } from './sprites.js'

export const INTERNET_RADIUS = 260
export const INTERNET_LIFT = 720
export const INTERNET_HOME = new THREE.Vector3(HUB_CENTER.x, ORCHESTRATOR_HOME.y + INTERNET_LIFT, HUB_CENTER.z)
export const INTERNET_LABEL = 'INTERNET'
export const INTERNET_OFF_LABEL = 'NO CONNECTION'
export const INTERNET_OFF_COLOR = RED
export const INTERNET_SEED = 20261025
export const MORPH_SWING = 0.11
export const MORPH_RATE = 0.8
export const BASE_OPACITY = 0.08
export const GLOW_OPACITY = 0.62
export const HALO_OPACITY = 0.35
export const LABEL_REST = 0.3
export const TURN_RATE = 0.05

export function morphOffsets(seed, count, time, rate = MORPH_RATE) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  const offsets = []
  if (total === 0) return offsets
  const random = seeded(Math.floor(Number(seed) || 0))
  const clock = Number.isFinite(Number(time)) ? Number(time) : 0
  const speed = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : MORPH_RATE
  for (let index = 0; index < total; index += 1) {
    const phase = random() * Math.PI * 2
    const swing = 0.55 + random() * 0.45
    offsets.push(Math.sin(clock * speed + phase) * swing)
  }
  return offsets
}

export function createInternet(scene, texture = null) {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(INTERNET_RADIUS, 2))
  const base = Float32Array.from(geometry.attributes.position.array)
  const material = new THREE.MeshBasicMaterial({
    color: WEB,
    wireframe: true,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const shape = new THREE.Mesh(geometry, material)
  shape.frustumCulled = false

  const group = new THREE.Group()
  group.name = 'internet'
  group.position.copy(INTERNET_HOME)
  group.add(shape)

  const label = textSprite(INTERNET_LABEL, { scale: 1.1, color: 'rgba(255,255,255,.55)' })
  label.name = 'internet-label'
  label.position.set(0, -INTERNET_RADIUS - 90, 0)
  group.add(label)

  const labelOff = textSprite(INTERNET_OFF_LABEL, { scale: 1.1, color: 'rgba(255,42,42,.9)' })
  labelOff.name = 'internet-label-off'
  labelOff.position.copy(label.position)
  labelOff.userData.text = INTERNET_OFF_LABEL
  labelOff.visible = false
  group.add(labelOff)

  let halo = null
  if (texture) {
    halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, color: WEB, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    halo.scale.set(INTERNET_RADIUS * 4.2, INTERNET_RADIUS * 4.2, 1)
    group.add(halo)
  }

  scene.add(group)

  const attribute = geometry.attributes.position
  const array = attribute.array
  const phases = new Float64Array(attribute.count)
  const swings = new Float64Array(attribute.count)
  const random = seeded(INTERNET_SEED)
  for (let index = 0; index < attribute.count; index += 1) {
    phases[index] = random() * Math.PI * 2
    swings[index] = 0.55 + random() * 0.45
  }
  let elapsed = 0
  let glow = 0
  let frozen = false
  let online = true

  function setOnline(next) {
    const value = next !== false
    if (value === online) return online
    online = value
    material.color.setHex(online ? WEB : INTERNET_OFF_COLOR)
    if (halo) halo.material.color.setHex(online ? WEB : INTERNET_OFF_COLOR)
    label.visible = online
    labelOff.visible = !online
    return online
  }

  function apply(time) {
    const clock = Number.isFinite(Number(time)) ? Number(time) : 0
    for (let index = 0; index < attribute.count; index += 1) {
      const factor = 1 + Math.sin(clock * MORPH_RATE + phases[index]) * swings[index] * MORPH_SWING
      array[index * 3] = base[index * 3] * factor
      array[index * 3 + 1] = base[index * 3 + 1] * factor
      array[index * 3 + 2] = base[index * 3 + 2] * factor
    }
    attribute.needsUpdate = true
  }

  function update(delta, active = false) {
    const isStill = still()
    const step = Number.isFinite(Number(delta)) ? Math.max(0, Number(delta)) : 0
    glow += ((active ? 1 : 0) - glow) * easeRate(step, 2.4, isStill)
    material.opacity = BASE_OPACITY + glow * GLOW_OPACITY
    if (halo) halo.material.opacity = glow * HALO_OPACITY
    label.material.opacity = LABEL_REST + glow * (1 - LABEL_REST)
    labelOff.material.opacity = LABEL_REST + glow * (1 - LABEL_REST)
    if (isStill) {
      if (!frozen) {
        frozen = true
        apply(0)
      }
      return
    }
    frozen = false
    elapsed += step
    apply(elapsed)
    group.rotation.y += step * TURN_RATE
  }

  function dispose() {
    scene.remove(group)
    group.traverse((object) => {
      object.geometry?.dispose()
      object.material?.map?.dispose()
      object.material?.dispose()
    })
  }

  return { group, position: group.position, radius: INTERNET_RADIUS, update, dispose, glow: () => glow, setOnline, online: () => online, label, labelOff }
}
