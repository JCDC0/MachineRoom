import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SUB_ORCHESTRATOR_LIFT,
  SUB_ORCHESTRATOR_RADIUS,
  SUB_ORCHESTRATOR_SCALE,
  agentPresence,
  createAgents,
  showsNameLabel,
  subOrchestratorPlace,
} from '../src/engine/agents.js'
import { OVERVIEW, viewBasis } from '../src/engine/camera.js'
import {
  HUB_RADIUS,
  HUB_Y,
  ORCHESTRATOR_HOME,
  ORCHESTRATOR_LIFT,
  PARK_LIFT,
  RING_OPACITY,
  SECTOR_ARC_HALF_WIDTH,
  SECTOR_ARC_OPACITY,
  SECTOR_LABEL_BASE,
  SECTOR_LABEL_COLOR,
  SECTOR_LABEL_DROP,
  SECTOR_LABEL_FONT,
  SECTOR_LABEL_MIN,
  SECTOR_LABEL_OPACITY,
  SECTOR_LABEL_OUT,
  SECTOR_LABEL_SPREAD,
  SUB_RING_RADIUS,
  SUB_RING_Y,
  arcDrawSpan,
  createHub,
  sectorArcRadii,
  sectorArcTone,
  sectorLabelPoint,
  sectorLabelRadius,
  sectorLabelScale,
  sectorSlotAngles,
  slotAngle,
} from '../src/engine/hub.js'
import { isOrchestrator, isSubOrchestrator, shapesFor } from '../src/engine/shapes.js'
import { sectorArcs } from '../src/model/hierarchy.js'

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  letterSpacing: '',
  measureText: (text) => ({ width: String(text).length * 10 }),
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  fillText: () => {},
}

function element(tag) {
  if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext: () => context2d }
  const listeners = new Map()
  const node = {
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    removed: false,
    listeners,
    ownerDocument: { defaultView: { Element: function Element() {} } },
    append(...items) {
      node.children.push(...items)
    },
    remove() {
      node.removed = true
    },
    setAttribute() {},
    addEventListener(type, fn) {
      listeners.set(type, fn)
    },
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = { createElement: element, querySelectorAll: () => [] }
})

afterAll(() => {
  globalThis.document = savedDocument
})

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
    { id: 'backend', name: 'Backend', lanes: ['claude'] },
  ],
}

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
  { key: 'hermes', name: 'Hermes' },
]

const FOUR_LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode', 'opencode2'] },
    { id: 'backend', name: 'Backend', lanes: ['claude', 'claude2'] },
    { id: 'platform', name: 'Platform', lanes: ['hermes', 'hermes2'] },
  ],
}

const FOUR_KEYS = ['opencode', 'opencode2', 'claude', 'claude2', 'hermes', 'hermes2', 'agy', 'agy2']

describe('sector slot angles', () => {
  it('uses the plain slot angles with no ladder or an empty one', () => {
    const keys = ['opencode', 'claude', 'hermes']
    for (const ladder of [null, { subs: [] }]) {
      const angles = sectorSlotAngles(ladder, keys)
      keys.forEach((key, index) => {
        expect(angles.get(key)).toBeCloseTo(slotAngle(index, keys.length))
      })
    }
  })

  it('puts each lane in the middle of its own sector when the sector holds one lane', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const angles = sectorSlotAngles(LADDER, keys)
    const arcs = sectorArcs(LADDER, keys)
    expect(angles.get('opencode')).toBeCloseTo((arcs[0].start + arcs[0].end) / 2)
    expect(angles.get('claude')).toBeCloseTo((arcs[1].start + arcs[1].end) / 2)
    expect(angles.get('hermes')).toBeCloseTo((arcs[2].start + arcs[2].end) / 2)
  })

  it('spreads two lanes inside one sector in roster order', () => {
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode', 'claude'] }] }
    const keys = ['claude', 'opencode', 'hermes']
    const arcs = sectorArcs(ladder, keys)
    const angles = sectorSlotAngles(ladder, keys)
    const arc = arcs[0]
    expect(arc.lanes).toEqual(['claude', 'opencode'])
    expect(angles.get('claude')).toBeGreaterThan(arc.start)
    expect(angles.get('claude')).toBeLessThan(angles.get('opencode'))
    expect(angles.get('opencode')).toBeLessThan(arc.end)
  })

  it('gives the same angles for the same input', () => {
    const keys = ['opencode', 'claude', 'hermes']
    expect(sectorSlotAngles(LADDER, keys)).toEqual(sectorSlotAngles(LADDER, keys))
  })
})

