import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FOLDER_SHAPE, packTree, treeEvent } from '../server/index.js'
import { discoverBridge, openBridge } from '../src/live/bridge.js'
import { loadTree } from '../src/live/source.js'
import { FOLDER_SHAPE as PAGE_SHAPE, FOLDER_SHAPE_ACCEPT, readFileList } from '../src/live/tree.js'
import { makeScaleTree } from '../scripts/scale-probe.mjs'
import { getJson, startLoop, waitForPaperclip } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

const wire = (value) => JSON.parse(JSON.stringify(value))
const roundTrip = (tree) => readFileList(wire(packTree(tree)))

describe('the folder shape', () => {
  it('names the same shape on the bridge and the page', () => {
    expect(PAGE_SHAPE).toBe(FOLDER_SHAPE)
    expect(FOLDER_SHAPE_ACCEPT).toContain(`shape=${FOLDER_SHAPE}`)
  })

  it('round trips the probe tree in under 1 MB with each folder named once', () => {
    const files = [...makeScaleTree().files].sort()
    const packed = packTree({ root: 'project', files })
    expect(packed.shape).toBe(FOLDER_SHAPE)
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(1024 * 1024)
    expect(new Set(packed.folders.map(([parent, name]) => `${parent}/${name}`)).size).toBe(packed.folders.length)
    const read = readFileList(wire(packed))
    expect(read.root).toBe('project')
    expect(read.files).toEqual(files)
  })

  it('keeps the order of a list that is not sorted, with repeats', () => {
    const files = ['z.js', 'a/x.js', 'b.js', 'a/y.js', 'a/x.js', 'a/b/c.js', 'a/y.js']
    expect(roundTrip({ root: 'p', files })).toEqual({ root: 'p', files })
  })

  it('reads the root alone', () => {
    expect(packTree({ root: 'p', files: [] })).toEqual({ root: 'p', shape: FOLDER_SHAPE, folders: [], files: [] })
    expect(roundTrip({ root: 'p', files: [] })).toEqual({ root: 'p', files: [] })
    expect(roundTrip({ root: '', files: [] })).toEqual({ root: '', files: [] })
  })

  it('reads a file at the root', () => {
    const files = ['README.md', 'src/a.js', 'package.json']
    expect(packTree({ root: 'p', files }).files).toEqual([[0, 'README.md'], [1, 'a.js'], [0, 'package.json']])
    expect(roundTrip({ root: 'p', files })).toEqual({ root: 'p', files })
  })

  it('reads names with spaces, dots and letters outside ASCII', () => {
    const files = [
      '.github/workflows/ci.yml',
      'my folder/file name with spaces.txt',
      'a.b/c..d/.hidden',
      '..dots/x',
      'données/été/résumé.md',
      '日本語/ファイル.js',
      'emoji-free/ünïcödé name.tar.gz',
      'a//double/slash.js',
      'trailing/',
    ]
    expect(packTree({ root: 'café', files }).shape).toBe(FOLDER_SHAPE)
    expect(roundTrip({ root: 'café', files })).toEqual({ root: 'café', files })
  })

  it('falls back to the list of paths when a path would not read back the same', () => {
    for (const files of [['/abs/x.js', 'a.js'], ['a.js', '/top']]) {
      const packed = packTree({ root: 'p', files })
      expect(packed).toEqual({ root: 'p', files })
      expect(readFileList(wire(packed))).toEqual({ root: 'p', files })
    }
  })
})

describe('readFileList', () => {
  it('reads the old shape, with or without its created list', () => {
    expect(readFileList({ root: 'p', files: ['a.js', 'src/b.js'], created: [] })).toEqual({ root: 'p', files: ['a.js', 'src/b.js'] })
    expect(readFileList({ files: [] })).toEqual({ root: '', files: [] })
  })

  it('refuses junk with a sentence and never throws', () => {
    const junk = [
      null,
      undefined,
      'text',
      42,
      [],
      {},
      { root: 5, files: [] },
      { files: 'a.js' },
      { files: ['a.js', 7] },
      { shape: 'zip', files: [] },
      { shape: FOLDER_SHAPE },
      { shape: FOLDER_SHAPE, folders: {}, files: [] },
      { shape: FOLDER_SHAPE, folders: [], files: {} },
      { shape: FOLDER_SHAPE, folders: [[1, 'self']], files: [] },
      { shape: FOLDER_SHAPE, folders: [[0, 7]], files: [] },
      { shape: FOLDER_SHAPE, folders: [[0]], files: [] },
      { shape: FOLDER_SHAPE, folders: ['src'], files: [] },
      { shape: FOLDER_SHAPE, folders: [], files: [[0]] },
      { shape: FOLDER_SHAPE, folders: [], files: [[1, 'a.js']] },
      { shape: FOLDER_SHAPE, folders: [], files: [[-1, 'a.js']] },
      { shape: FOLDER_SHAPE, folders: [], files: [[0.5, 'a.js']] },
      { shape: FOLDER_SHAPE, folders: [], files: [[0, 'a.js', null]] },
      { shape: FOLDER_SHAPE, folders: [], files: ['a.js'] },
    ]
    for (const value of junk) {
      const read = readFileList(value)
      expect(read.files).toBeUndefined()
      expect(read.error).toMatch(/^The bridge sent a file list this page cannot read\. \S.*\.$/)
    }
  })
})

