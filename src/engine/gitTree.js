import * as THREE from 'three'
import { INTERNET_HOME, INTERNET_RADIUS } from './internet.js'
import { WHITE, YELLOW, still, textSprite } from './sprites.js'

export const GIT_START_LIFT = 200
export const GIT_BASE_STEP = 64
export const GIT_MAX_HEIGHT = 900
export const GIT_LEAN_STEP = 76
export const GIT_MAX_LABELS = 12
export const GIT_LABEL_LIFT = 18
export const GIT_LABEL_OFFSET = 34
export const GIT_FOCUS_DIST = 1700
export const GIT_START = {
  x: INTERNET_HOME.x,
  y: INTERNET_HOME.y + INTERNET_RADIUS + GIT_START_LIFT,
  z: INTERNET_HOME.z,
}

const TAU = Math.PI * 2
const HEAD_COLOR = new THREE.Color(YELLOW)
const REST_COLOR = new THREE.Color(WHITE)
const REST_OPACITY = 0.2
const POINT_SIZE = 7
const POINT_OPACITY = 0.6
const HEAD_REST = 0.72
const HEAD_SWING = 0.28
const HEAD_RATE = 2.4

function nameOrder(a, b) {
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

function timeOf(commit) {
  const value = commit?.time
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readCommits(commits) {
  const list = Array.isArray(commits) ? commits : []
  const seen = new Set()
  const kept = []
  for (let index = 0; index < list.length; index += 1) {
    const commit = list[index]
    const sha = typeof commit?.sha === 'string' ? commit.sha : ''
    if (!sha || seen.has(sha)) continue
    seen.add(sha)
    kept.push({
      sha,
      parents: Array.isArray(commit.parents) ? commit.parents.filter((parent) => typeof parent === 'string' && parent) : [],
      time: timeOf(commit),
      index,
    })
  }
  return kept.sort((a, b) => b.time - a.time || a.index - b.index)
}

function readBranches(branches) {
  const list = Array.isArray(branches) ? branches : []
  const kept = []
  const seen = new Set()
  for (let index = 0; index < list.length; index += 1) {
    const branch = list[index]
    const name = typeof branch?.name === 'string' ? branch.name : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    kept.push({
      name,
      head: typeof branch.head === 'string' ? branch.head : '',
      current: branch.current === true,
      index,
    })
  }
  return kept.sort((a, b) => nameOrder(a, b) || a.index - b.index)
}

function firstParent(commit) {
  return commit?.parents?.[0] ?? ''
}

function placeAt(x, y, z, level, trunk) {
  return { x, y, z, level, trunk }
}

export function layoutGitTree(commits, branches = []) {
  const ordered = readCommits(commits)
  const named = readBranches(branches)
  const total = ordered.length
  const step = total > 1 ? Math.min(GIT_BASE_STEP, GIT_MAX_HEIGHT / (total - 1)) : 0
  const height = total > 1 ? step * (total - 1) : 0
  const bySha = new Map(ordered.map((commit, index) => [commit.sha, { ...commit, level: total - 1 - index }]))
  const places = new Map()
  const currentBranch = named.find((branch) => branch.current) ?? null

  function put(sha, x, z, trunk) {
    const commit = bySha.get(sha)
    if (!commit || places.has(sha)) return places.get(sha) ?? null
    const place = placeAt(x, GIT_START.y + commit.level * step, z, commit.level, trunk)
    places.set(sha, place)
    return place
  }

  let trunkHead = currentBranch?.head && bySha.has(currentBranch.head) ? currentBranch.head : ''
  if (!trunkHead && ordered.length > 0) trunkHead = ordered[0].sha
  let at = trunkHead
  while (at && bySha.has(at) && !places.has(at)) {
    const commit = bySha.get(at)
    put(at, GIT_START.x, GIT_START.z, true)
    at = firstParent(commit)
  }

  const leanBranches = named.filter((branch) => !branch.current && branch.head && bySha.has(branch.head) && !places.has(branch.head))
  const angles = new Map()
  const branchTotal = leanBranches.length
  leanBranches.forEach((branch, index) => {
    const angle = branchTotal > 0 ? (TAU * index) / branchTotal : 0
    angles.set(branch.name, angle)
    const chain = []
    let sha = branch.head
    while (sha && bySha.has(sha) && !places.has(sha)) {
      chain.push(sha)
      sha = firstParent(bySha.get(sha))
    }
    const depth = chain.length
    chain.forEach((item, chainIndex) => {
      const radius = GIT_LEAN_STEP * (depth - chainIndex)
      put(item, GIT_START.x + Math.cos(angle) * radius, GIT_START.z + Math.sin(angle) * radius, false)
    })
  })

  const leftover = ordered.filter((commit) => !places.has(commit.sha)).sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0))
  leftover.forEach((commit, index) => {
    const angle = leftover.length > 0 ? (TAU * index) / leftover.length : 0
    const radius = GIT_LEAN_STEP * 2 + step
    put(commit.sha, GIT_START.x + Math.cos(angle) * radius, GIT_START.z + Math.sin(angle) * radius, false)
  })

  const commitPlaces = ordered.map((commit) => {
    const place = places.get(commit.sha)
    return { sha: commit.sha, ...place }
  })

  const links = []
  for (const commit of ordered) {
    const from = places.get(commit.sha)
    for (const parent of commit.parents) {
      const to = places.get(parent)
      if (!from || !to) continue
      links.push({
        sha: commit.sha,
        parent,
        from: { x: from.x, y: from.y, z: from.z },
        to: { x: to.x, y: to.y, z: to.z },
        trunk: from.trunk && to.trunk,
      })
    }
  }

  const tips = []
  for (const branch of named) {
    if (!branch.head || !bySha.has(branch.head)) continue
    const place = places.get(branch.head)
    if (!place) continue
    tips.push({
      name: branch.name,
      sha: branch.head,
      current: branch.current,
      time: bySha.get(branch.head).time,
      angle: angles.get(branch.name) ?? 0,
      x: place.x,
      y: place.y,
      z: place.z,
    })
  }
  tips.sort((a, b) => Number(b.current) - Number(a.current) || b.time - a.time || nameOrder(a, b))
  const labels = tips.slice(0, GIT_MAX_LABELS).map((tip) => ({
    name: tip.name,
    sha: tip.sha,
    current: tip.current,
    x: tip.x + Math.cos(tip.angle) * GIT_LABEL_OFFSET,
    y: tip.y + GIT_LABEL_LIFT,
    z: tip.z + Math.sin(tip.angle) * GIT_LABEL_OFFSET,
  }))

  const headIndex = trunkHead ? commitPlaces.findIndex((commit) => commit.sha === trunkHead) : -1

  return {
    start: { x: GIT_START.x, y: GIT_START.y, z: GIT_START.z },
    step,
    height,
    headSha: trunkHead || null,
    headIndex,
    commits: commitPlaces,
    links,
    tips,
    labels,
  }
}

