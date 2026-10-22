import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const DEAD_PAPERCLIP = 'http://127.0.0.1:3999'

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

async function openEvents(url) {
  const controller = new AbortController()
  const response = await fetch(`${url}/events`, { signal: controller.signal })
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

function startBridge({ readTree, root, debounceMs = 15 }) {
  const bridge = createBridge({
    paperclipUrl: DEAD_PAPERCLIP,
    companyId: 'tree-read-test',
    projectRoot: root,
    port: 0,
    env: {},
    surfaceEveryMs: 0,
    debounceMs,
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
