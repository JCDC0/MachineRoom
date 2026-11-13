import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FOLDER_SHAPE, createBridge, packTree, treeReadDue } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, { timeoutMs = 5000, everyMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error('Timed out waiting for the tree read.')
    await wait(everyMs)
  }
}

function queuedReads() {
  const reads = []
  const readTree = () => {
    let resolve
    const promise = new Promise((done) => {
      resolve = done
    })
    reads.push({ promise, resolve })
    return promise
  }
  return { reads, readTree }
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

const roots = []
const bridges = []

function makeRoot() {
  const root = makeTempDir('mr-tree-read-')
  roots.push(root)
  return root
}

function startBridge({ readTree, root, debounceMs = 15, pollMs, quietMs }) {
  const bridge = createBridge({
    projectRoot: root,
    port: 0,
    env: {},
    debounceMs,
    pollMs,
    quietMs,
    readTree,
  })
  bridges.push(bridge)
  return { bridge, started: bridge.start() }
}

afterEach(async () => {
  while (bridges.length > 0) await bridges.pop().stop()
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('a tree read in flight', () => {
  it('does not hold GET /api/health', async () => {
    const root = makeRoot()
    const queued = queuedReads()
    const { started } = startBridge({ readTree: queued.readTree, root })
    queued.reads[0].resolve({ root: 'project', files: [], created: [] })
    const { url } = await started

    writeFileSync(join(root, 'a.js'), '1\n')
    await waitFor(() => queued.reads.length === 2)

    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)

    queued.reads[1].resolve({ root: 'project', files: ['a.js'], created: [] })
  })

  it('reads once more after five changes during one pending read', async () => {
    const root = makeRoot()
    const queued = queuedReads()
    const { started } = startBridge({ readTree: queued.readTree, root, debounceMs: 10 })
    queued.reads[0].resolve({ root: 'project', files: ['a.js'], created: [] })
    await started

    writeFileSync(join(root, 'start.js'), 'start\n')
    await waitFor(() => queued.reads.length === 2)
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(root, `change-${index}.js`), `${index}\n`)
      await wait(40)
    }
    await wait(50)
    expect(queued.reads).toHaveLength(2)

    queued.reads[1].resolve({ root: 'project', files: ['a.js', 'b.js'], created: [] })
    await waitFor(() => queued.reads.length === 3)
    await wait(150)
    expect(queued.reads).toHaveLength(3)

    queued.reads[2].resolve({ root: 'project', files: ['a.js', 'b.js'], created: [] })
  })

  it('writes no tree event after the bridge stops during a read', async () => {
    const root = makeRoot()
    const queued = queuedReads()
    const { bridge, started } = startBridge({ readTree: queued.readTree, root, debounceMs: 10 })
    queued.reads[0].resolve({ root: 'project', files: ['a.js'], created: [] })
    const { url } = await started
    const events = await openEvents(url)

    writeFileSync(join(root, 'b.js'), '2\n')
    await waitFor(() => queued.reads.length === 2)

    await bridge.stop()
    queued.reads[1].resolve({ root: 'project', files: ['a.js', 'b.js'], created: [] })
    await wait(50)

    await events.close()
    expect(events.text()).not.toContain('event: tree')
  })

  it('answers GET /api/tree with the tree from the read', async () => {
    const queued = queuedReads()
    const { started } = startBridge({ readTree: queued.readTree, root: makeRoot() })
    queued.reads[0].resolve({ root: 'project', files: ['old.js'], created: [] })
    const { url } = await started
    await wait(1100)

    const pending = fetch(`${url}/api/tree`, { signal: AbortSignal.timeout(5000) })
    await waitFor(() => queued.reads.length === 2)

    queued.reads[1].resolve({ root: 'project', files: ['src/a.js'], created: [] })
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ root: 'project', files: ['src/a.js'], created: [], start: expect.any(String) })
  })
})

const FOLDER_ACCEPT = `application/json; shape=${FOLDER_SHAPE}`

async function folderTree(url) {
  const response = await fetch(`${url}/api/tree`, {
    headers: { Accept: FOLDER_ACCEPT },
    signal: AbortSignal.timeout(10000),
  })
  return { status: response.status, body: await response.json() }
}

