import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHILD_GAP, CHILD_SCALE, childPlace, createAgents } from '../src/engine/agents.js'
import { nextSpareShape } from '../src/engine/shapes.js'
import { createTerminals } from '../src/engine/terminals.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { apply, createState } from '../src/model/state.js'
import Hud, { agentRows } from '../src/ui/Hud.jsx'

const parentPlace = { x: 0, y: 290, z: 300 }

describe('childPlace', () => {
  it('puts a child beside its parent at the parent height and radius', () => {
    const place = childPlace(parentPlace, 0)
    expect(place).not.toEqual(parentPlace)
    expect(place.y).toBe(parentPlace.y)
    expect(Math.hypot(place.x, place.z)).toBeCloseTo(Math.hypot(parentPlace.x, parentPlace.z))
  })

  it('sends the first two children to either side of the parent', () => {
    const first = childPlace(parentPlace, 0)
    const second = childPlace(parentPlace, 1)
    expect(first.x).toBeLessThan(0)
    expect(second.x).toBeGreaterThan(0)
    expect(first).not.toEqual(second)
  })

  it('gives each index its own place', () => {
    const places = [0, 1, 2, 3].map((index) => childPlace(parentPlace, index))
    expect(new Set(places.map((place) => `${place.x},${place.y},${place.z}`)).size).toBe(4)
  })

  it('starts a short way from a parent at the hub centre', () => {
    const place = childPlace({ x: 0, y: 200, z: 0 }, 0)
    expect(Math.hypot(place.x, place.z)).toBeCloseTo(CHILD_GAP)
  })

  it('gives the same place every time and leaves its input alone', () => {
    const before = { ...parentPlace }
    const first = childPlace(parentPlace, 2)
    const second = childPlace(parentPlace, 2)
    expect(second).toEqual(first)
    expect(parentPlace).toEqual(before)
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

describe('a child view', () => {
  it('is added beside its parent and removed after the fade', () => {
    const scene = new THREE.Scene()
    const agents = createAgents(scene, [{ key: 'a', name: 'Alpha', shape: 'claude' }])
    const state = createState({ files: [], dirs: [], created: [] }, [{ key: 'a', name: 'Alpha' }])
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'a', child: 'a~1', name: 'Scout', label: 'task', runId: 'r1' })
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
    agents.update(state, 0.016, 1000, world, terminals)
    const child = agents.views.get('a~1')
    expect(child).toBeTruthy()
    expect(child.scale).toBe(CHILD_SCALE)
    expect(child.parentLink).toBeTruthy()
    const parent = agents.views.get('a')
    expect(child.home.distanceTo(parent.home)).toBeGreaterThan(50)
    expect(chips.get('a~1').name).toBe('Alpha > Scout')

    apply(state, { time: 2000, type: 'agent.end', agent: 'a~1', ok: true })
    agents.update(state, 0.016, 2000, world, terminals)
    agents.update(state, 0.016, 3601, world, terminals)
    expect(agents.views.has('a~1')).toBe(false)
    expect(chips.get('a~1').visible).toBe(false)
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
    terminals.setFade('a~1', 0.5)
    expect(term.element.style.opacity).toBe('0.5')
    terminals.setVisible('a~1', false)
    expect(term.object.visible).toBe(false)
    terminals.dispose()
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
})
