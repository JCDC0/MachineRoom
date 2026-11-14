import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridge } from '../../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../../server/active-lanes.js'
import { readLanes } from '../../server/lanes-source.js'
import { makeTree } from '../../src/model/paths.js'
import { createPipeline } from '../../src/model/pipeline.js'
import { apply, createState } from '../../src/model/state.js'
import { makeTempDir } from './tempRoot.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'fixtures')

export const TEST_LANES = {
  claude: { name: 'Claude Code', harness: 'Claude Code', cli: { harness: 'claude', model: 'sonnet' }, worktree: 'C:\\work\\claude' },
  hermes: { name: 'Hermes', harness: 'Hermes', cli: { harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' }, worktree: 'C:\\work\\hermes' },
  opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }, worktree: 'C:\\work\\opencode' },
}

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

export async function startLaneBridge({
  projectRoot = makeTempDir('mr-project-'),
  runsDir = makeTempDir('mr-runs-'),
  lanes = TEST_LANES,
  bridge = {},
  lanesSource = {},
} = {}) {
  mkdirSync(runsDir, { recursive: true })
  writeActiveLanes(activeLanesFileFor(projectRoot, runsDir), Array.from(new Set([...Object.keys(lanes), ...Object.keys(readLanes())])))
  const started = createBridge({
    projectRoot,
    port: 0,
    env: {},
    ...bridge,
    lanesSource: { folder: runsDir, lanes, repoRoot: projectRoot, pollMs: 20, quietMs: 60000, primeMs: 600000, ...lanesSource },
  })
  const { url } = await started.start()
  return {
    bridge: started,
    url,
    runsDir,
    projectRoot,
    writeLog(name, text, { append = false } = {}) {
      const path = join(runsDir, `${name}.log`)
      if (append) appendFileSync(path, text)
      else writeFileSync(path, text)
      return path
    },
    async stop() {
      await started.stop()
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

export async function openRunWatch(url) {
  const controller = new AbortController()
  const response = await fetch(`${url}/events`, { signal: controller.signal })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let timedOut = false
  let timer = null

  async function nextNotice() {
    for (;;) {
      const cut = buffer.indexOf('\n\n')
      if (cut !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const lines = block.split(/\r?\n/)
        if (!lines.includes('event: change')) continue
        const data = lines.find((line) => line.startsWith('data: '))
        if (!data) continue
        return JSON.parse(data.slice(6))
      }
      const { value, done } = await reader.read()
      if (done) return null
      buffer += decoder.decode(value, { stream: true })
    }
  }

  return {
    async waitForEnd(routeUrl, { lane = '', startedAt = '', timeoutMs = 15000, what = 'the run to end' } = {}) {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      timer.unref?.()
      try {
        for (;;) {
          const notice = await nextNotice()
          if (notice === null) throw new Error(`The event stream ended before ${what}.`)
          if (notice?.topic !== 'runs') continue
          const { body } = await getJson(`${routeUrl}/api/control/runs`)
          const running = Array.isArray(body?.running) ? body.running : []
          const stillRunning = running.some(
            (item) => item?.startedAt === startedAt && (lane === '' || item?.lane === lane)
          )
          if (!stillRunning) {
            const recent = Array.isArray(body?.recent) ? body.recent : []
            return recent.some((item) => item?.startedAt === startedAt && (lane === '' || item?.lane === lane))
          }
        }
      } catch (error) {
        if (timedOut) throw new Error(`Timed out waiting for ${what}.`)
        throw error
      } finally {
        clearTimeout(timer)
      }
    },
    close() {
      controller.abort()
      reader.cancel().catch(() => {})
    },
  }
}

export async function waitForBridge(url) {
  return waitFor(
    async () => {
      const { body } = await getJson(`${url}/api/health`)
      return body?.ok === true ? body : null
    },
    { what: 'the bridge health answer' }
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

export async function roomInputs(url) {
  const agents = (await getJson(`${url}/api/agents`)).body
  const raw = (await getJson(`${url}/api/tree`)).body
  return { agents, tree: makeTree({ root: raw.root, files: raw.files, created: [] }) }
}

export function playFrames(frames, agents, tree, onActivity = () => {}) {
  const pipeline = createPipeline({ agents, tree })
  const state = createState(tree, agents)
  const activities = []
  const applyOne = (activity) => {
    apply(state, activity)
    activities.push(activity)
    onActivity(activity, state)
  }
  for (const frame of frames) {
    for (const activity of pipeline.push(frame)) applyOne(activity)
  }
  for (const activity of pipeline.flush()) applyOne(activity)
  return { state, activities }
}
