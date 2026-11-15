import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Transport from '../src/ui/Transport.jsx'

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
})
