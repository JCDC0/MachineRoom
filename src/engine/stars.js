import * as THREE from 'three'
import { lineParentKey, polylineLengths, samplePolyline, speckPolyline } from './agents.js'
import { WHITE, glowTexture } from './sprites.js'

export const STAR_POOL = 48
export const STAR_SPEED = 1800
export const STAR_MIN_SECONDS = 0.25
export const STAR_MAX_SECONDS = 0.9
export const STAR_CORE_PIXELS = 22
export const STAR_HALO_PIXELS = 40
export const STAR_HALO_OPACITY = 0.35
export const STAR_LABEL_LIFT = 24

const MESSAGE_STAR_KINDS = new Set(['order', 'report', 'wake'])

export function agentStar(activity, ladder) {
  if (!activity || typeof activity !== 'object') return null
  const agent = typeof activity.agent === 'string' ? activity.agent : ''
  if (activity.type === 'run.start') {
    if (agent === '') return null
    const from = lineParentKey(agent, ladder)
    return from === agent ? null : { from, to: agent }
  }
  if (activity.type === 'agent.spawn') {
    const child = typeof activity.child === 'string' ? activity.child : ''
    return agent === '' || child === '' ? null : { from: agent, to: child }
  }
  if (activity.type === 'agent.message') {
    const to = typeof activity.to === 'string' ? activity.to : ''
    if (agent === '' || to === '' || !MESSAGE_STAR_KINDS.has(activity.kind)) return null
    return { from: agent, to }
  }
  return null
}

export function starDuration(length) {
  const value = Number(length)
  if (!Number.isFinite(value) || value <= 0) return STAR_MIN_SECONDS
  return Math.min(STAR_MAX_SECONDS, Math.max(STAR_MIN_SECONDS, value / STAR_SPEED))
}

export function starEase(share) {
  const value = Number(share)
  const t = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return 1 - Math.pow(1 - t, 3)
}

export function starPoint(points, share, out = {}, lengths = null) {
  return samplePolyline(points, starEase(share), out, lengths)
}

export function starAdvance(age, delta, speed) {
  const current = Number.isFinite(Number(age)) ? Math.max(0, Number(age)) : 0
  const step = Number(delta)
  const rate = Number(speed)
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(rate) || rate <= 0) return current
  return current + step * rate
}

export function touchLabelPoint(anchor, out = {}) {
  const x = Number(anchor?.x)
  const y = Number(anchor?.y)
  const z = Number(anchor?.z)
  out.x = Number.isFinite(x) ? x : 0
  out.y = Number.isFinite(y) ? y + STAR_LABEL_LIFT : STAR_LABEL_LIFT
  out.z = Number.isFinite(z) ? z : 0
  return out
}

export function starSlot(stars) {
  const list = Array.isArray(stars) ? stars : []
  let oldest = -1
  let oldestStart = Infinity
  for (let index = 0; index < list.length; index += 1) {
    const star = list[index]
    if (!star || star.active !== true) return index
    const start = Number(star.start)
    if (Number.isFinite(start) && start < oldestStart) {
      oldest = index
      oldestStart = start
    }
  }
  return oldest
}

export function starRoute(centre, chain, anchorOf, end, out = []) {
  return speckPolyline(centre, chain, anchorOf, end, out)
}

function starTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  const centre = size / 2
  context.translate(centre, centre)
  context.globalCompositeOperation = 'lighter'

  const ray = (angle) => {
    context.save()
    context.rotate(angle)
    const gradient = context.createLinearGradient(0, 0, centre, 0)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(0, -2.5)
    context.lineTo(centre, 0)
    context.lineTo(0, 2.5)
    context.closePath()
    context.fill()
    context.restore()
  }

  for (let index = 0; index < 4; index += 1) ray((index * Math.PI) / 2)

  const core = context.createRadialGradient(0, 0, 0, 0, 0, 9)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.5, 'rgba(255,255,255,.7)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = core
  context.beginPath()
  context.arc(0, 0, 9, 0, Math.PI * 2)
  context.fill()

  return new THREE.CanvasTexture(canvas)
}