describe('the page side', () => {
  class FakeSource {
    constructor(url) {
      this.url = url
      this.listeners = new Map()
      FakeSource.last = this
    }

    addEventListener(name, handler) {
      this.listeners.set(name, handler)
    }

    emit(name, data) {
      this.listeners.get(name)({ data })
    }

    close() {}
  }

  it('reads a folder shape tree event and skips one it cannot read', () => {
    const trees = []
    openBridge({ url: 'http://bridge', EventSourceImpl: FakeSource, onFrame: () => {}, onTree: (tree) => trees.push(tree), onStatus: () => {} })
    const files = ['a.js', 'src/b.js']
    FakeSource.last.emit('tree', JSON.stringify(packTree({ root: 'p', files })))
    FakeSource.last.emit('tree', JSON.stringify({ shape: FOLDER_SHAPE, folders: [], files: [[3, 'x']] }))
    FakeSource.last.emit('tree', JSON.stringify({ root: 'p', files: ['c.js'] }))
    expect(trees).toEqual([{ root: 'p', files }, { root: 'p', files: ['c.js'] }])
  })

  it('asks for the folder shape and reads it in discoverBridge and loadTree', async () => {
    const asked = []
    const files = ['a.js', 'src/b.js']
    const fetchImpl = async (url, init) => {
      asked.push([url, init?.headers?.Accept])
      const body = url.endsWith('/api/agents') ? [] : { ...packTree({ root: 'p', files }), created: [] }
      return { ok: true, status: 200, json: async () => body }
    }
    expect((await discoverBridge({ url: 'http://bridge', fetchImpl })).files).toEqual(files)
    expect(await loadTree('http://bridge', fetchImpl)).toEqual({ root: 'p', files })
    expect(asked.filter(([url]) => url.endsWith('/api/tree')).map(([, accept]) => accept)).toEqual([FOLDER_SHAPE_ACCEPT, FOLDER_SHAPE_ACCEPT])
  })

  it('turns a list it cannot read into an error with the sentence', async () => {
    const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith('/api/agents') ? [] : { shape: 'zip' }) })
    await expect(discoverBridge({ url: 'http://bridge', fetchImpl })).rejects.toThrow('The bridge sent a file list this page cannot read. Its shape is unknown.')
    await expect(loadTree('http://bridge', fetchImpl)).rejects.toThrow('The bridge sent a file list this page cannot read.')
  })
})

describe('the bridge', () => {
  const loops = []

  afterEach(async () => {
    while (loops.length > 0) await loops.pop().stop()
  })

  function makeProject(files) {
    const root = join(makeTempDir('mr-tree-format-'), 'project')
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), 'x\n')
    }
    return root
  }

  async function readFirstTree(url, query, onOpen) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${url}/events${query}`, { signal: controller.signal })
      onOpen()
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        for (const block of buffer.split('\n\n').slice(0, -1)) {
          const lines = block.split('\n')
          if (lines.includes('event: tree')) return JSON.parse(lines.find((line) => line.startsWith('data: ')).slice(6))
        }
      }
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    throw new Error('The event stream ended before a tree event.')
  }

  it('answers GET /api/tree in the folder shape only when the page asks for it', async () => {
    const files = ['README.md', 'src/model/a.js', 'src/b.js', 'données/été.md']
    const loop = await startLoop({ bridge: { projectRoot: makeProject(files) } })
    loops.push(loop)
    await waitForPaperclip(loop.url)
    const plain = (await getJson(`${loop.url}/api/tree`)).body
    expect(plain).toEqual({ root: 'project', files: [...files].sort(), created: [] })
    const packed = (await getJson(`${loop.url}/api/tree`, { headers: { Accept: FOLDER_SHAPE_ACCEPT } })).body
    expect(packed.shape).toBe(FOLDER_SHAPE)
    expect(packed.created).toEqual([])
    expect(readFileList(packed)).toEqual({ root: 'project', files: plain.files })
    expect((await discoverBridge({ url: loop.url })).files).toEqual(plain.files)
  })

  it('sends the first tree event in the folder shape only to a page that asks for it', async () => {
    const root = makeProject(['a.js', 'src/b.js'])
    const loop = await startLoop({ bridge: { projectRoot: root, debounceMs: 50 } })
    loops.push(loop)
    await waitForPaperclip(loop.url)
    let opened
    const ready = new Promise((resolve) => {
      opened = resolve
    })
    const asking = readFirstTree(loop.url, `?tree=${FOLDER_SHAPE}`, () => opened())
    await ready
    const plain = readFirstTree(loop.url, '?tree=1', () => writeFileSync(join(root, 'src', 'c.js'), 'x\n'))
    const [packed, paths] = await Promise.all([asking, plain])
    expect(paths).toEqual({ root: 'project', files: ['a.js', 'src/b.js', 'src/c.js'] })
    expect(packed.shape).toBe(FOLDER_SHAPE)
    expect(readFileList(packed)).toEqual(paths)
  })

  it('keeps later tree events as a short list of paths', () => {
    const before = ['a.js']
    const text = treeEvent({ root: 'p', files: ['a.js', 'b.js'] }, before, FOLDER_SHAPE)
    expect(JSON.parse(text.split('\n')[1].slice(6))).toEqual({ root: 'p', files: ['b.js'] })
  })
})
