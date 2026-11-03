import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CHILD_HOLD_MS,
  CHILD_ORBIT_SCALE,
  CHILD_ORBIT_SECONDS,
  CHILD_ORBIT_TILT,
  CHILD_RADIUS,
  CHILD_SCALE,
  childEndIsFresh,
  childFade,
  childOrbit,
  createAgents,
} from '../src/engine/agents.js'
import { nextSpareShape } from '../src/engine/shapes.js'
import { createTerminals } from '../src/engine/terminals.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { apply, createState } from '../src/model/state.js'
import Hud, { agentRows } from '../src/ui/Hud.jsx'

const parentPlace = { x: 0, y: 290, z: 300 }
const ORBIT_RADIUS = CHILD_RADIUS * CHILD_ORBIT_SCALE

describe('childOrbit', () => {
  it('keeps the same distance from its parent all the way round', () => {
    for (let time = 0; time <= CHILD_ORBIT_SECONDS; time += 5) {
      const place = childOrbit(parentPlace, 0, 1, time)
      expect(Math.hypot(place.x - parentPlace.x, place.y - parentPlace.y, place.z - parentPlace.z)).toBeCloseTo(ORBIT_RADIUS)
    }
  })

  it('spreads siblings evenly and never shares a phase', () => {
    const places = [0, 1, 2, 3].map((index) => childOrbit(parentPlace, index, 4, 0))
    expect(new Set(places.map((place) => `${place.x},${place.y},${place.z}`)).size).toBe(4)
    places.forEach((place) => {
      expect(Math.hypot(place.x - parentPlace.x, place.y - parentPlace.y, place.z - parentPlace.z)).toBeCloseTo(ORBIT_RADIUS)
    })
  })

  it('turns once in about 40 seconds', () => {
    const start = childOrbit(parentPlace, 2, 5, 0)
    const turn = childOrbit(parentPlace, 2, 5, CHILD_ORBIT_SECONDS)
    expect(turn.x).toBeCloseTo(start.x)
    expect(turn.y).toBeCloseTo(start.y)
    expect(turn.z).toBeCloseTo(start.z)
  })

  it('tilts a little off the hub plane', () => {
    const place = childOrbit(parentPlace, 0, 1, 10)
    expect(place.y).not.toBeCloseTo(parentPlace.y)
    expect(Math.abs(place.y - parentPlace.y)).toBeLessThanOrEqual(ORBIT_RADIUS * Math.sin(CHILD_ORBIT_TILT) + 1e-9)
  })

  it('gives the same place every time and leaves its input alone', () => {
    const before = { ...parentPlace }
    const first = childOrbit(parentPlace, 2, 4, 7)
    const second = childOrbit(parentPlace, 2, 4, 7)
    expect(second).toEqual(first)
    expect(parentPlace).toEqual(before)
  })
})

describe('childFade', () => {
  it('holds an ended child at full opacity for the hold, then fades it', () => {
    expect(childFade(0)).toBe(1)
    expect(childFade(CHILD_HOLD_MS - 100)).toBe(1)
    expect(childFade(CHILD_HOLD_MS)).toBe(1)
    expect(childFade(CHILD_HOLD_MS + 750)).toBeCloseTo(0.5)
    expect(childFade(CHILD_HOLD_MS + 1500)).toBe(0)
  })

  it('holds for the same time under reduced motion, then goes at once', () => {
    expect(childFade(0, true)).toBe(1)
    expect(childFade(CHILD_HOLD_MS - 100, true)).toBe(1)
    expect(childFade(CHILD_HOLD_MS, true)).toBe(1)
    expect(childFade(CHILD_HOLD_MS + 750, true)).toBe(0)
    expect(childFade(CHILD_HOLD_MS + 1500, true)).toBe(0)
  })
})

describe('childEndIsFresh', () => {
  const entry = { endedAt: 1000 }

  it('keeps an entry 7 seconds after its end and drops it at 8', () => {
    expect(childEndIsFresh(entry, { latest: 8000 })).toBe(true)
    expect(childEndIsFresh(entry, { latest: 9000 })).toBe(false)
  })

  it('covers the hold and the fade together, 7.5 seconds', () => {
    expect(childEndIsFresh(entry, { latest: 1000 + CHILD_HOLD_MS + 1500 })).toBe(true)
    expect(childEndIsFresh(entry, { latest: 1001 + CHILD_HOLD_MS + 1500 })).toBe(false)
  })

  it('drops an entry that never ended', () => {
    expect(childEndIsFresh({}, { latest: 9000 })).toBe(false)
  })
})

describe('nextSpareShape', () => {
  it('gives the first spare shape not taken by the roster', () => {
    expect(nextSpareShape(['compound', 'knot', 'stella', 'geodesic', 'armillary'])).toBe('shells')
    expect(nextSpareShape(['compound', 'knot', 'stella', 'geodesic', 'armillary', 'shells'])).toBe('knot35')
  })
})

