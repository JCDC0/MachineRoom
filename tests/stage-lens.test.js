import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Stage, { lensEdgeLabels, lensEdgeTicks } from '../src/Stage.jsx'
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
  it('keeps the project, clock, straight edges and waiting card inside the lens', () => {
    const html = stageHtml()
    const lens = html.indexOf('class="lens"')
    const labels = html.indexOf('class="lens-labels"')
    const topEdge = html.indexOf('class="lens-edge is-top"')
    const bottomEdge = html.indexOf('class="lens-edge is-bottom"')
    const waiting = html.indexOf('class="waiting is-')
    const menu = html.indexOf('class="hud-menu')

    expect(lens).toBeGreaterThan(-1)
    expect(labels).toBeGreaterThan(lens)
    expect(topEdge).toBeGreaterThan(lens)
    expect(bottomEdge).toBeGreaterThan(topEdge)
    expect(waiting).toBeGreaterThan(lens)
    expect(waiting).toBeLessThan(menu)
    expect(html).toContain('class="lens-corner is-center"')
    expect(html).toContain('class="lens-project">/agent-sandbox')
    expect(html).toContain('class="lens-clock mono"')
    expect(html).toContain('class="lens-edge-cross">+<')
    expect(html.match(/class="lens-edge-corner is-left"/g)).toHaveLength(2)
    expect(html.match(/class="lens-edge-corner is-right"/g)).toHaveLength(2)
    expect(html).not.toContain('mr-lens-clip')
    expect(html).not.toContain('lens-brackets')
  })

  it('puts the live link tag in the transport beside Live feed', () => {
    const html = stageHtml()
    const transport = html.indexOf('class="transport')
    const badge = html.indexOf('class="transport-badge is-down"')
    const feed = html.indexOf('Live feed')

    expect(badge).toBeGreaterThan(transport)
    expect(badge).toBeLessThan(feed)
    expect(html).toContain('Demo // connecting')
    expect(html).not.toContain('class="stage-badge"')
  })
})

describe('lens edge marks', () => {
  it('lays a tick every 40 pixels and a tall one every 200', () => {
    const ticks = lensEdgeTicks(520)
    expect(ticks.map((tick) => tick.x)).toEqual([
      0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520,
    ])
    expect(ticks.filter((tick) => tick.tall).map((tick) => tick.x)).toEqual([0, 200, 400])
  })

  it('labels every tall tick from the left', () => {
    expect(lensEdgeLabels(520).map((label) => label.text)).toEqual(['000', '200', '400'])
    expect(lensEdgeLabels(1000).map((label) => label.text)).toEqual([
      '000', '200', '400', '600', '800', '1000',
    ])
    expect(lensEdgeTicks(0)).toEqual([{ x: 0, tall: true }])
    expect(lensEdgeTicks(-40)).toEqual([{ x: 0, tall: true }])
  })
})