export function createStars(scene) {
  const coreTexture = starTexture()
  const haloTexture = glowTexture()
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(STAR_POOL * 3)
  const colors = new Float32Array(STAR_POOL * 3)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setDrawRange(0, 0)

  const coreMaterial = new THREE.PointsMaterial({
    map: coreTexture,
    color: WHITE,
    size: STAR_CORE_PIXELS,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const haloMaterial = new THREE.PointsMaterial({
    map: haloTexture,
    color: WHITE,
    size: STAR_HALO_PIXELS,
    sizeAttenuation: false,
    transparent: true,
    opacity: STAR_HALO_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  })

  const core = new THREE.Points(geometry, coreMaterial)
  const halo = new THREE.Points(geometry, haloMaterial)
  core.frustumCulled = false
  halo.frustumCulled = false
  core.visible = false
  halo.visible = false
  core.renderOrder = 1
  halo.renderOrder = 0
  scene.add(halo, core)

  const pool = Array.from({ length: STAR_POOL }, () => ({
    active: false,
    start: 0,
    age: 0,
    duration: STAR_MIN_SECONDS,
    points: [],
    lengths: [],
    r: 1,
    g: 1,
    b: 1,
    onLand: null,
    agent: null,
    call: null,
    follow: null,
    point: { x: 0, y: 0, z: 0 },
  }))
  const tint = new THREE.Color()
  let sequence = 0

  function dropAt(star) {
    star.active = false
    star.age = 0
    star.onLand = null
    star.agent = null
    star.call = null
    star.follow = null
  }

  function landAt(star) {
    const onLand = star.onLand
    dropAt(star)
    if (onLand) onLand()
  }

  function launch({ points, color = WHITE, onLand = null, agent = null, call = null, follow = null } = {}) {
    const list = Array.isArray(points) ? points : []
    if (list.length === 0) return false
    const index = starSlot(pool)
    if (index < 0) return false
    const star = pool[index]
    if (star.active) landAt(star)
    star.points.length = list.length
    for (let at = 0; at < list.length; at += 1) {
      const source = list[at]
      const point = star.points[at] ?? (star.points[at] = { x: 0, y: 0, z: 0 })
      point.x = source.x
      point.y = source.y
      point.z = source.z
    }
    polylineLengths(star.points, star.lengths)
    const total = star.lengths[star.lengths.length - 1] ?? 0
    star.duration = starDuration(total)
    star.age = 0
    star.start = (sequence += 1)
    tint.setHex(color)
    star.r = tint.r
    star.g = tint.g
    star.b = tint.b
    star.onLand = typeof onLand === 'function' ? onLand : null
    star.agent = typeof agent === 'string' ? agent : null
    star.call = typeof call === 'string' ? call : null
    star.follow = typeof follow === 'function' ? follow : null
    star.active = true
    return true
  }

  function cancel(test) {
    if (typeof test !== 'function') return 0
    let dropped = 0
    for (const star of pool) {
      if (!star.active || !test(star)) continue
      dropAt(star)
      dropped += 1
    }
    return dropped
  }

  function land(test) {
    if (typeof test !== 'function') return 0
    let landed = 0
    for (const star of pool) {
      if (!star.active || !test(star)) continue
      landAt(star)
      landed += 1
    }
    return landed
  }

  function update(delta, speed = 1) {
    let count = 0
    for (const star of pool) {
      if (!star.active) continue
      if (star.follow) {
        const end = star.points[star.points.length - 1]
        const next = star.follow(end)
        if (next === null || next === false) {
          dropAt(star)
          continue
        }
        if (next && next !== end) {
          end.x = next.x
          end.y = next.y
          end.z = next.z
        }
        polylineLengths(star.points, star.lengths)
        const total = star.lengths[star.lengths.length - 1] ?? 0
        star.duration = starDuration(total)
      }
      star.age = starAdvance(star.age, delta, speed)
      const share = star.duration > 0 ? star.age / star.duration : 1
      if (share >= 1) {
        landAt(star)
        continue
      }
      starPoint(star.points, share, star.point, star.lengths)
      const base = count * 3
      positions[base] = star.point.x
      positions[base + 1] = star.point.y
      positions[base + 2] = star.point.z
      colors[base] = star.r
      colors[base + 1] = star.g
      colors[base + 2] = star.b
      count += 1
    }
    geometry.setDrawRange(0, count)
    const visible = count > 0
    core.visible = visible
    halo.visible = visible
    if (visible) {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    }
  }

  function reset() {
    for (const star of pool) dropAt(star)
    geometry.setDrawRange(0, 0)
    core.visible = false
    halo.visible = false
  }

  function dispose() {
    scene.remove(halo, core)
    geometry.dispose()
    coreMaterial.dispose()
    haloMaterial.dispose()
    coreTexture.dispose()
    haloTexture.dispose()
  }

  return { launch, update, cancel, land, reset, dispose }
}
