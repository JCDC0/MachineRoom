import { describe, expect, it } from 'vitest'
import { CARD_SCALES, cardBaseWidth, occluderBox, occluderParts } from '../src/engine/cards.js'

const view = (state, back = 0, items = 0, hiddenItems = 0) => ({
  path: 'src',
  state,
  back,
  items: Array.from({ length: items }, (_, i) => ({ path: `src/f${i}.js`, kind: 'file' })),
  hiddenItems,
})

const inside = (parts, x, y) => parts.some((part) => Math.abs(x - part.x) <= part.width / 2 && Math.abs(y - part.y) <= part.height / 2)

const union = (parts) => {
  const box = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity }
  for (const part of parts) {
    box.left = Math.min(box.left, part.x - part.width / 2)
    box.right = Math.max(box.right, part.x + part.width / 2)
    box.bottom = Math.min(box.bottom, part.y - part.height / 2)
    box.top = Math.max(box.top, part.y + part.height / 2)
  }
  return box
}

describe('occluderBox', () => {
  it('covers the face and the tab of a closed card with no backs', () => {
    expect(occluderBox(view('closed'), 1)).toEqual({ width: 250, height: 74, offsetX: 0, offsetY: 4 })
    const box = occluderBox(view('closed'), CARD_SCALES.closed)
    expect(box.width).toBeCloseTo(250, 6)
    expect(box.height).toBeCloseTo(74, 6)
    expect(box.offsetX).toBeCloseTo(0, 6)
    expect(box.offsetY).toBeCloseTo(4, 6)
  })

  it('covers the face and the tab of an open card with no backs', () => {
    expect(occluderBox(view('open'), 1)).toEqual({ width: 250, height: 74, offsetX: 0, offsetY: 4 })
    const box = occluderBox(view('open'), CARD_SCALES.open)
    expect(box.width).toBeCloseTo(300, 6)
    expect(box.height).toBeCloseTo(88.8, 6)
    expect(box.offsetX).toBeCloseTo(0, 6)
    expect(box.offsetY).toBeCloseTo(4.8, 6)
  })

  it('reaches the first full folder block on a closed card and on an open one', () => {
    expect(occluderBox(view('closed', 1), 1)).toEqual({ width: 262, height: 74, offsetX: -6, offsetY: 4 })
    const closed = occluderBox(view('closed', 1), CARD_SCALES.closed)
    expect(closed.width).toBeCloseTo(262, 6)
    expect(closed.height).toBeCloseTo(74, 6)
    expect(closed.offsetX).toBeCloseTo(-6, 6)
    expect(closed.offsetY).toBeCloseTo(4, 6)
    const open = occluderBox(view('open', 1), CARD_SCALES.open)
    expect(open.width).toBeCloseTo(314.4, 6)
    expect(open.height).toBeCloseTo(88.8, 6)
    expect(open.offsetX).toBeCloseTo(-7.2, 6)
    expect(open.offsetY).toBeCloseTo(4.8, 6)
  })

  it('reaches the third full folder block on a closed card and on an open one', () => {
    expect(occluderBox(view('closed', 3), 1)).toEqual({ width: 286, height: 74, offsetX: -18, offsetY: 4 })
    const closed = occluderBox(view('closed', 3), CARD_SCALES.closed)
    expect(closed.width).toBeCloseTo(286, 6)
    expect(closed.height).toBeCloseTo(74, 6)
    expect(closed.offsetX).toBeCloseTo(-18, 6)
    expect(closed.offsetY).toBeCloseTo(4, 6)
    const open = occluderBox(view('open', 3), CARD_SCALES.open)
    expect(open.width).toBeCloseTo(343.2, 6)
    expect(open.height).toBeCloseTo(88.8, 6)
    expect(open.offsetX).toBeCloseTo(-21.6, 6)
    expect(open.offsetY).toBeCloseTo(4.8, 6)
  })

  it('grows down the file rows of a card that lists files', () => {
    expect(occluderBox(view('files', 0, 4), 1)).toEqual({ width: 250, height: 162, offsetX: 0, offsetY: 4 })
    expect(occluderBox(view('files', 3, 4), 1)).toEqual({ width: 286, height: 162, offsetX: -18, offsetY: 4 })
  })
})

