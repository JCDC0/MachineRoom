import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createAgents } from '../src/engine/agents.js'

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

let saved

beforeAll(() => {
  saved = globalThis.document
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context2d }),
  }
})

afterAll(() => {
  globalThis.document = saved
})

function disposals(scene) {
  const owners = new Set()
  scene.traverse((object) => {
    if (object.geometry) owners.add(object.geometry)
    if (object.material) owners.add(object.material)
    if (object.material?.map) owners.add(object.material.map)
  })
  const freed = new Set()
  for (const owner of owners) owner.addEventListener('dispose', () => freed.add(owner))
  return { owners, freed }
}

describe('agent shapes', () => {
  it('free every geometry, material and texture and leave the scene on dispose', () => {
    const scene = new THREE.Scene()
    const roster = [
      { key: 'hermes', name: 'Hermes', shape: 'hermes' },
      { key: 'agy', name: 'agy', shape: 'agy' },
      { key: 'orchestrator', name: 'Orchestrator', shape: 'claude' },
    ]
    const agents = createAgents(scene, roster)
    const { owners, freed } = disposals(scene)
    expect(owners.size).toBeGreaterThan(20)
    agents.dispose()
    expect(scene.children).toEqual([])
    expect(freed.size).toBe(owners.size)
    expect(agents.views.size).toBe(0)
    expect(agents.pickables).toEqual([])
  })
})
