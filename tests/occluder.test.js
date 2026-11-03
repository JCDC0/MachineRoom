import { describe, expect, it } from 'vitest'
import {
  BACK_STEP,
  CARD_FACE_BORDER,
  CARD_FACE_EDGE,
  CARD_PAD,
  CARD_SCALES,
  CARD_TAB_H,
  CARD_TAB_LEFT,
  CARD_TAB_TOP,
  CARD_TAB_W,
  CARD_W,
  HEAD_H,
  ROW_H,
  cardBaseWidth,
  occluderBox,
  occluderParts,
} from '../src/engine/cards.js'

const FACE_W = CARD_W + CARD_FACE_BORDER
const FACE_H = HEAD_H + CARD_PAD + CARD_FACE_BORDER
const BOX_H = FACE_H + CARD_TAB_H
const TAB_X = CARD_TAB_LEFT + CARD_FACE_EDGE + CARD_TAB_W / 2 - FACE_W / 2
const TAB_Y = FACE_H / 2 - (CARD_TAB_TOP + CARD_FACE_EDGE) - CARD_TAB_H / 2

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
    expect(occluderBox(view('closed'), CARD_SCALES.closed)).toEqual({
      width: FACE_W,
      height: BOX_H,
      offsetX: 0,
      offsetY: CARD_TAB_H / 2,
    })
  })

  it('covers the face and the tab of an open card with no backs', () => {
    expect(occluderBox(view('open'), CARD_SCALES.open)).toEqual({
      width: FACE_W * CARD_SCALES.open,
      height: BOX_H * CARD_SCALES.open,
      offsetX: 0,
      offsetY: (CARD_TAB_H / 2) * CARD_SCALES.open,
    })
  })

  it('reaches the first full folder block on a closed card and on an open one', () => {
    expect(occluderBox(view('closed', 1), CARD_SCALES.closed)).toEqual({
      width: FACE_W + BACK_STEP,
      height: BOX_H,
      offsetX: -BACK_STEP / 2,
      offsetY: CARD_TAB_H / 2,
    })
    expect(occluderBox(view('open', 1), CARD_SCALES.open)).toEqual({
      width: (FACE_W + BACK_STEP) * CARD_SCALES.open,
      height: BOX_H * CARD_SCALES.open,
      offsetX: (-BACK_STEP / 2) * CARD_SCALES.open,
      offsetY: (CARD_TAB_H / 2) * CARD_SCALES.open,
    })
  })

  it('reaches the third full folder block on a closed card and on an open one', () => {
    expect(occluderBox(view('closed', 3), CARD_SCALES.closed)).toEqual({
      width: FACE_W + 3 * BACK_STEP,
      height: BOX_H,
      offsetX: (-3 * BACK_STEP) / 2,
      offsetY: CARD_TAB_H / 2,
    })
    expect(occluderBox(view('open', 3), CARD_SCALES.open)).toEqual({
      width: (FACE_W + 3 * BACK_STEP) * CARD_SCALES.open,
      height: BOX_H * CARD_SCALES.open,
      offsetX: ((-3 * BACK_STEP) / 2) * CARD_SCALES.open,
      offsetY: (CARD_TAB_H / 2) * CARD_SCALES.open,
    })
  })

  it('grows down the file rows of a card that lists files', () => {
    const filesHeight = FACE_H + 4 * ROW_H + CARD_TAB_H
    expect(occluderBox(view('files', 0, 4), CARD_SCALES.files)).toEqual({
      width: FACE_W * CARD_SCALES.files,
      height: filesHeight * CARD_SCALES.files,
      offsetX: 0,
      offsetY: (CARD_TAB_H / 2) * CARD_SCALES.files,
    })
    expect(occluderBox(view('files', 3, 4), CARD_SCALES.files)).toEqual({
      width: (FACE_W + 3 * BACK_STEP) * CARD_SCALES.files,
      height: filesHeight * CARD_SCALES.files,
      offsetX: ((-3 * BACK_STEP) / 2) * CARD_SCALES.files,
      offsetY: (CARD_TAB_H / 2) * CARD_SCALES.files,
    })
  })
})

describe('occluderParts', () => {
  it('makes a part for the face, a part for its tab and a block and a tab for each faint folder', () => {
    expect(occluderParts(view('closed'))).toHaveLength(2)
    expect(occluderParts(view('closed', 1))).toHaveLength(4)
    expect(occluderParts(view('closed', 3))).toHaveLength(8)
  })

  it('places the tab at the left of the face, above it, at its own size', () => {
    const parts = occluderParts(view('closed'))
    expect(parts[1]).toEqual({ width: CARD_TAB_W, height: CARD_TAB_H, x: TAB_X, y: TAB_Y })
  })

  it('steps each faint folder left at the face height, block then tab', () => {
    const parts = occluderParts(view('open', 3))
    const back = (step) => [
      { width: FACE_W, height: FACE_H, x: -step * BACK_STEP, y: 0 },
      { width: CARD_TAB_W, height: CARD_TAB_H, x: -step * BACK_STEP + TAB_X, y: TAB_Y },
    ]
    expect(parts.slice(2)).toEqual([...back(1), ...back(2), ...back(3)])
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
    expect(base).toBeGreaterThan(CARD_W)
    expect(occluderParts(wide)[0].width).toBe(base + CARD_FACE_BORDER)
    expect(occluderParts(wide)[1].x).toBe(CARD_TAB_LEFT + CARD_FACE_EDGE + CARD_TAB_W / 2 - (base + CARD_FACE_BORDER) / 2)
    expect(occluderBox(wide, 1).width).toBe(base + CARD_FACE_BORDER)
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
