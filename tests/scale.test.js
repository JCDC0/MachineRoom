import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readTree, treeEvent } from '../server/index.js'
import { planFolderView } from '../src/model/folderView.js'
import { BUDGET, fakeListDir, makeScaleTree, parseProbeArgs, replayDigest, replaySources, runProbe } from '../scripts/scale-probe.mjs'
import { startLoop, waitForPaperclip } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

const MEASURED_MS = {
  'planFolderView, first call': 49,
  'planFolderView, 3 agents, same files': 3.2,
  'planFolderView, one new file': 10.6,
  'layoutCards (cold)': 11,
  'layoutCards (warm)': 21,
  planCollapse: 16,
  'pipeline, Hermes read or shell line (mean)': 2.7,
  'pipeline, Hermes read or shell line (worst)': 9,
  packTree: 48,
}

describe('the scale tree', () => {
  it('gives the same tree for the same seed and another tree for another seed', () => {
    const first = makeScaleTree({ files: 3000, folders: 300, seed: 7 })
    const again = makeScaleTree({ files: 3000, folders: 300, seed: 7 })
    const other = makeScaleTree({ files: 3000, folders: 300, seed: 8 })
    expect(again).toEqual(first)
    expect(other.files).not.toEqual(first.files)
  })

  it('holds 40000 files in 4000 folders, up to 12 deep, by default', () => {
    const tree = makeScaleTree()
    expect(tree.files).toHaveLength(40000)
    expect(new Set(tree.files).size).toBe(40000)
    expect(tree.folders).toHaveLength(4001)
    const depths = tree.folders.map((path) => (path === '' ? 0 : path.split('/').length))
    expect(Math.max(...depths)).toBe(12)
  })

  it('reads back through readTree with the fake listDir', async () => {
    const tree = makeScaleTree({ files: 2000, folders: 200, seed: 3 })
    const root = join(makeTempDir('mr-scale-'), 'not-there')
    const read = await readTree(root, { listDir: fakeListDir(root, tree.files) })
    expect(read.files).toEqual([...tree.files].sort())
  })
})

describe('the probe options and replays', () => {
  it('reads --files, --folders, --seed and --replay and refuses anything else', () => {
    expect(parseProbeArgs(['--files', '500', '--folders', '50', '--seed', '9', '--replay'])).toEqual({ files: 500, folders: 50, seed: 9, replay: true })
    expect(() => parseProbeArgs(['--depth', '3'])).toThrow('Unknown option --depth.')
    expect(() => parseProbeArgs(['--files', 'many'])).toThrow('--files needs a whole number.')
  })

  it('replays the sandbox and every scenario fixture', () => {
    const results = replaySources().map(replayDigest)
    expect(results.map((result) => result.name).slice(0, 5)).toEqual(['fixtures/sandbox', 'fixtures/scenario-a', 'fixtures/scenario-b', 'fixtures/scenario-c', 'fixtures/scenario-d'])
    for (const result of results) {
      expect(result.plans).toBe(result.activities)
      expect(result.layouts).toBeGreaterThan(0)
    }
  })
})

describe('the probe tree stage', () => {
  it('reads a fresh folder and leaves none behind', async () => {
    const result = await runProbe({ files: 40, folders: 4, seed: 424242, activities: 20 })
    expect(result.treeRoot).toContain('machineroom-scale-probe-424242-')
    expect(existsSync(result.treeRoot)).toBe(false)
  })
})

describe('each fixed stage at 40000 files', () => {
  let rows

  beforeAll(async () => {
    rows = new Map((await runProbe()).rows.map((row) => [row.stage, row]))
  }, 120000)

  for (const [stage, measured] of Object.entries(MEASURED_MS)) {
    it(`keeps ${stage} under ten times the measured ${measured} ms`, () => {
      expect(rows.get(stage).ms).toBeLessThan(measured * 10)
    })
  }

  it('sends the first tree event and the file list route in under 1 MB', () => {
    expect(rows.get('tree event, first to a page').bytes).toBeLessThan(BUDGET.firstEvent)
    expect(rows.get('GET /api/tree, folder shape').bytes).toBeLessThan(BUDGET.firstEvent)
  })

  it('sends only the new file in a later tree event', () => {
    expect(rows.get('tree event, one new file').bytes).toBeLessThan(BUDGET.event)
  })
})

describe('treeEvent', () => {
  const data = (text) => JSON.parse(text.split('\n').find((line) => line.startsWith('data: ')).slice(6))

  it('sends the whole list first, then only what the page has not had', () => {
    const first = { root: 'project', files: ['a.js', 'src/b.js'] }
    const next = { root: 'project', files: ['a.js', 'src/b.js', 'src/c.js', 'z.md'] }
    expect(data(treeEvent(first))).toEqual(first)
    expect(data(treeEvent(next, first.files))).toEqual({ root: 'project', files: ['src/c.js', 'z.md'] })
    expect(treeEvent({ root: 'project', files: ['a.js'] }, first.files)).toBe('')
  })
})

describe('planFolderView with a growing file list', () => {
  const fresh = (input) => {
    planFolderView({ files: [] })
    return planFolderView(input)
  }

  it('plans the same as a fresh call when the list grows, shrinks, changes order or repeats a path', () => {
    const base = ['src/a.js', 'src/model/b.js', 'docs/c.md', 'README.md']
    const lists = [
      base,
      [...base, 'src/model/d.js'],
      ['tests/e.js', ...base, 'src/model/d.js'],
      ['tests/e.js', ...base, 'src/model/d.js', 'src/a.js', './x//y.js', 'win\\path.js'],
      base.slice(1),
      [...base].reverse(),
    ]
    const focus = ['', 'src/model/b.js', 'tests', 'x/y.js']
    for (const files of lists) {
      const input = { files, focus, touched: ['src/model/d.js', 'docs'] }
      const planned = planFolderView(input)
      expect(planned).toEqual(fresh(input))
    }
  })
})

describe('the bridge tree event', () => {
  const loops = []

  afterEach(async () => {
    while (loops.length > 0) await loops.pop().stop()
  })

  async function readTrees(url, count, onOpen) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const trees = []
    try {
      const response = await fetch(`${url}/events?tree=1`, { signal: controller.signal })
      onOpen()
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let cut = buffer.indexOf('\n\n')
        while (cut !== -1) {
          const lines = buffer.slice(0, cut).split('\n')
          buffer = buffer.slice(cut + 2)
          cut = buffer.indexOf('\n\n')
          if (!lines.includes('event: tree')) continue
          trees.push(JSON.parse(lines.find((line) => line.startsWith('data: ')).slice(6)))
          if (trees.length === 1) onOpen(trees)
        }
        if (trees.length >= count) return trees
      }
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    throw new Error(`The event stream ended after ${trees.length} tree events.`)
  }

  it('sends the whole list in the first tree event and only the new file after it', async () => {
    const root = makeTempDir('mr-scale-tree-')
    writeFileSync(join(root, 'a.js'), '1\n')
    const loop = await startLoop({ bridge: { projectRoot: root, debounceMs: 50 } })
    loops.push(loop)
    await waitForPaperclip(loop.url)
    const trees = await readTrees(loop.url, 2, (seen) => {
      if (!seen) writeFileSync(join(root, 'b.js'), '2\n')
      else setTimeout(() => writeFileSync(join(root, 'c.js'), '3\n'), 200)
    })
    expect(trees[0].files).toEqual(['a.js', 'b.js'])
    expect(trees[1].files).toEqual(['c.js'])
  })
})
