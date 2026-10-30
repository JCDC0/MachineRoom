import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORCHESTRATOR_HOME } from '../src/engine/hub.js'
import { BASE_OPACITY, GLOW_OPACITY, INTERNET_HOME, INTERNET_LABEL, INTERNET_OFF_COLOR, INTERNET_OFF_LABEL, MORPH_SWING, createInternet, morphOffsets } from '../src/engine/internet.js'
import { WEB } from '../src/engine/sprites.js'

describe('morphOffsets', () => {
  it('gives the same offsets for the same seed, count and time', () => {
    expect(morphOffsets(7, 12, 2.5)).toEqual(morphOffsets(7, 12, 2.5))
  })

  it('keeps every offset within one swing', () => {
    for (const value of morphOffsets(20261025, 64, 5)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(Math.abs(value)).toBeLessThanOrEqual(1)
    }
    expect(MORPH_SWING).toBeGreaterThan(0)
    expect(MORPH_SWING).toBeLessThan(0.25)
  })

  it('breathes over time and gives another seed another shape', () => {
    expect(morphOffsets(7, 8, 0)).not.toEqual(morphOffsets(7, 8, 1))
    expect(morphOffsets(7, 8, 1)).not.toEqual(morphOffsets(8, 8, 1))
  })

  it('gives no offsets for no vertices and reads junk as zero', () => {
    expect(morphOffsets(7, 0, 1)).toEqual([])
    expect(morphOffsets(7, -4, 1)).toEqual([])
    expect(morphOffsets(7, 4, 'x')).toEqual(morphOffsets(7, 4, 0))
  })
})

describe('the internet shape place', () => {
  it('floats over the hub centre and above the orchestrator', () => {
    expect(INTERNET_HOME.x).toBe(0)
    expect(INTERNET_HOME.z).toBe(0)
    expect(INTERNET_HOME.y).toBeGreaterThan(ORCHESTRATOR_HOME.y)
  })
})

describe('the internet glow', () => {
  it('rests dim and glows bright only while an agent is on the web', () => {
    expect(BASE_OPACITY).toBeLessThan(0.15)
    expect(BASE_OPACITY + GLOW_OPACITY).toBeGreaterThanOrEqual(0.6)
  })
})

const context2d = {
  font: '',
  fillStyle: '',
  measureText: (text) => ({ width: String(text).length * 10 }),
  fillRect: () => {},
  fillText: () => {},
}

function element(tag) {
  if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext: () => context2d }
  const node = {
    className: '',
    textContent: '',
    style: {},
    children: [],
    append() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

describe('the internet shape when the room is offline', () => {
  let savedDocument

  beforeAll(() => {
    savedDocument = globalThis.document
    globalThis.document = { createElement: element }
  })

  afterAll(() => {
    globalThis.document = savedDocument
  })

  it('turns the wireframe and label red, reads NO CONNECTION and keeps breathing', () => {
    const internet = createInternet(new THREE.Scene())
    const wire = internet.group.children.find((child) => child.isMesh)
    expect(wire.material.color.getHex()).toBe(WEB)
    expect(internet.label.visible).toBe(true)
    expect(internet.labelOff.visible).toBe(false)
    expect(internet.online()).toBe(true)

    internet.setOnline(false)
    expect(internet.online()).toBe(false)
    expect(wire.material.color.getHex()).toBe(INTERNET_OFF_COLOR)
    expect(wire.material.color.getHex()).toBe(0xff2a2a)
    expect(internet.label.visible).toBe(false)
    expect(internet.labelOff.visible).toBe(true)
    expect(internet.labelOff.userData.text).toBe(INTERNET_OFF_LABEL)
    expect(INTERNET_OFF_LABEL).toBe('NO CONNECTION')

    const geometry = wire.geometry
    const before = Array.from(geometry.attributes.position.array)
    internet.update(0.5, false)
    const after = Array.from(geometry.attributes.position.array)
    expect(after).not.toEqual(before)
    expect(wire.material.color.getHex()).toBe(INTERNET_OFF_COLOR)

    internet.setOnline(true)
    expect(internet.online()).toBe(true)
    expect(wire.material.color.getHex()).toBe(WEB)
    expect(internet.label.visible).toBe(true)
    expect(internet.labelOff.visible).toBe(false)
    expect(INTERNET_LABEL).toBe('INTERNET')
    internet.dispose()
  })
})
