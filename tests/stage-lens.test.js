import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Stage, {
  compassBearingLabel,
  compassHeading,
  lensEdgeLabels,
  lensEdgeTicks,
} from '../src/Stage.jsx'
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

describe('compass headings', () => {
  it('turns the camera yaw into a compass heading from 0 to 360', () => {
    expect(compassHeading()).toBe(0)
    expect(compassHeading(0)).toBe(0)
    expect(compassHeading(-Math.PI / 2)).toBeCloseTo(90)
    expect(compassHeading(Math.PI / 2)).toBeCloseTo(270)
    expect(compassHeading(Math.PI)).toBeCloseTo(180)
    expect(compassHeading(Math.PI * 2)).toBeCloseTo(0)
    expect(compassHeading(-Math.PI * 2)).toBeCloseTo(0)
    expect(compassHeading('x')).toBe(0)
  })

  it('labels the eight points and the other 15 degree marks', () => {
    expect(compassBearingLabel(0)).toBe('N 000')
    expect(compassBearingLabel(45)).toBe('NE 045')
    expect(compassBearingLabel(90)).toBe('E 090')
    expect(compassBearingLabel(135)).toBe('SE 135')
    expect(compassBearingLabel(180)).toBe('S 180')
    expect(compassBearingLabel(225)).toBe('SW 225')
    expect(compassBearingLabel(270)).toBe('W 270')
    expect(compassBearingLabel(315)).toBe('NW 315')
    expect(compassBearingLabel(15)).toBe('015')
    expect(compassBearingLabel(30)).toBe('030')
    expect(compassBearingLabel(60)).toBe('060')
    expect(compassBearingLabel(360)).toBe('N 000')
    expect(compassBearingLabel(-45)).toBe('NW 315')
  })
})

describe('lens edge compass tape', () => {
  it('lays a tick every 5 degrees at 6 pixels and a tall one every 15', () => {
    const ticks = lensEdgeTicks(1200, 0)
    expect(ticks).toHaveLength(41)
    expect(ticks[0]).toEqual({ x: 0, tall: false, bearing: 260 })
    expect(ticks[1]).toEqual({ x: 30, tall: false, bearing: 265 })
    expect(ticks[2]).toEqual({ x: 60, tall: true, bearing: 270 })
    expect(ticks.find((tick) => tick.x === 600)).toEqual({ x: 600, tall: true, bearing: 0 })
    expect(ticks.at(-1)).toEqual({ x: 1200, tall: false, bearing: 100 })
    expect(ticks.filter((tick) => tick.tall).map((tick) => tick.bearing)).toEqual([
      270, 285, 300, 315, 330, 345, 0, 15, 30, 45, 60, 75, 90,
    ])
  })

  it('centres the tape on the heading and wraps every bearing', () => {
    const ticks = lensEdgeTicks(600, -Math.PI / 2)
    expect(ticks.find((tick) => tick.x === 300)).toEqual({ x: 300, tall: true, bearing: 90 })
    expect(ticks[0].bearing).toBe(40)
    expect(ticks.at(-1).bearing).toBe(140)
    expect(ticks.every((tick) => tick.bearing >= 0 && tick.bearing < 360)).toBe(true)
    expect(lensEdgeTicks(0)).toEqual([])
    expect(lensEdgeTicks(-40)).toEqual([])
  })

  it('labels the tall ticks clear of both ends', () => {
    const labels = lensEdgeLabels(1440, 0)
    expect(labels[0]).toEqual({ x: 90, bearing: 255, cardinal: false, text: '255' })
    expect(labels.at(-1)).toEqual({ x: 1350, bearing: 105, cardinal: false, text: '105' })
    expect(labels.every((label) => label.x >= 24 && label.x <= 1416)).toBe(true)
    expect(labels.filter((label) => label.cardinal).map((label) => label.text)).toEqual([
      'W 270', 'NW 315', 'N 000', 'NE 045', 'E 090',
    ])
    expect(lensEdgeLabels(1440, Math.PI / 2).some((label) => label.text === 'W 270')).toBe(true)
    expect(lensEdgeLabels()).toContainEqual({ x: 720, bearing: 0, cardinal: true, text: 'N 000' })
  })
})