function stateKey(state) {
  if (!state || state.git !== true) return ''
  const commits = Array.isArray(state.commits) ? state.commits : []
  const branches = Array.isArray(state.branches) ? state.branches : []
  const current = branches.find((branch) => branch?.current === true)?.name ?? ''
  return `${commits.map((commit) => (typeof commit?.sha === 'string' ? commit.sha : '')).join(',')}|${current}`
}

function stateLayout(state) {
  if (!state || state.git !== true) return layoutGitTree([], [])
  return layoutGitTree(state.commits, state.branches)
}

export function createGitTree(scene) {
  const group = new THREE.Group()
  group.name = 'git-tree'
  scene.add(group)

  const lineGeometry = new THREE.BufferGeometry()
  const lineMaterial = new THREE.LineBasicMaterial({
    color: WHITE,
    transparent: true,
    opacity: REST_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial)
  lines.frustumCulled = false
  group.add(lines)

  const pointGeometry = new THREE.BufferGeometry()
  const pointMaterial = new THREE.PointsMaterial({
    size: POINT_SIZE,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: POINT_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(pointGeometry, pointMaterial)
  points.frustumCulled = false
  group.add(points)

  const focusTarget = new THREE.Vector3(GIT_START.x, GIT_START.y + GIT_MAX_HEIGHT / 2, GIT_START.z)
  const pulseColor = new THREE.Color()
  const labelSprites = []
  let key = ''
  let layout = null
  let builds = 0
  let headIndex = -1
  let colorArray = null
  let colorAttribute = null
  let elapsed = 0
  let frozen = false

  function clearLabels() {
    for (const sprite of labelSprites) {
      group.remove(sprite)
      sprite.material?.map?.dispose()
      sprite.material?.dispose()
    }
    labelSprites.length = 0
  }

  function writeHead(scale) {
    if (!colorArray || !colorAttribute || headIndex < 0) return
    pulseColor.copy(HEAD_COLOR).multiplyScalar(scale)
    colorArray[headIndex * 3] = pulseColor.r
    colorArray[headIndex * 3 + 1] = pulseColor.g
    colorArray[headIndex * 3 + 2] = pulseColor.b
    colorAttribute.needsUpdate = true
  }

  function empty() {
    clearLabels()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(0), 3))
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(0), 3))
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(0), 3))
    lines.visible = false
    points.visible = false
    layout = null
    headIndex = -1
    colorArray = null
    colorAttribute = null
    focusTarget.set(GIT_START.x, GIT_START.y, GIT_START.z)
    frozen = false
    elapsed = 0
  }

  function rebuild(state) {
    const next = stateLayout(state)
    clearLabels()
    layout = next
    headIndex = next.headIndex
    focusTarget.set(next.start.x, next.start.y + next.height / 2, next.start.z)
    frozen = false
    elapsed = 0

    const count = next.commits.length
    const pointPositions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const commit = next.commits[index]
      pointPositions[index * 3] = commit.x
      pointPositions[index * 3 + 1] = commit.y
      pointPositions[index * 3 + 2] = commit.z
      colors[index * 3] = REST_COLOR.r
      colors[index * 3 + 1] = REST_COLOR.g
      colors[index * 3 + 2] = REST_COLOR.b
    }
    if (headIndex >= 0 && headIndex < count) {
      colors[headIndex * 3] = HEAD_COLOR.r
      colors[headIndex * 3 + 1] = HEAD_COLOR.g
      colors[headIndex * 3 + 2] = HEAD_COLOR.b
    }
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3))
    colorAttribute = new THREE.BufferAttribute(colors, 3)
    colorArray = colors
    pointGeometry.setAttribute('color', colorAttribute)

    const linePositions = new Float32Array(next.links.length * 6)
    next.links.forEach((link, index) => {
      linePositions[index * 6] = link.from.x
      linePositions[index * 6 + 1] = link.from.y
      linePositions[index * 6 + 2] = link.from.z
      linePositions[index * 6 + 3] = link.to.x
      linePositions[index * 6 + 4] = link.to.y
      linePositions[index * 6 + 5] = link.to.z
    })
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))

    for (const label of next.labels) {
      const sprite = textSprite(label.name, {
        scale: 0.55,
        color: label.current ? 'rgba(229,255,0,.9)' : 'rgba(255,255,255,.55)',
      })
      sprite.position.set(label.x, label.y, label.z)
      group.add(sprite)
      labelSprites.push(sprite)
    }

    lines.visible = count > 0
    points.visible = count > 0
    builds += 1
  }

  function setState(state) {
    const nextKey = stateKey(state)
    if (nextKey === key) return false
    key = nextKey
    if (nextKey === '') {
      empty()
      return true
    }
    rebuild(state)
    return true
  }

  function update(delta) {
    if (headIndex < 0 || !colorArray) return
    if (still()) {
      if (frozen) return
      frozen = true
      writeHead(1)
      return
    }
    frozen = false
    const step = Number.isFinite(Number(delta)) ? Math.max(0, Number(delta)) : 0
    elapsed += step
    writeHead(HEAD_REST + HEAD_SWING * Math.sin(elapsed * HEAD_RATE))
  }

  function ready() {
    return Boolean(layout && layout.commits.length > 0)
  }

  function dispose() {
    scene.remove(group)
    clearLabels()
    lineGeometry.dispose()
    lineMaterial.dispose()
    pointGeometry.dispose()
    pointMaterial.dispose()
    layout = null
    colorArray = null
    colorAttribute = null
    headIndex = -1
  }

  empty()

  return {
    group,
    setState,
    update,
    ready,
    center: () => focusTarget,
    layout: () => layout,
    builds: () => builds,
    dispose,
  }
}
