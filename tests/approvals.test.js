import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { APPROVAL_DENIED, APPROVAL_NO_ANSWER } from '../server/orchestrator.js'
import {
  APPROVAL_ALLOW_PROBLEM,
  APPROVAL_INPUT_LIMIT,
  APPROVAL_LIMIT_PROBLEM,
  APPROVAL_TOOL_PROBLEM,
  CONFIRM_APPROVAL_PROBLEM,
  NO_APPROVAL_PROBLEM,
  NO_TOKEN_PROBLEM,
  OWNER_ANSWER_PROBLEM,
  PAGE_APPROVAL_PROBLEM,
  createOrchestrators,
} from '../server/orchestrators.js'
import { getJson, startLaneBridge, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const LANES = {
  orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function makeRegistry({ approvalTimeoutMs } = {}) {
  const base = tempDir('mr-approvals-')
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(project, { recursive: true })
  const notices = []
  const registry = createOrchestrators({
    projectRoot: project,
    runsFolder: runs,
    lanes: LANES,
    promptFile: join(base, 'orchestrator-agent.md'),
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onNotice: (event) => notices.push(event),
    sendJson: (req, res, status, body) => {
      res.sent = { status, body }
    },
    readJsonBody: async (req) => req.body ?? {},
    ...(approvalTimeoutMs === undefined ? {} : { approvalTimeoutMs }),
  })
  cleanups.push(() => registry.close())
  return { registry, notices }
}

function call(registry, { method = 'POST', path, origin = '', token = '', body = {} }) {
  const req = {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(token ? { 'x-machineroom-orchestrator': token } : {}),
    },
    body,
  }
  const res = {}
  return { done: registry.handle(req, res, new URL(`http://127.0.0.1${path}`)), res }
}

function hold(registry, body = {}) {
  return call(registry, {
    path: '/api/orchestrator/approvals',
    token: registry.token('orchestrator'),
    body: { id: 'orchestrator', tool: 'Bash', input: { command: 'echo hi' }, ...body },
  })
}

function approvalIdOf(registry) {
  return registry.find('orchestrator').answer().approvals[0]?.approvalId
}

describe('orchestrator approvals', () => {
  it('takes an approval only from a no-Origin request with the orchestrator token', async () => {
    const { registry } = makeRegistry()
    const token = registry.token('orchestrator')

    const missingToken = call(registry, { path: '/api/orchestrator/approvals', body: { tool: 'Bash' } })
    await missingToken.done
    expect(missingToken.res.sent).toEqual({ status: 403, body: { error: NO_TOKEN_PROBLEM } })

    const wrongToken = call(registry, { path: '/api/orchestrator/approvals', token: 'wrong', body: { tool: 'Bash' } })
    await wrongToken.done
    expect(wrongToken.res.sent).toEqual({ status: 403, body: { error: NO_TOKEN_PROBLEM } })

    const page = call(registry, {
      path: '/api/orchestrator/approvals',
      origin: 'http://localhost:5173',
      token,
      body: { tool: 'Bash' },
    })
    await page.done
    expect(page.res.sent).toEqual({ status: 403, body: { error: PAGE_APPROVAL_PROBLEM } })

    const other = call(registry, {
      path: '/api/orchestrator/approvals',
      token,
      body: { id: 'another', tool: 'Bash' },
    })
    await other.done
    expect(other.res.sent).toEqual({ status: 403, body: { error: NO_TOKEN_PROBLEM } })

    const noTool = call(registry, { path: '/api/orchestrator/approvals', token, body: { id: 'orchestrator' } })
    await noTool.done
    expect(noTool.res.sent).toEqual({ status: 400, body: { error: APPROVAL_TOOL_PROBLEM } })
  })

  it('holds the request, lists it, masks its input and answers it', async () => {
    const { registry, notices } = makeRegistry()
    const held = hold(registry, {
      tool: 'Bash',
      input: { command: 'rm -rf build', key: `sk-${'a'.repeat(30)}` },
    })
    await waitFor(() => approvalIdOf(registry), { what: 'the approval to wait' })

    const answer = registry.find('orchestrator').answer()
    expect(answer.approvals).toHaveLength(1)
    expect(answer.approvals[0]).toMatchObject({ tool: 'Bash', at: expect.any(String) })
    expect(answer.approvals[0].input).toContain('[key]')
    expect(answer.approvals[0].input).not.toContain('a'.repeat(30))
    expect(registry.list()[0].approvals).toHaveLength(1)
    expect(notices.some((event) => event.topic === 'orchestrator')).toBe(true)

    const approvalId = answer.approvals[0].approvalId
    const answered = call(registry, {
      path: `/api/orchestrator/approvals/${approvalId}`,
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', allow: true, confirmed: true },
    })
    await answered.done
    expect(answered.res.sent).toEqual({ status: 200, body: { ok: true, approvalId, allow: true } })
    await held.done
    expect(held.res.sent).toEqual({ status: 200, body: { allow: true } })
    expect(registry.find('orchestrator').answer().approvals).toEqual([])
  })

  it('cuts the listed input to 2000 characters', async () => {
    const { registry } = makeRegistry()
    const held = hold(registry, { tool: 'write_file', input: { content: 'x'.repeat(2500) } })
    await waitFor(() => approvalIdOf(registry), { what: 'the long approval to wait' })
    const listed = registry.find('orchestrator').answer().approvals[0]
    expect(listed.input).toHaveLength(APPROVAL_INPUT_LIMIT)
    registry.find('orchestrator').stop({ confirmed: true })
    await held.done
  })

  it('denies an approval from the page and checks the answer', async () => {
    const { registry } = makeRegistry()
    const held = hold(registry)
    await waitFor(() => approvalIdOf(registry), { what: 'the approval to wait' })
    const approvalId = approvalIdOf(registry)

    const noOrigin = call(registry, {
      path: `/api/orchestrator/approvals/${approvalId}`,
      body: { id: 'orchestrator', allow: true, confirmed: true },
    })
    await noOrigin.done
    expect(noOrigin.res.sent).toEqual({ status: 403, body: { error: OWNER_ANSWER_PROBLEM } })

    const unconfirmed = call(registry, {
      path: `/api/orchestrator/approvals/${approvalId}`,
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', allow: true },
    })
    await unconfirmed.done
    expect(unconfirmed.res.sent).toEqual({ status: 400, body: { error: CONFIRM_APPROVAL_PROBLEM } })

    const noAllow = call(registry, {
      path: `/api/orchestrator/approvals/${approvalId}`,
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', allow: 'yes', confirmed: true },
    })
    await noAllow.done
    expect(noAllow.res.sent).toEqual({ status: 400, body: { error: APPROVAL_ALLOW_PROBLEM } })

    const missing = call(registry, {
      path: '/api/orchestrator/approvals/missing',
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', allow: true, confirmed: true },
    })
    await missing.done
    expect(missing.res.sent).toEqual({ status: 404, body: { error: NO_APPROVAL_PROBLEM } })

    const denied = call(registry, {
      path: `/api/orchestrator/approvals/${approvalId}`,
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', allow: false, confirmed: true },
    })
    await denied.done
    expect(denied.res.sent.status).toBe(200)
    await held.done
    expect(held.res.sent).toEqual({ status: 200, body: { allow: false, message: APPROVAL_DENIED } })
  })

  it('answers the owner did not answer after four minutes and when the turn stops', async () => {
    const timed = makeRegistry({ approvalTimeoutMs: 30 })
    const timedHeld = hold(timed.registry)
    await timedHeld.done
    expect(timedHeld.res.sent).toEqual({ status: 200, body: { allow: false, message: APPROVAL_NO_ANSWER } })

    const stopped = makeRegistry()
    const stopHeld = hold(stopped.registry)
    await waitFor(() => approvalIdOf(stopped.registry), { what: 'the approval to stop' })
    const stoppedCall = call(stopped.registry, {
      path: '/api/orchestrator/stop',
      origin: 'http://localhost:5173',
      body: { id: 'orchestrator', confirmed: true },
    })
    await stoppedCall.done
    expect(stoppedCall.res.sent.status).toBe(200)
    await stopHeld.done
    expect(stopHeld.res.sent).toEqual({ status: 200, body: { allow: false, message: APPROVAL_NO_ANSWER } })
  })

  it('answers the owner did not answer when the bridge stops', async () => {
    const { registry } = makeRegistry()
    const held = hold(registry)
    await waitFor(() => approvalIdOf(registry), { what: 'the approval to close' })
    registry.close()
    await held.done
    expect(held.res.sent).toEqual({ status: 200, body: { allow: false, message: APPROVAL_NO_ANSWER } })
  })

  it('answers 429 when 20 approvals already wait', async () => {
    const { registry } = makeRegistry()
    const held = []
    for (let index = 0; index < 20; index += 1) held.push(hold(registry, { tool: `Tool ${index}` }))
    await waitFor(() => registry.find('orchestrator').answer().approvals.length === 20, {
      what: 'the 20 waiting approvals',
    })
    const over = hold(registry)
    await over.done
    expect(over.res.sent).toEqual({ status: 429, body: { error: APPROVAL_LIMIT_PROBLEM } })
    registry.find('orchestrator').stop({ confirmed: true })
    await Promise.all(held.map((entry) => entry.done))
  })

  it('keeps the request open over the real bridge and lists it on both answers', async () => {
    const started = await startLaneBridge()
    cleanups.push(() => started.stop())
    const token = started.bridge.orchestrators().token('orchestrator')
    const held = fetch(`${started.url}/api/orchestrator/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
      body: JSON.stringify({ id: 'orchestrator', tool: 'Bash', input: { command: 'echo hi' } }),
    })
    const listed = await waitFor(
      async () => {
        const answer = await getJson(`${started.url}/api/orchestrator`)
        return answer.body.approvals.length === 1 ? answer.body : null
      },
      { what: 'the approval on the bridge answer' },
    )
    const all = await getJson(`${started.url}/api/orchestrators`)
    expect(all.body[0].approvals).toHaveLength(1)
    const approvalId = listed.approvals[0].approvalId
    const answered = await getJson(`${started.url}/api/orchestrator/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ id: 'orchestrator', allow: true, confirmed: true }),
    })
    expect(answered.status).toBe(200)
    const response = await held
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ allow: true })
    expect((await getJson(`${started.url}/api/orchestrator`)).body.approvals).toEqual([])
  })
})

describe('the approval client methods', () => {
  it('posts an approval answer with its id and confirmation', async () => {
    const calls = []
    const client = createClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, json: async () => ({ ok: true }) }
      },
    })
    await client.answerApproval({ id: 'orchestrator', approvalId: 'ap 1', allow: true })
    expect(calls[0].url).toBe('/api/orchestrator/approvals/ap%201')
    expect(JSON.parse(calls[0].init.body)).toEqual({ id: 'orchestrator', allow: true, confirmed: true })
  })

  it('answers an approval in the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect((await client.orchestrator()).approvals).toEqual([])
    await expect(client.answerApproval({ approvalId: 'missing', allow: true })).rejects.toThrow(
      'There is no approval with that id.',
    )
  })
})
