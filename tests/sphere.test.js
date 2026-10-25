import { describe, expect, it } from 'vitest'
import { cardSize, overviewSpheres } from '../src/engine/cards.js'
import { fitView } from '../src/engine/camera.js'
import { HUB_CENTER, HUB_RADIUS } from '../src/engine/hub.js'
import {
  CARD_CLEARANCE,
  OPEN_CONE,
  OPEN_STEP,
  POLE_CAP,
  ROOT_DROP,
  SPHERE_CENTER,
  STACK_LIMIT,
  STACK_STEP,
  TOP_MAX_RADIUS,
  TOP_MIN_RADIUS,
  TOP_SPACING,
  layoutSphere,
  topShellRadius,
} from '../src/engine/sphere.js'

const CLOSED = cardSize({ state: 'closed' })
const EPS = 1e-6

const rootEntry = () => ({ path: '', ...CLOSED })

const topEntry = (index) => ({ path: `top-${String(index).padStart(3, '0')}`, ...CLOSED })

function topTree(count) {
  return [rootEntry(), ...Array.from({ length: count }, (_, index) => topEntry(index))]
}

const relative = (at) => ({ x: at.x - SPHERE_CENTER.x, y: at.y - SPHERE_CENTER.y, z: at.z - SPHERE_CENTER.z })
const radial = (at) => Math.hypot(relative(at).x, relative(at).y, relative(at).z)
const unit = (value) => {
  const length = Math.hypot(value.x, value.y, value.z)
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}
const direction = (at) => unit(relative(at))
const angle = (a, b) => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}
const placeOf = (placed, path) => {
  const at = placed.get(path)
  return { x: at.x, y: at.y, z: at.z }
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function expectTopsSpaced(entries, placed) {
  const tops = entries.filter((entry) => entry.path !== '' && !entry.path.includes('/'))
  for (let i = 0; i < tops.length; i += 1) {
    const a = placed.get(tops[i].path)
    expect(a, tops[i].path).toBeTruthy()
    expect(Math.abs(direction(a).y)).toBeLessThanOrEqual(Math.cos(POLE_CAP) + EPS)
    for (let j = i + 1; j < tops.length; j += 1) {
      const b = placed.get(tops[j].path)
      expect(distance(a, b), `${tops[i].path} and ${tops[j].path}`).toBeGreaterThanOrEqual(TOP_SPACING * Math.min(tops[i].width, tops[j].width) - EPS)
    }
  }
}

function expectClearOf(entries, placed, obstacle) {
  for (const entry of entries) {
    if (entry.path === '') continue
    const at = placed.get(entry.path)
    const distanceTo = Math.hypot(at.x - obstacle.x, at.y - obstacle.y, at.z - obstacle.z)
    const needed = Math.hypot(entry.width, entry.height) / 2 + obstacle.radius + CARD_CLEARANCE
    expect(distanceTo, entry.path).toBeGreaterThanOrEqual(needed - EPS)
  }
}

describe('the first shell', () => {
  it('takes its radius from the count of top-level folders', () => {
    for (const count of [4, 20, 80]) {
      const entries = topTree(count)
      const placed = layoutSphere(entries)
      const wanted = topShellRadius(count, CLOSED)
      for (const entry of entries) {
        if (entry.path === '') continue
        expect(radial(placed.get(entry.path)), entry.path).toBeCloseTo(wanted, 6)
      }
    }
    expect(topShellRadius(4, CLOSED)).toBe(TOP_MIN_RADIUS)
    expect(topShellRadius(20, CLOSED)).toBe(TOP_MIN_RADIUS)
    expect(topShellRadius(80, CLOSED)).toBeCloseTo(1620, 0)
    expect(topShellRadius(4000, CLOSED)).toBe(TOP_MAX_RADIUS)
  })

  it('keeps the top card centres at least 0.6 of a card width apart', () => {
    const entries = topTree(80)
    const placed = layoutSphere(entries)
    expectTopsSpaced(entries, placed)
  })

  it('keeps that spacing when a top card grows on a warm start', () => {
    const entries = topTree(20)
    const before = layoutSphere(entries)
    const grown = entries.map((entry) => (entry.path === 'top-000' ? { path: entry.path, ...cardSize({ state: 'files', items: Array.from({ length: 4 }, (_, i) => ({ path: `top-000/f${i}.js`, kind: 'file' })) }) } : entry))
    const after = layoutSphere(grown, { previous: before })
    expectTopsSpaced(grown, after)
  })
})

describe('the cabinet', () => {
  it('stacks the children behind their parent, four deep', () => {
    const entries = [rootEntry(), { path: 'src', ...CLOSED }]
    for (let index = 0; index < 6; index += 1) entries.push({ path: `src/child-${String(index).padStart(2, '0')}`, ...CLOSED })
    const placed = layoutSphere(entries)
    const parent = placed.get('src')
    const parentDirection = direction(parent)
    const parentRadius = radial(parent)
    const kids = entries.filter((entry) => entry.path.startsWith('src/')).sort((a, b) => (a.path < b.path ? -1 : 1))
    const stacked = kids.filter((entry) => placed.has(entry.path))
    expect(stacked).toHaveLength(STACK_LIMIT)
    let before = parentRadius
    for (const entry of stacked) {
      const at = placed.get(entry.path)
      const radius = radial(at)
      expect(radius, entry.path).toBeGreaterThan(before)
      expect(angle(direction(at), parentDirection), entry.path).toBeLessThan(0.1)
      before = radius
    }
    expect(placed.has('src/child-04')).toBe(false)
    expect(placed.has('src/child-05')).toBe(false)
  })

  it('steps a folder on the path out one layer and fans its siblings around it', () => {
    const entries = [rootEntry(), { path: 'src', ...CLOSED }]
    for (const name of ['a', 'b', 'c', 'd']) entries.push({ path: `src/${name}`, ...CLOSED })
    entries.push({ path: 'src/a/deep', ...CLOSED })
    const open = new Set(['src/a', 'src/a/deep'])
    const placed = layoutSphere(entries, { open })
    const parent = placed.get('src')
    const parentDirection = direction(parent)
    const parentRadius = radial(parent)
    const pathAt = placed.get('src/a')
    expect(radial(pathAt)).toBeCloseTo(parentRadius + OPEN_STEP, 6)
    expect(angle(direction(pathAt), parentDirection)).toBeLessThan(EPS)
    for (const name of ['b', 'c', 'd']) {
      const at = placed.get(`src/${name}`)
      expect(radial(at)).toBeCloseTo(parentRadius + OPEN_STEP, 6)
      expect(angle(direction(at), parentDirection)).toBeLessThanOrEqual(OPEN_CONE + EPS)
      expect(angle(direction(at), direction(pathAt))).toBeLessThanOrEqual(OPEN_CONE + EPS)
    }
    const deep = placed.get('src/a/deep')
    expect(radial(deep)).toBeCloseTo(parentRadius + OPEN_STEP * 2, 6)
    expect(angle(direction(deep), parentDirection)).toBeLessThan(EPS)
  })

  it('returns a folder that leaves the path to its parent stack and keeps the rest in place', () => {
    const entries = [rootEntry(), { path: 'src', ...CLOSED }, { path: 'src/ui', ...CLOSED }, { path: 'src/model', ...CLOSED }]
    const first = layoutSphere(entries, { open: new Set(['src/ui']) })
    const parent = placeOf(first, 'src')
    const ui = first.get('src/ui')
    expect(radial(ui)).toBeCloseTo(radial(parent) + OPEN_STEP, 6)
    const second = layoutSphere(entries, { previous: first })
    expect(placeOf(second, 'src')).toEqual(parent)
    const back = second.get('src/ui')
    expect(distance(back, parent)).toBeLessThan(STACK_STEP * (STACK_LIMIT + 1))
    expect(radial(back)).toBeGreaterThan(radial(parent))
    expect(angle(direction(back), direction(parent))).toBeLessThan(0.1)
    expect(placeOf(second, '')).toEqual(placeOf(first, ''))
  })
})

describe('the layout', () => {
  it('keeps the root in the park space just under the hub', () => {
    const entries = topTree(12)
    for (const placed of [layoutSphere(entries), layoutSphere(entries, { previous: layoutSphere(entries) })]) {
      const root = placed.get('')
      expect(root.x).toBe(0)
      expect(root.z).toBe(0)
      expect(root.y).toBe(HUB_CENTER.y - ROOT_DROP)
      expect(root.y).toBeLessThan(HUB_CENTER.y - HUB_RADIUS)
      expect(HUB_CENTER.y - root.y).toBeLessThan(HUB_RADIUS * 2)
    }
  })

  it('gives the same places for the same input, cold and warm', () => {
    const entries = topTree(20)
    entries.push({ path: 'top-000/one', ...CLOSED }, { path: 'top-000/two', ...CLOSED })
    const open = new Set(['top-000/one'])
    const cold = layoutSphere(entries, { open })
    expect([...layoutSphere(entries, { open })]).toEqual([...cold])
    expect([...layoutSphere(entries, { previous: cold, open })]).toEqual([...cold])
  })

  it('keeps every card clear of an obstacle and the root in place', () => {
    const entries = topTree(8)
    entries.push({ path: 'top-000/one', ...CLOSED })
    const before = layoutSphere(entries)
    const at = before.get('top-000/one')
    const obstacle = { x: at.x + 20, y: at.y, z: at.z, radius: 120 }
    const placed = layoutSphere(entries, { obstacles: [obstacle] })
    expectClearOf(entries, placed, obstacle)
    expect(placeOf(placed, '')).toEqual(placeOf(before, ''))
    expect(placeOf(placed, 'top-000/one')).not.toEqual(placeOf(before, 'top-000/one'))
  })

  it('moves only the card that meets a new obstacle on a warm start', () => {
    const entries = topTree(8)
    entries.push({ path: 'top-000/one', ...CLOSED })
    const open = new Set(['top-000/one'])
    const before = layoutSphere(entries, { open })
    const at = before.get('top-000/one')
    const obstacle = { x: at.x, y: at.y, z: at.z, radius: 120 }
    const after = layoutSphere(entries, { previous: before, obstacles: [obstacle], open })
    expect(placeOf(after, '')).toEqual(placeOf(before, ''))
    expect(placeOf(after, 'top-000')).toEqual(placeOf(before, 'top-000'))
    expect(placeOf(after, 'top-000/one')).not.toEqual(placeOf(before, 'top-000/one'))
    expectClearOf(entries, after, obstacle)
  })

  it('keeps the root in place when an obstacle covers it', () => {
    const entries = topTree(8)
    const root = { x: 0, y: HUB_CENTER.y - ROOT_DROP, z: 0 }
    const obstacle = { ...root, radius: 500 }
    const cold = layoutSphere(entries, { obstacles: [obstacle] })
    expect(placeOf(cold, '')).toEqual(root)
    expectClearOf(entries, cold, obstacle)
    const warm = layoutSphere(entries, { previous: cold, obstacles: [obstacle] })
    expect(placeOf(warm, '')).toEqual(root)
    expectClearOf(entries, warm, obstacle)
  })

  it('fits only the root and the pinned cards, not every drawn card', () => {
    const card = (path, x, y, z, view) => ({ path, home: { x, y, z }, view })
    const hub = { x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z, r: HUB_RADIUS + 160 }
    const root = card('', 0, HUB_CENTER.y - ROOT_DROP, 0, { path: '', state: 'closed' })
    const pinned = card('src', 1100, HUB_CENTER.y, 0, { path: 'src', state: 'closed', pinned: true })
    const deep = card('src/ui/panels/rows', 0, 11000, 0, { path: 'src/ui/panels/rows', state: 'files', items: [], hiddenItems: 0, pinned: false })
    const spheres = overviewSpheres([root, pinned, deep])
    const sizeOf = (view) => {
      const size = cardSize(view)
      return Math.hypot(size.width, size.height) / 2
    }
    expect(spheres).toHaveLength(2)
    expect(spheres.map((item) => item.r)).toEqual([sizeOf(root.view), sizeOf(pinned.view)])
    const pinnedFit = fitView([hub, ...spheres], { aspect: 1.6 })
    const deeper = card('src/ui/panels/rows/one', 0, 15000, 0, { path: 'src/ui/panels/rows/one', state: 'files', items: [], hiddenItems: 0, pinned: false })
    expect(fitView([hub, ...overviewSpheres([root, pinned, deep, deeper])], { aspect: 1.6 })).toEqual(pinnedFit)
    const all = [root, pinned, deep].map((entry) => {
      const size = cardSize(entry.view)
      return { x: entry.home.x, y: entry.home.y, z: entry.home.z, r: Math.hypot(size.width, size.height) / 2 }
    })
    expect(fitView([hub, ...all], { aspect: 1.6 }).dist).toBeGreaterThan(pinnedFit.dist)
  })
})
