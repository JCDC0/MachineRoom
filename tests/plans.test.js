import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { PLAN_REFUSAL } from '../server/plans.js'
import { makeTempDir } from './helpers/tempRoot.js'

const SAMPLE_TASKS_MD = [
  '## Open work',
  '',
  '**B6. Late join replay (OpenCode).** Let the event stream send the kept history to a viewer.',
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function writeRoot() {
  const root = makeTempDir('mr-plans-')
  cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  mkdirSync(join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(root, 'docs', 'agents', 'TASKS.md'), SAMPLE_TASKS_MD)
  return root
}

async function setup() {
  const root = writeRoot()
  const bridge = createBridge({
    projectRoot: root,
    port: 0,
    env: {},
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, root, tasksPath: join(root, 'docs', 'agents', 'TASKS.md') }
}

async function postPlan(url, body) {
  const response = await fetch(`${url}/api/control/plans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function getPlan(url, issueId) {
  const response = await fetch(`${url}/api/control/plans/${encodeURIComponent(issueId)}`)
  return { status: response.status, body: await response.json() }
}

async function acceptPlan(url, issueId, body) {
  const response = await fetch(`${url}/api/control/plans/${encodeURIComponent(issueId)}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

describe('plans routes', () => {
  it('refuses a plan that was not confirmed', async () => {
    const { url } = await setup()
    for (const confirmed of [false, undefined, 'yes', 1]) {
      const answer = await postPlan(url, { goal: 'Do the work', confirmed })
      expect(answer.status, String(confirmed)).toBe(400)
      expect(answer.body).toEqual({ error: 'Confirm the plan request first.' })
    }
  })

  it('refuses a goal that is not text of 1 to 2000 characters', async () => {
    const { url } = await setup()
    const goals = [undefined, '', '   ', 42, [], {}, 'x'.repeat(2001)]
    for (const goal of goals) {
      const answer = await postPlan(url, { goal, confirmed: true })
      expect(answer.status).toBe(400)
      expect(answer.body).toEqual({ error: 'Write the goal in 1 to 2000 characters.' })
    }
  })

  it('refuses a confirmed plan request and writes no task', async () => {
    const { url, tasksPath } = await setup()
    const before = readFileSync(tasksPath, 'utf8')
    const answer = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
    expect(answer.status).toBe(409)
    expect(answer.body).toEqual({ error: PLAN_REFUSAL })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)
  })

  it('refuses to read or accept a plan', async () => {
    const { url, tasksPath } = await setup()
    const before = readFileSync(tasksPath, 'utf8')

    expect(await getPlan(url, 'opencode-B6-20261024-120000')).toEqual({ status: 409, body: { error: PLAN_REFUSAL } })
    expect(await acceptPlan(url, 'opencode-B6-20261024-120000', { ids: ['B6'], confirmed: true })).toEqual({
      status: 409,
      body: { error: PLAN_REFUSAL },
    })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)
  })

  it('answers the not-found sentence for an id that is not valid percent encoding', async () => {
    const { url } = await setup()
    const get = await fetch(`${url}/api/control/plans/%E0%A4%A`)
    expect(get.status).toBe(404)
    expect(await get.json()).toEqual({ error: 'That task no longer exists.' })
    const accept = await fetch(`${url}/api/control/plans/%E0%A4%A/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['B6'], confirmed: true }),
    })
    expect(accept.status).toBe(404)
    expect(await accept.json()).toEqual({ error: 'That task no longer exists.' })
  })

  it('refuses a method it does not have', async () => {
    const { url } = await setup()
    const response = await fetch(`${url}/api/control/plans`, { method: 'DELETE' })
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'Method not allowed.' })
  })
})
