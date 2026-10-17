import * as THREE from 'three'
import { WHITE, lineMaterial } from './sprites.js'

const SEGMENTS = 16
const SAG = 0.12
const SAG_MAX = 520
export const STRING_LIFT = 30

export function curvePoint(a, b, t, out) {
  out.lerpVectors(a, b, t)
  out.y -= Math.min(SAG_MAX, a.distanceTo(b) * SAG) * 4 * t * (1 - t)
  return out
}

export function createStrings(scene) {
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  let line = null
  let ends = []

  function dispose() {
    if (!line) return
    scene.remove(line)
    line.geometry.dispose()
    line.material.dispose()
    line = null
  }

  function update(centerOf) {
    if (!line) return
    const array = line.geometry.attributes.position.array
    let k = 0
    for (const link of ends) {
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
    }
    line.geometry.attributes.position.needsUpdate = true
  }

  function build(links, centerOf) {
    dispose()
    ends = [{ from: null, to: '' }, ...links]
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ends.length * SEGMENTS * 6), 3))
    line = new THREE.LineSegments(geometry, lineMaterial(WHITE, 0.22))
    line.frustumCulled = false
    scene.add(line)
    update(centerOf)
  }

  return { build, update, dispose }
}