describe('sector arcs a beginner can see', () => {
  const FOCAL = 464 / 2 / Math.tan((50 * Math.PI) / 360)
  const OVERVIEW_DEPTH = 2854

  it('leaves a gap at each end of an arc', () => {
    const arc = { start: 0.04, end: 2.054 }
    const draw = arcDrawSpan(arc.start, arc.end)
    expect(draw.start).toBeGreaterThan(arc.start)
    expect(draw.end).toBeLessThan(arc.end)
    expect(draw.end - draw.start).toBeCloseTo(arc.end - arc.start - 0.11)
  })

  it('never inverts a short arc and gives nothing for an empty one', () => {
    const small = arcDrawSpan(0, 0.2)
    expect(small.end).toBeGreaterThanOrEqual(small.start)
    expect(arcDrawSpan(1, 1)).toEqual({ start: 0, end: 0 })
    expect(arcDrawSpan(2, 1)).toEqual({ start: 0, end: 0 })
    expect(arcDrawSpan(Number.NaN, 1)).toEqual({ start: 0, end: 0 })
  })

  it('keeps the label text at 11 pixels or more in the overview', () => {
    const factor = sectorLabelScale(OVERVIEW_DEPTH, FOCAL)
    const pixels = SECTOR_LABEL_FONT * SECTOR_LABEL_BASE * factor * (FOCAL / OVERVIEW_DEPTH)
    expect(pixels).toBeGreaterThanOrEqual(11)
    expect(SECTOR_LABEL_MIN).toBeGreaterThanOrEqual(11)
    expect(factor).toBeGreaterThan(1)
    expect(sectorLabelScale(OVERVIEW_DEPTH / 4, FOCAL)).toBe(1)
    expect(sectorLabelScale(0, FOCAL)).toBe(1)
    expect(sectorLabelScale(OVERVIEW_DEPTH, 0)).toBe(1)
  })

  it('makes each arc brighter than the ring and the main arc dimmer than a sub arc', () => {
    const main = sectorArcTone(true)
    const sub = sectorArcTone(false)
    expect(main.center).toBe(SECTOR_ARC_OPACITY.main)
    expect(sub.center).toBe(SECTOR_ARC_OPACITY.sub)
    expect(sub.center).toBeGreaterThan(main.center)
    expect(main.center).toBeGreaterThan(RING_OPACITY)
    expect(main.edge).toBeLessThan(main.center)
    expect(sub.edge).toBeLessThan(sub.center)
  })

  it('draws a band a little wider than the ring line', () => {
    const radii = sectorArcRadii()
    expect(radii).toHaveLength(3)
    expect(radii[1]).toBe(HUB_RADIUS)
    expect(radii[2] - radii[0]).toBe(SECTOR_ARC_HALF_WIDTH * 2)
    expect(SECTOR_ARC_HALF_WIDTH).toBeGreaterThan(1)
  })
})

