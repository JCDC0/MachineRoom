import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_NAME_LIFT,
  SUB_ORCHESTRATOR_LIFT,
  createAgents,
  orchestratorNameLift,
} from '../src/engine/agents.js'
import { viewBasis } from '../src/engine/camera.js'
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

const ROSTER = [
  { key: 'orchestrator', name: 'Orchestrator', orchestrator: true },
  { key: 'sub-frontend', name: 'Frontend', subOrchestrator: true },
  { key: 'sub-backend', name: 'Backend', subOrchestrator: true },
  { key: 'opencode', name: 'OpenCode' },
  { key: 'claude', name: 'Claude' },
]

const LADDER = {
  subs: [
    { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
    { id: 'backend', name: 'Backend', lanes: ['claude'] },
  ],
}

const SUB_REACH = 96 * 0.7
const CHIP_HALF_HEIGHT = 40
const CALLOUT_HALF_HEIGHT = 40

function harness() {
  const scene = new THREE.Scene()
  const cssScene = new THREE.Scene()
  const agents = createAgents(scene, ROSTER, cssScene)
  const terminals = createTerminals(cssScene, ROSTER)
  const state = createState({ files: [], dirs: [], created: [] }, ROSTER)
  agents.setLadder(LADDER)
  apply(state, { time: 1000, type: 'tool.start', agent: 'orchestrator', id: 't1', label: 'run the room', touches: [] })
  return { agents, terminals, state }
}

function atHeading(yaw) {
  const { agents, terminals, state } = harness()
  const basis = viewBasis(yaw, 0.3)
  const world = {
    right: new THREE.Vector3(basis.right.x, basis.right.y, basis.right.z),
    back: new THREE.Vector3(basis.back.x, basis.back.y, basis.back.z),
    side: () => 1,
    edge: (dir, file, side, out) => out.set(0, 0, 0),
  }
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 100000)
  camera.position.set(0, 200, 0).addScaledVector(world.back, 2600)
  camera.lookAt(0, 200, 0)
  camera.updateMatrixWorld()
  agents.update(state, 0.016, 1000, world, terminals)
  const mainChip = terminals.terminals.get('orchestrator')
  mainChip.placed = false
  terminals.update(state, 1000, camera, null, (key) => agents.views.get(key)?.group.position ?? null, 0.016, () => 1)
  return { agents, terminals, camera }
}

function ndcY(camera, point) {
  return point.clone().project(camera).y
}

describe('orchestratorNameLift', () => {
  it('lifts the main name once a sub exists and leaves it alone without one', () => {
    expect(orchestratorNameLift(0)).toBe(0)
    expect(orchestratorNameLift(1)).toBe(ORCHESTRATOR_NAME_LIFT)
    expect(orchestratorNameLift(2)).toBe(ORCHESTRATOR_NAME_LIFT)
    expect(orchestratorNameLift(null)).toBe(0)
    expect(orchestratorNameLift(undefined)).toBe(0)
    expect(orchestratorNameLift(-2)).toBe(0)
    expect(orchestratorNameLift('2')).toBe(ORCHESTRATOR_NAME_LIFT)
  })

  it('raises the name above the sub lift', () => {
    expect(ORCHESTRATOR_NAME_LIFT).toBeGreaterThan(SUB_ORCHESTRATOR_LIFT)
    expect(ORCHESTRATOR_NAME_LIFT).toBeGreaterThan(SUB_REACH)
  })
})

describe('the main name from the overview', () => {
  it('keeps the chip and the callout above every sub at any heading', () => {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const yaw = (degrees * Math.PI) / 180
      const { agents, terminals, camera } = atHeading(yaw)
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const chip = terminals.terminals.get('orchestrator').object.position
      const callout = agents.views.get('orchestrator').callout.object.position
      const chipBottom = ndcY(camera, chip.clone().addScaledVector(camUp, -CHIP_HALF_HEIGHT))
      const calloutBottom = ndcY(camera, callout.clone().addScaledVector(camUp, -CALLOUT_HALF_HEIGHT))
      for (const key of ['sub-frontend', 'sub-backend']) {
        const sub = agents.views.get(key).group.position
        const subTop = ndcY(camera, sub.clone().addScaledVector(camUp, SUB_REACH))
        expect(chipBottom).toBeGreaterThan(subTop)
        expect(calloutBottom).toBeGreaterThan(subTop)
      }
      agents.dispose()
      terminals.dispose()
    }
  })

  it('keeps the name clear at the default overview heading', () => {
    const { agents, terminals, camera } = atHeading(0.42)
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const chip = terminals.terminals.get('orchestrator').object.position
    const main = agents.views.get('orchestrator').group.position
    expect(chip.distanceTo(main)).toBeGreaterThan(ORCHESTRATOR_NAME_LIFT)
    const callout = agents.views.get('orchestrator').callout.object.position
    expect(callout.y).toBeGreaterThan(main.y + 180)
    for (const key of ['sub-frontend', 'sub-backend']) {
      const sub = agents.views.get(key).group.position
      const subTop = ndcY(camera, sub.clone().addScaledVector(camUp, SUB_REACH))
      expect(ndcY(camera, chip.clone().addScaledVector(camUp, -CHIP_HALF_HEIGHT))).toBeGreaterThan(subTop)
    }
    agents.dispose()
    terminals.dispose()
  })
})
