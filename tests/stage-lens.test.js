import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Stage, {
  LENS_BOW,
  LENS_EDGE_HEIGHT,
  compassBearingLabel,
  compassBottomHeading,
  compassBottomLabel,
  compassHeading,
  isBridgeDown,
  labelsFromFamily,
  lensBowAt,
  lensClipPath,
  lensEdgeLabels,
  lensEdgeTicks,
  seamPose,
} from '../src/Stage.jsx'
import Hud from '../src/ui/Hud.jsx'
import { stageClassName } from '../src/ui/idleView.js'
import { makeTree } from '../src/model/paths.js'

const liveStatus = vi.hoisted(() => ({ status: 'connecting' }))

vi.mock('../src/live/livePlayer.js', () => ({
  createLivePlayer: () => ({
    live: true,
    state: { files: new Map(), dirs: new Map(), agents: new Map() },
    snapshot: () => ({
      position: 0,
      duration: 0,
      playing: true,
      speed: 1,
      live: true,
      status: liveStatus.status,
      agents: [],
    }),
    play() {},
    pause() {},
    toggle() {},
    setSpeed() {},
    seek() {},
    tick() {},
    push() {},
    addFiles() {},
    setStatus(next) {
      liveStatus.status = next
    },
    subscribe() {
      return () => {}
    },
  }),
}))

function stageHtml(extra = {}, props = {}) {
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
      ...props,
    })
  )
}

describe('Stage lens labels', () => {
  it('keeps the project, clock, curved edges and waiting card inside the lens', () => {
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
    expect(html).toContain(`--lens-bow:${LENS_BOW}px`)
    expect(html).toContain(`height="${LENS_EDGE_HEIGHT + LENS_BOW}"`)
    expect(html).toContain(`class="lens-edge-line" d="M 0 0.5 Q 0 ${0.5 + 2 * LENS_BOW} 0 0.5"`)
    const bottomLine = LENS_EDGE_HEIGHT + LENS_BOW - 0.5
    expect(html).toContain(
      `class="lens-edge-line" d="M 0 ${bottomLine} Q 0 ${bottomLine - 2 * LENS_BOW} 0 ${bottomLine}"`
    )
    expect(html).not.toContain('<line class="lens-edge-line"')
    expect(html).not.toContain('mr-lens-clip')
    expect(html).not.toContain('lens-brackets')
  })

  it('puts the empty room sentence above the waiting card in a live empty room', () => {
    liveStatus.status = 'live'
    try {
      const html = stageHtml({ live: { bridge: 'http://127.0.0.1:9' } }, { mode: 'live' })
      const lens = html.indexOf('class="lens"')
      const line = html.indexOf('class="lens-empty-room mono"')
      const waiting = html.indexOf('class="waiting is-')
      const menu = html.indexOf('class="hud-menu')

      expect(line).toBeGreaterThan(lens)
      expect(waiting).toBeGreaterThan(line)
      expect(line).toBeLessThan(menu)
      expect(html).toContain(
        'This folder is empty. Open another project in Projects, or start a lane in Dispatch with C.'
      )
    } finally {
      liveStatus.status = 'connecting'
    }
  })

  it('never shows the empty room sentence in a replay', () => {
    const html = stageHtml()
    expect(html).not.toContain('class="lens-empty-room')
    expect(html).not.toContain('This folder is empty.')
  })

  it('puts the live link tag in the transport beside the Center button', () => {
    const html = stageHtml()
    const transport = html.indexOf('class="transport')
    const badge = html.indexOf('class="transport-badge is-down"')
    const center = html.indexOf('class="transport-center mono"')

    expect(badge).toBeGreaterThan(transport)
    expect(center).toBeGreaterThan(badge)
    expect(html).toContain('>Center<')
    expect(html).not.toContain('Live feed')
    expect(html).toContain('Demo // connecting')
    expect(html).not.toContain('class="stage-badge"')
  })
})

