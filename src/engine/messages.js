import * as THREE from 'three'
import { WHITE, YELLOW, still } from './sprites.js'

export const MESSAGE_PACKETS = 6
export const MESSAGE_DURATION = 600
export const MESSAGE_GAP = 60
export const MESSAGE_POOL = 48
export const MESSAGE_SIZE = 3
export const MESSAGE_LIFE = (MESSAGE_PACKETS - 1) * MESSAGE_GAP + MESSAGE_DURATION
const MAX_SENDS = Math.floor(MESSAGE_POOL / MESSAGE_PACKETS)

export function messageColor(kind) {
  return kind === 'dispatch' ? YELLOW : WHITE
}

export function messageSpots(from, to, startedAt, now, out = []) {
  const spots = out ?? []
  const start = Number(startedAt)
  const time = Number(now)
  const ax = Number(from?.x)
  const ay = Number(from?.y)
  const az = Number(from?.z)
  const bx = Number(to?.x)
  const by = Number(to?.y)
  const bz = Number(to?.z)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(time) ||
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(az) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by) ||
    !Number.isFinite(bz)
  ) {
    spots.length = 0
    return spots
  }
  let count = 0
  for (let index = 0; index < MESSAGE_PACKETS; index += 1) {
    const age = time - (start + index * MESSAGE_GAP)
    if (age < 0 || age > MESSAGE_DURATION) continue
    const share = age / MESSAGE_DURATION
    const spot = spots[count] ?? (spots[count] = { x: 0, y: 0, z: 0 })
    spot.x = ax + (bx - ax) * share
    spot.y = ay + (by - ay) * share
    spot.z = az + (bz - az) * share
    count += 1
  }
  spots.length = count
  return spots
}

export function createMessages(scene, { viewOf = () => null, reduced = still, clock = () => performance.now() } = {}) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(MESSAGE_POOL * 3)
  const colors = new Float32Array(MESSAGE_POOL * 3)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setDrawRange(0, 0)
  const material = new THREE.PointsMaterial({
    color: WHITE,
    size: MESSAGE_SIZE,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.visible = false
  scene.add(points)

  const sends = []
  const scratch = []
  const tint = new THREE.Color()

  function note(activity) {
    if (!activity || activity.type !== 'agent.message') return false
    if (typeof activity.to !== 'string' || activity.to === '') return false
    if (reduced()) return false
    const from = viewOf(activity.agent)
    const to = viewOf(activity.to)
    if (!from || !to) return false
    sends.push({
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: to.x, y: to.y, z: to.z },
      startedAt: clock(),
      color: messageColor(activity.kind),
    })
    if (sends.length > MAX_SENDS) sends.shift()
    return true
  }

  function update(now) {
    let count = 0
    if (reduced()) {
      sends.length = 0
    } else {
      for (let index = sends.length - 1; index >= 0; index -= 1) {
        const send = sends[index]
        const spots = messageSpots(send.from, send.to, send.startedAt, now, scratch)
        tint.setHex(send.color)
        for (let spot = 0; spot < spots.length && count < MESSAGE_POOL; spot += 1) {
          positions[count * 3] = spots[spot].x
          positions[count * 3 + 1] = spots[spot].y
          positions[count * 3 + 2] = spots[spot].z
          colors[count * 3] = tint.r
          colors[count * 3 + 1] = tint.g
          colors[count * 3 + 2] = tint.b
          count += 1
        }
      }
      for (let index = sends.length - 1; index >= 0; index -= 1) {
        if (now - sends[index].startedAt > MESSAGE_LIFE) sends.splice(index, 1)
      }
    }
    geometry.setDrawRange(0, count)
    points.visible = count > 0
    if (count > 0) {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    }
  }

  function dispose() {
    scene.remove(points)
    geometry.dispose()
    material.dispose()
    sends.length = 0
  }

  return { note, update, dispose, points }
}
