import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { polylineLengths, samplePolyline } from './agents.js'
import { WHITE, still } from './sprites.js'

export const TRACE_CORE_WIDTH = 2.5
export const TRACE_SHEATH_WIDTH = 9
export const TRACE_SHEATH_SHARE = 0.25
export const TRACE_HEAD_SIZE = 12
export const TRACE_TAIL_FLOOR = 0.12
export const TRACE_HOLD_SECONDS = 0.15
export const TRACE_FADE_SECONDS = 0.8
export const TRACE_SEGMENTS = 64
export const FOLDER_TRACE_SECONDS = 0.6
export const FILE_TRACE_SECONDS = 0.4

const CLOSED_EPSILON = 1e-6

function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(1, Math.max(0, number))
}

function samePoint(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= CLOSED_EPSILON
}

export function traceClosedOutline(points, out = []) {
  const list = Array.isArray(points) ? points : []
  const target = Array.isArray(out) ? out : []
  let count = 0
  for (let index = 0; index < list.length; index += 1) {
    const source = list[index]
    if (!source) continue
    const x = Number(source.x)
    const y = Number(source.y)
    const z = Number(source.z)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    const point = target[count] ?? (target[count] = { x: 0, y: 0, z: 0 })
    point.x = x
    point.y = y
    point.z = z
    count += 1
  }
  if (count >= 2 && !samePoint(target[0], target[count - 1])) {
    const first = target[0]
    const point = target[count] ?? (target[count] = { x: 0, y: 0, z: 0 })
    point.x = first.x
    point.y = first.y
    point.z = first.z
    count += 1
  }
  target.length = count
  return target
}

export function traceTotalLength(points, lengths = null) {
  const closed = traceClosedOutline(points, [])
  if (closed.length < 2) {
    if (Array.isArray(lengths)) lengths.length = closed.length
    return 0
  }
  const spans = polylineLengths(closed, lengths ?? [])
  return spans[spans.length - 1] ?? 0
}

export function traceDrawnLength(points, share, lengths = null) {
  return traceTotalLength(points, lengths) * clamp01(share)
}

export function traceHeadPoint(points, share, out = { x: 0, y: 0, z: 0 }, lengths = null) {
  const closed = traceClosedOutline(points, [])
  const spans = closed.length >= 2 ? polylineLengths(closed, lengths ?? []) : null
  return samplePolyline(closed, clamp01(share), out, spans)
}

export function traceProgress(elapsed, duration, hold = TRACE_HOLD_SECONDS, fade = TRACE_FADE_SECONDS, reduced = false) {
  if (reduced) {
    return { share: 1, opacity: 0, drawing: false, holding: false, fading: false, done: true }
  }
  const t = Math.max(0, Number(elapsed) || 0)
  const draw = Math.max(0, Number(duration) || 0)
  const holdTime = Math.max(0, Number(hold) || 0)
  const fadeTime = Math.max(0, Number(fade) || 0)
  if (draw > 0 && t < draw) {
    return { share: t / draw, opacity: 1, drawing: true, holding: false, fading: false, done: false }
  }
  if (t < draw + holdTime) {
    return { share: 1, opacity: 1, drawing: false, holding: true, fading: false, done: false }
  }
  if (fadeTime > 0 && t < draw + holdTime + fadeTime) {
    return {
      share: 1,
      opacity: 1 - (t - draw - holdTime) / fadeTime,
      drawing: false,
      holding: false,
      fading: true,
      done: false,
    }
  }
  return { share: 1, opacity: 0, drawing: false, holding: false, fading: false, done: true }
}

function traceMaterial(color, width, resolution) {
  const material = new LineMaterial({
    color,
    linewidth: width,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    fog: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  })
  if (resolution) material.resolution.set(resolution.x, resolution.y)
  return material
}

function tailBrightness(u, drawing) {
  if (!drawing) return 1
  return TRACE_TAIL_FLOOR + (1 - TRACE_TAIL_FLOOR) * u * u
}

