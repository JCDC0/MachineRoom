import { describe, expect, it } from 'vitest'
import { planCollapse } from '../src/model/collapse.js'

function counts(entries) {
  return new Map(entries)
}

describe('planCollapse', () => {
  it('keeps the whole tree open when it fits', () => {
    const folders = ['', 'src', 'src/model', 'src/ui', 'tests']
    const fileCounts = counts([
      ['', 2],
      ['src', 1],
      ['src/model', 4],
      ['src/ui', 3],
      ['tests', 1],
    ])

    const plan = planCollapse({ folders, fileCounts })

    expect(plan.visible).toEqual(['', 'src', 'src/model', 'src/ui', 'tests'])
    expect(plan.collapsed).toEqual([])
    expect(plan.overBudget).toBe(false)
  })

  it('opens the shallow folders first and collapses the deeper ones', () => {
    const folders = ['', 'a', 'a/x', 'a/y', 'b', 'b/x', 'b/y', 'c', 'c/x', 'c/y']
    const fileCounts = counts([
      ['a', 1],
      ['a/x', 2],
      ['a/y', 3],
      ['b/x', 1],
      ['b/y', 1],
      ['c/x', 1],
      ['c/y', 1],
    ])

    const plan = planCollapse({ folders, fileCounts, maxTiles: 6 })

    expect(plan.visible).toEqual(['', 'a', 'a/x', 'a/y'])
    expect(plan.collapsed).toEqual([
      { path: 'b', folders: 3, files: 2 },
      { path: 'c', folders: 3, files: 2 },
    ])
    expect(plan.overBudget).toBe(false)
    expect(plan.visible.length + plan.collapsed.length).toBe(6)
  })

  it('keeps a hot folder and its whole chain open', () => {
    const folders = ['', 'src', 'src/model', 'src/model/deep', 'src/model/deep/er', 'docs', 'docs/a', 'docs/b']

    const plan = planCollapse({ folders, hot: ['src/model/deep'], maxTiles: 6 })

    expect(plan.visible).toEqual(['', 'src', 'src/model', 'src/model/deep', 'src/model/deep/er'])
    expect(plan.collapsed).toEqual([{ path: 'docs', folders: 3, files: 0 }])
    expect(plan.overBudget).toBe(false)
  })

  it('gives the same plan whatever the input order', () => {
    const folders = ['', 'src', 'src/model', 'src/ui', 'tests', 'docs', 'docs/api']
    const hot = ['src/ui']

    const first = planCollapse({ folders, hot, maxTiles: 6 })
    const second = planCollapse({ folders: [...folders].reverse(), hot, maxTiles: 6 })
    const third = planCollapse({ folders: ['docs/api', 'tests', 'src/model', 'docs', 'src/ui', 'src', ''], hot, maxTiles: 6 })

    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(first.collapsed).toEqual([{ path: 'docs', folders: 2, files: 0 }])
  })

  it('reports overBudget when the hot set alone needs more tiles', () => {
    const folders = ['', 'a', 'a/b', 'a/b/c', 'a/b/c/d']

    const plan = planCollapse({ folders, hot: ['a/b/c'], maxTiles: 2 })

    expect(plan.overBudget).toBe(true)
    expect(plan.visible).toEqual(['', 'a', 'a/b', 'a/b/c'])
    expect(plan.collapsed).toEqual([{ path: 'a/b/c/d', folders: 1, files: 0 }])
  })

  it('adds the ancestors a folder list leaves out', () => {
    const plan = planCollapse({ folders: ['src/model'], hot: ['nope/deep'] })

    expect(plan.visible).toEqual(['', 'src', 'src/model'])
    expect(plan.collapsed).toEqual([])
  })

  it('plans ten thousand folders well inside the time bound', () => {
    const folders = ['']
    for (let i = 0; i < 100; i += 1) {
      folders.push(`f${i}`)
      for (let j = 0; j < 99; j += 1) folders.push(`f${i}/g${j}`)
    }
    const fileCounts = new Map(folders.map((path) => [path, 3]))

    const started = performance.now()
    const plan = planCollapse({ folders, fileCounts })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(200)
    expect(plan.overBudget).toBe(false)
    expect(plan.visible.length + plan.collapsed.length).toBeLessThanOrEqual(400)
    expect(plan.visible).toContain('')
  })
})