describe('a child in the live snapshot', () => {
  it('carries its parent and depth like the replay player does', () => {
    const player = createLivePlayer({
      tree: { files: [], dirs: [], created: [] },
      agents: [{ key: 'opencode', name: 'OpenCode' }],
    })
    player.push([{ time: Date.now(), type: 'agent.spawn', agent: 'opencode', child: 'opencode~1', name: 'Scout', label: 'subagent', runId: 'r1' }])
    const byKey = new Map(player.snapshot().agents.map((agent) => [agent.key, agent]))
    expect(byKey.get('opencode')).toMatchObject({ parent: null, depth: 0 })
    expect(byKey.get('opencode~1')).toMatchObject({ parent: 'opencode', depth: 1 })
  })
})

const context2d = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  measureText: (text) => ({ width: String(text).length * 10 }),
  clearRect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  fillText: () => {},
}

function element(tag) {
  if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext: () => context2d }
  const node = {
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    ownerDocument: { defaultView: { Element: function Element() {} } },
    append(...items) {
      node.children.push(...items)
    },
    remove() {},
    setAttribute() {},
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

function childHarness() {
  const scene = new THREE.Scene()
  const agents = createAgents(scene, [{ key: 'a', name: 'Alpha', shape: 'claude' }])
  const state = createState({ files: [], dirs: [], created: [] }, [{ key: 'a', name: 'Alpha' }])
  const chips = new Map()
  const terminals = {
    ensure(key, name) {
      chips.set(key, { key, name })
      return chips.get(key)
    },
    setVisible(key, visible) {
      chips.set(key, { ...(chips.get(key) ?? { key }), visible })
    },
    setFade(key, alpha) {
      chips.set(key, { ...(chips.get(key) ?? { key }), alpha })
    },
    setOpen() {},
    edgePoint(key, side, out) {
      return out.set(100, 290, 0)
    },
  }
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(500, 400, 0),
  }
  return { agents, state, chips, terminals, world }
}

describe('a child view', () => {
  it('is added beside its parent and held, faded, then removed', () => {
    const { agents, state, chips, terminals, world } = childHarness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    const child = agents.views.get('a~1')
    expect(child).toBeTruthy()
    expect(CHILD_SCALE).toBe(0.35)
    expect(child.scale).toBe(CHILD_SCALE)
    expect(child.parentLink).toBeTruthy()
    const parent = agents.views.get('a')
    expect(child.home.distanceTo(parent.home)).toBeCloseTo(parent.shellRadius * CHILD_ORBIT_SCALE)
    expect(chips.get('a~1').name).toBe('Alpha > Scout')

    apply(state, { time: 2000, type: 'agent.end', agent: 'a~1', ok: true })
    agents.update(state, 0.016, 2000, world, terminals)
    expect(chips.get('a~1').alpha).toBe(1)
    apply(state, { time: 3000, type: 'run.end', agent: 'a', runId: 'r1', ok: true })
    agents.update(state, 0.016, 3000, world, terminals)
    expect(chips.get('a~1').alpha).toBe(1)
    agents.update(state, 0.016, 7999, world, terminals)
    expect(agents.views.has('a~1')).toBe(true)
    expect(chips.get('a~1').alpha).toBe(1)
    agents.update(state, 0.016, 8000, world, terminals)
    expect(agents.views.has('a~1')).toBe(true)
    expect(chips.get('a~1').alpha).toBe(1)
    agents.update(state, 0.016, 8750, world, terminals)
    expect(agents.views.has('a~1')).toBe(true)
    expect(chips.get('a~1').alpha).toBe(0.5)
    agents.update(state, 0.016, 9500, world, terminals)
    expect(agents.views.has('a~1')).toBe(false)
    expect(chips.get('a~1').visible).toBe(false)
    agents.dispose()
  })

  it('moves round its parent and keeps its short line with it', () => {
    const { agents, state, terminals, world } = childHarness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    const parent = agents.views.get('a')
    const child = agents.views.get('a~1')
    const first = child.home.clone()
    const distance = first.distanceTo(parent.home)
    agents.update(state, 0.016, 11000, world, terminals)
    expect(child.home.equals(first)).toBe(false)
    expect(child.home.distanceTo(parent.home)).toBeCloseTo(distance)
    const ends = child.parentLink.geometry.attributes.position.array
    expect(ends[0]).toBeCloseTo(parent.group.position.x)
    expect(ends[1]).toBeCloseTo(parent.group.position.y)
    expect(ends[2]).toBeCloseTo(parent.group.position.z)
    expect(ends[3]).toBeCloseTo(child.group.position.x)
    expect(ends[4]).toBeCloseTo(child.group.position.y)
    expect(ends[5]).toBeCloseTo(child.group.position.z)
    agents.dispose()
  })

  it('titles the chip with the parent and fades and hides it', () => {
    const terminals = createTerminals(new THREE.Scene(), [{ key: 'a', name: 'Alpha' }])
    const state = createState({ files: [], dirs: [], created: [] }, [{ key: 'a', name: 'Alpha' }])
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    terminals.ensure('a~1', 'Alpha > Scout')
    const camera = new THREE.PerspectiveCamera()
    terminals.update(state, 1000, camera, null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    const term = terminals.terminals.get('a~1')
    expect(term.title.textContent).toBe('Alpha > Scout')

    terminals.setLabels(new Map([['a', 'Bridge Coder']]))
    terminals.update(state, 1016, camera, null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    expect(term.title.textContent).toBe('Bridge Coder > Scout')

    terminals.setLabels(null)
    terminals.update(state, 1032, camera, null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1)
    expect(term.title.textContent).toBe('Alpha > Scout')

    terminals.setFade('a~1', 0.5)
    expect(term.element.style.opacity).toBe('0.5')
    terminals.setVisible('a~1', false)
    expect(term.object.visible).toBe(false)
    terminals.dispose()
  })
})

describe('a child view under a moved parent', () => {
  it('takes its home from its parent home after a roster change', () => {
    const { agents, state, terminals, world } = childHarness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    const parent = agents.views.get('a')
    const child = agents.views.get('a~1')
    const before = child.home.clone()

    agents.setRoster([
      { key: 'b', name: 'Beta' },
      { key: 'a', name: 'Alpha' },
    ])

    const place = childOrbit({ x: parent.home.x, y: parent.home.y, z: parent.home.z, radius: parent.shellRadius * parent.scale }, 0, 1, 0)
    expect(child.home.x).toBeCloseTo(place.x)
    expect(child.home.y).toBeCloseTo(place.y)
    expect(child.home.z).toBeCloseTo(place.z)
    expect(child.home.equals(before)).toBe(false)
    agents.dispose()
  })
})

describe('a child view under reduced motion', () => {
  let savedWindow

  beforeEach(() => {
    savedWindow = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) }
  })

  afterEach(() => {
    globalThis.window = savedWindow
  })

  it('holds the view for 6 seconds, then removes it at once', () => {
    const { agents, state, chips, terminals, world } = childHarness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    apply(state, { time: 2000, type: 'agent.end', agent: 'a~1', ok: true })
    agents.update(state, 0.016, 2000, world, terminals)
    expect(chips.get('a~1').alpha).toBe(1)
    agents.update(state, 0.016, 7999, world, terminals)
    expect(agents.views.has('a~1')).toBe(true)
    expect(chips.get('a~1').alpha).toBe(1)
    agents.update(state, 0.016, 8001, world, terminals)
    expect(agents.views.has('a~1')).toBe(false)
    expect(chips.get('a~1').visible).toBe(false)
    agents.dispose()
  })

  it('holds the child where it is on the circle', () => {
    const { agents, state, terminals, world } = childHarness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    const child = agents.views.get('a~1')
    const first = child.home.clone()
    agents.update(state, 0.016, 31000, world, terminals)
    expect(child.home.equals(first)).toBe(true)
    agents.dispose()
  })
})

