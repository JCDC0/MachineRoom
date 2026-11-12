import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge, deletedDiffArgs, mergeNamedFiles, readTree, readTreePartial } from '../server/index.js'
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

async function waitForTreePath(url, name, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const folder = await folderTree(url)
    if (treePaths(folder.body).includes(name)) return
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name}.`)
    await wait(10)
  }
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

function startBridge({ root, files, watcher, readTree, readTreePartial, treeBudgetMs = 3000, quietMs = 60000, quietFullMs = 60000 }) {
  const counts = { full: 0, partial: [] }
  const bridge = createBridge({
    projectRoot: root,
    port: 0,
    env: {},
    initialTree: { root: 'project', files, created: [] },
    debounceMs: 5,
    pollMs: 5,
    quietMs,
    quietFullMs,
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

describe('a read whose list call fails', () => {
  it('walks when the list fails', async () => {
    const dir = makeRoot()
    writeFileSync(join(dir, 'a.js'), 'x')
    const calls = []
    const deletedCalls = []
    const { files } = await readTree(dir, {
      gitList: async (_root, args) => {
        calls.push(args)
        return null
      },
      gitDeleted: async () => {
        deletedCalls.push(true)
        return null
      },
    })
    expect(calls).toEqual([['--cached', '--others', '--exclude-standard']])
    expect(deletedCalls).toHaveLength(1)
    expect(files).toEqual(['a.js'])
  })

  it('answers null and never asks for deleted paths', async () => {
    const dir = makeRoot()
    const calls = []
    const result = await readTreePartial(dir, ['a.js'], {
      gitList: async (_root, args) => {
        calls.push(args)
        return null
      },
    })
    expect(result).toBeNull()
    expect(calls).toEqual([['--cached', '--others', '--exclude-standard', '--', 'a.js']])
  })
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

describe('an unstaged delete', () => {
  it('leaves the list after a full read and after a partial read', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'a.js'), 'x')
    writeFileSync(join(dir, 'b.js'), 'x')
    mkdirSync(join(dir, 'dir'))
    writeFileSync(join(dir, 'dir', 'a.js'), 'x')
    writeFileSync(join(dir, 'dir', 'b.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, 'b.js'))
    rmSync(join(dir, 'dir', 'b.js'))

    expect((await readTree(dir)).files).toEqual(['a.js', 'dir/a.js'])
    expect((await readTreePartial(dir, ['b.js'])).files).toEqual([])
    expect((await readTreePartial(dir, ['dir'])).files).toEqual(['dir/a.js'])
  })
})

describe('the deleted-file diff', () => {
  it('leaves a tracked file deleted from the folder out of a full read', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'gone.js'), 'x')
    writeFileSync(join(dir, 'kept.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, 'gone.js'))

    expect((await readTree(dir)).files).toEqual(['kept.js'])
  })

  it('leaves a tracked file deleted from the folder out of a partial read of its name', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'gone.js'), 'x')
    writeFileSync(join(dir, 'kept.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, 'gone.js'))

    expect((await readTreePartial(dir, ['gone.js'])).files).toEqual([])
    expect((await readTreePartial(dir, ['kept.js'])).files).toEqual(['kept.js'])
  })

  it('leaves a file removed with git rm out of both reads', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'gone.js'), 'x')
    writeFileSync(join(dir, 'kept.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    execFileSync(gitPath(), ['rm', '-f', '--quiet', '--', 'gone.js'], { cwd: dir, stdio: 'ignore' })

    expect((await readTree(dir)).files).toEqual(['kept.js'])
    expect((await readTreePartial(dir, ['gone.js'])).files).toEqual([])
  })

  it('reads a name that starts with a minus sign as a path', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, '-odd.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, '-odd.js'))

    expect((await readTree(dir)).files).toEqual([])
    expect((await readTreePartial(dir, ['-odd.js'])).files).toEqual([])
  })

  it('names a deleted file relative to a project folder inside the repository', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'gone.js'), 'x')
    writeFileSync(join(dir, 'sub', 'kept.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, 'sub', 'gone.js'))

    const deleted = execFileSync(gitPath(), ['-C', join(dir, 'sub'), ...deletedDiffArgs()], { encoding: 'utf8' })

    expect(deleted.split(' ').filter(Boolean)).toEqual(['gone.js'])
  })

  it('does not write the index when a file only changed its time', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'kept.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    const later = new Date(Date.now() + 60000)
    utimesSync(join(dir, 'kept.js'), later, later)
    const before = statSync(join(dir, '.git', 'index')).mtimeMs

    expect((await readTree(dir)).files).toEqual(['kept.js'])
    expect(statSync(join(dir, '.git', 'index')).mtimeMs).toBe(before)
  })

  it('asks for the deleted names with the flags that keep the diff cheap', () => {
    expect(deletedDiffArgs()).toEqual([
      '-c',
      'core.longpaths=true',
      'diff-files',
      '--name-only',
      '-z',
      '--diff-filter=D',
      '--no-ext-diff',
      '--no-textconv',
      '--relative',
    ])
    expect(deletedDiffArgs(['gone.js'])).toEqual([
      '-c',
      'core.longpaths=true',
      'diff-files',
      '--name-only',
      '-z',
      '--diff-filter=D',
      '--no-ext-diff',
      '--no-textconv',
      '--relative',
      '--',
      'gone.js',
    ])
  })

  it('keeps the list when the diff fails', async () => {
    const dir = makeRoot()
    execFileSync(gitPath(), ['init', '--quiet', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'gone.js'), 'x')
    execFileSync(gitPath(), ['add', '--', '.'], { cwd: dir, stdio: 'ignore' })
    rmSync(join(dir, 'gone.js'))

    expect((await readTree(dir, { gitDeleted: async () => null })).files).toEqual(['gone.js'])
    expect((await readTreePartial(dir, ['gone.js'], { gitDeleted: async () => null })).files).toEqual(['gone.js'])
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

describe('a plain folder', () => {
  it('starts one git list for the first read and walks the next watcher event', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), 'x')
    const watcher = fakeWatch()
    const calls = []
    let reads = 0
    const bridge = createBridge({
      projectRoot: root,
      port: 0,
      env: {},
      debounceMs: 5,
      pollMs: 60000,
      quietMs: 60000,
      quietFullMs: 60000,
      watchProject: watcher.projectWatch,
      readTree: async (folder) => {
        reads += 1
        return readTree(folder, {
          gitList: async (_folder, args) => {
            calls.push(args)
            return null
          },
          gitDeleted: async () => {
            calls.push(['diff', '--diff-filter=D'])
            return null
          },
        })
      },
    })
    bridges.push(bridge)
    const { url } = await bridge.start()
    await waitFor(() => reads === 1)
    expect(calls).toHaveLength(2)

    writeFileSync(join(root, 'b.js'), 'x')
    watcher.emit('b.js')
    await waitForTreePath(url, 'b.js')
    expect(reads).toBe(1)
    expect(calls).toHaveLength(2)
  })
})

describe('the quiet full read', () => {
  it('arms none for a watcher event after a full read', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      quietFullMs: 20,
      readTree: async () => ({ root: 'project', files: ['a.js'], created: [] }),
      readTreePartial: async () => null,
    })
    await bridge.start()

    watcher.emit('b.js')
    await waitFor(() => counts.full === 1)
    watcher.emit('c.js')
    await wait(60)
    expect(counts.full).toBe(1)
    expect(counts.partial).toHaveLength(1)
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

  it('runs one full read after a partial read goes quiet', async () => {
    const watcher = fakeWatch()
    const { bridge, counts } = startBridge({
      root: makeRoot(),
      files: ['a.js'],
      watcher,
      quietFullMs: 20,
      readTree: async () => ({ root: 'project', files: ['a.js', 'b.js', 'c.js'], created: [] }),
      readTreePartial: async () => ({ root: 'project', files: ['b.js'], created: [] }),
    })
    const { url } = await bridge.start()

    watcher.emit('b.js')
    await waitFor(() => counts.partial.length === 1)
    expect(counts.full).toBe(0)
    await waitFor(() => counts.full === 1)
    expect(counts.partial).toEqual([['b.js']])

    const folder = await folderTree(url)
    expect(treePaths(folder.body)).toContain('c.js')
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
      expect(readTreeEvents(events.text())).toEqual([{ root: 'project', files: [], removed: ['b.js'], version: 2, start: expect.any(String) }])
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
        { root: 'project', files: [], removed: ['dir/a.js', 'dir/b.js'], version: 2, start: expect.any(String) },
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
