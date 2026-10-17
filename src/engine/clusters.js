import * as THREE from 'three'
import { CELL_H, CELL_W, PLANE_H, PLANE_W } from './layout.js'
import { RED, WHITE, YELLOW, lineMaterial, textSprite } from './sprites.js'

const plane = new THREE.PlaneGeometry(PLANE_W, PLANE_H).rotateX(-Math.PI / 2)
const edges = new THREE.EdgesGeometry(plane)
const DIM = new THREE.Color(0x161616)
const TOUCHED = new THREE.Color(0x303030)
const DONE = new THREE.Color(YELLOW).multiplyScalar(0.62)
const FAILED = new THREE.Color(RED).multiplyScalar(0.8)
const FLASH = { white: new THREE.Color(WHITE), red: new THREE.Color(RED) }
const HIDDEN = 0.001

function outlineGeometry(slots) {
  const source = edges.attributes.position
  const positions = []
  for (const slot of slots) {
    for (let i = 0; i < source.count; i++) {
      positions.push(source.getX(i) + slot.x, source.getY(i) + 0.5, source.getZ(i) + slot.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

function frameGeometry(node) {
  const w = Math.max(1, node.cols) * CELL_W * 0.5 + 24
  const h = Math.max(1, node.rows) * CELL_H * 0.5 + 24
  const points = [new THREE.Vector3(-w, -1, -h), new THREE.Vector3(w, -1, -h), new THREE.Vector3(w, -1, h), new THREE.Vector3(-w, -1, h)]
  return new THREE.BufferGeometry().setFromPoints(points)
}

export function createClusters(scene, layout) {
  const clusters = new Map()
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()

  for (const node of layout.nodes) {
    const group = new THREE.Group()
    group.position.set(node.x, 0, node.z)
    const count = node.files.length

    let mesh = null
    let outline = null
    if (count > 0) {
      mesh = new THREE.InstancedMesh(
        plane,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
        count
      )
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      outline = new THREE.LineSegments(outlineGeometry(node.slots), lineMaterial(WHITE, 0.16))
      group.add(mesh, outline)
    }

    const frame = new THREE.LineLoop(frameGeometry(node), lineMaterial(WHITE, 0.1))
    group.add(frame)

    const title = node.path === '' ? `${node.name}/` : `${node.name}/`
    const label = textSprite(title, { scale: 3.4, color: 'rgba(255,255,255,.85)' })
    label.position.set(0, 90, -(Math.max(1, node.rows) * CELL_H * 0.5 + 70))
    group.add(label)

    scene.add(group)
    clusters.set(node.path, {
      node,
      group,
      mesh,
      outline,
      frame,
      label,
      index: new Map(node.files.map((file, i) => [file, i])),
      flash: new Float32Array(count),
      tone: new Array(count).fill('white'),
      scale: new Float32Array(count).fill(1),
      goal: new Float32Array(count).fill(1),
      openness: 0,
      openGoal: 0,
      pulse: 0,
      pulseTone: 'white',
    })
  }

  function center(path) {
    const cluster = clusters.get(path) ?? clusters.get('')
    return cluster.group.position
  }

  function slotPosition(path, file, out) {
    const cluster = clusters.get(path)
    const slot = cluster?.node.slots[cluster.index.get(file)]
    out.copy(center(path))
    if (slot) {
      out.x += slot.x
      out.z += slot.z
    }
    return out
  }

  function open(path) {
    const cluster = clusters.get(path)
    if (cluster) cluster.openGoal = 1
  }

  function flashFile(dir, file, tone) {
    const cluster = clusters.get(dir)
    if (!cluster) return
    const index = cluster.index.get(file)
    if (index === undefined) return
    cluster.flash[index] = 1
    cluster.tone[index] = tone
    cluster.pulse = 1
    cluster.pulseTone = tone
  }

  function flashCluster(path, tone) {
    const cluster = clusters.get(path)
    if (!cluster) return
    cluster.pulse = 1
    cluster.pulseTone = tone
  }

  function applyMatrix(cluster, index) {
    const slot = cluster.node.slots[index]
    const s = Math.max(HIDDEN, cluster.scale[index])
    matrix.makeScale(s, s, s).setPosition(slot.x, 0, slot.z)
    cluster.mesh.setMatrixAt(index, matrix)
  }

  function sync(state) {
    for (const cluster of clusters.values()) {
      const dir = state.dirs.get(cluster.node.path)
      cluster.openGoal = dir?.opened ? 1 : 0
      cluster.openness = cluster.openGoal
      cluster.pulse = 0
      if (!cluster.mesh) continue
      cluster.node.files.forEach((file, index) => {
        const entry = state.files.get(file)
        cluster.goal[index] = entry?.exists ? 1 : HIDDEN
        cluster.scale[index] = cluster.goal[index]
        cluster.flash[index] = 0
        applyMatrix(cluster, index)
      })
      cluster.mesh.instanceMatrix.needsUpdate = true
    }
  }

  function update(state, delta) {
    for (const cluster of clusters.values()) {
      cluster.openness += (cluster.openGoal - cluster.openness) * Math.min(1, delta * 5)
      cluster.pulse = Math.max(0, cluster.pulse - delta * 1.6)
      const open = cluster.openness
      cluster.group.scale.setScalar(0.9 + 0.1 * open)
      const pulseColor = cluster.pulseTone === 'red' ? RED : WHITE
      cluster.frame.material.opacity = 0.08 + 0.22 * open + cluster.pulse * 0.5
      cluster.frame.material.color.setHex(cluster.pulse > 0.05 ? pulseColor : WHITE)
      cluster.label.material.opacity = 0.28 + 0.62 * open
      if (!cluster.mesh) continue
      cluster.outline.material.opacity = 0.1 + 0.12 * open + cluster.pulse * 0.4
      cluster.outline.material.color.setHex(cluster.pulse > 0.05 ? pulseColor : WHITE)

      let moved = false
      cluster.node.files.forEach((file, index) => {
        const entry = state.files.get(file)
        cluster.goal[index] = entry?.exists ? 1 : HIDDEN
        if (Math.abs(cluster.scale[index] - cluster.goal[index]) > 0.002) {
          cluster.scale[index] += (cluster.goal[index] - cluster.scale[index]) * Math.min(1, delta * 7)
          applyMatrix(cluster, index)
          moved = true
        }
        cluster.flash[index] = Math.max(0, cluster.flash[index] - delta * 1.1)
        if (entry?.failed) color.copy(FAILED)
        else if (entry?.yellow) color.copy(DONE)
        else if (entry && (entry.reads > 0 || entry.writes > 0)) color.copy(TOUCHED)
        else color.copy(DIM)
        if (cluster.flash[index] > 0) color.lerp(FLASH[cluster.tone[index]], cluster.flash[index])
        cluster.mesh.setColorAt(index, color)
      })
      cluster.mesh.instanceColor.needsUpdate = true
      if (moved) cluster.mesh.instanceMatrix.needsUpdate = true
    }
  }

  return { clusters, center, slotPosition, open, flashFile, flashCluster, sync, update }
}
