import { describe, expect, it } from 'vitest'
import { cardSize, overviewSpheres } from '../src/engine/cards.js'
import { fitView } from '../src/engine/camera.js'
import { HUB_CENTER, HUB_RADIUS } from '../src/engine/hub.js'
import {
  FAN_LIMIT,
  FOLDER_DRIFT_RADIUS,
  FOLDER_SPACING_MIN,
  FOLDER_SPACING_MAX,
  FOLDER_SPACING_DEFAULT,
  clampFolderSpacing,
  RING_BACK,
  RING_CENTER,
  RING_FRONT,
  RING_MAX_TOP,
  RING_RIGHT,
  ROOT_AHEAD,
  ROOT_DROP,
  ROOT_PLACE,
  SPRAY_LIFT,
  TOP_MIN_RADIUS,
  folderDrift,
  layoutRing,
  orbitPlace,
  ringOf,
  ringRotation,
  ringRadius,
  shotgunOffset,
} from '../src/engine/ring.js'

const EPS = 1e-6
const filesView = (items = 0) => ({
  path: 'card',
  state: 'files',
  items: Array.from({ length: items }, (_, index) => ({ path: `card/f${index}.js`, kind: 'file' })),
  hiddenItems: 0,
})
const FILES = cardSize(filesView())
const WIDE = cardSize({ ...filesView(10), path: 'a-very-long-folder-name' })
const TALL = cardSize(filesView(10))

const rootEntry = () => ({ path: '', ...FILES })
const topEntry = (index) => ({ path: `top-${String(index).padStart(3, '0')}`, ...FILES })

function topTree(count) {
  return [rootEntry(), ...Array.from({ length: count }, (_, index) => topEntry(index))]
}

const placeOf = (placed, path) => {
  const at = placed.get(path)
  expect(at, path).toBeTruthy()
  return at
}

const acrossOf = (at) => (at.x - RING_CENTER.x) * RING_RIGHT.x + (at.z - RING_CENTER.z) * RING_RIGHT.z
const spotOf = (at) => ({ x: at.x, y: at.y, z: at.z })
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
const backOf = (at) => (at.x - RING_CENTER.x) * RING_BACK.x + (at.z - RING_CENTER.z) * RING_BACK.z

function boxOf(at, size) {
  return {
    left: acrossOf(at) - size.width / 2,
    right: acrossOf(at) + size.width / 2,
    bottom: backOf(at) - size.height / 2,
    top: backOf(at) + size.height / 2,
  }
}

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom
}