describe('the folder tree answer', () => {
  it('packs once and reuses the answer while the version holds', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    let packs = 0
    const bridge = createBridge({
      projectRoot: root,
      port: 0,
      env: {},
      readTree: async () => ({ root: 'project', files: ['a.js'], created: [] }),
      packTree: (tree) => {
        packs += 1
        return packTree(tree)
      },
    })
    bridges.push(bridge)
    const { url } = await bridge.start()

    const [first, second] = await Promise.all([folderTree(url), folderTree(url)])
    expect(first.status).toBe(200)
    expect(first.body.version).toBe(1)
    expect(second.body).toEqual(first.body)
    expect(packs).toBe(1)

    const third = await folderTree(url)
    expect(third.body).toEqual(first.body)
    expect(packs).toBe(1)
  })

  it('answers a folder ask from the last tree at any age and starts no read', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    let reads = 0
    const bridge = createBridge({
      projectRoot: root,
      port: 0,
      env: {},
      debounceMs: 1000,
      pollMs: 1000,
      quietMs: 60000,
      readTree: async () => {
        reads += 1
        return { root: 'project', files: ['a.js'], created: [] }
      },
    })
    bridges.push(bridge)
    const { url } = await bridge.start()
    await waitFor(() => reads === 1)

    await wait(1100)
    const answer = await folderTree(url)
    expect(answer.body.version).toBe(1)
    expect(reads).toBe(1)
  })

  it('waits for the read in flight and starts no other', async () => {
    const queued = queuedReads()
    const { started } = startBridge({ readTree: queued.readTree, root: makeRoot() })
    const { url } = await started

    const pending = folderTree(url)
    await wait(50)
    expect(queued.reads).toHaveLength(1)
    queued.reads[0].resolve({ root: 'project', files: ['a.js'], created: [] })
    const answer = await pending
    expect(answer.body.version).toBe(1)
    expect(queued.reads).toHaveLength(1)
  })
})

describe('the bridge before its first tree', () => {
  it('answers health while the first read is open and tree waits for it', async () => {
    const queued = queuedReads()
    const { started } = startBridge({ readTree: queued.readTree, root: makeRoot() })
    const { url } = await started

    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })
    expect(health.status).toBe(200)
    expect((await health.json()).ok).toBe(true)

    const pending = fetch(`${url}/api/tree`, { signal: AbortSignal.timeout(5000) })
    await wait(50)
    queued.reads[0].resolve({ root: 'project', files: ['a.js'], created: [] })
    const tree = await (await pending).json()
    expect(tree.files).toEqual(['a.js'])
    expect(queued.reads).toHaveLength(1)
  })

  it('takes an initial tree as its first one and starts no read', async () => {
    let reads = 0
    const bridge = createBridge({
      projectRoot: makeRoot(),
      port: 0,
      env: {},
      initialTree: { root: 'project', files: ['a.js', 'src/b.js'], created: [] },
      readTree: async () => {
        reads += 1
        return { root: 'project', files: [], created: [] }
      },
    })
    bridges.push(bridge)
    const { url } = await bridge.start()

    const folder = await folderTree(url)
    expect(folder.body.version).toBe(1)
    expect(folder.body.shape).toBe(FOLDER_SHAPE)
    expect(reads).toBe(0)
  })
})

describe('the tree read timing rule', () => {
  const base = {
    lastReadEndAt: 1000,
    lastReadMs: 1600,
    lastReadChanged: true,
    lastTreeAt: 1000,
    quietMs: 300,
    pollMs: 200,
    budgetMs: 3000,
  }

  it('waits the budget minus the last read after a read that saw changes', () => {
    expect(treeReadDue({ ...base, now: 2399 })).toBe(false)
    expect(treeReadDue({ ...base, now: 2400 })).toBe(true)
  })

  it('starts at once after a long read that used the budget', () => {
    const long = { ...base, lastReadMs: 3700 }
    expect(treeReadDue({ ...long, now: 1199 })).toBe(false)
    expect(treeReadDue({ ...long, now: 1200 })).toBe(true)
  })

  it('waits for quiet after a read that saw no change', () => {
    const same = { ...base, lastReadChanged: false }
    expect(treeReadDue({ ...same, now: 1299 })).toBe(false)
    expect(treeReadDue({ ...same, now: 1300 })).toBe(true)
  })

  it('does not use the quiet wait after a read that saw changes', () => {
    expect(treeReadDue({ ...base, now: 1100 })).toBe(false)
  })
})