describe('the place of a sector name', () => {
  const FOCAL = 464 / 2 / Math.tan((50 * Math.PI) / 360)
  const GLYPH = 0.62

  it('sits below the ring plane and outside the arc', () => {
    const point = sectorLabelPoint(0, HUB_RADIUS, 3)
    expect(point.x).toBeCloseTo(sectorLabelRadius(HUB_RADIUS, 3))
    expect(point.z).toBeCloseTo(0)
    expect(point.y).toBe(-SECTOR_LABEL_DROP)
    expect(point.y).toBeLessThan(0)
    expect(Math.hypot(point.x, point.z)).toBeGreaterThan(HUB_RADIUS + 120)
  })

  it('moves further out as sectors are added', () => {
    expect(sectorLabelRadius(HUB_RADIUS, 2)).toBe(HUB_RADIUS + SECTOR_LABEL_OUT + SECTOR_LABEL_SPREAD)
    expect(sectorLabelRadius(HUB_RADIUS, 4)).toBe(HUB_RADIUS + SECTOR_LABEL_OUT + SECTOR_LABEL_SPREAD * 3)
    expect(sectorLabelRadius(HUB_RADIUS, 4)).toBeGreaterThan(sectorLabelRadius(HUB_RADIUS, 3))
    expect(sectorLabelRadius(HUB_RADIUS, 1)).toBeGreaterThan(HUB_RADIUS + 120)
    expect(sectorLabelRadius(0, 4)).toBe(sectorLabelRadius(HUB_RADIUS, 4))
    expect(sectorLabelRadius(HUB_RADIUS, Number.NaN)).toBe(HUB_RADIUS + SECTOR_LABEL_OUT)
  })

  it('fills the vector it is given and leaves the angle alone', () => {
    const out = new THREE.Vector3()
    expect(sectorLabelPoint(Math.PI / 2, HUB_RADIUS, 3, out)).toBe(out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(sectorLabelRadius(HUB_RADIUS, 3))
  })

  it('dims the name below the agents own names', () => {
    expect(SECTOR_LABEL_OPACITY).toBeGreaterThan(0)
    expect(SECTOR_LABEL_OPACITY).toBeLessThan(0.7)
    expect(SECTOR_LABEL_COLOR).toBe(`rgba(255,255,255,${SECTOR_LABEL_OPACITY})`)
  })

  it('keeps two sector names from overlapping at four sectors', () => {
    const arcs = sectorArcs(FOUR_LADDER, FOUR_KEYS)
    expect(arcs).toHaveLength(4)
    const camera = new THREE.PerspectiveCamera(50, 1280 / 464, 1, 60000)
    const basis = viewBasis(OVERVIEW.yaw, OVERVIEW.pitch)
    camera.position.set(
      OVERVIEW.x + basis.back.x * OVERVIEW.dist,
      OVERVIEW.y + basis.back.y * OVERVIEW.dist,
      OVERVIEW.z + basis.back.z * OVERVIEW.dist,
    )
    camera.lookAt(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
    camera.updateMatrixWorld()
    const boxes = arcs.map((arc) => {
      const point = sectorLabelPoint((arc.start + arc.end) / 2, HUB_RADIUS, arcs.length)
      const world = new THREE.Vector3(point.x, HUB_Y + point.y, point.z)
      const distance = camera.position.distanceTo(world)
      const projected = world.clone().project(camera)
      const factor = (sectorLabelScale(distance, FOCAL) * FOCAL) / distance
      const width = (String(arc.name).length * SECTOR_LABEL_FONT * GLYPH + 16) * SECTOR_LABEL_BASE * factor
      const height = 40 * SECTOR_LABEL_BASE * factor
      const x = (projected.x * 0.5 + 0.5) * 1280
      const y = (-projected.y * 0.5 + 0.5) * 464
      return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 }
    })
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlap(boxes[i], boxes[j])).toBe(false)
      }
    }
  })
})

