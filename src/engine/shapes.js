import * as THREE from 'three'

export const PREFERRED = { claude: 'compound', hermes: 'knot', opencode: 'stella', agy: 'geodesic' }
export const ORCHESTRATOR_SHAPE = 'armillary'
export const SPARE = ['shells', 'knot35', 'helix', 'prism']
export const SHAPE_NAMES = ['compound', 'knot', 'stella', 'geodesic', ORCHESTRATOR_SHAPE, ...SPARE]

const ORCHESTRATOR = /orchestrat/i

export function isOrchestrator(agent) {
  if (!agent) return false
  if (agent.orchestrator === true || agent.role === 'ceo') return true
  return ORCHESTRATOR.test(String(agent.name ?? '')) || ORCHESTRATOR.test(String(agent.key ?? ''))
}

export function shapesFor(roster) {
  const used = new Set()
  const names = roster.map((agent) => {
    const kind = agent.shape ?? agent.parser ?? agent.key
    const wanted = isOrchestrator(agent) && !used.has(ORCHESTRATOR_SHAPE) ? ORCHESTRATOR_SHAPE : Object.hasOwn(PREFERRED, kind) ? PREFERRED[kind] : null
    if (wanted && !used.has(wanted)) {
      used.add(wanted)
      return wanted
    }
    return null
  })
  return names.map((name, index) => {
    if (name) return name
    const spare = SHAPE_NAMES.find((candidate) => candidate !== ORCHESTRATOR_SHAPE && !used.has(candidate))
    const chosen = spare ?? SPARE[index % SPARE.length]
    used.add(chosen)
    return chosen
  })
}

function edges(geometry, out, rotation = null) {
  const lines = new THREE.EdgesGeometry(geometry)
  if (rotation) lines.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation))
  out.push(...lines.attributes.position.array)
  lines.dispose()
  geometry.dispose()
}

function polyline(points, out, closed = false) {
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
}

function circle(radius, rotation, out, steps = 64, lift = 0) {
  const matrix = new THREE.Matrix4().makeRotationFromEuler(rotation)
  const points = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2
    const point = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0).applyMatrix4(matrix)
    point.y += lift
    return point
  })
  polyline(points, out, true)
}

function knot(p, q, radius, tube, out, steps = 160) {
  const point = (t) => {
    const r = radius * (0.62 + 0.38 * Math.cos(q * t))
    return new THREE.Vector3(r * Math.cos(p * t), r * Math.sin(p * t), radius * 0.38 * Math.sin(q * t))
  }
  for (const phase of [0, 1, 2]) {
    const points = Array.from({ length: steps }, (_, i) => {
      const t = (i / steps) * Math.PI * 2
      const base = point(t)
      const ahead = point(t + 0.01).sub(base).normalize()
      const side = new THREE.Vector3(0, 0, 1).cross(ahead).normalize()
      const lift = ahead.clone().cross(side).normalize()
      const angle = (phase / 3) * Math.PI * 2 + t * 3
      return base.add(side.multiplyScalar(Math.cos(angle) * tube)).add(lift.multiplyScalar(Math.sin(angle) * tube))
    })
    polyline(points, out, true)
  }
}

const BUILDERS = {
  compound(out) {
    edges(new THREE.IcosahedronGeometry(92, 0), out)
    edges(new THREE.DodecahedronGeometry(64, 0), out, new THREE.Euler(0.4, 0.3, 0))
  },
  knot(out) {
    knot(2, 3, 78, 9, out)
  },
  stella(out) {
    edges(new THREE.TetrahedronGeometry(98, 0), out)
    edges(new THREE.TetrahedronGeometry(98, 0), out, new THREE.Euler(0, Math.PI / 2, 0))
    edges(new THREE.OctahedronGeometry(38, 0), out)
  },
  geodesic(out) {
    edges(new THREE.IcosahedronGeometry(86, 1), out)
    edges(new THREE.BoxGeometry(56, 56, 56), out, new THREE.Euler(0.6, 0.6, 0))
  },
  armillary(out) {
    circle(96, new THREE.Euler(0, 0, 0), out)
    circle(96, new THREE.Euler(Math.PI / 2, 0, 0), out)
    circle(96, new THREE.Euler(0, Math.PI / 2, 0), out)
    circle(78, new THREE.Euler(Math.PI / 2 + 0.41, 0, 0.3), out)
    edges(new THREE.OctahedronGeometry(30, 0), out)
    out.push(0, -128, 0, 0, 128, 0)
  },
  shells(out) {
    edges(new THREE.TetrahedronGeometry(96, 0), out)
    edges(new THREE.OctahedronGeometry(70, 0), out, new THREE.Euler(0.3, 0.5, 0))
    edges(new THREE.BoxGeometry(56, 56, 56), out, new THREE.Euler(0.2, 0.9, 0.4))
  },
  knot35(out) {
    knot(3, 5, 74, 7, out, 220)
  },
  helix(out) {
    for (const phase of [0, Math.PI]) {
      const points = Array.from({ length: 96 }, (_, i) => {
        const t = i / 95
        const angle = phase + t * Math.PI * 6
        return new THREE.Vector3(Math.cos(angle) * 54, (t - 0.5) * 190, Math.sin(angle) * 54)
      })
      polyline(points, out)
    }
    for (const y of [-95, 0, 95]) circle(70, new THREE.Euler(Math.PI / 2, 0, 0), out, 48, y)
  },
  prism(out) {
    edges(new THREE.CylinderGeometry(70, 70, 160, 6, 1), out)
    edges(new THREE.CylinderGeometry(40, 40, 110, 3, 1), out, new THREE.Euler(0, 0.5, 0))
  },
}

export function shapeGeometry(name) {
  const out = []
  ;(Object.hasOwn(BUILDERS, name) ? BUILDERS[name] : BUILDERS.compound)(out)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  return geometry
}
