import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge, mergeNamedFiles, readTreePartial } from '../server/index.js'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const FOLDER_ACCEPT = 'application/json; shape=folders'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return
    if (Date.now() > deadline) throw new Error('Timed out waiting for the tree update.')
    await wait(5)
  }
}

function fakeWatch() {
  let listener = null
  function projectWatch(_root, _options, callback) {
    listener = callback
    return {
      on() {},
      close() {},
    }
  }
  return {
    projectWatch,
    emit(name) {
      if (!listener) throw new Error('The watcher is not armed.')
      listener('change', name)
    },
  }
}

function treePaths(body) {
  const paths = ['']
  for (const entry of body.folders) {
    const parent = Number(entry[0])
    const name = String(entry[1])
    paths.push(parent === 0 ? name : `${paths[parent]}/${name}`)
  }
  const out = []
  for (const run of body.files) {
    const folder = paths[Number(run[0])] ?? ''
    for (const name of run.slice(1)) out.push(folder ? `${folder}/${name}` : String(name))
  }
  return out
}

async function folderTree(url) {
  const response = await fetch(`${url}/api/tree`, {
    headers: { Accept: FOLDER_ACCEPT },
    signal: AbortSignal.timeout(10000),
  })
  return { status: response.status, body: await response.json() }
}

async function openEvents(url, query = '') {
  const controller = new AbortController()
  const response = await fetch(`${url}/events${query}`, { signal: controller.signal })
  const chunks = []
  const decoder = new TextDecoder()
  const reading = (async () => {
    try {
      for await (const chunk of response.body) chunks.push(decoder.decode(chunk, { stream: true }))
    } catch {}
  })()
  return {
    text: () => chunks.join(''),
    async close() {
      controller.abort()
      await reading
    },
  }
}

function readTreeEvents(text) {
  const events = []
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n')
    if (!lines.includes('event: tree')) continue
    const data = lines.find((line) => line.startsWith('data: '))
    if (data) events.push(JSON.parse(data.slice(6)))
  }
  return events
}

const roots = []
const bridges = []

function makeRoot() {
  const root = makeTempDir('mr-tree-partial-')
  roots.push(root)
  return root
}

function startBridge({ root, files, watcher, readTree, readTreePartial, treeBudgetMs = 3000 }) {
  const counts = { full: 0, partial: [] }
  const bridge = createBridge({
    projectRoot: root,
    port: 0,
    env: {},
    initialTree: { root: 'project', files, created: [] },
    debounceMs: 5,
    pollMs: 5,
    quietMs: 10,
    treeBudgetMs,
    watchProject: watcher.projectWatch,
    readTree: async (projectRoot) => {
      counts.full += 1
      const tree = readTree ? await readTree(projectRoot) : { root: 'project', files: [...files], created: [] }
      return tree
    },
    readTreePartial: async (projectRoot, names) => {
      counts.partial.push(names)
      return readTreePartial
        ? readTreePartial(projectRoot, names)
        : { root: 'project', files: [...names], created: [] }
    },
  })
  bridges.push(bridge)
  return { bridge, counts }
}

afterEach(async () => {
  while (bridges.length > 0) await bridges.pop().stop()
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('readTreePartial', () => {
  it('lists a named file and folder and keeps an ignored folder out', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, '.gitignore'), 'dist/\n')
    writeFileSync(join(dir, 'top.txt'), 'x')
    writeFileSync(join(dir, 'with space.txt'), 'x')
    mkdirSync(join(dir, 'fresh'))
    writeFileSync(join(dir, 'fresh', 'a.js'), 'x')
    writeFileSync(join(dir, 'fresh', 'b.js'), 'x')
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'skip.txt'), 'x')

    expect((await readTreePartial(dir, ['top.txt'])).files).toEqual(['top.txt'])
    expect((await readTreePartial(dir, ['with space.txt'])).files).toEqual(['with space.txt'])
    expect((await readTreePartial(dir, ['fresh'])).files).toEqual(['fresh/a.js', 'fresh/b.js'])
    expect((await readTreePartial(dir, ['dist'])).files).toEqual([])
  })

  it('answers null outside a git checkout', async () => {
    const dir = makeRoot()
    writeFileSync(join(dir, 'a.js'), 'x')
    expect(await readTreePartial(dir, ['a.js'])).toBeNull()
  })
})