describe('disconnected borders', () => {
  it('marks the stage, the lens edges and the hud while the live feed reconnects', () => {
    liveStatus.status = 'reconnecting'
    try {
      const html = stageHtml({}, { mode: 'live' })
      expect(html).toContain('class="stage is-disconnected"')
      expect(html).toContain('class="lens is-disconnected"')
      expect(html).toContain('class="lens-edge is-top is-disconnected"')
      expect(html).toContain('class="lens-edge is-bottom is-disconnected"')
      expect(html).toContain('class="hud is-disconnected"')
      expect(html).toContain('class="waiting is-error"')
    } finally {
      liveStatus.status = 'connecting'
    }
  })

  it('leaves the borders alone on a connected live room and in a replay', () => {
    const liveHtml = stageHtml({}, { mode: 'live' })
    expect(liveHtml).toContain('class="stage"')
    expect(liveHtml).toContain('class="lens"')
    expect(liveHtml).toContain('class="lens-edge is-top"')
    expect(liveHtml).toContain('class="hud"')

    const replayHtml = renderToString(
      createElement(Hud, {
        mode: 'replay',
        snapshot: { agents: [], position: 0, duration: 0, status: 'reconnecting' },
        speeds: [1],
      })
    )
    expect(replayHtml).toContain('class="hud"')
    expect(replayHtml).not.toContain('is-disconnected')
  })

  it('needs a live room and a reconnecting, disconnected or failed bridge', () => {
    expect(isBridgeDown({}, { status: 'reconnecting' }, null)).toBe(true)
    expect(isBridgeDown({}, { status: 'disconnected' }, null)).toBe(true)
    expect(isBridgeDown({}, { status: 'live' }, { ok: false })).toBe(true)
    expect(isBridgeDown({}, { status: 'live' }, { ok: true })).toBe(false)
    expect(isBridgeDown({}, { status: 'live' }, null)).toBe(false)
    expect(isBridgeDown(null, { status: 'reconnecting' }, { ok: false })).toBe(false)
  })
})

describe('stage idle class', () => {
  it('marks the stage is-idle only when the calm view is on and the room is connected', () => {
    expect(stageClassName()).toBe('stage')
    expect(stageClassName({ idle: true })).toBe('stage is-idle')
    expect(stageClassName({ idle: true, disconnected: true })).toBe('stage is-disconnected')
    expect(stageClassName({ disconnected: true })).toBe('stage is-disconnected')
  })

  it('renders the default split and no scroll state before the timer', () => {
    const html = stageHtml()
    expect(html).toContain('class="stage"')
    expect(html).not.toContain('class="stage is-idle"')
    expect(html).not.toContain('is-scrolled')
    expect(html).toContain('--lens-h-user:min(calc(100vh - var(--menu-h) - var(--transport-h)), max(240px, 56.0vh))')
  })
})

