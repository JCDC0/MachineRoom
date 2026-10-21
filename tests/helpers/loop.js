import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridge } from '../../server/index.js'
import { startFakePaperclip } from '../../scripts/fake-paperclip.mjs'
import { makeTempDir } from './tempRoot.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'fixtures')

export function makeSandbox() {
  const tree = JSON.parse(readFileSync(join(FIXTURES, 'sandbox-tree.json'), 'utf8'))
  const root = join(makeTempDir('mr-loop-'), tree.root)
  for (const file of tree.files) {
    if (tree.created.includes(file)) continue
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${file}\n`)
  }
  return root
}

export async function startLoop({ fake: fakeOptions = {}, bridge: bridgeOptions = {} } = {}) {
  const fake = await startFakePaperclip({ speed: 1000, ...fakeOptions, port: 0 })
  const bridge = createBridge({
    paperclipUrl: fake.url,
    companyId: fake.companyId,
    port: 0,
    projectRoot: bridgeOptions.projectRoot ?? makeSandbox(),
    env: {},
    surfaceEveryMs: 0,
    ...bridgeOptions,
  })
  const { url } = await bridge.start()
  return {
    fake,
    bridge,
    url,
    async stop() {
      await bridge.stop()
      await fake.stop()
    },
  }
}

export async function getJson(url, init = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...init })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

export function postJson(url, body) {
  return getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

export async function waitFor(check, { timeoutMs = 10000, everyMs = 25, what = 'the condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await new Promise((resolveWait) => setTimeout(resolveWait, everyMs))
  }
}

export async function waitForPaperclip(url) {
  return waitFor(
    async () => {
      const { body } = await getJson(`${url}/api/health`)
      return body?.paperclip === true && body?.surface?.ok !== null ? body : null
    },
    { what: 'the bridge to connect to the fake Paperclip' }
  )
}

export async function readFrames(url, until, { timeoutMs = 15000, history = true, onOpen = () => {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const frames = []
  try {
    const response = await fetch(`${url}/events${history ? '?history=1' : ''}`, { signal: controller.signal })
    onOpen()
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        cut = buffer.indexOf('\n\n')
        const lines = block.split('\n')
        if (!lines.includes('event: frame')) continue
        const data = lines.find((line) => line.startsWith('data: '))
        if (data) frames.push(JSON.parse(data.slice(6)))
      }
      if (until(frames)) return frames
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  throw new Error(`The event stream ended before the frames arrived (${frames.length} read).`)
}

export function runEnded(agentId) {
  return (frames) =>
    frames.some(
      (frame) =>
        frame.type === 'heartbeat.run.status' &&
        frame.payload?.agentId === agentId &&
        ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(frame.payload?.status)
    )
}