describe('the flat ring', () => {
  it('puts the first folder at twelve and the rest clockwise at equal angles', () => {
    for (const count of [1, 3, 12]) {
      const entries = topTree(count)
      const placed = layoutRing(entries)
      const sizes = entries.filter((entry) => entry.path !== '')
      const radius = ringRadius(count)
      sizes.forEach((entry, index) => {
        const at = placeOf(placed, entry.path)
        const spot = ringOf(at)
        expect(spot.angle, `${count} folders, ${entry.path}`).toBeCloseTo((index / count) * Math.PI * 2, 6)
        expect(spot.radius, entry.path).toBeCloseTo(radius, 6)
        expect(at.y, entry.path).toBe(HUB_CENTER.y)
      })
      const first = ringOf(placeOf(placed, 'top-000'))
      expect(first.angle).toBeCloseTo(0, 6)
      expect(backOf(placeOf(placed, 'top-000'))).toBeCloseTo(radius, 6)
      expect(acrossOf(placeOf(placed, 'top-000'))).toBeCloseTo(0, 6)
    }
  })

  it('caps the base ring at twelve and sprays the extra folders behind it', () => {
    const entries = topTree(17)
    const placed = layoutRing(entries)
    const tops = entries.filter((entry) => entry.path !== '')
    const base = tops.slice(0, RING_MAX_TOP)
    const overflow = tops.slice(RING_MAX_TOP)
    const radius = ringRadius(RING_MAX_TOP)
    expect(RING_MAX_TOP).toBe(12)
    expect(overflow).toHaveLength(5)
    base.forEach((entry, index) => {
      const spot = ringOf(placeOf(placed, entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius, 6)
      expect(turn(spot.angle, (index / RING_MAX_TOP) * Math.PI * 2), entry.path).toBeCloseTo(0, 6)
    })
    overflow.forEach((entry, index) => {
      const off = shotgunOffset(index, overflow.length, undefined, radius)
      const spot = ringOf(placeOf(placed, entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius + off.radiusStep, 6)
      expect(turn(spot.angle, (RING_MAX_TOP - 1.5) / RING_MAX_TOP * Math.PI * 2 + off.angleOffset), entry.path).toBeCloseTo(0, 6)
    })
    const nearest = Math.min(...overflow.map((entry) => ringOf(placeOf(placed, entry.path)).radius))
    expect(nearest).toBeGreaterThan(radius)
  })

  it('keeps the first overflow card apart from the first top child', () => {
    const size = cardSize({ ...filesView(6), maxFiles: 6 })
    const entries = [...topTree(RING_MAX_TOP + 1), { path: 'top-000/only', ...size }]
    for (const spacing of [600, 1200, 2000]) {
      const placed = layoutRing(entries, { spacing })
      const child = placed.get('top-000/only')
      const overflow = placed.get(topEntry(RING_MAX_TOP).path)
      const distance = Math.hypot(child.x - overflow.x, child.z - overflow.z)
      expect(distance).toBeGreaterThanOrEqual(Math.hypot(size.width, size.height) + 2 * FOLDER_DRIFT_RADIUS - EPS)
    }
  })

  it('keeps the base ring still when the overflow grows', () => {
    const before = layoutRing(topTree(13))
    const after = layoutRing(topTree(16), { previous: before })
    for (let index = 0; index < RING_MAX_TOP; index += 1) {
      const path = topEntry(index).path
      expect(spotOf(placeOf(after, path)), path).toEqual(spotOf(placeOf(before, path)))
    }
    expect(placeOf(after, topEntry(15).path)).toBeTruthy()
  })

  it('grows its radius with the count and spacing', () => {
    for (const spacing of [600, 1200, 2000]) {
      expect(ringRadius(0, spacing)).toBe(TOP_MIN_RADIUS * spacing / 1200)
      expect(ringRadius(1, spacing)).toBe(TOP_MIN_RADIUS * spacing / 1200)
      expect(ringRadius(12, spacing) * Math.PI * 2 / 12).toBeGreaterThanOrEqual(spacing - EPS)
      expect(ringRadius(30, spacing)).toBeGreaterThan(ringRadius(12, spacing))
    }
    expect(ringRadius(12, 2000)).toBeGreaterThan(ringRadius(12, 600))
  })

  it('keeps default top siblings apart through their drift', () => {
    const size = cardSize({ ...filesView(6), maxFiles: 6 })
    const entries = topTree(RING_MAX_TOP).map((entry) => ({ ...entry, ...size }))
    for (const spacing of [600, 1200, 2000]) {
      const placed = layoutRing(entries, { spacing })
      const tops = entries.slice(1).map((entry) => placed.get(entry.path))
      for (let i = 0; i < tops.length; i += 1) {
        for (let j = i + 1; j < tops.length; j += 1) {
          const distance = Math.hypot(tops[i].x - tops[j].x, tops[i].z - tops[j].z)
          expect(distance - 2 * FOLDER_DRIFT_RADIUS).toBeGreaterThanOrEqual(Math.hypot(size.width, size.height) - EPS)
        }
      }
    }
  })

  it('keeps every pair of top-level cards apart', () => {
    const entries = topTree(12)
    entries[3] = { path: entries[3].path, ...WIDE }
    entries[7] = { path: entries[7].path, ...TALL }
    const placed = layoutRing(entries)
    const tops = entries.filter((entry) => entry.path !== '')
    for (let i = 0; i < tops.length; i += 1) {
      for (let j = i + 1; j < tops.length; j += 1) {
        const a = placeOf(placed, tops[i].path)
        const b = placeOf(placed, tops[j].path)
        const apart = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        const needed = Math.hypot(tops[i].width, tops[i].height) / 2 + Math.hypot(tops[j].width, tops[j].height) / 2
        expect(apart, `${tops[i].path} and ${tops[j].path}`).toBeGreaterThanOrEqual(needed - EPS)
        expect(overlap(boxOf(a, tops[i]), boxOf(b, tops[j]))).toBe(false)
      }
    }
  })

  it('keeps the same ring radius when a folder grows', () => {
    const entries = topTree(12)
    const spacing = 800
    const before = layoutRing(entries, { spacing })
    const tall = cardSize({ ...filesView(20), path: 'W'.repeat(24), back: 3 })
    const grown = entries.map((entry) => (entry.path === 'top-000' ? { path: entry.path, ...tall } : entry))
    const after = layoutRing(grown, { spacing, previous: before })
    expect(after.get('top-000').height).toBeGreaterThan(before.get('top-000').height)
    for (const { path } of grown) {
      expect(spotOf(placeOf(after, path)), path).toEqual(spotOf(placeOf(before, path)))
    }
  })

  it('keeps two fully expanded faces apart when they share a plane at 800', () => {
    const entries = ['M'.repeat(24), 'W'.repeat(24)].map((path) => ({
      path,
      ...cardSize({ ...filesView(20), path, back: 3 }),
    }))
    const [a, b] = entries
    for (const small of [false, true]) {
      const placed = layoutRing(entries, { spacing: 800, small })
      const first = placed.get(a.path)
      const second = placed.get(b.path)
      const distance = Math.hypot(first.x - second.x, first.z - second.z)
      const width = (a.width + b.width) / 2 * 1.02
      expect(distance - 80).toBeGreaterThan(width)
    }
  })

  it('puts the root beneath the hub circle at the centre', () => {
    const entries = topTree(12)
    const placed = layoutRing(entries)
    const root = placeOf(placed, '')
    const fromHub = Math.hypot(root.x - HUB_CENTER.x, root.z - HUB_CENTER.z)
    expect(ROOT_AHEAD).toBe(0)
    expect(ROOT_DROP).toBe(240)
    expect(fromHub).toBe(0)
    expect(root.x).toBe(HUB_CENTER.x)
    expect(root.z).toBe(HUB_CENTER.z)
    expect((root.x - HUB_CENTER.x) * RING_FRONT.x + (root.z - HUB_CENTER.z) * RING_FRONT.z).toBe(0)
    expect(root.y + root.height / 2).toBeCloseTo(HUB_CENTER.y - ROOT_DROP, 6)
    expect(root.y).toBeLessThan(HUB_CENTER.y)
    expect(root.y).toBeGreaterThan(HUB_CENTER.y - HUB_RADIUS)
    expect({ x: root.x, z: root.z }).toEqual({ x: ROOT_PLACE.x, z: ROOT_PLACE.z })
  })

  it('drops the root far enough below the ring to clear its front edge at the overview pitch', () => {
    const placed = layoutRing([rootEntry()])
    const root = placeOf(placed, '')
    expect(ROOT_DROP).toBeGreaterThanOrEqual(200)
    expect(root.y + root.height / 2).toBeLessThanOrEqual(HUB_CENTER.y - 200)
  })

  it('keeps the root top edge below the hub however many files it lists', () => {
    const short = layoutRing([rootEntry()])
    const tall = layoutRing([{ path: '', ...cardSize(filesView(40)) }])
    const flat = placeOf(short, '')
    const grown = placeOf(tall, '')
    expect(grown.height).toBeGreaterThan(flat.height)
    expect(grown.y).toBeLessThan(flat.y)
    expect(flat.y + flat.height / 2).toBeCloseTo(HUB_CENTER.y - ROOT_DROP, 6)
    expect(grown.y + grown.height / 2).toBeCloseTo(HUB_CENTER.y - ROOT_DROP, 6)
  })

  it('keeps every top-level folder on the plane of the hub', () => {
    const placed = layoutRing(topTree(8))
    for (const [path, at] of placed) {
      if (path === '') continue
      expect(at.y, path).toBe(HUB_CENTER.y)
    }
  })
})

describe('folder orbit', () => {
  it('turns the ring once in 480 seconds with bounded path-specific drift', () => {
    const place = { x: 0, y: RING_CENTER.y, z: 900 }
    const first = folderDrift('src')
    const second = folderDrift('src/ui')
    expect(folderDrift('src')).toEqual(first)
    expect(second).not.toEqual(first)
    expect(ringRotation(480)).toEqual(ringRotation(0))
    expect(ringRotation(120).cos).toBeCloseTo(0, 8)
    expect(ringRotation(120).sin).toBeCloseTo(1, 8)
    for (const drift of [first, second, folderDrift('')]) {
      expect(drift.period).toBeGreaterThanOrEqual(24)
      expect(drift.period).toBeLessThanOrEqual(48)
      for (const seconds of [0, 120, 480]) {
        const rotation = ringRotation(seconds)
        const at = orbitPlace(place, rotation, drift, seconds)
        expect(Math.hypot(at.x + 900 * rotation.sin, at.z - 900 * rotation.cos)).toBeCloseTo(40, 8)
        expect(at.y).toBe(place.y)
      }
    }
    expect(orbitPlace(place, ringRotation(120), first, 120)).not.toEqual(orbitPlace(place, ringRotation(120), second, 120))
  })
})

describe('the shotgun spray', () => {
  it('clamps the spacing and uses the new default', () => {
    expect([FOLDER_SPACING_MIN, FOLDER_SPACING_MAX, FOLDER_SPACING_DEFAULT]).toEqual([600, 2000, 1200])
    expect([clampFolderSpacing(1), clampFolderSpacing(9999), clampFolderSpacing('bad'), clampFolderSpacing(1349)]).toEqual([600, 2000, 1200, 1300])
  })
  it('spreads inner siblings and rows with the slider, without overlapping open cards of the default size', () => {
    const size = cardSize({ ...filesView(6), maxFiles: 6 })
    const entries = [rootEntry(), { path: 'src', ...size }, ...Array.from({ length: 20 }, (_, i) => ({ path: 'src/c' + String(i).padStart(2, '0'), ...size }))]
    const gaps = []
    for (const spacing of [600, 1200, 2000]) {
      const placed = layoutRing(entries, { spacing })
      const parent = ringOf(placed.get('src'))
      const children = entries.slice(2).map((entry, i) => ({ ...ringOf(placed.get(entry.path)), off: shotgunOffset(i, 20, spacing, parent.radius), at: placed.get(entry.path) }))
      expect(new Set(children.map((child) => child.off.row)).size).toBeGreaterThan(1)
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i]
        expect(Math.abs(turn(child.angle, parent.angle))).toBeLessThanOrEqual(FAN_LIMIT + EPS)
        expect(child.radius - parent.radius).toBeGreaterThanOrEqual(0.6 * spacing - EPS)
        for (let j = i + 1; j < children.length; j += 1) {
          const other = children[j]
          const distance = Math.hypot(child.at.x - other.at.x, child.at.z - other.at.z)
          expect(distance - 2 * FOLDER_DRIFT_RADIUS).toBeGreaterThanOrEqual(Math.hypot(size.width, size.height) - EPS)
          if (child.off.row === other.off.row && other.off.col === child.off.col + 1) expect(child.radius * Math.abs(turn(child.angle, other.angle))).toBeGreaterThanOrEqual(0.6 * spacing - EPS)
          if (other.off.row === child.off.row + 1) expect(other.radius - child.radius).toBeGreaterThanOrEqual(0.6 * spacing - EPS)
        }
      }
      gaps.push(children[0].radius * Math.abs(turn(children[0].angle, children[1].angle)))
      const lone = layoutRing(entries.slice(0, 3), { spacing })
      expect(ringOf(lone.get('src/c00')).radius - ringOf(lone.get('src')).radius).toBeGreaterThanOrEqual(0.6 * spacing - EPS)
    }
    expect(gaps[1]).toBeGreaterThan(gaps[0])
    expect(gaps[2]).toBeGreaterThan(gaps[1])
  })
  it('keeps every other place when an inner folder grows', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }, ...['a', 'b', 'c'].map((name) => ({ path: 'src/' + name, ...FILES }))]
    const grown = entries.map((entry) => entry.path === 'src/a' ? { ...entry, ...cardSize({ ...filesView(20), maxFiles: 20 }) } : entry)
    for (const spacing of [600, 2000]) {
      const before = layoutRing(entries, { spacing })
      const after = layoutRing(grown, { spacing })
      for (const { path } of entries) expect(spotOf(after.get(path))).toEqual(spotOf(before.get(path)))
    }
  })
})