describe('the place of a sub orchestrator', () => {
  it('floats above the middle of its arc at 0.7 of the main orchestrator', () => {
    const arc = { start: 0, end: Math.PI }
    const place = subOrchestratorPlace(arc)
    expect(place.x).toBeCloseTo(0)
    expect(place.z).toBeCloseTo(SUB_ORCHESTRATOR_RADIUS)
    expect(place.y).toBeCloseTo(HUB_Y + SUB_ORCHESTRATOR_LIFT)
    expect(SUB_ORCHESTRATOR_SCALE).toBe(0.7)
    expect(SUB_ORCHESTRATOR_LIFT).toBeLessThan(ORCHESTRATOR_LIFT)
    expect(SUB_ORCHESTRATOR_RADIUS).toBeGreaterThan(HUB_RADIUS * 2)
  })

  it('fills the vector it is given and leaves the arc alone', () => {
    const arc = { start: Math.PI / 2, end: Math.PI / 2 }
    const before = { ...arc }
    const out = new THREE.Vector3()
    expect(subOrchestratorPlace(arc, out)).toBe(out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(SUB_ORCHESTRATOR_RADIUS)
    expect(arc).toEqual(before)
  })

  it('keeps the demo subs clear of the main orchestrator on screen', () => {
    const keys = ['opencode', 'claude', 'hermes']
    const basis = viewBasis(0.42, 0.3)
    const chipBox = { width: 384, height: 240 }
    for (const arc of sectorArcs(LADDER, keys)) {
      if (arc.id === 'orchestrator') continue
      const place = subOrchestratorPlace(arc)
      const delta = {
        x: place.x - ORCHESTRATOR_HOME.x,
        y: place.y - ORCHESTRATOR_HOME.y,
        z: place.z - ORCHESTRATOR_HOME.z,
      }
      const right = Math.abs(delta.x * basis.right.x + delta.y * basis.right.y + delta.z * basis.right.z)
      const up = Math.abs(delta.x * basis.up.x + delta.y * basis.up.y + delta.z * basis.up.z)
      expect(up > chipBox.height || right > chipBox.width).toBe(true)
    }
  })
})

describe('a sector names a sub once', () => {
  const sub = { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true }

  it('drops the shape label when it matches the sector name, ignoring case', () => {
    expect(showsNameLabel(sub, { id: 'frontend', name: 'Frontend' })).toBe(false)
    expect(showsNameLabel(sub, { id: 'frontend', name: 'FRONTEND' })).toBe(false)
    expect(showsNameLabel({ ...sub, name: ' frontend ' }, { id: 'frontend', name: 'Frontend' })).toBe(false)
  })

  it('keeps the shape label when the names differ, the sector is missing or the agent is not a sub', () => {
    expect(showsNameLabel({ ...sub, name: 'Platform' }, { id: 'frontend', name: 'Frontend' })).toBe(true)
    expect(showsNameLabel(sub, null)).toBe(true)
    expect(showsNameLabel(sub, { id: 'frontend' })).toBe(true)
    expect(showsNameLabel({ key: 'opencode', name: 'Frontend' }, { id: 'frontend', name: 'Frontend' })).toBe(true)
    expect(showsNameLabel({ ...sub, name: '' }, { id: 'frontend', name: 'Frontend' })).toBe(true)
  })

  it('hides the sub shape label on the demo ladder and shows it again with no ladder', () => {
    const agents = createAgents(new THREE.Scene(), ROSTER, new THREE.Scene())
    agents.setLadder(LADDER)
    expect(agents.views.get('sub-frontend').label.visible).toBe(false)
    expect(agents.views.get('opencode').label.visible).toBe(true)
    expect(agents.views.get('orchestrator').label.visible).toBe(true)

    agents.setLadder(null)
    expect(agents.views.get('sub-frontend').label.visible).toBe(true)
    agents.dispose()
  })
})

describe('sub orchestrator agents', () => {
  it('tells a sub from the main orchestrator by its key or flag', () => {
    expect(isOrchestrator(ROSTER[0])).toBe(true)
    expect(isOrchestrator(ROSTER[1])).toBe(false)
    expect(isSubOrchestrator(ROSTER[1])).toBe(true)
    expect(isSubOrchestrator({ key: 'x', subOrchestrator: true })).toBe(true)
    expect(isOrchestrator({ key: 'sub-orchestrator', name: 'Sub Orchestrator' })).toBe(false)
  })

  it('never dims a sub orchestrator that has not run', () => {
    expect(agentPresence({ status: 'idle', key: 'sub-frontend' }, false).dim).toBe(false)
  })

  it('gives the main and every sub the armillary shape family', () => {
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'sub-frontend', name: 'Frontend' },
      { key: 'opencode', name: 'OpenCode' },
    ]
    expect(shapesFor(roster)).toEqual(['armillary', 'armillary', 'stella'])
  })
})

describe('the hub with a ladder', () => {
  it('draws one arc and one label per sector and parks the lanes inside them', () => {
    const scene = new THREE.Scene()
    const hub = createHub(scene, ROSTER)
    const ring = hub.group.getObjectByName('ring')
    const sectors = hub.group.getObjectByName('sectors')
    const slots = () => hub.group.children.filter((child) => child.name === 'slot')
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)

    hub.setLadder(LADDER)
    const arcs = sectorArcs(LADDER, ['opencode', 'claude', 'hermes'])
    const sectorsOf = () => sectors.children
    expect(ring.visible).toBe(false)
    expect(sectorsOf()).toHaveLength(arcs.length)
    for (const group of sectorsOf()) {
      const lines = group.children.filter((child) => child.isLine)
      const labels = group.children.filter((child) => child.isSprite)
      expect(lines).toHaveLength(3)
      expect(labels).toHaveLength(1)
      expect(Math.hypot(labels[0].position.x, labels[0].position.z)).toBeCloseTo(sectorLabelRadius(HUB_RADIUS, arcs.length))
      expect(labels[0].position.y).toBe(-SECTOR_LABEL_DROP)
    }
    const mainGroup = sectorsOf().find((group) => group.name === 'sector:orchestrator')
    const subGroup = sectorsOf().find((group) => group.name === 'sector:frontend')
    const brightest = (group) => Math.max(...group.children.filter((child) => child.isLine).map((line) => line.userData.baseOpacity))
    expect(brightest(mainGroup)).toBe(SECTOR_ARC_OPACITY.main)
    expect(brightest(subGroup)).toBe(SECTOR_ARC_OPACITY.sub)
    expect(brightest(subGroup)).toBeGreaterThan(brightest(mainGroup))
    expect(brightest(mainGroup)).toBeGreaterThan(RING_OPACITY)

    const label = subGroup.children.find((child) => child.isSprite)
    const at = new THREE.Vector3()
    label.getWorldPosition(at)
    const camera = new THREE.PerspectiveCamera(50, 1280 / 464, 1, 60000)
    camera.position.copy(at).add(new THREE.Vector3(0, 0, 2854))
    hub.update(0, 0.016, camera, 464)
    const focal = 464 / 2 / Math.tan((50 * Math.PI) / 360)
    const pixels = SECTOR_LABEL_FONT * SECTOR_LABEL_BASE * label.userData.factor * (focal / 2854)
    expect(pixels).toBeGreaterThanOrEqual(11)
    expect(label.scale.x).toBeCloseTo(label.userData.base.x * label.userData.factor)
    expect(label.scale.y).toBeCloseTo(label.userData.base.y * label.userData.factor)

    const angles = sectorSlotAngles(LADDER, ['opencode', 'claude', 'hermes'])
    const keys = ['opencode', 'claude', 'hermes']
    slots().forEach((marker, index) => {
      const angle = angles.get(keys[index])
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * HUB_RADIUS)
      expect(marker.position.z).toBeCloseTo(Math.sin(angle) * HUB_RADIUS)
    })

    hub.setLadder({ subs: [] })
    expect(ring.visible).toBe(true)
    expect(sectors.children).toHaveLength(0)
    expect(slots()).toHaveLength(3)
    hub.update(0, 0.016)
    expect(ring.material.opacity).toBeCloseTo(RING_OPACITY)
    slots().forEach((marker, index) => {
      const angle = slotAngle(index, 3)
      expect(marker.position.x).toBeCloseTo(Math.cos(angle) * HUB_RADIUS)
    })
    hub.dispose()
  })
})