function removeRoot(root) {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

describe('the watcher when it cannot be armed', () => {
  it('keeps polling after a burst when watch throws on the way back', async () => {
    const root = makeRoot()
    let files = ['a.js']
    let reads = 0
    const readTree = async () => {
      reads += 1
      return { root: 'project', files: [...files], created: [] }
    }
    const { started } = startBridge({ readTree, root, debounceMs: 5, pollMs: 5, quietMs: 50 })
    const { url } = await started
    const events = await openEvents(url, '?tree=1')
    try {
      writeFileSync(join(root, 'burst.js'), '1\n')
      await waitFor(() => reads >= 2)
      removeRoot(root)
      await wait(250)

      const before = reads
      await wait(60)
      expect(reads).toBeGreaterThan(before)

      files = ['a.js', 'b.js']
      await waitFor(() => events.text().includes('b.js'))
    } finally {
      await events.close()
    }
  })

  it('polls at once when watch throws at startup', async () => {
    const root = makeRoot()
    removeRoot(root)
    let files = ['a.js']
    let reads = 0
    const readTree = async () => {
      reads += 1
      return { root: 'project', files: [...files], created: [] }
    }
    const { started } = startBridge({ readTree, root, debounceMs: 5, pollMs: 10, quietMs: 10 })
    const { url } = await started
    expect(reads).toBe(1)
    const events = await openEvents(url, '?tree=1')
    try {
      files = ['a.js', 'b.js']
      await waitFor(() => events.text().includes('b.js'))
      expect(reads).toBeGreaterThan(1)
    } finally {
      await events.close()
    }
  })
})

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

function changingReads(files) {
  let current = files
  let count = 0
  const readTree = async () => {
    count += 1
    return { root: 'project', files: [...current], created: [] }
  }
  return { readTree, count: () => count, set: (next) => { current = next } }
}

async function waitForVersion(url, version, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const answer = await folderTree(url)
    if (answer.body.version === version) return answer
    if (Date.now() > deadline) throw new Error(`Timed out waiting for tree version ${version}.`)
    await wait(20)
  }
}

describe('a file that leaves the project', () => {
  it('sends the removed path to a plain stream and a folder stream', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    const reads = changingReads(['a.js', 'b.js'])
    const { started } = startBridge({ readTree: reads.readTree, root, debounceMs: 10, pollMs: 10, quietMs: 20 })
    const { url } = await started
    const tree = await waitForVersion(url, 1)
    expect(tree.body.files.length).toBeGreaterThan(0)
    const since = `${tree.body.start}:1`
    const plain = await openEvents(url, `?tree=1&since=${since}`)
    const folder = await openEvents(url, `?tree=${FOLDER_SHAPE}&since=${since}`)
    try {
      reads.set(['a.js'])
      writeFileSync(join(root, 'tick.js'), '1\n')
      await waitFor(() => reads.count() >= 2)
      await waitFor(() => readTreeEvents(plain.text()).length > 0 && readTreeEvents(folder.text()).length > 0)
      expect(readTreeEvents(plain.text())).toEqual([{ root: 'project', files: [], removed: ['b.js'], version: 2, start: tree.body.start }])
      expect(readTreeEvents(folder.text())).toEqual([{ root: 'project', files: [], removed: ['b.js'], version: 2, start: tree.body.start }])
    } finally {
      await plain.close()
      await folder.close()
    }
  })

  it('sends the old path removed and the new path added for a rename', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    const reads = changingReads(['a.js', 'old.js'])
    const { started } = startBridge({ readTree: reads.readTree, root, debounceMs: 10, pollMs: 10, quietMs: 20 })
    const { url } = await started
    const tree = await waitForVersion(url, 1)
    const events = await openEvents(url, `?tree=1&since=${tree.body.start}:1`)
    try {
      reads.set(['a.js', 'new.js'])
      writeFileSync(join(root, 'tick.js'), '1\n')
      await waitFor(() => readTreeEvents(events.text()).length > 0)
      expect(readTreeEvents(events.text())).toEqual([
        { root: 'project', files: ['new.js'], removed: ['old.js'], version: 2, start: tree.body.start },
      ])
    } finally {
      await events.close()
    }
  })

  it('sends a page at an old version both the added and the removed paths', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    const reads = changingReads(['a.js', 'b.js'])
    const { started } = startBridge({ readTree: reads.readTree, root, debounceMs: 10, pollMs: 10, quietMs: 20 })
    const { url } = await started
    const tree = await waitForVersion(url, 1)

    reads.set(['a.js'])
    writeFileSync(join(root, 'tick-1.js'), '1\n')
    await waitForVersion(url, 2)

    reads.set(['a.js', 'c.js'])
    writeFileSync(join(root, 'tick-2.js'), '1\n')
    await waitForVersion(url, 3)

    const events = await openEvents(url, `?tree=1&since=${tree.body.start}:1`)
    try {
      await waitFor(() => readTreeEvents(events.text()).length > 0)
      expect(readTreeEvents(events.text())).toEqual([
        { root: 'project', files: ['c.js'], removed: ['b.js'], version: 3, start: tree.body.start },
      ])
    } finally {
      await events.close()
    }
  })
})

