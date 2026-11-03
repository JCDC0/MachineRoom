import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_DEPTH_DEFAULT,
  CONFIRM_DEPTH_PROBLEM,
  LIMIT_DEPTH_PROBLEM,
  ORIGIN_DEPTH_PROBLEM,
  TOKEN_DEPTH_PROBLEM,
  UNLOCK_DEPTH_PROBLEM,
  agentDepthFileFor,
  readAgentDepth,
  saveAgentDepth,
} from '../server/agent-depth.js'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

async function startBridge() {
  const projectRoot = tempDir('mr-depth-project-')
  const runsFolder = tempDir('mr-depth-runs-')
  mkdirSync(runsFolder, { recursive: true })
  const bridge = createBridge({ projectRoot, runsFolder, port: 0, env: {} })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, runsFolder }
}

async function request(url, { method = 'GET', origin = 'http://localhost:5173', token = '', body = null } = {}) {
  const headers = {}
  if (origin) headers.Origin = origin
  if (token) headers['X-MachineRoom-Orchestrator'] = token
  if (body !== null) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

describe('the agent depth file', () => {
  it('reads 2 and locked when there is no file', () => {
    const runs = tempDir('mr-depth-none-')
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })
    expect(existsSync(agentDepthFileFor(runs))).toBe(false)
  })

  it('saves the limit and the unlock in agent-depth.json', () => {
    const runs = tempDir('mr-depth-save-')
    expect(saveAgentDepth(runs, { limit: 3, unlocked: true })).toEqual({ limit: 3, unlocked: true })
    expect(JSON.parse(readFileSync(agentDepthFileFor(runs), 'utf8'))).toEqual({ limit: 3, unlocked: true })
    expect(readAgentDepth(runs)).toEqual({ limit: 3, unlocked: true })
  })

  it('keeps a deep limit only while it is unlocked, and survives a broken file', () => {
    const runs = tempDir('mr-depth-broken-')
    saveAgentDepth(runs, { limit: 4, unlocked: false })
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })

    writeFileSync(agentDepthFileFor(runs), 'not json')
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })
  })
})

describe('GET and POST /api/agent-depth', () => {
  it('answers 2 and locked by default', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })
  })

  it('refuses a write without a page Origin', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      origin: '',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe(ORIGIN_DEPTH_PROBLEM)
  })

  it('refuses a write from an orchestrator token', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      token: 'a-room-token',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe(TOKEN_DEPTH_PROBLEM)
  })

  it('refuses a depth past 2 without an unlock and needs a confirmation', async () => {
    const { url, runsFolder } = await startBridge()
    const deep = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 3, unlocked: false, confirmed: true },
    })
    expect(deep.status).toBe(400)
    expect(deep.body.error).toBe(UNLOCK_DEPTH_PROBLEM)
    expect(existsSync(agentDepthFileFor(runsFolder))).toBe(false)

    const unconfirmed = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false },
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(CONFIRM_DEPTH_PROBLEM)

    const outOfRange = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 5, unlocked: true, confirmed: true },
    })
    expect(outOfRange.status).toBe(400)
    expect(outOfRange.body.error).toBe(LIMIT_DEPTH_PROBLEM)
  })

  it('saves an unlocked 3 or 4 and reads it back', async () => {
    const { url, runsFolder } = await startBridge()
    const saved = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 3, unlocked: true, confirmed: true },
    })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ ok: true, limit: 3, unlocked: true })
    expect(JSON.parse(readFileSync(agentDepthFileFor(runsFolder), 'utf8'))).toEqual({ limit: 3, unlocked: true })

    const read = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(read.body).toEqual({ limit: 3, unlocked: true })

    const deeper = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 4, unlocked: true, confirmed: true },
    })
    expect(deeper.status).toBe(200)
    expect(deeper.body).toEqual({ ok: true, limit: 4, unlocked: true })

    const locked = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: AGENT_DEPTH_DEFAULT, unlocked: false, confirmed: true },
    })
    expect(locked.status).toBe(200)
    expect(locked.body).toEqual({ ok: true, limit: AGENT_DEPTH_DEFAULT, unlocked: false })
  })

  it('sends an agents notice after a write', async () => {
    const { url } = await startBridge()
    const notices = []
    const controller = new AbortController()
    cleanups.push(() => controller.abort())

    const response = await fetch(`${url}/events`, { signal: controller.signal })
    const decoder = new TextDecoder()
    let buffer = ''
    ;(async () => {
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const block = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            cut = buffer.indexOf('\n\n')
            const lines = block.split('\n')
            if (lines.some((line) => line.trim() === 'event: change')) {
              const dataLine = lines.find((line) => line.startsWith('data: '))
              if (dataLine) {
                try {
                  notices.push(JSON.parse(dataLine.slice(6)))
                } catch {}
              }
            }
          }
        }
      } catch {}
    })()

    await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })

    const deadline = Date.now() + 10000
    while (!notices.some((notice) => notice.topic === 'agents') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(notices.some((notice) => notice.topic === 'agents')).toBe(true)
  })
})
