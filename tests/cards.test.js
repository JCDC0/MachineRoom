import { describe, expect, it } from 'vitest'
import { CARD_SCALES, CARD_W, cardHeight, cardRows, cardSize, rowOffset, viewInput } from '../src/engine/cards.js'

const view = (state, items = 0, hiddenItems = 0, back = 0) => ({
  path: 'src',
  state,
  back,
  items: Array.from({ length: items }, (_, i) => ({ path: `src/f${i}.js`, kind: 'file' })),
  hiddenItems,
})

describe('card size', () => {
  it('counts rows only on a card that lists its files, with one more for the hidden line', () => {
    expect(cardRows(view('open', 4))).toBe(0)
    expect(cardRows(view('files', 4))).toBe(4)
    expect(cardRows(view('files', 10, 6))).toBe(11)
  })

  it('makes a card that lists files larger than an open one, and an open one larger than a closed one', () => {
    const closed = cardSize(view('closed'))
    const open = cardSize(view('open'))
    const files = cardSize(view('files', 3))
    expect(open.width).toBeGreaterThan(closed.width)
    expect(files.width).toBeGreaterThan(open.width)
    expect(files.height).toBeGreaterThan(open.height)
    expect(files.scale).toBe(CARD_SCALES.files)
  })

  it('widens a card for each faint back folder', () => {
    expect(cardSize(view('open', 0, 0, 3)).width).toBeGreaterThan(cardSize(view('open')).width)
    expect(cardSize(view('closed')).width).toBe(CARD_W * CARD_SCALES.closed)
  })

  it('places rows from the top of the card down', () => {
    expect(rowOffset(3, 0)).toBeGreaterThan(rowOffset(3, 1))
    expect(rowOffset(3, 0)).toBeLessThan(cardHeight(3) / 2)
  })
})

describe('viewInput', () => {
  const state = (recent, recentAt, latest) => ({
    files: new Map([['src/a.js', { path: 'src/a.js', exists: true }], ['docs/b.md', { path: 'docs/b.md', exists: true }]]),
    agents: new Map([['hermes', { focus: ['src/a.js'] }]]),
    recent,
    recentAt: new Map(Object.entries(recentAt)),
    latest,
  })

  it('opens only the recent paths touched in the last minute and a half', () => {
    const input = viewInput(state(['docs/b.md', 'src/a.js'], { 'docs/b.md': 0, 'src/a.js': 100000 }, 100000))
    expect(input.focus).toEqual(['', 'src/a.js', 'src/a.js'])
    expect(input.touched).toEqual(['docs/b.md', 'src/a.js'])
  })

  it('keeps pinned folders open', () => {
    expect(viewInput(state([], {}, 0), ['docs']).focus).toEqual(['', 'src/a.js', 'docs'])
  })
})
