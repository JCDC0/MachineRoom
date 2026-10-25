import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Stage from '../src/Stage.jsx'
import { makeTree } from '../src/model/paths.js'

function stageHtml(extra = {}) {
  const tree = makeTree({ root: 'agent-sandbox', files: [], created: [] })
  return renderToString(
    createElement(Stage, {
      data: {
        agents: [],
        tree,
        activities: [],
        live: { simulated: true, frames: [], speed: 1 },
        ...extra,
      },
    })
  )
}

describe('Stage lens labels', () => {
  it('keeps the project, clock, brackets and waiting card inside the lens', () => {
    const html = stageHtml()
    const lens = html.indexOf('class="lens"')
    const labels = html.indexOf('class="lens-labels"')
    const brackets = html.indexOf('class="lens-brackets"')
    const waiting = html.indexOf('class="waiting is-')
    const menu = html.indexOf('class="hud-menu')

    expect(lens).toBeGreaterThan(-1)
    expect(labels).toBeGreaterThan(lens)
    expect(brackets).toBeGreaterThan(lens)
    expect(waiting).toBeGreaterThan(lens)
    expect(waiting).toBeLessThan(menu)
    expect(html).toContain('class="lens-corner is-center"')
    expect(html).toContain('class="lens-project">/agent-sandbox')
    expect(html).toContain('class="lens-clock mono"')
    expect(html).toContain('class="lens-mark is-top-left"')
    expect(html).toContain('class="lens-mark is-tick-one"')
    expect(html).toContain('class="lens-mark is-tick-two"')
    expect(html).toContain('class="lens-mark is-bottom-left"')
    expect(html).toContain('class="lens-mark is-bottom-right"')
  })
})
