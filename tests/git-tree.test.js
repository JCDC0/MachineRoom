import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { HUB_CENTER } from '../src/engine/hub.js'
import {
  GIT_BASE_STEP,
  GIT_HIT_MARGIN,
  GIT_MAX_LABELS,
  GIT_MAX_WIDTH,
  GIT_ROOT_GAP,
  GIT_START,
  createGitTree,
  layoutGitTree,
} from '../src/engine/gitTree.js'

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  letterSpacing: '',
  measureText: (text) => ({ width: String(text).length * 10 }),
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  fillText: () => {},
}

let saved

beforeAll(() => {
  saved = globalThis.document
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d, append: () => {}, setAttribute: () => {}, remove: () => {} }),
  }
})

afterAll(() => {
  globalThis.document = saved
})

function commit(sha, parents = [], time = 0, refs = []) {
  return { sha, parents, subject: sha, time, refs }
}

function bySha(layout) {
  return Object.fromEntries(layout.commits.map((item) => [item.sha, item]))
}

function linearCommits(count) {
  const list = []
  for (let index = count - 1; index >= 0; index -= 1) {
    list.push(commit(`c${index}`, index > 0 ? [`c${index - 1}`] : [], index))
  }
  return list
}

describe('layoutGitTree', () => {
  it('stands beneath the root card on the hub axis', () => {
    expect(GIT_START.x).toBe(HUB_CENTER.x)
    expect(GIT_START.z).toBe(HUB_CENTER.z)
    expect(GIT_START.y).toBe(0)
    expect(GIT_ROOT_GAP).toBe(120)
    expect(GIT_MAX_WIDTH).toBe(1400)
  })

  it('draws a linear history along the trunk with the newest on the right', () => {
    const commits = linearCommits(3)
    const layout = layoutGitTree(commits, [{ name: 'main', head: 'c2', current: true }])
    const places = bySha(layout)
    expect(layout.commits).toHaveLength(3)
    for (const place of layout.commits) {
      expect(place.y).toBe(GIT_START.y)
      expect(place.z).toBe(GIT_START.z)
      expect(place.trunk).toBe(true)
    }
    expect(places.c2.x).toBeGreaterThan(places.c1.x)
    expect(places.c1.x).toBeGreaterThan(places.c0.x)
    expect(places.c2.x).toBe(GIT_START.x + layout.step)
    expect(places.c0.x).toBe(GIT_START.x - layout.step)
    expect(places.c2.x).toBeCloseTo(GIT_START.x + layout.width / 2, 6)
    expect(places.c0.x).toBeCloseTo(GIT_START.x - layout.width / 2, 6)
    expect(layout.headSha).toBe('c2')
    expect(layout.headIndex).toBe(0)
    expect(layout.links).toHaveLength(2)
    expect(layout.links.every((link) => link.trunk)).toBe(true)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.width).toBeLessThanOrEqual(GIT_MAX_WIDTH)
    expect(layout.labels[0]).toMatchObject({ name: 'main', current: true })
    expect(layout.labels[0].x).toBe(places.c2.x)
    expect(layout.labels[0].y).toBeGreaterThan(places.c2.y)
    expect(layout.labels[0].z).toBe(places.c2.z)
  })

  it('leans another branch out below the trunk from the commit where it leaves', () => {
    const commits = [
      commit('c2', ['c1'], 4),
      commit('f2', ['c1'], 3),
      commit('c1', [], 1),
    ]
    const layout = layoutGitTree(commits, [
      { name: 'feature', head: 'f2', current: false },
      { name: 'main', head: 'c2', current: true },
    ])
    const places = bySha(layout)
    expect(places.c2.x).toBe(GIT_START.x + layout.step)
    expect(places.c2.y).toBe(GIT_START.y)
    expect(places.c2.z).toBe(GIT_START.z)
    expect(places.c1.x).toBe(GIT_START.x - layout.step)
    expect(places.c1.y).toBe(GIT_START.y)
    expect(places.c1.z).toBe(GIT_START.z)
    expect(places.f2.x).toBe(GIT_START.x)
    expect(places.f2.y).toBeLessThan(GIT_START.y)
    expect(places.f2.z).toBeCloseTo(GIT_START.z, 6)
    expect(places.f2.trunk).toBe(false)
    expect(layout.links.some((link) => link.sha === 'f2' && link.parent === 'c1')).toBe(true)
    expect(layout.tips.map((tip) => tip.name)).toEqual(['main', 'feature'])
    expect(layout.labels.map((label) => label.name)).toEqual(['main', 'feature'])
    const featureLabel = layout.labels.find((label) => label.name === 'feature')
    expect(featureLabel.x).toBe(places.f2.x)
    expect(featureLabel.y).toBeGreaterThan(places.f2.y)
    expect(featureLabel.z).toBe(places.f2.z)
  })

  it('gives every other branch its angle in name order over the half circle below the trunk', () => {
    const commits = [
      commit('c2', ['c1'], 5),
      commit('a1', ['c1'], 4),
      commit('b1', ['c1'], 3),
      commit('c1', [], 1),
    ]
    const layout = layoutGitTree(commits, [
      { name: 'beta', head: 'b1', current: false },
      { name: 'alpha', head: 'a1', current: false },
      { name: 'main', head: 'c2', current: true },
    ])
    const places = bySha(layout)
    expect(places.a1.x).toBeGreaterThan(GIT_START.x)
    expect(places.b1.x).toBeLessThan(GIT_START.x)
    expect(places.a1.y).toBeLessThan(GIT_START.y)
    expect(places.b1.y).toBeLessThan(GIT_START.y)
    expect(places.a1.z).toBeGreaterThan(GIT_START.z)
    expect(places.b1.z).toBeLessThan(GIT_START.z)
    expect(places.a1.y).toBeCloseTo(places.b1.y, 6)
    expect(layout.tips.find((tip) => tip.name === 'alpha').angle).toBeCloseTo(Math.PI / 4, 6)
    expect(layout.tips.find((tip) => tip.name === 'beta').angle).toBeCloseTo((Math.PI * 3) / 4, 6)
  })

  it('draws every parent of a merge, the second parent off the trunk', () => {
    const commits = [
      commit('m2', ['m1', 'f1'], 5),
      commit('m1', ['c1'], 4),
      commit('f1', ['c1'], 3),
      commit('c1', [], 1),
    ]
    const layout = layoutGitTree(commits, [
      { name: 'feature', head: 'f1', current: false },
      { name: 'main', head: 'm2', current: true },
    ])
    const places = bySha(layout)
    expect(layout.links).toHaveLength(4)
    expect(layout.links.some((link) => link.sha === 'm2' && link.parent === 'f1')).toBe(true)
    expect(places.m2.y).toBe(GIT_START.y)
    expect(places.m1.y).toBe(GIT_START.y)
    expect(places.c1.y).toBe(GIT_START.y)
    expect(places.m2.z).toBe(GIT_START.z)
    expect(places.m1.z).toBe(GIT_START.z)
    expect(places.c1.z).toBe(GIT_START.z)
    expect(places.m2.x).toBeGreaterThan(places.m1.x)
    expect(places.m1.x).toBeGreaterThan(places.c1.x)
    expect(places.f1.trunk).toBe(false)
    expect(places.f1.y).toBeLessThan(GIT_START.y)
    expect(layout.labels[0]).toMatchObject({ name: 'main', current: true })
    expect(layout.labels.map((label) => label.name)).toContain('feature')
  })

  it('gives an empty history an empty tree beneath the root card', () => {
    const layout = layoutGitTree([], [])
    expect(layout.start.x).toBe(GIT_START.x)
    expect(layout.start.y).toBe(GIT_START.y)
    expect(layout.start.z).toBe(GIT_START.z)
    expect(layout.commits).toEqual([])
    expect(layout.links).toEqual([])
    expect(layout.tips).toEqual([])
    expect(layout.labels).toEqual([])
    expect(layout.width).toBe(0)
    expect(layout.step).toBe(0)
    expect(layout.headSha).toBe(null)
    expect(layout.headIndex).toBe(-1)
  })

  it('keeps 200 commits within the width cap by shrinking the step', () => {
    const commits = linearCommits(200)
    const layout = layoutGitTree(commits, [{ name: 'main', head: 'c199', current: true }])
    const places = bySha(layout)
    const left = Math.min(...layout.commits.map((place) => place.x))
    const right = Math.max(...layout.commits.map((place) => place.x))
    expect(layout.commits).toHaveLength(200)
    expect(places.c199.x).toBe(right)
    expect(right - left).toBeLessThanOrEqual(GIT_MAX_WIDTH + 1e-9)
    expect(right).toBeCloseTo(GIT_START.x + GIT_MAX_WIDTH / 2, 6)
    expect(left).toBeCloseTo(GIT_START.x - GIT_MAX_WIDTH / 2, 6)
    expect(layout.width).toBeCloseTo(GIT_MAX_WIDTH, 6)
    expect(layout.step).toBeLessThan(GIT_BASE_STEP)
    expect(layout.headIndex).toBe(0)
    expect(layout.commits.every((place) => place.y === GIT_START.y && place.z === GIT_START.z)).toBe(true)
  })

  it('gives the same places for the same input', () => {
    const commits = [
      commit('m2', ['m1', 'f1'], 5),
      commit('m1', ['c1'], 4),
      commit('f1', ['c1'], 3),
      commit('c1', [], 1),
    ]
    const branches = [
      { name: 'feature', head: 'f1', current: false },
      { name: 'main', head: 'm2', current: true },
    ]
    expect(layoutGitTree(commits, branches)).toEqual(layoutGitTree(commits, branches))
  })

  it('labels at most 12 tips, the current branch first and then the newest', () => {
    const commits = [commit('root', [], 0)]
    const branches = [{ name: 'main', head: 'root', current: true }]
    for (let index = 0; index < 15; index += 1) {
      const sha = `b${String(index).padStart(2, '0')}`
      commits.unshift(commit(sha, ['root'], 100 + index))
      branches.push({ name: `branch-${String(index).padStart(2, '0')}`, head: sha, current: false })
    }
    const layout = layoutGitTree(commits, branches)
    expect(layout.labels).toHaveLength(GIT_MAX_LABELS)
    expect(layout.labels[0]).toMatchObject({ name: 'main', current: true })
    const newest = Array.from({ length: GIT_MAX_LABELS - 1 }, (_, index) => `branch-${String(14 - index).padStart(2, '0')}`)
    expect(layout.labels.slice(1).map((label) => label.name)).toEqual(newest)
  })
})

