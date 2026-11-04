import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LensRail, { RAIL_WHEEL_HOLD_MS, railNear } from '../src/ui/LensRail.jsx'
import { withDom } from './helpers/uiDom.js'

const LENS_RECT = { left: 100, right: 900, top: 0, bottom: 600, width: 800, height: 600 }

async function renderRail(root, side = 'right', onWheel = () => {}) {
  await act(async () => {
    root.render(
      createElement(
        'div',
        { className: 'lens' },
        createElement(LensRail, {
          side,
          label: side === 'left' ? 'Height' : 'Zoom',
          share: 0.5,
          multiplier: '1.0x',
          ariaLabel: side === 'left' ? 'Lens height' : 'Zoom',
          valueText: '50 percent of the window',
          onShare() {},
          onWheel,
        })
      )
    )
  })
}

describe('railNear', () => {
  it('is true within 64 pixels of its own edge of the lens', () => {
    expect(railNear(164, LENS_RECT, 'left')).toBe(true)
    expect(railNear(165, LENS_RECT, 'left')).toBe(false)
    expect(railNear(36, LENS_RECT, 'left')).toBe(true)
    expect(railNear(35, LENS_RECT, 'left')).toBe(false)
    expect(railNear(836, LENS_RECT, 'right')).toBe(true)
    expect(railNear(835, LENS_RECT, 'right')).toBe(false)
    expect(railNear(964, LENS_RECT, 'right')).toBe(true)
    expect(railNear(965, LENS_RECT, 'right')).toBe(false)
  })

  it('takes a reach and rejects a bad side, rect or reach', () => {
    expect(railNear(120, LENS_RECT, 'left', 20)).toBe(true)
    expect(railNear(121, LENS_RECT, 'left', 20)).toBe(false)
    expect(railNear(120, LENS_RECT, 'top')).toBe(false)
    expect(railNear(Number.NaN, LENS_RECT, 'left')).toBe(false)
    expect(railNear(120, null, 'left')).toBe(false)
    expect(railNear(120, LENS_RECT, 'left', -1)).toBe(false)
  })
})

describe('LensRail fade', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows near its own edge and fades away from it', async () => {
    await withDom(async ({ container, root }) => {
      await renderRail(root)
      const lens = container.querySelector('.lens')
      const rail = container.querySelector('.lens-rail')
      lens.getBoundingClientRect = () => LENS_RECT

      expect(rail.className).not.toContain('is-shown')
      await act(async () => lens.dispatchEvent({ type: 'pointermove', bubbles: true, clientX: 850 }))
      expect(rail.className).toContain('is-shown')
      await act(async () => lens.dispatchEvent({ type: 'pointermove', bubbles: true, clientX: 700 }))
      expect(rail.className).not.toContain('is-shown')
    })
  })

  it('shows near the left edge for the left rail', async () => {
    await withDom(async ({ container, root }) => {
      await renderRail(root, 'left')
      const lens = container.querySelector('.lens')
      const rail = container.querySelector('.lens-rail')
      lens.getBoundingClientRect = () => LENS_RECT

      await act(async () => lens.dispatchEvent({ type: 'pointermove', bubbles: true, clientX: 150 }))
      expect(rail.className).toContain('is-shown')
      await act(async () => lens.dispatchEvent({ type: 'pointermove', bubbles: true, clientX: 300 }))
      expect(rail.className).not.toContain('is-shown')
    })
  })

  it('stays shown for a second after a wheel turn over it', async () => {
    vi.useFakeTimers()
    const wheels = []
    await withDom(async ({ container, root }) => {
      await renderRail(root, 'right', (delta) => wheels.push(delta))
      const rail = container.querySelector('.lens-rail')

      await act(async () => rail.dispatchEvent({ type: 'wheel', bubbles: true, cancelable: true, deltaY: -120 }))
      expect(wheels).toEqual([-120])
      expect(rail.className).toContain('is-shown')

      await act(async () => vi.advanceTimersByTime(RAIL_WHEEL_HOLD_MS - 1))
      expect(rail.className).toContain('is-shown')
      await act(async () => vi.advanceTimersByTime(1))
      expect(rail.className).not.toContain('is-shown')
    })
  })

  it('shows while dragged, follows the pointer and removes its lens listener on unmount', async () => {
    const shares = []
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(
            'div',
            { className: 'lens' },
            createElement(LensRail, {
              side: 'right',
              label: 'Zoom',
              share: 0.5,
              multiplier: '1.0x',
              ariaLabel: 'Zoom',
              valueText: '1.0x of the overview',
              onShare: (share, done) => shares.push([share, done]),
              onWheel() {},
            })
          )
        )
      })
      const lens = container.querySelector('.lens')
      const rail = container.querySelector('.lens-rail')
      const track = rail.querySelector('.lens-rail-track')
      track.getBoundingClientRect = () => ({ top: 0, height: 200 })

      await act(async () => rail.dispatchEvent({ type: 'pointerdown', bubbles: true, button: 0, pointerId: 1, clientY: 100 }))
      expect(rail.className).toContain('is-shown')
      expect(shares).toEqual([[0.5, false]])

      await act(async () => rail.dispatchEvent({ type: 'pointerup', bubbles: true, button: 0, pointerId: 1, clientY: 100 }))
      expect(rail.className).not.toContain('is-shown')
      expect(shares).toEqual([
        [0.5, false],
        [0.5, true],
      ])

      const remove = vi.spyOn(lens, 'removeEventListener')
      await act(async () => root.render(null))
      expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function))
    })
  })
})