describe('unreadable folders in the plain tree', () => {
  it('reports an unreadable root error in health and keeps the last good tree', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.js'), '1\n')
    let blockRoot = true
    const listDir = (folder, options) => {
      if (blockRoot && folder === root) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return readdirSync(folder, options)
    }
    const initialFailBridge = createBridge({
      projectRoot: root,
      port: 0,
      env: {},
      debounceMs: 15,
      pollMs: 15,
      quietMs: 50,
      listDir,
    })
    bridges.push(initialFailBridge)
    const { url: failUrl } = await initialFailBridge.start()
    await waitFor(async () => {
      const health = await (await fetch(`${failUrl}/api/health`)).json()
      return health.problems.length > 0
    })
    const initialHealth = await (await fetch(`${failUrl}/api/health`)).json()
    expect(initialHealth.ok).toBe(true)
    expect(initialHealth.problems.join('\n')).toContain('permission denied')

    blockRoot = false
    const recoverRoot = makeRoot()
    writeFileSync(join(recoverRoot, 'kept.js'), '1\n')
    let lockAfter = false
    const recoverBridge = createBridge({
      projectRoot: recoverRoot,
      port: 0,
      env: {},
      debounceMs: 15,
      pollMs: 15,
      quietMs: 50,
      listDir: (folder, options) => {
        if (lockAfter && folder === recoverRoot) throw Object.assign(new Error('root locked'), { code: 'EACCES' })
        return readdirSync(folder, options)
      },
    })
    bridges.push(recoverBridge)
    const { url } = await recoverBridge.start()
    const before = await (await fetch(`${url}/api/tree`)).json()
    expect(before.files).toEqual(['kept.js'])
    const events = await openEvents(url, `?tree=1&since=${before.start}:1`)
    try {
      lockAfter = true
      await wait(1100)
      const after = await (await fetch(`${url}/api/tree`)).json()
      expect(after.files).toEqual(['kept.js'])
      const health = await (await fetch(`${url}/api/health`)).json()
      expect(health.ok).toBe(true)
      expect(health.problems.join('\n')).toContain('root locked')
      expect(readTreeEvents(events.text())).toEqual([])
    } finally {
      await events.close()
    }
  })

  it('keeps the old files of an unreadable child folder and names it in health problems', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'open'), { recursive: true })
    mkdirSync(join(root, 'sub', 'locked', 'deep'), { recursive: true })
    writeFileSync(join(root, 'open', 'a.js'), '1\n')
    writeFileSync(join(root, 'sub', 'locked', 'b.js'), '2\n')
    writeFileSync(join(root, 'sub', 'locked', 'deep', 'c.js'), '3\n')
    let blockChild = false
    const bridge = createBridge({
      projectRoot: root,
      port: 0,
      env: {},
      debounceMs: 15,
      pollMs: 15,
      quietMs: 50,
      listDir: (folder, options) => {
        if (blockChild && folder === join(root, 'sub', 'locked')) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        }
        return readdirSync(folder, options)
      },
    })
    bridges.push(bridge)
    const { url } = await bridge.start()
    const first = await (await fetch(`${url}/api/tree`)).json()
    expect(first.files).toEqual(['open/a.js', 'sub/locked/b.js', 'sub/locked/deep/c.js'])

    blockChild = true
    writeFileSync(join(root, 'open', 'added.js'), '4\n')
    await waitFor(async () => {
      const health = await (await fetch(`${url}/api/health`)).json()
      return health.problems.some((line) => line.includes('sub/locked'))
    })

    const tree = await (await fetch(`${url}/api/tree`)).json()
    expect(tree.files).toEqual(['open/a.js', 'open/added.js', 'sub/locked/b.js', 'sub/locked/deep/c.js'])
    const health = await (await fetch(`${url}/api/health`)).json()
    expect(health.ok).toBe(true)
    expect(health.problems.some((line) => line.includes('sub/locked'))).toBe(true)
  })
})
