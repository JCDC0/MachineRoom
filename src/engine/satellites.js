import * as THREE from 'three'
import { INTERNET_HOME } from './internet.js'
import { WEB, WHITE, easeRate, lineMaterial, seeded, still, textSprite } from './sprites.js'

export const BROWSER_OFFSET = new THREE.Vector3(540, 30, -80)
export const BROWSER_HOME = INTERNET_HOME.clone().add(BROWSER_OFFSET)
export const BROWSER_WIDTH = 220
export const BROWSER_HEIGHT = 150
export const BROWSER_RADIUS = 110
export const BROWSER_BOB_AMP = 18
export const BROWSER_BOB_RATE = 1.1
export const BROWSER_YAW = 0.25
export const BROWSER_TRACE_SECONDS = 0.6
export const BROWSER_BASE_OPACITY = 0.45
export const BROWSER_ACTIVE_OPACITY = 0.85

export const MAX_MCP_NODES = 12
export const MCP_NODE_RADIUS = 38
export const MCP_TRACE_SECONDS = 0.45
export const MCP_ORBIT_MIN = 340
export const MCP_ORBIT_MAX = 410
export const MCP_BASE_OPACITY = 0.35
export const MCP_ACTIVE_OPACITY = 0.85
const MCP_LABEL_SCALE = 0.85
const MCP_LABEL_COLOR = 'rgba(255,255,255,.7)'

function hashServer(name) {
  let hash = 2166136261
  const text = String(name ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) || 1
}

export function browserBobY(time, baseY = BROWSER_HOME.y, reduced = false) {
  const base = Number.isFinite(Number(baseY)) ? Number(baseY) : BROWSER_HOME.y
  if (reduced) return base
  const clock = Number.isFinite(Number(time)) ? Number(time) : 0
  return base + Math.sin(clock * BROWSER_BOB_RATE) * BROWSER_BOB_AMP
}

export function mcpOrbitParams(server) {
  const random = seeded(hashServer(server))
  return {
    radius: MCP_ORBIT_MIN + random() * (MCP_ORBIT_MAX - MCP_ORBIT_MIN),
    phase: random() * Math.PI * 2,
    speed: 0.08 + random() * 0.06,
    tiltX: (random() - 0.5) * 0.65,
    tiltZ: (random() - 0.5) * 0.55,
    yLift: (random() - 0.5) * 80,
  }
}

export function mcpOrbitPoint(params, time, center = INTERNET_HOME, out = { x: 0, y: 0, z: 0 }, reduced = false) {
  const target = out ?? { x: 0, y: 0, z: 0 }
  const clock = reduced || !Number.isFinite(Number(time)) ? 0 : Number(time)
  const radius = Number.isFinite(Number(params?.radius)) ? Number(params.radius) : MCP_ORBIT_MIN
  const phase = Number.isFinite(Number(params?.phase)) ? Number(params.phase) : 0
  const speed = Number.isFinite(Number(params?.speed)) ? Number(params.speed) : 0.1
  const tiltX = Number.isFinite(Number(params?.tiltX)) ? Number(params.tiltX) : 0
  const tiltZ = Number.isFinite(Number(params?.tiltZ)) ? Number(params.tiltZ) : 0
  const yLift = Number.isFinite(Number(params?.yLift)) ? Number(params.yLift) : 0
  const angle = phase + clock * speed

  const x0 = Math.cos(angle) * radius
  const z0 = Math.sin(angle) * radius
  const cosX = Math.cos(tiltX)
  const sinX = Math.sin(tiltX)
  const y1 = yLift * cosX - z0 * sinX
  const z1 = yLift * sinX + z0 * cosX
  const cosZ = Math.cos(tiltZ)
  const sinZ = Math.sin(tiltZ)
  const x2 = x0 * cosZ - y1 * sinZ
  const y2 = x0 * sinZ + y1 * cosZ

  target.x = (Number(center?.x) || 0) + x2
  target.y = (Number(center?.y) || 0) + y2
  target.z = (Number(center?.z) || 0) + z1
  return target
}

function pushSegment(out, x0, y0, x1, y1) {
  out.push(x0, y0, 0, x1, y1, 0)
}

function pushRect(out, x0, y0, x1, y1) {
  pushSegment(out, x0, y0, x1, y0)
  pushSegment(out, x1, y0, x1, y1)
  pushSegment(out, x1, y1, x0, y1)
  pushSegment(out, x0, y1, x0, y0)
}

export function browserWindowSegments(width = BROWSER_WIDTH, height = BROWSER_HEIGHT) {
  const hw = width / 2
  const hh = height / 2
  const barY = hh - 28
  const dotY = hh - 14
  const points = []
  pushRect(points, -hw, -hh, hw, hh)
  pushSegment(points, -hw, barY, hw, barY)
  for (let index = 0; index < 3; index += 1) {
    const cx = -hw + 16 + index * 16
    pushRect(points, cx - 3, dotY - 3, cx + 3, dotY + 3)
  }
  pushSegment(points, -hw + 64, dotY, hw - 16, dotY)
  pushSegment(points, -hw + 20, barY - 24, hw - 44, barY - 24)
  pushSegment(points, -hw + 20, barY - 46, hw - 22, barY - 46)
  pushSegment(points, -hw + 20, barY - 68, hw - 58, barY - 68)
  pushSegment(points, -hw + 20, barY - 90, hw - 36, barY - 90)
  return new Float32Array(points)
}