describe('the agents with a ladder', () => {
  it('parks each lane in its sector and floats the sub above its arc', () => {
    const agents = createAgents(new THREE.Scene(), ROSTER, new THREE.Scene())
    agents.setLadder(LADDER)
    const keys = ['opencode', 'claude', 'hermes']
    const angles = sectorSlotAngles(LADDER, keys)
    const opencode = agents.views.get('opencode')
    expect(opencode.home.y).toBeCloseTo(SUB_RING_Y + PARK_LIFT)
    expect(opencode.home.x).toBeCloseTo(Math.cos(angles.get('opencode')) * SUB_RING_RADIUS)
    expect(opencode.home.z).toBeCloseTo(Math.sin(angles.get('opencode')) * SUB_RING_RADIUS)

    const sub = agents.views.get('sub-frontend')
    const arcs = sectorArcs(LADDER, keys)
    const place = subOrchestratorPlace(arcs[0])
    expect(sub.home.x).toBeCloseTo(place.x)
    expect(sub.home.y).toBeCloseTo(place.y)
    expect(sub.home.z).toBeCloseTo(place.z)
    expect(sub.scale).toBe(SUB_ORCHESTRATOR_SCALE)
    expect(sub.shapeName).toBe('armillary')
    expect(sub.orchestrator).toBe(false)
    expect(sub.subOrchestrator).toBe(true)
    expect(sub.orchestratorLink).toBeTruthy()

    const main = agents.views.get('orchestrator')
    expect(main.home.equals(ORCHESTRATOR_HOME)).toBe(true)
    expect(main.orchestrator).toBe(true)
    agents.dispose()
  })

  it('keeps a lane in no sub on the main ring and a sub above its own code agents', () => {
    const roster = [...ROSTER, { key: 'agy', name: 'AGY' }]
    const ladder = { subs: [{ id: 'frontend', name: 'Frontend', lanes: ['opencode'] }] }
    const agents = createAgents(new THREE.Scene(), roster, new THREE.Scene())
    agents.setLadder(ladder)
    const keys = ['opencode', 'claude', 'hermes', 'agy']
    const angles = sectorSlotAngles(ladder, keys)
    const agy = agents.views.get('agy')
    expect(agy.home.y).toBeCloseTo(HUB_Y + PARK_LIFT)
    expect(agy.home.x).toBeCloseTo(Math.cos(angles.get('agy')) * HUB_RADIUS)
    expect(agy.home.z).toBeCloseTo(Math.sin(angles.get('agy')) * HUB_RADIUS)
    const sub = agents.views.get('sub-frontend')
    const opencode = agents.views.get('opencode')
    expect(Math.hypot(sub.home.x, sub.home.z)).toBeGreaterThan(Math.hypot(opencode.home.x, opencode.home.z))
    expect(sub.home.y).toBeGreaterThan(opencode.home.y)
    agents.dispose()
  })
})
