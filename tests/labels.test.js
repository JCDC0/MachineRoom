import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createLabels } from '../src/engine/labels.js'

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

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context2d,
    }),
  }
})

afterAll(() => {
  globalThis.document = savedDocument
})

describe('a label on replay time', () => {
  it('ends in a quarter of the wall time at speed 4', () => {
    const scene = new THREE.Scene()
    const labels = createLabels(scene, 2)
    labels.show('test.js', new THREE.Vector3(0, 0, 0))
    const item = scene.children[0]
    labels.update(0.5)
    expect(item.visible).toBe(true)
    labels.update(0.6, 4)
    expect(item.visible).toBe(false)
    labels.dispose()
  })

  it('holds while the replay is paused', () => {
    const scene = new THREE.Scene()
    const labels = createLabels(scene, 2)
    labels.show('test.js', new THREE.Vector3(0, 0, 0))
    const item = scene.children[0]
    labels.update(10, 0)
    expect(item.visible).toBe(true)
    labels.dispose()
  })

  it('treats a speed that is not a finite number at or above zero as one', () => {
    for (const speed of [null, '', false, -2, Number.NaN]) {
      const scene = new THREE.Scene()
      const labels = createLabels(scene, 1)
      labels.show('test.js', new THREE.Vector3(0, 0, 0))
      labels.update(10, speed)
      expect(scene.children[0].visible).toBe(false)
      labels.dispose()
    }
  })
})
