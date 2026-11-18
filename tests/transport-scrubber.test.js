import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Transport from '../src/ui/Transport.jsx'
import { withDom } from './helpers/uiDom.js'

const SNAPSHOT = { position: 0, duration: 0, playing: false, speed: 1 }

function renderScrubber(position, duration) {
  return renderToString(
    createElement(Transport, { snapshot: { ...SNAPSHOT, position, duration }, speeds: [1] })
  )
}

function rangeTag(html) {
  const match = html.match(/<input[^>]*type="range"[^>]*>/)
  return match ? match[0] : ''
}

function warningsFor(render) {
  const warnings = []
  const error = vi.spyOn(console, 'error').mockImplementation((...args) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  })
  try {
    const html = render()
    return { html, warnings }
  } finally {
    error.mockRestore()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the replay scrubber', () => {
  it('gives max and value 0 when duration and position are not finite numbers', () => {
    const { html, warnings } = warningsFor(() => renderScrubber(NaN, NaN))
    const tag = rangeTag(html)
    expect(tag).toContain('max="0"')
    expect(tag).toContain('value="0"')
    expect(warnings.filter((line) => line.includes('NaN'))).toEqual([])
  })

  it('keeps the rounded duration and position for finite numbers', () => {
    const tag = rangeTag(renderScrubber(42000, 125000))
    expect(tag).toContain('max="125000"')
    expect(tag).toContain('value="42000"')
  })

  it('keeps the value at or below the max', () => {
    const tag = rangeTag(renderScrubber(9000, 5000))
    expect(tag).toContain('max="5000"')
    expect(tag).toContain('value="5000"')
  })

  it('keeps all markers in one row before the rail has a width', () => {
    const markers = [100, 101, 102, 103].map((at) => ({ at, tone: 'start' }))
    const html = renderToString(createElement(Transport, {
      snapshot: { ...SNAPSHOT, duration: 200 }, speeds: [1], markers,
    }))
    expect(html).toContain('data-rows="1"')
    expect(html.match(/--marker-row:0/g)).toHaveLength(markers.length)
    expect(html).not.toContain('scrubber-overflow')
  })

  it('stacks close markers in three rows at their time positions and keeps the rest reachable', async () => {
    await withDom(async ({ container, root }) => {
      let resize
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resize = (width) => callback([{ contentRect: { width } }]) }
        observe() {}
        disconnect() {}
      })
      const markers = [
        { at: 500000, tone: 'start' },
        { at: 500000, tone: 'done' },
        { at: 501000, tone: 'error' },
        { at: 502000, tone: 'done' },
        { at: 600000, tone: 'start' },
      ]
      const onSeek = vi.fn()
      try {
        await act(async () => root.render(createElement(Transport, {
          snapshot: { ...SNAPSHOT, duration: 1000000 }, speeds: [1], markers, onSeek,
        })))
        await act(async () => resize?.(500))
        const rail = container.querySelector('.scrubber-markers')
        const ticks = rail.querySelectorAll('.scrubber-tick')
        expect(rail.parentNode.children).toEqual([container.querySelector('input'), rail])
        expect(rail.getAttribute('data-rows')).toBe('3')
        expect(ticks.map((tick) => tick.style['--marker-row'])).toEqual(['0', '1', '2', '2', '0'])
        expect(ticks.map((tick) => tick.style.left)).toEqual(['50%', '50%', '50.1%', '50.2%', '60%'])
        const overflow = rail.querySelector('.scrubber-overflow')
        expect(ticks.slice(2, 4).map((tick) => tick.getAttribute('popoverTarget'))).toEqual([overflow.id, overflow.id])
        ticks[2].popoverTargetElement = overflow
        ticks[2].getBoundingClientRect = () => ({ left: 248, top: 700, bottom: 716, width: 4 })
        ticks[2].click()
        expect(overflow.getAttribute('data-side')).toBe('above')
        expect(overflow.style['--marker-x']).toBe('250px')
        expect(overflow.style['--marker-edge']).toBe('100px')
        for (const target of [...ticks.slice(0, 2), ...overflow.querySelectorAll('button'), ticks[4]]) target.click()
        expect(onSeek.mock.calls.flat()).toEqual(markers.map(({ at }) => at))

        await act(async () => resize(12000))
        expect(rail.getAttribute('data-rows')).toBe('2')
        expect(ticks.map((tick) => tick.style['--marker-row'])).toEqual(['0', '1', '0', '0', '0'])
        expect(rail.querySelector('.scrubber-overflow')).toBeNull()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
