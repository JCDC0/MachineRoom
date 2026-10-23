import { describe, expect, it } from 'vitest'
import { HUB_CENTER, HUB_RADIUS } from '../src/engine/hub.js'
import {
  CARD_CLEARANCE,
  HUB_CLEARANCE,
  POLE_CAP,
  ROOT_DROP,
  SHELL_RADIUS,
  SHELL_STEP,
  SPHERE_CENTER,
  layoutSphere,
  sphereOverlaps,
} from '../src/engine/sphere.js'

const CLOSED = { width: 372, height: 96 }

const fixture = [
  { path: '', width: 450, height: 120 },
  { path: 'src', width: 650, height: 800 },
  { path: 'src/engine', width: 650, height: 500 },
  { path: 'src/model', width: 370, height: 100 },
  { path: 'src/ui', width: 370, height: 100 },
  { path: 'src/ui/panels', width: 370, height: 100 },
  { path: 'docs', width: 370, height: 100 },
  { path: 'docs/guides', width: 370, height: 100 },
  { path: 'test', width: 450, height: 120 },
  { path: 'packages', width: 450, height: 120 },
  { path: 'packages/core', width: 450, height: 120 },
]

const depthOf = (path) => (path === '' ? 0 : path.split('/').length)
const radiusOf = (entry) => Math.hypot(entry.width, entry.height) / 2 + CARD_CLEARANCE / 2
const placeOf = (placed, path) => {
  const at = placed.get(path)
  return { x: at.x, y: at.y, z: at.z }
}

function treeOf(top, children) {
  const entries = [{ path: '', ...CLOSED }]
  for (let i = 0; i < top; i += 1) {
    const name = `top-${String(i).padStart(3, '0')}`
    entries.push({ path: name, ...CLOSED })
    for (let k = 0; k < children; k += 1) entries.push({ path: `${name}/child-${String(k).padStart(3, '0')}`, ...CLOSED })
  }
  return entries
}

function expectApart(entries, placed) {
  expect(sphereOverlaps(entries, placed)).toEqual([])
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i]
    const at = placed.get(a.path)
    expect(at, a.path).toBeTruthy()
    const hubDistance = Math.hypot(at.x - SPHERE_CENTER.x, at.y - SPHERE_CENTER.y, at.z - SPHERE_CENTER.z)
    expect(hubDistance - radiusOf(a)).toBeGreaterThanOrEqual(HUB_CLEARANCE)
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j]
      const other = placed.get(b.path)
      const distance = Math.hypot(at.x - other.x, at.y - other.y, at.z - other.z)
      const needed = (Math.hypot(a.width, a.height) + Math.hypot(b.width, b.height)) / 2 + 40
      expect(distance, `${a.path || 'root'} and ${b.path || 'root'}`).toBeGreaterThanOrEqual(needed - 1e-6)
    }
  }
}

