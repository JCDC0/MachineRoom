import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { treeEvent } from '../server/index.js'
import { startLoop, waitForPaperclip } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

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
      const response = await fetch(`${url}/events`, { signal: controller.signal })
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