export function browserOutlineAt(position, rotationY = BROWSER_YAW, width = BROWSER_WIDTH, height = BROWSER_HEIGHT, out = []) {
  const target = Array.isArray(out) ? out : []
  const hw = width / 2
  const hh = height / 2
  const px = Number(position?.x) || 0
  const py = Number(position?.y) || 0
  const pz = Number(position?.z) || 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const corners = [
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ]
  for (let index = 0; index < corners.length; index += 1) {
    const [lx, ly] = corners[index]
    const point = target[index] ?? (target[index] = { x: 0, y: 0, z: 0 })
    point.x = px + lx * cos
    point.y = py + ly
    point.z = pz - lx * sin
  }
  target.length = corners.length
  return target
}

export function mcpNodeOutlineAt(position, radius = MCP_NODE_RADIUS, out = []) {
  const target = Array.isArray(out) ? out : []
  const px = Number(position?.x) || 0
  const py = Number(position?.y) || 0
  const pz = Number(position?.z) || 0
  const r = Number.isFinite(Number(radius)) ? Number(radius) : MCP_NODE_RADIUS
  const offsets = [
    [r, 0, 0],
    [0, 0, r],
    [-r, 0, 0],
    [0, 0, -r],
  ]
  for (let index = 0; index < offsets.length; index += 1) {
    const [dx, dy, dz] = offsets[index]
    const point = target[index] ?? (target[index] = { x: 0, y: 0, z: 0 })
    point.x = px + dx
    point.y = py + dy
    point.z = pz + dz
  }
  target.length = offsets.length
  return target
}