describe('mergeNamedFiles', () => {
  it('drops a held file the list does not answer and keeps the other paths', () => {
    const current = { root: 'project', files: ['a.js', 'dir/a.js', 'dir/b.js'], created: [] }
    expect(mergeNamedFiles(current, ['dir'], ['dir/a.js']).files).toEqual(['a.js', 'dir/a.js'])
    expect(mergeNamedFiles(current, ['dir/a.js'], []).files).toEqual(['a.js', 'dir/b.js'])
    expect(mergeNamedFiles(current, ['dir/a.js'], ['dir/a.js', 'new.js']).files).toEqual([
      'a.js',
      'dir/a.js',
      'dir/b.js',
      'new.js',
    ])
  })
})

describe('a watcher event with names', () => {
  it('lists one new file with one partial read and no full read', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      readTreePartial: async () => ({ root: 'project', files: ['b.js'], created: [] }),
    })
    const { url } = await bridge.start()

    watcher.emit('b.js')
    await waitFor(() => counts.partial.length === 1)
    await wait(60)
    expect(counts.full).toBe(0)
    expect(counts.partial).toEqual([['b.js']])

    const folder = await folderTree(url)
    expect(folder.body.version).toBe(2)
    expect(treePaths(folder.body)).toContain('b.js')
  })

  it('runs one full read and no partial list for 51 names', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      readTree: async () => ({ root: 'project', files: ['a.js'], created: [] }),
    })
    await bridge.start()

    for (let index = 0; index < 51; index += 1) watcher.emit(`f-${index}.js`)
    await waitFor(() => counts.full === 1)
    expect(counts.partial).toHaveLength(0)
  })

  it('removes a deleted named file', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js', 'b.js'],
      watcher,
      readTreePartial: async () => ({ root: 'project', files: ['a.js'], created: [] }),
    })
    const { url } = await bridge.start()
    const events = await openEvents(url, '?tree=1&since=1')
    try {
      watcher.emit('b.js')
      await waitFor(() => readTreeEvents(events.text()).length > 0)
      expect(readTreeEvents(events.text())).toEqual([{ root: 'project', files: [], removed: ['b.js'] }])
      expect(counts.partial).toEqual([['b.js']])
      expect(counts.full).toBe(0)
    } finally {
      await events.close()
    }
  })

  it('removes the held files under a named folder the list no longer answers', async () => {
    const watcher = fakeWatch()
    const { bridge } = startBridge({
      root: makeRoot(),
      files: ['dir/a.js', 'dir/b.js', 'keep.js'],
      watcher,
      readTreePartial: async () => ({ root: 'project', files: [], created: [] }),
    })
    const { url } = await bridge.start()
    const events = await openEvents(url, '?tree=1&since=1')
    try {
      watcher.emit('dir')
      await waitFor(() => readTreeEvents(events.text()).length > 0)
      expect(readTreeEvents(events.text())).toEqual([
        { root: 'project', files: [], removed: ['dir/a.js', 'dir/b.js'] },
      ])
    } finally {
      await events.close()
    }
  })

  it('falls back to a full read when the partial list fails', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      readTree: async () => ({ root: 'project', files: ['a.js', 'b.js'], created: [] }),
      readTreePartial: async () => null,
    })
    const { url } = await bridge.start()

    watcher.emit('b.js')
    await waitFor(() => counts.full === 1)
    expect(counts.partial).toEqual([['b.js']])
    const folder = await folderTree(url)
    expect(treePaths(folder.body)).toContain('b.js')
  })

  it('follows the tenth partial read with a full one', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      treeBudgetMs: 20,
      readTree: async () => ({ root: 'project', files: ['a.js'], created: [] }),
    })
    await bridge.start()

    for (let index = 0; index < 10; index += 1) {
      watcher.emit(`f-${index}.js`)
      await waitFor(() => counts.partial.length === index + 1)
    }
    expect(counts.full).toBe(0)

    watcher.emit('f-10.js')
    await waitFor(() => counts.full === 1)
    expect(counts.partial).toHaveLength(10)
  })

  it('sends a page only the paths it has not had', async () => {
    const watcher = fakeWatch()
    const { bridge } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      readTreePartial: async (_root, names) => ({ root: 'project', files: names, created: [] }),
    })
    const { url } = await bridge.start()
    const events = await openEvents(url, '?tree=1&since=1')
    try {
      watcher.emit('b.js')
      await waitFor(() => events.text().includes('"files":["b.js"]'))
      watcher.emit('c.js')
      await waitFor(() => events.text().includes('"files":["c.js"]'))
      expect(events.text()).not.toContain('"files":["a.js"')
    } finally {
      await events.close()
    }
  })
})