describe('the folder levels', () => {
  const tree = () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }]
    for (const name of ['a', 'b', 'c']) entries.push({ path: `src/${name}`, ...FILES })
    entries.push({ path: 'src/b/deep', ...FILES })
    entries.push({ path: 'src/b/deep/more', ...FILES })
    return entries
  }

  it('steps a single child outward on its parent line', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }, { path: 'src/only', ...FILES }]
    const placed = layoutRing(entries)
    const parent = ringOf(placeOf(placed, 'src'))
    const child = ringOf(placeOf(placed, 'src/only'))
    expect(child.radius).toBeCloseTo(parent.radius + shotgunOffset(0, 1).radiusStep, 6)
    expect(child.angle).toBeCloseTo(parent.angle, 6)
    expect(placeOf(placed, 'src/only').y).toBe(HUB_CENTER.y)
  })

  it('sprays several children outward in rows', () => {
    const placed = layoutRing(tree())
    const parent = ringOf(placeOf(placed, 'src'))
    const kids = ['src/a', 'src/b', 'src/c'].map((path, index) => ({ path, index, spot: ringOf(placeOf(placed, path)) }))
    for (const kid of kids) {
      const off = shotgunOffset(kid.index, 3, undefined, parent.radius)
      expect(kid.spot.radius, kid.path).toBeCloseTo(parent.radius + off.radiusStep, 6)
      expect(turn(kid.spot.angle, parent.angle), kid.path).toBeCloseTo(off.angleOffset, 6)
      expect(placeOf(placed, kid.path).y, kid.path).toBe(HUB_CENTER.y)
    }
    expect(turn(kids[0].spot.angle, parent.angle)).toBeLessThan(0)
    expect(turn(kids[1].spot.angle, parent.angle)).toBeGreaterThan(0)
    expect(turn(kids[2].spot.angle, parent.angle)).toBeCloseTo(0, 6)
    expect(kids[2].spot.radius).toBeGreaterThan(kids[0].spot.radius)
  })

  it('spreads many children into distinct rows and columns', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }]
    for (let index = 0; index < 12; index += 1) entries.push({ path: `src/c${String(index).padStart(2, '0')}`, ...FILES })
    const placed = layoutRing(entries)
    const parent = ringOf(placeOf(placed, 'src'))
    const kids = entries
      .filter((entry) => entry.path.startsWith('src/'))
      .map((entry) => ({ radius: ringOf(placeOf(placed, entry.path)).radius, turn: turn(ringOf(placeOf(placed, entry.path)).angle, parent.angle) }))
    expect(new Set(kids.map((kid) => `${kid.radius.toFixed(6)}:${kid.turn.toFixed(6)}`)).size).toBe(12)
    const radii = [...new Set(kids.map((kid) => kid.radius.toFixed(6)))].map(Number).sort((a, b) => a - b)
    expect(radii).toHaveLength(3)
    for (let index = 1; index < radii.length; index += 1) expect(radii[index] - radii[index - 1]).toBeCloseTo(shotgunOffset(0, 1).radiusStep, 5)
    for (const radius of radii) {
      const turns = kids
        .filter((kid) => kid.radius.toFixed(6) === radius.toFixed(6))
        .map((kid) => kid.turn)
        .sort((a, b) => a - b)
      expect(turns).toHaveLength(4)
      for (let index = 1; index < turns.length; index += 1) expect(turns[index] - turns[index - 1]).toBeGreaterThan(0.01)
    }
    const turns = kids.map((kid) => kid.turn).sort((a, b) => a - b)
    expect(turns[0]).toBeGreaterThanOrEqual(-FAN_LIMIT - EPS)
    expect(turns.at(-1)).toBeLessThanOrEqual(FAN_LIMIT + EPS)
  })

  it('steps each deeper level one more step out', () => {
    const placed = layoutRing(tree())
    const src = ringOf(placeOf(placed, 'src'))
    const b = ringOf(placeOf(placed, 'src/b'))
    const deep = ringOf(placeOf(placed, 'src/b/deep'))
    const more = ringOf(placeOf(placed, 'src/b/deep/more'))
    expect(b.radius).toBeCloseTo(src.radius + shotgunOffset(0, 1).radiusStep, 6)
    expect(deep.radius).toBeCloseTo(b.radius + shotgunOffset(0, 1).radiusStep, 6)
    expect(more.radius).toBeCloseTo(deep.radius + shotgunOffset(0, 1).radiusStep, 6)
    expect(deep.angle).toBeCloseTo(b.angle, 6)
    expect(more.angle).toBeCloseTo(deep.angle, 6)
  })

  it('gives the same places for the same input, cold and warm', () => {
    const entries = tree()
    const cold = layoutRing(entries)
    expect([...layoutRing(entries)]).toEqual([...cold])
    expect([...layoutRing(entries, { previous: cold })]).toEqual([...cold])
  })

  it('keeps every other card in place when one level is added below a sibling', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }, { path: 'src/a', ...FILES }, { path: 'src/b', ...FILES }]
    const before = layoutRing(entries)
    const grown = [...entries, { path: 'src/a/one', ...FILES }]
    const after = layoutRing(grown, { previous: before })
    for (const entry of entries) {
      expect(spotOf(placeOf(after, entry.path)), entry.path).toEqual(spotOf(placeOf(before, entry.path)))
    }
  })

  it('moves a folder to its new line when its slot changes', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }, { path: 'src/a', ...FILES }]
    const before = layoutRing(entries)
    const grown = [...entries, { path: 'src/b', ...FILES }]
    const after = layoutRing(grown, { previous: before })
    expect(spotOf(placeOf(after, 'src/a'))).not.toEqual(spotOf(placeOf(before, 'src/a')))
    expect(ringOf(placeOf(after, 'src/a')).radius).toBeCloseTo(ringOf(placeOf(after, 'src')).radius + shotgunOffset(0, 1).radiusStep, 6)
  })

  it('places every card of a long folder chain in one pass', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }]
    let path = 'src'
    for (let level = 0; level < 2000; level += 1) {
      path = `${path}/d`
      entries.push({ path, ...FILES })
    }
    const placed = layoutRing(entries)
    expect(placed.size).toBe(entries.length)
    expect(ringOf(placeOf(placed, path)).radius).toBeGreaterThan(ringOf(placeOf(placed, 'src')).radius)
  })
})