export function createSatellites(scene) {
  const group = new THREE.Group()
  group.name = 'satellites'
  scene.add(group)

  const browserGeometry = new THREE.BufferGeometry()
  browserGeometry.setAttribute('position', new THREE.BufferAttribute(browserWindowSegments(), 3))
  const browserMaterial = lineMaterial(WEB, 0)
  const browserWire = new THREE.LineSegments(browserGeometry, browserMaterial)
  browserWire.frustumCulled = false

  const browserGroup = new THREE.Group()
  browserGroup.name = 'browser'
  browserGroup.position.copy(BROWSER_HOME)
  browserGroup.rotation.y = BROWSER_YAW
  browserGroup.add(browserWire)
  browserGroup.visible = false
  group.add(browserGroup)

  const mcpGroup = new THREE.Group()
  mcpGroup.name = 'mcp-servers'
  group.add(mcpGroup)

  const nodes = new Map()
  const browserActiveCalls = new Set()
  let browserSeen = false
  let browserTraced = false
  let browserReveal = 0
  let browserGlow = 0
  let browserElapsed = 0
  let mcpElapsed = 0

  function applyBrowserVisual() {
    const activeOpacity = BROWSER_BASE_OPACITY + browserGlow * (BROWSER_ACTIVE_OPACITY - BROWSER_BASE_OPACITY)
    browserMaterial.opacity = browserReveal * activeOpacity
    browserGroup.visible = browserSeen && browserReveal > 0
  }

  function applyNodeVisual(node) {
    const activeOpacity = MCP_BASE_OPACITY + node.glow * (MCP_ACTIVE_OPACITY - MCP_BASE_OPACITY)
    node.wire.material.opacity = node.reveal * activeOpacity
    node.label.material.opacity = node.reveal * (0.55 + node.glow * 0.45)
    node.group.visible = node.reveal > 0
  }

  function disposeNode(node) {
    mcpGroup.remove(node.group)
    node.wire.geometry.dispose()
    node.wire.material.dispose()
    node.label.material.map?.dispose()
    node.label.material.dispose()
  }

  function prepareBrowser(callKey = null) {
    const isNew = !browserSeen
    browserSeen = true
    if (callKey !== null && callKey !== undefined) browserActiveCalls.add(callKey)
    if (still() && browserReveal < 1) browserReveal = 1
    applyBrowserVisual()
    return { isNew }
  }

  function claimBrowserTrace() {
    if (browserTraced) return false
    browserTraced = true
    return true
  }

  function revealBrowser(share = 1) {
    browserSeen = true
    browserReveal = Math.min(1, Math.max(0, Number(share) || 0))
    applyBrowserVisual()
    return browserReveal
  }

  function browserAnchor(out = new THREE.Vector3()) {
    out.x = browserGroup.position.x
    out.y = browserGroup.position.y
    out.z = browserGroup.position.z
    return out
  }

  function browserOutline(out = []) {
    if (!browserSeen) return null
    return browserOutlineAt(browserGroup.position, browserGroup.rotation.y, BROWSER_WIDTH, BROWSER_HEIGHT, out)
  }

  function useMcp(server, callKey = null) {
    const name = typeof server === 'string' ? server.trim() : ''
    if (name === '') return { node: null, isNew: false }
    let node = nodes.get(name)
    const isNew = !node
    if (node) {
      nodes.delete(name)
      nodes.set(name, node)
    } else {
      if (nodes.size >= MAX_MCP_NODES) {
        const oldestKey = nodes.keys().next().value
        const oldest = nodes.get(oldestKey)
        if (oldest) disposeNode(oldest)
        nodes.delete(oldestKey)
      }
      const params = mcpOrbitParams(name)
      const nodeGroup = new THREE.Group()
      nodeGroup.name = `mcp-${name}`
      const octahedron = new THREE.OctahedronGeometry(MCP_NODE_RADIUS, 0)
      const edges = new THREE.EdgesGeometry(octahedron)
      octahedron.dispose()
      const wire = new THREE.LineSegments(edges, lineMaterial(WHITE, 0))
      wire.frustumCulled = false
      const label = textSprite(name, { scale: MCP_LABEL_SCALE, color: MCP_LABEL_COLOR })
      label.position.set(0, -MCP_NODE_RADIUS - 26, 0)
      nodeGroup.add(wire, label)
      const isStill = still()
      mcpOrbitPoint(params, isStill ? 0 : mcpElapsed, INTERNET_HOME, nodeGroup.position, isStill)
      node = {
        server: name,
        group: nodeGroup,
        wire,
        label,
        params,
        reveal: isStill ? 1 : 0,
        glow: 0,
        traced: false,
        activeCalls: new Set(),
      }
      applyNodeVisual(node)
      mcpGroup.add(nodeGroup)
      nodes.set(name, node)
    }
    if (callKey !== null && callKey !== undefined) node.activeCalls.add(callKey)
    if (still() && node.reveal < 1) {
      node.reveal = 1
      applyNodeVisual(node)
    }
    return { node, isNew }
  }

  function claimMcpTrace(server) {
    const node = nodes.get(server)
    if (!node || node.traced) return false
    node.traced = true
    return true
  }

  function revealMcp(server, share = 1) {
    const node = nodes.get(server)
    if (!node) return false
    node.reveal = Math.min(1, Math.max(0, Number(share) || 0))
    applyNodeVisual(node)
    return true
  }

  function mcpAnchor(server, out = new THREE.Vector3()) {
    const node = nodes.get(server)
    if (!node) return null
    out.x = node.group.position.x
    out.y = node.group.position.y
    out.z = node.group.position.z
    return out
  }

  function mcpOutline(server, out = []) {
    const node = nodes.get(server)
    if (!node) return null
    return mcpNodeOutlineAt(node.group.position, MCP_NODE_RADIUS, out)
  }

  function endCall(callKey) {
    if (callKey === null || callKey === undefined) return
    browserActiveCalls.delete(callKey)
    for (const node of nodes.values()) node.activeCalls.delete(callKey)
  }

  function update(delta) {
    const isStill = still()
    const step = Number.isFinite(Number(delta)) ? Math.max(0, Number(delta)) : 0
    if (!isStill) {
      browserElapsed += step
      mcpElapsed += step
    }
    browserGroup.position.x = BROWSER_HOME.x
    browserGroup.position.z = BROWSER_HOME.z
    browserGroup.position.y = browserBobY(isStill ? 0 : browserElapsed, BROWSER_HOME.y, isStill)
    browserGlow += ((browserActiveCalls.size > 0 ? 1 : 0) - browserGlow) * easeRate(step, 4, isStill)
    applyBrowserVisual()

    for (const node of nodes.values()) {
      mcpOrbitPoint(node.params, isStill ? 0 : mcpElapsed, INTERNET_HOME, node.group.position, isStill)
      if (!isStill) node.wire.rotation.y += step * 0.35
      node.glow += ((node.activeCalls.size > 0 ? 1 : 0) - node.glow) * easeRate(step, 4, isStill)
      applyNodeVisual(node)
    }
  }

  function reset() {
    browserSeen = false
    browserTraced = false
    browserReveal = 0
    browserGlow = 0
    browserElapsed = 0
    browserActiveCalls.clear()
    browserGroup.position.copy(BROWSER_HOME)
    applyBrowserVisual()
    for (const node of nodes.values()) disposeNode(node)
    nodes.clear()
    mcpElapsed = 0
  }

  function dispose() {
    reset()
    browserGeometry.dispose()
    browserMaterial.dispose()
    scene.remove(group)
  }

  return {
    group,
    browserGroup,
    mcpGroup,
    prepareBrowser,
    claimBrowserTrace,
    revealBrowser,
    browserAnchor,
    browserOutline,
    browserVisible: () => browserGroup.visible,
    browserSeen: () => browserSeen,
    browserReveal: () => browserReveal,
    useMcp,
    claimMcpTrace,
    revealMcp,
    mcpAnchor,
    mcpOutline,
    mcpServers: () => [...nodes.keys()],
    mcpNode: (server) => nodes.get(server) ?? null,
    endCall,
    update,
    reset,
    dispose,
  }
}