describe('layoutSphere', () => {
  it('gives the same places for the same input', () => {
    const first = layoutSphere(fixture)
    const second = layoutSphere(fixture)
    expect([...first]).toEqual([...second])
  })

  it('keeps cards apart and clear of the hub for a fixture tree', () => {
    expectApart(fixture, layoutSphere(fixture))
  })

  it('keeps 300 folders at depth 1 and 2 apart', () => {
    const entries = treeOf(10, 29)
    expect(entries.filter((entry) => entry.path !== '')).toHaveLength(300)
    expectApart(entries, layoutSphere(entries))
  })

  it('keeps one parent with 80 children apart and near their parent', () => {
    const entries = [{ path: '', ...CLOSED }, { path: 'parent', ...CLOSED }]
    for (let i = 0; i < 80; i += 1) entries.push({ path: `parent/child-${String(i).padStart(2, '0')}`, ...CLOSED })
    const placed = layoutSphere(entries)
    expectApart(entries, placed)
    const parent = placed.get('parent')
    for (const entry of entries.filter((item) => item.path.startsWith('parent/'))) {
      const at = placed.get(entry.path)
      const a = { x: parent.x - SPHERE_CENTER.x, y: parent.y - SPHERE_CENTER.y, z: parent.z - SPHERE_CENTER.z }
      const b = { x: at.x - SPHERE_CENTER.x, y: at.y - SPHERE_CENTER.y, z: at.z - SPHERE_CENTER.z }
      const cosine = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))
      expect(Math.acos(Math.min(1, Math.max(-1, cosine)))).toBeLessThanOrEqual(Math.PI / 2)
    }
  })

  it('keeps every card outside that place when a sibling is added', () => {
    const before = layoutSphere(fixture)
    const entries = [...fixture, { path: 'src/views', width: 370, height: 100 }]
    const after = layoutSphere(entries, { previous: before })
    const group = new Set(['src/ui', 'src/engine', 'src/model', 'src/views', 'src/ui/panels'])
    for (const entry of fixture) {
      if (group.has(entry.path)) continue
      expect(placeOf(after, entry.path), entry.path).toEqual(placeOf(before, entry.path))
    }
    expectApart(entries, after)
  })

  it('keeps every other card in place when a card is removed', () => {
    const before = layoutSphere(fixture)
    const entries = fixture.filter((entry) => entry.path !== 'docs/guides')
    const after = layoutSphere(entries, { previous: before })
    for (const entry of entries) expect(placeOf(after, entry.path), entry.path).toEqual(placeOf(before, entry.path))
    expectApart(entries, after)
  })

  it('keeps a card in place when it grows without overlapping', () => {
    const before = layoutSphere(fixture)
    const entries = fixture.map((entry) => (entry.path === 'test' ? { ...entry, width: entry.width + 80 } : entry))
    const after = layoutSphere(entries, { previous: before })
    for (const entry of fixture) expect(placeOf(after, entry.path), entry.path).toEqual(placeOf(before, entry.path))
    expectApart(entries, after)
  })

  it('moves only the grown card when it grows into another', () => {
    const before = layoutSphere(fixture)
    const entries = fixture.map((entry) => (entry.path === 'src/ui' ? { ...entry, width: entry.width + 1600 } : entry))
    const after = layoutSphere(entries, { previous: before })
    for (const entry of fixture) {
      if (entry.path === 'src/ui') continue
      expect(placeOf(after, entry.path), entry.path).toEqual(placeOf(before, entry.path))
    }
    expect(placeOf(after, 'src/ui')).not.toEqual(placeOf(before, 'src/ui'))
    expectApart(entries, after)
  })

  it('puts each depth on its own shell', () => {
    const entries = [...fixture, { path: 'src/ui/panels/rows', width: 370, height: 100 }]
    const placed = layoutSphere(entries)
    for (const entry of entries) {
      if (entry.path === '') continue
      const at = placed.get(entry.path)
      const distance = Math.hypot(at.x - SPHERE_CENTER.x, at.y - SPHERE_CENTER.y, at.z - SPHERE_CENTER.z)
      expect(distance, entry.path).toBeCloseTo(SHELL_RADIUS + (depthOf(entry.path) - 1) * SHELL_STEP, 6)
    }
    const tops = entries.filter((entry) => depthOf(entry.path) === 1)
    for (const entry of tops) {
      const at = placed.get(entry.path)
      expect(Math.abs(at.y - SPHERE_CENTER.y), entry.path).toBeLessThanOrEqual(Math.cos(POLE_CAP) * SHELL_RADIUS + 1e-6)
    }
  })

  it('puts the root below the hub centre', () => {
    expect(SPHERE_CENTER).toBe(HUB_CENTER)
    const root = layoutSphere(fixture).get('')
    expect(root.x).toBe(0)
    expect(root.z).toBe(0)
    expect(root.y).toBe(HUB_CENTER.y - ROOT_DROP)
    expect(root.y).toBeLessThan(HUB_CENTER.y - HUB_RADIUS)
  })
})