describe('family labels', () => {
  it('maps the main and lane ids as they are and a sub as sub-ID', () => {
    const labels = labelsFromFamily({
      nodes: [
        { id: 'orchestrator', kind: 'orchestrator', label: 'The Owner' },
        { id: 'frontend', kind: 'sub', label: 'Front' },
        { id: 'opencode', kind: 'lane', label: 'Bridge Coder' },
      ],
    })
    expect(labels).toEqual(
      new Map([
        ['orchestrator', 'The Owner'],
        ['sub-frontend', 'Front'],
        ['opencode', 'Bridge Coder'],
      ])
    )
  })

  it('asks for no labels without nodes', () => {
    expect(labelsFromFamily(null)).toBeNull()
    expect(labelsFromFamily({ nodes: [] })).toBeNull()
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

  it('keeps the top tape on the camera heading and the bottom tape opposite', () => {
    expect(lensEdgeLabels(1440, 0, 'top').filter((label) => label.cardinal).map((label) => label.text)).toEqual([
      'W 270', 'NW 315', 'N 000', 'NE 045', 'E 090',
    ])
    expect(lensEdgeTicks(600, -Math.PI / 2, 'bottom').find((tick) => tick.x === 300)).toEqual({
      x: 300,
      tall: true,
      bearing: 270,
    })
    expect(lensEdgeTicks(0, 0, 'bottom')).toEqual([])
  })
})

describe('lens bow', () => {
  it('is 0 at each end and LENS_BOW at the middle', () => {
    expect(LENS_BOW).toBe(28)
    expect(lensBowAt(0, 1200)).toBe(0)
    expect(lensBowAt(1200, 1200)).toBe(0)
    expect(lensBowAt(600, 1200)).toBe(LENS_BOW)
    expect(lensBowAt(300, 1200)).toBeCloseTo(21)
    expect(lensBowAt(600, 0)).toBe(0)
    expect(lensBowAt(0, 0)).toBe(0)
  })

  it('moves a tick at the middle LENS_BOW further in than one at the end', () => {
    const ticks = lensEdgeTicks(1200, 0)
    const middle = ticks.find((tick) => tick.x === 600)
    const end = ticks.find((tick) => tick.x === 0)
    expect(middle).toBeTruthy()
    expect(end).toBeTruthy()
    expect(lensBowAt(middle.x, 1200) - lensBowAt(end.x, 1200)).toBe(LENS_BOW)
  })

  it('bows the top and bottom clip edges toward the centre', () => {
    const path = lensClipPath(1200, 600)
    expect(path).toBe('M 0 0 Q 600 56 1200 0 L 1200 600 Q 600 544 0 600 Z')
    expect(path).toContain('Q 600 56')
    expect(path).toContain('Q 600 544')
    expect(lensClipPath(0, 600)).toBe('')
    expect(lensClipPath(1200, 0)).toBe('')
  })
})

describe('seam pose', () => {
  const width = 1200
  const endAngle = (Math.atan((4 * LENS_BOW) / width) * 180) / Math.PI

  it('bows the top controls down and tilts them along the curve at each end and the middle', () => {
    const left = seamPose(0, width, 'top')
    expect(left.y).toBe(0)
    expect(left.angle).toBeCloseTo(endAngle, 10)

    const middle = seamPose(width / 2, width, 'top')
    expect(middle.y).toBe(LENS_BOW)
    expect(middle.angle).toBe(0)

    const right = seamPose(width, width, 'top')
    expect(right.y).toBe(0)
    expect(right.angle).toBeCloseTo(-endAngle, 10)
  })

  it('bows the bottom controls up and tilts them the other way', () => {
    const left = seamPose(0, width, 'bottom')
    expect(left.y).toBe(0)
    expect(left.angle).toBeCloseTo(-endAngle, 10)

    const middle = seamPose(width / 2, width, 'bottom')
    expect(middle.y).toBe(-LENS_BOW)
    expect(middle.angle).toBe(0)

    const right = seamPose(width, width, 'bottom')
    expect(right.y).toBe(0)
    expect(right.angle).toBeCloseTo(endAngle, 10)
  })

  it('mirrors the curve about the middle', () => {
    for (const x of [0, 180, 300, 600, 900, 1020, 1200]) {
      const left = seamPose(x, width, 'top')
      const right = seamPose(width - x, width, 'top')
      expect(left.y).toBeCloseTo(right.y, 10)
      expect(left.angle + right.angle).toBeCloseTo(0, 10)
    }
  })

  it('makes the bottom the opposite of the top at the same x', () => {
    for (const x of [0, 300, 600, 900, 1200]) {
      const top = seamPose(x, width, 'top')
      const bottom = seamPose(x, width, 'bottom')
      expect(bottom.y).toBeCloseTo(-top.y, 10)
      expect(bottom.angle).toBeCloseTo(-top.angle, 10)
    }
  })

  it('takes its y from lensBowAt and its bow from the argument', () => {
    for (const x of [0, 180, 300, 600, 900, 1020, 1200]) {
      expect(seamPose(x, width, 'top').y).toBeCloseTo(lensBowAt(x, width), 10)
      expect(seamPose(x, width, 'bottom').y).toBeCloseTo(-lensBowAt(x, width), 10)
    }
    expect(seamPose(300, width, 'top', 14).y).toBeCloseTo(10.5, 10)
    expect(seamPose(600, width, 'top', 14).y).toBe(14)
  })

  it('answers a level pose without a width', () => {
    expect(seamPose(0, 0, 'top')).toEqual({ y: 0, angle: 0 })
    expect(seamPose(300, 0, 'bottom')).toEqual({ y: 0, angle: 0 })
  })
})

describe('bottom lens edge compass', () => {
  it('turns the heading half a turn', () => {
    expect(compassBottomHeading()).toBe(180)
    expect(compassBottomHeading(0)).toBe(180)
    expect(compassBottomHeading(-Math.PI / 2)).toBeCloseTo(270)
    expect(compassBottomHeading(Math.PI / 2)).toBeCloseTo(90)
    expect(compassBottomHeading(Math.PI)).toBeCloseTo(0)
    expect(compassBottomHeading(-Math.PI * 2)).toBeCloseTo(180)
    expect(compassBottomHeading('x')).toBe(180)
  })

  it('puts the cardinal after the degrees and a degree sign at the other marks', () => {
    expect(compassBottomLabel(180)).toBe('180 S')
    expect(compassBottomLabel(135)).toBe('135 SE')
    expect(compassBottomLabel(90)).toBe('090 E')
    expect(compassBottomLabel(45)).toBe('045 NE')
    expect(compassBottomLabel(0)).toBe('000 N')
    expect(compassBottomLabel(315)).toBe('315 NW')
    expect(compassBottomLabel(270)).toBe('270 W')
    expect(compassBottomLabel(225)).toBe('225 SW')
    expect(compassBottomLabel(165)).toBe('165°')
    expect(compassBottomLabel(150)).toBe('150°')
    expect(compassBottomLabel(360)).toBe('000 N')
    expect(compassBottomLabel(-15)).toBe('345°')
    expect(compassBottomLabel(180, 0.3)).toBe('180 S')
  })

  it('runs the ticks the other way from the opposite heading', () => {
    const ticks = lensEdgeTicks(1200, 0, 'bottom')
    expect(ticks).toHaveLength(41)
    expect(ticks[0]).toEqual({ x: 0, tall: false, bearing: 280 })
    expect(ticks.find((tick) => tick.x === 600)).toEqual({ x: 600, tall: true, bearing: 180 })
    expect(ticks.at(-1)).toEqual({ x: 1200, tall: false, bearing: 80 })
    expect(ticks.map((tick) => tick.bearing).slice(0, 3)).toEqual([280, 275, 270])
    expect(ticks.every((tick, index) => index === 0 || tick.x > ticks[index - 1].x)).toBe(true)
    expect(ticks.filter((tick) => tick.tall).map((tick) => tick.bearing)).toEqual([
      270, 255, 240, 225, 210, 195, 180, 165, 150, 135, 120, 105, 90,
    ])
  })

  it('labels the bottom tape in reverse with the pitch passed through', () => {
    const labels = lensEdgeLabels(1440, 0, 'bottom', 0.35)
    expect(labels[0]).toEqual({ x: 90, bearing: 285, cardinal: false, text: '285°' })
    expect(labels.at(-1)).toEqual({ x: 1350, bearing: 75, cardinal: false, text: '075°' })
    expect(labels).toContainEqual({ x: 720, bearing: 180, cardinal: true, text: '180 S' })
    expect(labels.filter((label) => label.cardinal).map((label) => label.text)).toEqual([
      '270 W', '225 SW', '180 S', '135 SE', '090 E',
    ])
    expect(labels.every((label) => label.x >= 24 && label.x <= 1416)).toBe(true)
  })
})
