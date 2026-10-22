import { describe, expect, it } from 'vitest'
import { makeTree } from '../src/model/paths.js'
import {
  AGENTS,
  createScaleReplay,
  makeScaleTree,
  random,
  scaleActivities,
  uniqueName,
} from '../src/model/scaleTree.js'
import { fpsEnabled, scaleSize } from '../src/startup.js'

describe('the scale tree model', () => {
  it('gives the same tree and activities for the same seed', () => {
    const tree1 = makeScaleTree({ files: 500, folders: 50, seed: 12345 })
    const tree2 = makeScaleTree({ files: 500, folders: 50, seed: 12345 })
    expect(tree1).toEqual(tree2)

    const made1 = makeTree(tree1)
    const made2 = makeTree(tree2)
    const acts1 = scaleActivities(made1, { count: 100, seed: 12345 })
    const acts2 = scaleActivities(made2, { count: 100, seed: 12345 })
    expect(acts1).toEqual(acts2)
  })

  it('gives different trees and activities for different seeds', () => {
    const tree1 = makeScaleTree({ files: 500, folders: 50, seed: 111 })
    const tree2 = makeScaleTree({ files: 500, folders: 50, seed: 222 })
    expect(tree1.files).not.toEqual(tree2.files)

    const acts1 = scaleActivities(makeTree(tree1), { count: 100, seed: 111 })
    const acts2 = scaleActivities(makeTree(tree2), { count: 100, seed: 222 })
    expect(acts1).not.toEqual(acts2)
  })

  it('builds a scale replay in the loadReplay shape', () => {
    const replay = createScaleReplay(1000)
    expect(replay.tree.files).toHaveLength(1000)
    expect(replay.agents).toEqual(AGENTS)
    expect(replay.activities.length).toBeGreaterThan(0)
    expect(replay.frames).toEqual([])
  })

  it('generates unique names when collisions occur', () => {
    const taken = new Set()
    const first = uniqueName(taken, 'item.js')
    const second = uniqueName(taken, 'item.js')
    const third = uniqueName(taken, 'item.js')
    expect(first).toBe('item.js')
    expect(second).toBe('item-2.js')
    expect(third).toBe('item-3.js')
  })
})

describe('scaleSize', () => {
  const at = (query) => new URLSearchParams(query)

  it('reads 1000 and 500000', () => {
    expect(scaleSize(at('scale=1000'))).toBe(1000)
    expect(scaleSize(at('scale=500000'))).toBe(500000)
    expect(scaleSize(at('scale=40000'))).toBe(40000)
    expect(scaleSize(at('scale=200000'))).toBe(200000)
  })

  it('refuses 999, 500001, abc and an empty value', () => {
    expect(scaleSize(at('scale=999'))).toBeNull()
    expect(scaleSize(at('scale=500001'))).toBeNull()
    expect(scaleSize(at('scale=abc'))).toBeNull()
    expect(scaleSize(at('scale='))).toBeNull()
    expect(scaleSize(at(''))).toBeNull()
  })

  it('refuses floats, negative numbers and whitespace', () => {
    expect(scaleSize(at('scale=1000.5'))).toBeNull()
    expect(scaleSize(at('scale=-1000'))).toBeNull()
    expect(scaleSize(at('scale= 1000 '))).toBeNull()
    expect(scaleSize(null)).toBeNull()
    expect(scaleSize(undefined)).toBeNull()
  })
})

describe('fpsEnabled', () => {
  it('reads whether fps is present in query params', () => {
    expect(fpsEnabled(new URLSearchParams('fps'))).toBe(true)
    expect(fpsEnabled(new URLSearchParams('replay&fps'))).toBe(true)
    expect(fpsEnabled(new URLSearchParams('replay'))).toBe(false)
    expect(fpsEnabled(null)).toBe(false)
  })
})