describe('the HUD agent list', () => {
  const agents = [
    { key: 'a', name: 'Alpha', status: 'working' },
    { key: 'a~1', name: 'Scout', status: 'done', parent: 'a', depth: 1 },
    { key: 'a~1~1', name: 'Deep', status: 'done', parent: 'a~1', depth: 2 },
    { key: 'b', name: 'Beta', status: 'idle' },
  ]

  it('puts a child under its parent and numbers only the top agents', () => {
    expect(agentRows(agents).map((row) => [row.agent.key, row.depth, row.number])).toEqual([
      ['a', 0, 1],
      ['a~1', 1, null],
      ['a~1~1', 2, null],
      ['b', 0, 2],
    ])
  })

  it('finds the parent even when the child comes first in the list', () => {
    expect(agentRows([agents[1], agents[0]]).map((row) => row.agent.key)).toEqual(['a', 'a~1'])
  })

  it('renders the child indented with its subagent tag', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        snapshot: { agents, speeds: [1] },
        speeds: [1],
      })
    )
    expect(html).toContain('class="hud-agent-row is-subagent" style="padding-left:16px"')
    expect(html).toContain('class="hud-agent-row is-subagent" style="padding-left:32px"')
    expect(html).toContain('class="agent-subtag agent-subagent"')
    expect(html).toContain('>subagent</span>')
    expect(html.indexOf('Alpha')).toBeLessThan(html.indexOf('Scout'))
    expect(html.indexOf('Scout')).toBeLessThan(html.indexOf('Deep'))
    expect(html.indexOf('Deep')).toBeLessThan(html.indexOf('Beta'))
  })

  it('shows a family label in a row and the key when the row has none', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'live',
        snapshot: { agents: [agents[0], agents[3]], speeds: [1] },
        speeds: [1],
        labels: new Map([['a', 'Bridge Coder']]),
      })
    )
    expect(html).toContain('class="agent-name">Bridge Coder</span>')
    expect(html).toContain('class="agent-name">b</span>')
  })
})