export function createTrace(scene, options = {}) {
  const {
    points = [],
    color = WHITE,
    duration = FOLDER_TRACE_SECONDS,
    hold = TRACE_HOLD_SECONDS,
    fade = TRACE_FADE_SECONDS,
    width = TRACE_CORE_WIDTH,
    sheathWidth = TRACE_SHEATH_WIDTH,
    resolution = null,
    follow = null,
    onProgress = null,
    onDone = null,
  } = options

  const outline = traceClosedOutline(points, [])
  const lengths = []
  const edges = Math.max(1, outline.length - 1)
  const capacity = Math.max(TRACE_SEGMENTS, edges * 2)

  const geometry = new LineGeometry()
  geometry.setPositions(new Float32Array((capacity + 1) * 3))
  geometry.setColors(new Float32Array((capacity + 1) * 3))
  geometry.instanceCount = 0

  const coreMaterial = traceMaterial(color, width, resolution)
  const sheathMaterial = traceMaterial(color, sheathWidth, resolution)
  const core = new Line2(geometry, coreMaterial)
  const sheath = new Line2(geometry, sheathMaterial)
  core.frustumCulled = false
  sheath.frustumCulled = false
  core.renderOrder = 2
  sheath.renderOrder = 1
  core.visible = false
  sheath.visible = false

  const headGeometry = new THREE.BufferGeometry()
  headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
  const headMaterial = new THREE.PointsMaterial({
    color: WHITE,
    size: TRACE_HEAD_SIZE,
    sizeAttenuation: false,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const head = new THREE.Points(headGeometry, headMaterial)
  head.frustumCulled = false
  head.renderOrder = 3
  head.visible = false

  scene.add(sheath, core, head)

  const followScratch = []
  const headPoint = { x: 0, y: 0, z: 0 }
  let elapsed = 0
  let finished = false
  let disposed = false

  function finish() {
    if (finished) return
    finished = true
    core.visible = false
    sheath.visible = false
    head.visible = false
    onProgress?.(1, 0, { share: 1, opacity: 0, drawing: false, holding: false, fading: false, done: true })
    onDone?.()
  }

  function writeState(state) {
    if (typeof follow === 'function') {
      const next = follow(followScratch)
      if (!next) {
        finish()
        return false
      }
      traceClosedOutline(next, outline)
    }
    if (outline.length < 2) {
      finish()
      return false
    }
    polylineLengths(outline, lengths)
    const total = lengths[lengths.length - 1] ?? 0
    if (!(total > 0) || state.opacity <= 0) {
      core.visible = false
      sheath.visible = false
      head.visible = false
      geometry.instanceCount = 0
      return true
    }

    const drawn = total * state.share
    const posAttr = geometry.getAttribute('instanceStart')
    const colAttr = geometry.getAttribute('instanceColorStart')
    const posArr = posAttr.data.array
    const colArr = colAttr.data.array
    const count = outline.length - 1
    const step = total / Math.max(1, capacity - count)
    let seg = 0

    if (drawn > 0) {
      for (let index = 0; index < count; index += 1) {
        const d0 = lengths[index]
        const d1 = lengths[index + 1]
        if (d0 >= drawn) break
        const endD = Math.min(d1, drawn)
        const span = endD - d0
        if (!(span > 0)) continue
        const edgeLen = d1 - d0
        const remainingCap = capacity - seg
        const remainingEdges = Math.max(0, count - 1 - index)
        const maxHere = Math.max(1, remainingCap - remainingEdges)
        const pieces = Math.min(maxHere, Math.max(1, Math.ceil(span / step)))
        const pA = outline[index]
        const pB = outline[index + 1]
        for (let k = 0; k < pieces; k += 1) {
          if (seg >= capacity) break
          const distA = d0 + (span * k) / pieces
          const distB = d0 + (span * (k + 1)) / pieces
          const t0 = (distA - d0) / edgeLen
          const t1 = (distB - d0) / edgeLen
          const base = seg * 6
          posArr[base] = pA.x + (pB.x - pA.x) * t0
          posArr[base + 1] = pA.y + (pB.y - pA.y) * t0
          posArr[base + 2] = pA.z + (pB.z - pA.z) * t0
          posArr[base + 3] = pA.x + (pB.x - pA.x) * t1
          posArr[base + 4] = pA.y + (pB.y - pA.y) * t1
          posArr[base + 5] = pA.z + (pB.z - pA.z) * t1
          const b0 = tailBrightness(distA / drawn, state.drawing)
          const b1 = tailBrightness(distB / drawn, state.drawing)
          colArr[base] = b0
          colArr[base + 1] = b0
          colArr[base + 2] = b0
          colArr[base + 3] = b1
          colArr[base + 4] = b1
          colArr[base + 5] = b1
          seg += 1
        }
      }
    }

    geometry.instanceCount = seg
    posAttr.data.needsUpdate = true
    colAttr.data.needsUpdate = true

    const visible = seg > 0 && state.opacity > 0
    core.visible = visible
    sheath.visible = visible
    coreMaterial.opacity = state.opacity
    sheathMaterial.opacity = state.opacity * TRACE_SHEATH_SHARE

    if (state.drawing && state.share > 0 && state.opacity > 0) {
      samplePolyline(outline, state.share, headPoint, lengths)
      const headAttr = headGeometry.getAttribute('position')
      const headArr = headAttr.array
      headArr[0] = headPoint.x
      headArr[1] = headPoint.y
      headArr[2] = headPoint.z
      headAttr.needsUpdate = true
      headMaterial.opacity = state.opacity
      head.visible = true
    } else {
      head.visible = false
    }
    return true
  }

  function setResolution(w, h) {
    coreMaterial.resolution.set(w, h)
    sheathMaterial.resolution.set(w, h)
  }

  function update(delta = 0) {
    if (finished || disposed) return false
    if (still()) {
      finish()
      return false
    }
    const step = Number(delta)
    if (Number.isFinite(step) && step > 0) elapsed += step
    const state = traceProgress(elapsed, duration, hold, fade, false)
    onProgress?.(state.share, state.opacity, state)
    if (state.done) {
      finish()
      return false
    }
    return writeState(state)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    finished = true
    scene.remove(sheath, core, head)
    geometry.dispose()
    coreMaterial.dispose()
    sheathMaterial.dispose()
    headGeometry.dispose()
    headMaterial.dispose()
  }

  const initial = traceProgress(0, duration, hold, fade, still())
  if (initial.done) {
    finish()
  } else {
    onProgress?.(initial.share, initial.opacity, initial)
    writeState(initial)
  }

  return {
    color,
    duration,
    core,
    sheath,
    head,
    geometry,
    outline,
    setResolution,
    update,
    dispose,
    get elapsed() {
      return elapsed
    },
    get done() {
      return finished
    },
  }
}

export function createTraces(scene) {
  const items = new Set()
  const resolution = new THREE.Vector2(1, 1)

  function setViewport(width, height) {
    const w = Math.max(1, Number(width) || 1)
    const h = Math.max(1, Number(height) || 1)
    resolution.set(w, h)
    for (const trace of items) trace.setResolution(w, h)
  }

  function start(options = {}) {
    if (still()) {
      options.onProgress?.(1, 0, { share: 1, opacity: 0, drawing: false, holding: false, fading: false, done: true })
      options.onDone?.()
      return null
    }
    const trace = createTrace(scene, { ...options, resolution })
    if (trace.done) {
      trace.dispose()
      return null
    }
    items.add(trace)
    return trace
  }

  function update(delta) {
    for (const trace of [...items]) {
      if (!trace.update(delta)) {
        trace.dispose()
        items.delete(trace)
      }
    }
  }

  function clear() {
    for (const trace of items) trace.dispose()
    items.clear()
  }

  function dispose() {
    clear()
  }

  return { items, start, update, setViewport, clear, dispose }
}
