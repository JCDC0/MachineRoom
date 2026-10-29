import { describe, expect, it } from 'vitest'
import { cardSize, overviewSpheres } from '../src/engine/cards.js'
import { fitView } from '../src/engine/camera.js'
import { HUB_CENTER, HUB_RADIUS } from '../src/engine/hub.js'
import {
  CARD_GAP,
  CHILD_STEP,
  FAN_LIMIT,
  FAN_STEP,
  RING_BACK,
  RING_CENTER,
  RING_FRONT,
  RING_MAX_TOP,
  RING_RIGHT,
  ROOT_AHEAD,
  ROOT_DROP,
  ROOT_PLACE,
  SHOTGUN_ROW_STEP,
  SPRAY_LIFT,
  TOP_MIN_RADIUS,
  fanAngle,
  layoutRing,
  ringOf,
  ringRadius,
  shotgunOffset,
} from '../src/engine/ring.js'

const EPS = 1e-6
const stepFor = (count) => Math.min(0.38, FAN_STEP * (1 + Math.min(count, 20) * 0.035))
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
      const radius = ringRadius(count, sizes)
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
    const radius = ringRadius(RING_MAX_TOP, base)
    expect(RING_MAX_TOP).toBe(12)
    expect(overflow).toHaveLength(5)
    base.forEach((entry, index) => {
      const spot = ringOf(placeOf(placed, entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius, 6)
      expect(turn(spot.angle, (index / RING_MAX_TOP) * Math.PI * 2), entry.path).toBeCloseTo(0, 6)
    })
    overflow.forEach((entry, index) => {
      const off = shotgunOffset(index, overflow.length)
      const spot = ringOf(placeOf(placed, entry.path))
      expect(spot.radius, entry.path).toBeCloseTo(radius + off.radiusStep, 6)
      expect(turn(spot.angle, off.angleOffset), entry.path).toBeCloseTo(0, 6)
    })
    const nearest = Math.min(...overflow.map((entry) => ringOf(placeOf(placed, entry.path)).radius))
    expect(nearest).toBeGreaterThan(radius)
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

  it('grows its radius with the count and never goes under 900 from the hub', () => {
    expect(TOP_MIN_RADIUS).toBe(900)
    expect(ringRadius(0, [])).toBe(TOP_MIN_RADIUS)
    expect(ringRadius(1, [FILES])).toBe(TOP_MIN_RADIUS)
    expect(ringRadius(3, [FILES, FILES, FILES])).toBe(TOP_MIN_RADIUS)
    const twelve = ringRadius(12, Array.from({ length: 12 }, () => FILES))
    const thirty = ringRadius(30, Array.from({ length: 30 }, () => FILES))
    expect(twelve).toBeGreaterThan(TOP_MIN_RADIUS)
    expect(thirty).toBeGreaterThan(twelve)
    expect(twelve).toBeGreaterThanOrEqual((Math.hypot(FILES.width, FILES.height) + CARD_GAP) / (2 * Math.sin(Math.PI / 12)) - EPS)
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

  it('grows the ring when a top card grows on a warm start', () => {
    const entries = topTree(12)
    const before = layoutRing(entries)
    const grown = entries.map((entry) => (entry.path === 'top-000' ? { path: entry.path, ...TALL } : entry))
    const after = layoutRing(grown, { previous: before })
    const sizes = grown.filter((entry) => entry.path !== '')
    const radius = ringRadius(12, sizes)
    expect(radius).toBeGreaterThan(ringOf(placeOf(before, 'top-000')).radius)
    for (const entry of sizes) expect(ringOf(placeOf(after, entry.path)).radius).toBeCloseTo(radius, 6)
    for (let i = 0; i < sizes.length; i += 1) {
      for (let j = i + 1; j < sizes.length; j += 1) {
        const a = placeOf(after, sizes[i].path)
        const b = placeOf(after, sizes[j].path)
        const apart = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        const needed = Math.hypot(sizes[i].width, sizes[i].height) / 2 + Math.hypot(sizes[j].width, sizes[j].height) / 2
        expect(apart, `${sizes[i].path} and ${sizes[j].path}`).toBeGreaterThanOrEqual(needed - EPS)
      }
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

describe('the shotgun spray', () => {
  it('steps a lone folder outward on the parent line', () => {
    for (const count of [0, 1]) {
      expect(shotgunOffset(0, count)).toEqual({ angleOffset: 0, radiusStep: CHILD_STEP, row: 0, col: 0, cols: 1, rows: 1 })
    }
  })

  it('arranges four folders in a two by two grid', () => {
    const four = [0, 1, 2, 3].map((index) => shotgunOffset(index, 4))
    const step = stepFor(4)
    expect(four.map((off) => [off.row, off.col])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ])
    expect(four.map((off) => off.cols)).toEqual([2, 2, 2, 2])
    expect(four.map((off) => off.rows)).toEqual([2, 2, 2, 2])
    expect(four.map((off) => off.angleOffset)).toEqual([-step / 2, step / 2, -step / 2, step / 2])
    expect(four.map((off) => off.radiusStep)).toEqual([
      CHILD_STEP,
      CHILD_STEP,
      CHILD_STEP + SHOTGUN_ROW_STEP,
      CHILD_STEP + SHOTGUN_ROW_STEP,
    ])
  })

  it('spreads wider and deeper as the folder count grows', () => {
    expect(SHOTGUN_ROW_STEP).toBe(380)
    const nine = shotgunOffset(8, 9)
    expect([nine.cols, nine.rows, nine.row, nine.col]).toEqual([3, 3, 2, 2])
    expect(nine.radiusStep).toBe(CHILD_STEP + 2 * SHOTGUN_ROW_STEP)
    const twenty = shotgunOffset(19, 20)
    expect([twenty.cols, twenty.rows, twenty.row, twenty.col]).toEqual([5, 4, 3, 4])
    expect(twenty.radiusStep).toBe(CHILD_STEP + 3 * SHOTGUN_ROW_STEP)
    expect(Math.abs(shotgunOffset(1, 20).angleOffset)).toBeGreaterThan(Math.abs(shotgunOffset(1, 2).angleOffset) / 2)
    const step = shotgunOffset(1, 20).angleOffset - shotgunOffset(0, 20).angleOffset
    expect(step).toBeCloseTo(Math.min(0.38, FAN_STEP * 1.7), 6)
  })

  it('keeps fanAngle as the shotgun angle', () => {
    expect(fanAngle(0, 1)).toBe(0)
    for (let index = 0; index < 7; index += 1) {
      expect(fanAngle(index, 7)).toBeCloseTo(shotgunOffset(index, 7).angleOffset, 12)
    }
  })

  it('places four child folders in a two by two grid', () => {
    const entries = [rootEntry(), { path: 'src', ...FILES }]
    for (const name of ['a', 'b', 'c', 'd']) entries.push({ path: `src/${name}`, ...FILES })
    const placed = layoutRing(entries)
    const parent = ringOf(placeOf(placed, 'src'))
    const step = stepFor(4)
    ;['a', 'b', 'c', 'd'].forEach((name, index) => {
      const off = shotgunOffset(index, 4)
      const spot = ringOf(placeOf(placed, `src/${name}`))
      expect(spot.radius, name).toBeCloseTo(parent.radius + off.radiusStep, 6)
      expect(turn(spot.angle, parent.angle + off.angleOffset), name).toBeCloseTo(0, 6)
      expect(placeOf(placed, `src/${name}`).y, name).toBe(HUB_CENTER.y)
    })
    expect(turn(ringOf(placeOf(placed, 'src/a')).angle, parent.angle)).toBeCloseTo(-step / 2, 6)
    expect(turn(ringOf(placeOf(placed, 'src/d')).angle, parent.angle)).toBeCloseTo(step / 2, 6)
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
    expect(child.radius).toBeCloseTo(parent.radius + CHILD_STEP, 6)
    expect(child.angle).toBeCloseTo(parent.angle, 6)
    expect(placeOf(placed, 'src/only').y).toBe(HUB_CENTER.y)
  })

  it('sprays several children outward in rows', () => {
    const placed = layoutRing(tree())
    const parent = ringOf(placeOf(placed, 'src'))
    const kids = ['src/a', 'src/b', 'src/c'].map((path, index) => ({ path, index, spot: ringOf(placeOf(placed, path)) }))
    for (const kid of kids) {
      const off = shotgunOffset(kid.index, 3)
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
    for (let index = 1; index < radii.length; index += 1) expect(radii[index] - radii[index - 1]).toBeCloseTo(SHOTGUN_ROW_STEP, 6)
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
    expect(b.radius).toBeCloseTo(src.radius + CHILD_STEP, 6)
    expect(deep.radius).toBeCloseTo(b.radius + CHILD_STEP, 6)
    expect(more.radius).toBeCloseTo(deep.radius + CHILD_STEP, 6)
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
    expect(ringOf(placeOf(after, 'src/a')).radius).toBeCloseTo(ringOf(placeOf(after, 'src')).radius + CHILD_STEP, 6)
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
      expect(child.radius).toBeCloseTo(parent.radius + CHILD_STEP, 6)
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
