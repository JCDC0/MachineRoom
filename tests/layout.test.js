import { describe, expect, it } from 'vitest'
import { CARD_DEPTH, CARD_HUB, cardDepth, layoutCards } from '../src/engine/layout.js'

describe('layoutCards', () => {
  const entries = [
    { path: '', width: 450, height: 120 },
    { path: 'src', width: 650, height: 800 },
    { path: 'docs', width: 370, height: 100 },
    { path: 'test', width: 450, height: 120 },
    { path: 'src/ui', width: 370, height: 100 },
    { path: 'src/engine', width: 650, height: 500 },
    { path: 'src/model', width: 370, height: 100 },
  ]
  const size = new Map(entries.map((entry) => [entry.path, entry]))
  const boxes = (layout) =>
    [...layout].map(([path, p]) => ({ path, x: p.x, y: p.y, hw: size.get(path).width / 2, hh: size.get(path).height / 2 }))
  const clash = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh
  const places = (layout) => [...layout].map(([path, p]) => [path, Math.round(p.x), Math.round(p.y), p.z])

  it('is the same every time', () => {
    expect([...layoutCards(entries)]).toEqual([...layoutCards(entries)])
  })

  it('puts the root above the hub, in the middle', () => {
    const root = layoutCards(entries).get('')
    expect(root.x).toBe(0)
    expect(root.y).toBeGreaterThan(CARD_HUB.hh)
  })

  it('keeps cards apart from each other and from the hub', () => {
    const placed = boxes(layoutCards(entries))
    const hub = { x: 0, y: 0, hw: CARD_HUB.hw, hh: CARD_HUB.hh }
    for (let i = 0; i < placed.length; i++) {
      expect(clash(placed[i], hub), `${placed[i].path || 'root'} and the hub`).toBe(false)
      for (let j = i + 1; j < placed.length; j++) {
        expect(clash(placed[i], placed[j]), `${placed[i].path} and ${placed[j].path}`).toBe(false)
      }
    }
  })

  it('keeps every card clear of an obstacle box', () => {
    const obstacle = { x: 0, y: -500, hw: 900, hh: 400 }
    const placed = boxes(layoutCards(entries, null, { obstacles: [obstacle] }))
    for (const card of placed) {
      expect(clash(card, obstacle), `${card.path || 'root'} and the obstacle`).toBe(false)
    }
  })

  it('places the cards as before when no obstacles are given', () => {
    expect(places(layoutCards(entries))).toEqual([
      ['', 0, 415, CARD_DEPTH.root],
      ['docs', 1121, 128, -60],
      ['src', -1260, 128, -60],
      ['src/engine', -1981, 470, 200],
      ['src/model', -1840, 99, 200],
      ['src/ui', -1840, -184, 200],
      ['test', 1047, -416, -60],
    ])
  })

  it('grows each subfolder outward on the side of its parent', () => {
    const layout = layoutCards(entries)
    for (const child of ['src/ui', 'src/engine', 'src/model']) {
      expect(Math.sign(layout.get(child).x)).toBe(Math.sign(layout.get('src').x))
      expect(Math.abs(layout.get(child).x)).toBeGreaterThan(Math.abs(layout.get('src').x))
    }
  })

  it('adds a root card when the list has none', () => {
    expect(layoutCards([{ path: 'src', width: 400, height: 100 }]).has('')).toBe(true)
  })

  it('keeps cards near their place when a card is added', () => {
    const before = layoutCards(entries.slice(0, 4))
    const after = layoutCards(entries, before)
    for (const path of ['docs', 'test']) {
      const a = before.get(path)
      const b = after.get(path)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(150)
    }
  })

  it('brings deeper folders toward the camera, up to a limit', () => {
    expect(cardDepth('')).toBe(CARD_DEPTH.root)
    expect(cardDepth('src')).toBeGreaterThan(cardDepth(''))
    expect(cardDepth('src/ui')).toBeGreaterThan(cardDepth('src'))
    expect(cardDepth('a/b/c/d/e/f')).toBe(CARD_DEPTH.max)
    expect(layoutCards(entries).get('src/ui').z).toBe(cardDepth('src/ui'))
  })
})
