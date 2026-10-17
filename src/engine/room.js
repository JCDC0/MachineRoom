import * as THREE from 'three'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { ancestors, dirname } from '../model/paths.js'
import { createAgents } from './agents.js'
import { createCameraRig } from './camera.js'
import { createClusters } from './clusters.js'
import { createCore } from './core.js'
import { layoutTree, treeFromState } from './layout.js'
import { RED, WHITE, YELLOW, glowTexture, lineMaterial, seeded } from './sprites.js'
import { createTerminals } from './terminals.js'

const OPEN_STEP_MS = 170
const ZERO = new THREE.Vector3()

export function createRoom({ surface, gl, css, rootName, agents, getState, beforeFrame = () => {}, onPick = () => {} }) {
  const texture = glowTexture()
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  scene.fog = new THREE.FogExp2(0x000000, 0.00005)
  const cssScene = new THREE.Scene()

  let width = surface.clientWidth || window.innerWidth
  let height = surface.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(50, width / height, 1, 60000)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(width, height)
  gl.appendChild(renderer.domElement)
  const cssRenderer = new CSS3DRenderer()
  cssRenderer.setSize(width, height)
  cssRenderer.domElement.style.pointerEvents = 'none'
  css.appendChild(cssRenderer.domElement)

  const next = seeded(9001)
  const dust = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 700 }, () => {
        const direction = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize()
        return direction.multiplyScalar(7000 + next() * 9000)
      })
    ),
    new THREE.PointsMaterial({ color: WHITE, size: 12, map: texture, transparent: true, opacity: 0.4, depthWrite: false })
  )
  scene.add(dust)

  const core = createCore(scene, texture)
  const roster = agents.map((agent) => ({ key: agent.key, name: agent.name, shape: agent.parser ?? agent.key }))
  const agentSet = createAgents(scene, roster)
  const terminals = createTerminals(cssScene, roster)

  let clusters = null
  let links = null
  const known = { files: -1, dirs: -1 }

  function build(state) {
    if (clusters) clusters.dispose()
    if (links) {
      scene.remove(links)
      links.geometry.dispose()
      links.material.dispose()
    }
    const layout = layoutTree(treeFromState(state, rootName))
    clusters = createClusters(scene, layout)
    const points = [ZERO.clone(), clusters.center('').clone()]
    for (const link of layout.links) points.push(clusters.center(link.from).clone(), clusters.center(link.to).clone())
    links = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(WHITE, 0.12))
    scene.add(links)
    known.files = state.files.size
    known.dirs = state.dirs.size
    clusters.sync(state)
  }

  const grown = (state) => state.files.size !== known.files || state.dirs.size !== known.dirs

  const pulses = Array.from({ length: 32 }, () => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: YELLOW,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    sprite.scale.set(110, 110, 1)
    scene.add(sprite)
    return { sprite, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), start: 0, duration: 1 }
  })

  function firePulse(from, to, color, duration = 800) {
    const pulse = pulses.find((item) => !item.active)
    if (!pulse) return
    pulse.active = true
    pulse.from.copy(from)
    pulse.to.copy(to)
    pulse.start = performance.now()
    pulse.duration = duration
    pulse.sprite.material.color.setHex(color)
  }

  let queue = []
  function later(ms, fn) {
    queue.push({ at: performance.now() + ms, fn })
  }
  function runQueue(now) {
    if (queue.length === 0) return
    const due = queue.filter((item) => item.at <= now).sort((a, b) => a.at - b.at)
    if (due.length === 0) return
    queue = queue.filter((item) => item.at > now)
    due.forEach((item) => item.fn())
  }

  const scratch = new THREE.Vector3()
  const rig = createCameraRig(camera, surface)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let focused = null

  rig.setClickHandler((event) => {
    const rect = gl.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(agentSet.pickables, false)[0]
    if (hit) onPick(hit.object.userData.key)
  })

  for (const term of terminals.terminals.values()) {
    term.element.addEventListener('click', () => onPick(term.key))
  }

  const anchorFor = (path) => clusters.center(path ?? '')

  function sync(state) {
    queue = []
    pulses.forEach((pulse) => {
      pulse.active = false
      pulse.sprite.material.opacity = 0
    })
    if (grown(state)) build(state)
    else clusters.sync(state)
    agentSet.snap(state, anchorFor)
  }

  function onActivity(activity) {
    const view = agentSet.views.get(activity.agent)
    if (!view) return
    const position = view.group.position

    if (activity.type === 'run.start') {
      core.pulse(YELLOW, 1)
      firePulse(ZERO, position, YELLOW, 700)
    } else if (activity.type === 'tool.start') {
      for (const touch of activity.touches) {
        const chain = touch.kind === 'dir' ? ancestors(`${touch.path}/x`) : ancestors(touch.path)
        chain.forEach((dir, index) => later(index * OPEN_STEP_MS, () => clusters.open(dir)))
        later(chain.length * OPEN_STEP_MS, () => {
          if (touch.kind === 'file') {
            const dir = dirname(touch.path)
            clusters.flashFile(dir, touch.path, 'white')
            clusters.slotPosition(dir, touch.path, scratch)
          } else {
            clusters.flashCluster(touch.path, 'white')
            scratch.copy(clusters.center(touch.path))
          }
          firePulse(view.group.position, scratch, WHITE, 600)
        })
      }
    } else if (activity.type === 'tool.end' && !activity.ok) {
      const touches = getState().agents.get(activity.agent)?.calls.get(activity.id) ?? []
      touches.forEach((touch) => {
        if (touch.kind === 'file') clusters.flashFile(dirname(touch.path), touch.path, 'red')
        else clusters.flashCluster(touch.path, 'red')
      })
      core.pulse(RED, 0.5)
    } else if (activity.type === 'run.end') {
      const color = activity.ok ? YELLOW : RED
      core.pulse(color, 1)
      firePulse(position, ZERO, color, 900)
    } else if (activity.type === 'error') {
      core.pulse(RED, 0.6)
    }
  }

  function onResize() {
    width = surface.clientWidth || window.innerWidth
    height = surface.clientHeight || window.innerHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
    cssRenderer.setSize(width, height)
  }
  const observer = new ResizeObserver(onResize)
  observer.observe(surface)

  let last = performance.now()
  let frameId = 0

  function frame(now) {
    frameId = requestAnimationFrame(frame)
    const delta = Math.min((now - last) / 1000, 0.1)
    last = now
    beforeFrame(delta * 1000)
    runQueue(now)

    const state = getState()
    if (grown(state)) build(state)
    core.update(now / 1000, delta)
    clusters.update(state, delta)
    agentSet.update(state, delta, now, anchorFor, terminals.positionOf)

    pulses.forEach((pulse) => {
      if (!pulse.active) return
      const t = (now - pulse.start) / pulse.duration
      if (t >= 1) {
        pulse.active = false
        pulse.sprite.material.opacity = 0
        return
      }
      pulse.sprite.position.lerpVectors(pulse.from, pulse.to, t)
      pulse.sprite.material.opacity = t < 0.1 ? t * 10 : t > 0.85 ? (1 - t) / 0.15 : 1
    })

    rig.update(delta)
    terminals.update(state, now, camera, focused)
    renderer.render(scene, camera)
    cssRenderer.render(cssScene, camera)
  }

  rig.snap()
  sync(getState())
  frameId = requestAnimationFrame(frame)

  return {
    onActivity,
    reset: sync,
    focus(key) {
      const view = agentSet.views.get(key)
      if (!view) return
      focused = key
      const middle = new THREE.Vector3()
      rig.focus(() => middle.copy(view.group.position).add(terminals.positionOf(key)).multiplyScalar(0.5), 2800)
    },
    overview() {
      focused = null
      rig.overview()
    },
    focused: () => focused,
    dispose() {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      rig.dispose()
      terminals.dispose()
      clusters.dispose()
      renderer.dispose()
      gl.removeChild(renderer.domElement)
      css.removeChild(cssRenderer.domElement)
    },
  }
}
