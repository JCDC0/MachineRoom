import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAgents } from '../src/engine/agents.js'
import { AGENT_COLORS, YELLOW, agentColors } from '../src/engine/sprites.js'
import { createTerminals } from '../src/engine/terminals.js'
import { apply, createState } from '../src/model/state.js'

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
  const listeners = new Map()
  const properties = new Map()
  const node = {
    className: '',
    textContent: '',
    style: {
      setProperty(name, value) {
        properties.set(name, String(value))
      },
      getPropertyValue(name) {
        return properties.get(name) ?? ''
      },
      removeProperty(name) {
        properties.delete(name)
      },
    },
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

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator' },
  { key: 'claude', name: 'Claude', shape: 'claude' },
  { key: 'hermes', name: 'Hermes', shape: 'hermes' },
]

function harness(roster = ROSTER) {
  const scene = new THREE.Scene()
  const cssScene = new THREE.Scene()
  const agents = createAgents(scene, roster, cssScene)
  const terminals = createTerminals(cssScene, roster)
  const state = createState({ files: ['src/a.js'], dirs: ['src'], created: [] }, roster)
  const world = {
    right: new THREE.Vector3(1, 0, 0),
    back: new THREE.Vector3(0, 0, 1),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(500, 400, 0),
  }
  return { agents, terminals, state, world }
}

function startWrite(state, agent = 'claude') {
  apply(state, {
    time: 1000,
    type: 'tool.start',
    agent,
    id: 't1',
    label: 'write a.js',
    touches: [{ path: 'src/a.js', mode: 'write', kind: 'file' }],
  })
}

describe('the colour of each agent', () => {
  it('gives the main orchestrator yellow and counts lane colours without it', () => {
    expect(agentColors(ROSTER)).toEqual([YELLOW, AGENT_COLORS[0], AGENT_COLORS[1]])
    const moved = [ROSTER[1], ROSTER[0], ROSTER[2]]
    expect(agentColors(moved)).toEqual([AGENT_COLORS[0], YELLOW, AGENT_COLORS[1]])
  })

  it('counts a sub orchestrator as a lane and reads a missing roster as empty', () => {
    const roster = [
      { key: 'orchestrator', name: 'Orchestrator' },
      { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
      { key: 'opencode', name: 'OpenCode' },
    ]
    expect(agentColors(roster)).toEqual([YELLOW, AGENT_COLORS[0], AGENT_COLORS[1]])
    expect(agentColors(null)).toEqual([])
    expect(agentColors('bad')).toEqual([])
  })

  it('gives a child its parent colour', () => {
    const { agents, terminals, state, world } = harness()
    apply(state, { time: 1000, type: 'agent.spawn', agent: 'claude', child: 'claude~1', name: 'Scout', label: 'task', runId: 'r1' })
    agents.update(state, 0.016, 1000, world, terminals)
    expect(agents.views.get('claude').color).toBe(AGENT_COLORS[0])
    expect(agents.views.get('claude~1').color).toBe(AGENT_COLORS[0])
    agents.dispose()
    terminals.dispose()
  })
})

describe('the agent colour on a chip and a callout', () => {
  it('sets --agent-color to the agent own colour', () => {
    const { agents, terminals } = harness()
    expect(terminals.terminals.get('orchestrator').element.style.getPropertyValue('--agent-color')).toBe('#e5ff00')
    expect(terminals.terminals.get('claude').element.style.getPropertyValue('--agent-color')).toBe('#ff8c1a')
    expect(agents.views.get('orchestrator').callout.element.style.getPropertyValue('--agent-color')).toBe('#e5ff00')
    expect(agents.views.get('claude').callout.element.style.getPropertyValue('--agent-color')).toBe('#ff8c1a')
    agents.dispose()
    terminals.dispose()
  })

  it('writes the property again only when the roster colour changes', () => {
    const { agents, state, terminals, world } = harness()
    const term = terminals.terminals.get('claude')
    let writes = 0
    const set = term.element.style.setProperty
    term.element.style.setProperty = (name, value) => {
      if (name === '--agent-color') writes += 1
      set(name, value)
    }
    terminals.update(state, 1000, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1, (key) => agents.views.get(key)?.color)
    terminals.update(state, 1008, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1, (key) => agents.views.get(key)?.color)
    expect(writes).toBe(0)
    agents.setRoster([ROSTER[0], ROSTER[2], ROSTER[1]])
    terminals.update(state, 1016, new THREE.PerspectiveCamera(), null, () => new THREE.Vector3(0, 290, 300), 0.016, () => 1, (key) => agents.views.get(key)?.color)
    expect(writes).toBe(1)
    expect(term.element.style.getPropertyValue('--agent-color')).toBe('#ff3ddb')
    agents.dispose()
    terminals.dispose()
  })
})

describe('the agent colour on a working shape', () => {
  it('colours the status ring and the callout border with the agent colour', () => {
    const { agents, state, terminals, world } = harness()
    startWrite(state)
    agents.update(state, 0.016, 1000, world, terminals)
    const view = agents.views.get('claude')
    expect(view.callout.element.className).toBe('mr-callout is-working')
    expect(view.callout.element.style.getPropertyValue('--agent-color')).toBe('#ff8c1a')
    expect(view.rings[0].material.color.getHex()).toBe(AGENT_COLORS[0])
    agents.dispose()
    terminals.dispose()
  })
})
