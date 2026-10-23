import { describe, expect, it } from 'vitest'
import { FOLLOW_HOLD_MS, followTarget } from '../src/engine/camera.js'

const frame = (card, width = 1000, height = 800) => ({ width, height, card })
const middle = { x: 500, y: 400, width: 240, height: 120 }
const edge = { x: 940, y: 400, width: 240, height: 120 }

describe('followTarget', () => {
  it('adopts the first card and asks for a move', () => {
    expect(followTarget(null, { path: 'src' }, frame(middle), 1000)).toEqual({ path: 'src', at: 1000, moved: true })
  })

  it('treats the root card as a target', () => {
    expect(followTarget(null, { path: '' }, frame(middle), 1000)).toEqual({ path: '', at: 1000, moved: true })
    expect(followTarget({ path: '', at: 0 }, { path: 'src' }, frame(edge), 5000)).toEqual({ path: 'src', at: 5000, moved: true })
  })

  it('keeps a card for the whole hold', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, { path: 'docs' }, frame(edge), 1000 + FOLLOW_HOLD_MS - 1)).toEqual({
      path: 'src',
      at: 1000,
      moved: false,
    })
  })

  it('switches when the hold ends and the next card is outside the middle', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, { path: 'docs' }, frame(edge), 1000 + FOLLOW_HOLD_MS)).toEqual({
      path: 'docs',
      at: 1000 + FOLLOW_HOLD_MS,
      moved: true,
    })
  })

  it('does not move when the next card is already inside the middle two thirds', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, { path: 'docs' }, frame(middle), 60000)).toEqual({
      path: 'src',
      at: 1000,
      moved: false,
    })
  })

  it('moves when part of the next card leaves the middle two thirds', () => {
    const previous = { path: 'src', at: 1000 }
    const partial = { x: 260, y: 400, width: 240, height: 120 }
    expect(followTarget(previous, { path: 'docs' }, frame(partial), 60000)).toEqual({
      path: 'docs',
      at: 60000,
      moved: true,
    })
  })

  it('does not reset the hold for the card it already follows', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, { path: 'src' }, frame(edge), 9000)).toEqual({ path: 'src', at: 1000, moved: false })
  })

  it('keeps the previous card when there is no next card', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, null, frame(edge), 9000)).toEqual({ path: 'src', at: 1000, moved: false })
    expect(followTarget(null, null, frame(edge), 9000)).toBe(null)
  })

  it('moves when the frame is missing', () => {
    const previous = { path: 'src', at: 1000 }
    expect(followTarget(previous, { path: 'docs' }, null, 9000)).toEqual({ path: 'docs', at: 9000, moved: true })
  })
})