describe('occluderParts', () => {
  it('makes a part for the face, a part for its tab and a block and a tab for each faint folder', () => {
    expect(occluderParts(view('closed'))).toHaveLength(2)
    expect(occluderParts(view('closed', 1))).toHaveLength(4)
    expect(occluderParts(view('closed', 3))).toHaveLength(8)
  })

  it('places the tab at the left of the face, 8 pixels above it, 72 by 8', () => {
    const parts = occluderParts(view('closed'))
    expect(parts[1]).toEqual({ width: 72, height: 8, x: -89, y: 37 })
  })

  it('steps each faint folder 12 pixels left at the face height, block then tab', () => {
    const parts = occluderParts(view('open', 3))
    expect(parts.slice(2)).toEqual([
      { width: 250, height: 66, x: -12, y: 0 },
      { width: 72, height: 8, x: -101, y: 37 },
      { width: 250, height: 66, x: -24, y: 0 },
      { width: 72, height: 8, x: -113, y: 37 },
      { width: 250, height: 66, x: -36, y: 0 },
      { width: 72, height: 8, x: -125, y: 37 },
    ])
  })

  it('matches the bounds of its parts', () => {
    for (const [state, back, scale] of [
      ['closed', 0, 1],
      ['open', 1, 1],
      ['closed', 3, CARD_SCALES.closed],
      ['open', 3, CARD_SCALES.open],
      ['files', 0, CARD_SCALES.files],
    ]) {
      const parts = occluderParts(view(state, back, state === 'files' ? 4 : 0))
      const box = occluderBox(view(state, back, state === 'files' ? 4 : 0), scale)
      const bounds = union(parts)
      expect(box.width).toBeCloseTo((bounds.right - bounds.left) * scale, 6)
      expect(box.height).toBeCloseTo((bounds.top - bounds.bottom) * scale, 6)
      expect(box.offsetX).toBeCloseTo(((bounds.left + bounds.right) / 2) * scale, 6)
      expect(box.offsetY).toBeCloseTo(((bounds.top + bounds.bottom) / 2) * scale, 6)
    }
  })

  it('does not cover the empty corner above the face beside the tab', () => {
    const bare = occluderParts(view('closed'))
    expect(inside(bare, -88, 37)).toBe(true)
    expect(inside(bare, -50, 38)).toBe(false)
    expect(inside(bare, -50, 34)).toBe(false)
  })

  it('sizes the face part from the card name and the face border', () => {
    const long = 'W'.repeat(24)
    const wide = { ...view('closed'), path: long }
    const base = cardBaseWidth(long)
    expect(base).toBeGreaterThan(248)
    expect(occluderParts(wide)[0].width).toBe(base + 2)
    expect(occluderParts(wide)[1].x).toBe(36 - (base + 2) / 2)
    expect(occluderBox(wide, 1).width).toBe(base + 2)
  })

  it('keeps the faint folders at the face height and reaches left of the face', () => {
    const one = occluderParts(view('closed', 1))
    expect(inside(one, -120, 0)).toBe(true)
    expect(inside(one, -110, 50)).toBe(false)
    const three = occluderParts(view('closed', 3))
    expect(inside(three, -160, 0)).toBe(true)
    expect(inside(three, -110, 50)).toBe(false)
  })

  it('does not cover the empty corner below and right of the face', () => {
    expect(inside(occluderParts(view('closed', 1)), 130, -30)).toBe(false)
    expect(inside(occluderParts(view('closed', 3)), 130, -30)).toBe(false)
  })
})