function disposals(scene) {
  const owners = new Set()
  scene.traverse((object) => {
    if (object.geometry && !object.isSprite) owners.add(object.geometry)
    if (object.material) owners.add(object.material)
    if (object.material?.map) owners.add(object.material.map)
  })
  const freed = new Set()
  for (const owner of owners) owner.addEventListener('dispose', () => freed.add(owner))
  return { owners, freed }
}

function sampleState() {
  return {
    git: true,
    branch: 'main',
    detached: false,
    head: 'c2',
    dirty: false,
    branches: [
      { name: 'feature', head: 'f2', current: false, worktree: false, upstream: null, ahead: null, behind: null },
      { name: 'main', head: 'c2', current: true, worktree: false, upstream: null, ahead: null, behind: null },
    ],
    commits: [
      commit('c2', ['c1'], 4),
      commit('f2', ['c1'], 3),
      commit('c1', [], 1),
    ],
    truncated: false,
  }
}

describe('createGitTree', () => {
  it('rebuilds when the sha list or the current branch changes and not for a copy', () => {
    const scene = new THREE.Scene()
    const tree = createGitTree(scene)
    expect(tree.builds()).toBe(0)
    const state = sampleState()
    expect(tree.setState(state)).toBe(true)
    expect(tree.builds()).toBe(1)
    const copy = sampleState()
    copy.commits = copy.commits.map((item) => ({ ...item }))
    copy.branches = copy.branches.map((item) => ({ ...item }))
    expect(tree.setState(copy)).toBe(false)
    expect(tree.builds()).toBe(1)
    const switched = sampleState()
    switched.branches = switched.branches.map((branch) => ({ ...branch, current: branch.name === 'feature' }))
    expect(tree.setState(switched)).toBe(true)
    expect(tree.builds()).toBe(2)
    expect(tree.layout().headSha).toBe('f2')
    const named = sampleState()
    named.branches = [...switched.branches, { name: 'new-at-head', head: 'f2', current: false }]
    expect(tree.setState({ ...named, commits: switched.commits })).toBe(true)
    const labels = tree.layout().labels
    expect(labels.map((label) => label.name)).toContain('new-at-head')
    const atHead = labels.filter((label) => label.sha === 'f2').map((label) => label.y)
    expect(atHead.length).toBeGreaterThan(1)
    expect(new Set(atHead).size).toBe(atHead.length)
    expect(tree.setState({ git: false })).toBe(true)
    expect(tree.layout()).toBe(null)
    tree.dispose()
  })

  it('sits 120 below the card bottom it is given and answers the middle of the trunk', () => {
    const scene = new THREE.Scene()
    const tree = createGitTree(scene)
    tree.setState(sampleState())
    const trunk = tree.layout().commits.filter((place) => place.trunk)
    const middle = (Math.min(...trunk.map((place) => place.x)) + Math.max(...trunk.map((place) => place.x))) / 2
    expect(tree.setTop(-500)).toBe(true)
    expect(tree.group.position.y).toBe(-620)
    expect(tree.center()).toBe(tree.center())
    expect(tree.center().x).toBeCloseTo(middle, 6)
    expect(tree.center().y).toBeCloseTo(-620, 6)
    expect(tree.center().z).toBeCloseTo(GIT_START.z, 6)
    expect(tree.setTop(-500)).toBe(false)
    expect(tree.group.position.y).toBe(-620)
    expect(tree.setTop(-400)).toBe(true)
    expect(tree.group.position.y).toBe(-520)
    expect(tree.center().y).toBeCloseTo(-520, 6)
    tree.dispose()
  })

  it('hides a hit box with a 60 unit margin around every commit and label', () => {
    const scene = new THREE.Scene()
    const tree = createGitTree(scene)
    tree.setState(sampleState())
    expect(tree.hitBox.visible).toBe(false)
    const points = [...tree.layout().commits, ...tree.layout().labels]
    for (const axis of ['x', 'y', 'z']) {
      const values = points.map((point) => point[axis])
      const low = Math.min(...values)
      const high = Math.max(...values)
      expect(tree.hitBox.scale[axis]).toBeCloseTo(high - low + GIT_HIT_MARGIN * 2, 6)
      expect(tree.hitBox.position[axis]).toBeCloseTo((low + high) / 2, 6)
    }
    expect(tree.hitBox.scale.x).toBeGreaterThan(GIT_HIT_MARGIN * 2)
    expect(tree.ready()).toBe(true)
    tree.dispose()
  })

  it('frees every geometry, material and texture and leaves the scene on dispose', () => {
    const scene = new THREE.Scene()
    const tree = createGitTree(scene)
    tree.setState(sampleState())
    const { owners, freed } = disposals(scene)
    expect(owners.size).toBeGreaterThan(4)
    tree.dispose()
    expect(scene.children).toEqual([])
    expect(freed.size).toBe(owners.size)
  })
})
