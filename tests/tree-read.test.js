import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, { timeoutMs = 5000, everyMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return
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

    const pending = fetch(`${url}/api/tree`, { signal: AbortSignal.timeout(5000) })
    await waitFor(() => queued.reads.length === 2)

    queued.reads[1].resolve({ root: 'project', files: ['src/a.js'], created: [] })
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ root: 'project', files: ['src/a.js'], created: [] })
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
