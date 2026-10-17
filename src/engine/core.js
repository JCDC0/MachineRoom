import * as THREE from 'three'
import { WHITE, YELLOW, lineMaterial, seeded } from './sprites.js'

export const CORE_RADIUS = 300

export function createCore(scene, texture) {
  const next = seeded(2215)
  const points = []
  const surface = 360
  for (let i = 0; i < surface; i++) {
    const y = 1 - (i / (surface - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = i * 2.399963
    points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(CORE_RADIUS))
  }
  for (let i = 0; i < 200; i++) {
    const direction = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize()
    points.push(direction.multiplyScalar(CORE_RADIUS * 0.92 * Math.cbrt(next())))
  }

  const segments = []
  const seen = new Set()
  points.forEach((point, i) => {
    points
      .map((other, j) => ({ j, d: point.distanceToSquared(other) }))
      .filter((entry) => entry.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (seen.has(key)) return
        seen.add(key)
        segments.push(point.x, point.y, point.z, points[j].x, points[j].y, points[j].z)
      })
  })

  const group = new THREE.Group()
  const linkGeometry = new THREE.BufferGeometry()
  linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
  group.add(new THREE.LineSegments(linkGeometry, lineMaterial(WHITE, 0.2)))

  const dots = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.PointsMaterial({
      color: WHITE,
      size: 8,
      map: texture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  group.add(dots)

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: 0xfff4d6,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  glow.scale.set(1000, 1000, 1)
  group.add(glow)

  const ringGroup = new THREE.Group()
  const rings = [390, 460].map((radius, index) => {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius)
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(96)),
      lineMaterial(index === 1 ? YELLOW : WHITE, index === 1 ? 0.18 : 0.12)
    )
    ring.rotation.set(Math.PI / 2 + index * 0.5, index * 0.7, 0)
    ringGroup.add(ring)
    return ring
  })

  scene.add(group, ringGroup)

  function pulse(color, amount) {
    glow.material.color.setHex(color)
    glow.userData.boost = amount
  }

  function update(time, delta) {
    const boost = glow.userData.boost ?? 0
    glow.userData.boost = Math.max(0, boost - delta * 1.2)
    glow.material.opacity = 0.26 + glow.userData.boost * 0.4
    if (glow.userData.boost <= 0.01) glow.material.color.setHex(0xfff4d6)
    group.rotation.y += delta * 0.05
    ringGroup.rotation.y -= delta * 0.06
    rings.forEach((ring, index) => {
      ring.rotation.z += delta * (0.05 + index * 0.03)
    })
    const heart = Math.pow(Math.max(0, Math.sin(time * 2.4)), 8)
    group.scale.setScalar(1 + heart * 0.03)
  }

  return { group, pulse, update }
}