describe('the click spray', () => {
  it('lifts the clicked card out of the plane and leaves the rest flat', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }, { path: 'src/a', ...FILES }, { path: 'docs', ...FILES }]
    const flat = layoutRing(entries)
    const sprayed = layoutRing(entries, { sprayed: new Set(['src']) })
    expect(placeOf(sprayed, 'src').y).toBe(HUB_CENTER.y + SPRAY_LIFT)
    expect(placeOf(flat, 'src').y).toBe(HUB_CENTER.y)
    expect(placeOf(sprayed, '').y).toBe(placeOf(flat, '').y)
    expect(spotOf(placeOf(sprayed, 'docs'))).toEqual(spotOf(placeOf(flat, 'docs')))
    expect(spotOf(placeOf(sprayed, 'src/a'))).toEqual(spotOf(placeOf(flat, 'src/a')))
  })

  it('sprays the clicked folder children outward, then folds them back', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }]
    const source = [...entries, { path: 'src/a', ...FILES }, { path: 'src/b', ...FILES }]
    const flat = layoutRing(entries)
    const sprayed = layoutRing(source, { sprayed: new Set(['src']) })
    const parent = ringOf(placeOf(flat, 'src'))
    for (const path of ['src/a', 'src/b']) {
      const child = ringOf(placeOf(sprayed, path))
      expect(child.radius).toBeCloseTo(parent.radius + shotgunOffset(0, 2).radiusStep, 6)
    }
    const folded = layoutRing(entries, { previous: sprayed, sprayed: new Set() })
    expect(placeOf(folded, 'src').y).toBe(HUB_CENTER.y)
    expect(folded.has('src/a')).toBe(false)
  })
})

