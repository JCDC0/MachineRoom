import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { INTERNET_HOME, INTERNET_RADIUS } from '../src/engine/internet.js'
import {
  GIT_BASE_STEP,
  GIT_MAX_HEIGHT,
  GIT_MAX_LABELS,
  GIT_START,
  GIT_START_LIFT,
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
  it('stands above the top of the INTERNET sphere on its axis', () => {
    expect(GIT_START.x).toBe(INTERNET_HOME.x)
    expect(GIT_START.z).toBe(INTERNET_HOME.z)
    expect(GIT_START.y).toBe(INTERNET_HOME.y + INTERNET_RADIUS + GIT_START_LIFT)
    expect(GIT_START_LIFT).toBe(200)
  })

  it('draws a linear history straight up the trunk with the newest highest', () => {
    const commits = linearCommits(3)
    const layout = layoutGitTree(commits, [{ name: 'main', head: 'c2', current: true }])
    const places = bySha(layout)
    expect(layout.commits).toHaveLength(3)
    for (const place of layout.commits) {
      expect(place.x).toBe(GIT_START.x)
      expect(place.z).toBe(GIT_START.z)
      expect(place.trunk).toBe(true)
    }
    expect(places.c2.y).toBeGreaterThan(places.c1.y)
    expect(places.c1.y).toBeGreaterThan(places.c0.y)
    expect(layout.headSha).toBe('c2')
    expect(layout.headIndex).toBe(0)
    expect(layout.links).toHaveLength(2)
    expect(layout.links.every((link) => link.trunk)).toBe(true)
    expect(layout.height).toBeGreaterThan(0)
    expect(layout.height).toBeLessThanOrEqual(GIT_MAX_HEIGHT)
    expect(layout.labels[0]).toMatchObject({ name: 'main', current: true })
  })

  it('leans another branch out from the commit where it leaves the trunk', () => {
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
    expect(places.c2.x).toBe(GIT_START.x)
    expect(places.c2.z).toBe(GIT_START.z)
    expect(places.f2.x).not.toBe(GIT_START.x)
    expect(layout.links.some((link) => link.sha === 'f2' && link.parent === 'c1')).toBe(true)
    expect(layout.tips.map((tip) => tip.name)).toEqual(['main', 'feature'])
    expect(layout.labels.map((label) => label.name)).toEqual(['main', 'feature'])
  })

  it('gives every other branch its angle in name order', () => {
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
    expect(places.a1.z).toBeCloseTo(GIT_START.z, 6)
    expect(places.b1.z).toBeCloseTo(GIT_START.z, 6)
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
    expect(places.m2.x).toBe(GIT_START.x)
    expect(places.m1.x).toBe(GIT_START.x)
    expect(places.c1.x).toBe(GIT_START.x)
    expect(places.f1.x).not.toBe(GIT_START.x)
    expect(layout.labels[0]).toMatchObject({ name: 'main', current: true })
    expect(layout.labels.map((label) => label.name)).toContain('feature')
  })

  it('gives an empty history an empty tree above the sphere', () => {
    const layout = layoutGitTree([], [])
    expect(layout.start.y).toBe(GIT_START.y)
    expect(layout.commits).toEqual([])
    expect(layout.links).toEqual([])
    expect(layout.tips).toEqual([])
    expect(layout.labels).toEqual([])
    expect(layout.height).toBe(0)
    expect(layout.step).toBe(0)
    expect(layout.headSha).toBe(null)
    expect(layout.headIndex).toBe(-1)
  })

  it('keeps 200 commits within the height cap by shrinking the step', () => {
    const commits = linearCommits(200)
    const layout = layoutGitTree(commits, [{ name: 'main', head: 'c199', current: true }])
    const lowest = Math.min(...layout.commits.map((place) => place.y))
    const highest = Math.max(...layout.commits.map((place) => place.y))
    expect(layout.commits).toHaveLength(200)
    expect(highest - lowest).toBeLessThanOrEqual(GIT_MAX_HEIGHT + 1e-9)
    expect(layout.step).toBeLessThan(GIT_BASE_STEP)
    expect(layout.headIndex).toBe(0)
    expect(layout.commits.every((place) => place.x === GIT_START.x && place.z === GIT_START.z)).toBe(true)
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
    expect(tree.setState({ git: false })).toBe(true)
    expect(tree.layout()).toBe(null)
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