describe('the overview fit', () => {
  it('fits the hub, the root and the ring from the overview angle, aimed at the hub', () => {
    const card = (path, at, view) => ({ path, home: { x: at.x, y: at.y, z: at.z }, view })
    const hub = { x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z, r: HUB_RADIUS + 160 }
    const placed = layoutRing(topTree(12))
    const root = card('', placeOf(placed, ''), { path: '', state: 'files', items: [], hiddenItems: 0 })
    const top = card('top-000', placeOf(placed, 'top-000'), { path: 'top-000', state: 'files', items: [], hiddenItems: 0 })
    const deep = card('top-000/one/two', { x: 0, y: HUB_CENTER.y, z: 11000 }, { path: 'top-000/one/two', state: 'files', items: [], hiddenItems: 0, pinned: true })
    const spheres = overviewSpheres([root, top, deep])
    expect(spheres).toHaveLength(2)
    expect(spheres.map((item) => item.y)).toEqual([root.home.y, top.home.y])
    const fit = fitView([hub, ...spheres], { aspect: 1.6, center: HUB_CENTER })
    expect(fit.target).toEqual({ x: HUB_CENTER.x, y: HUB_CENTER.y, z: HUB_CENTER.z })
    expect(fit.dist).toBeGreaterThanOrEqual(900)
    const deeper = card('top-000/one/two/three', { x: 0, y: HUB_CENTER.y, z: 20000 }, { path: 'top-000/one/two/three', state: 'files', items: [], hiddenItems: 0, pinned: true })
    expect(fitView([hub, ...overviewSpheres([root, top, deep, deeper])], { aspect: 1.6, center: HUB_CENTER })).toEqual(fit)
  })
})
