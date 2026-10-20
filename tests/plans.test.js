import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const BASE_TIME = Date.parse('2026-10-18T00:00:00Z')

const SAMPLE_TASKS_MD = [
  '## Open work',
  '',
  '**B6. Late join replay (OpenCode).** Let the event stream send the kept history to a viewer. Tests in tests/bridge.test.js.',
].join('\n')

const SAMPLE_HOUSE_RULES_MD = [
  '# House rules',
  '',
  '## About',
  '',
  'MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room.',
  '',
  '## Rules',
  '',
  '- Work only in your own worktree and branch. Never push.',
  '- Run npm test after every change.',
  '',
  '## Report',
  '',
  'Give the report in your reply, not in a file.',
].join('\n')

const SAMPLE_LANES = {
  hermes: { name: 'Hermes', role: 'You take cheap tasks.', forbidden: ['server/**', 'src/ui/**'] },
  opencode: { name: 'OpenCode', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**'] },
  agy: { name: 'agy', role: 'You own the HUD.', forbidden: ['server/**', 'src/control/**'] },
}

const PLANNER = { id: 'agent-planner', name: 'Planner', role: 'pm', status: 'idle', adapterType: 'claude_local', adapterConfig: {} }
const ENGINEER = { id: 'agent-engineer', name: 'Engineer', role: 'engineer', status: 'idle', adapterType: 'claude_local', adapterConfig: {} }

const GOOD_PLAN = {
  briefs: [
    {
      id: 'C7a',
      title: 'Add the plan route',
      owner: 'opencode',
      size: 'small',
      files: ['server/plans.js'],
      tests: ['tests/plans.test.js'],
      text: 'Add the plan route in the bridge with tests.',
      dependsOn: [],
    },
  ],
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function startFakePlanner({ agents = [PLANNER], openapi = null } = {}) {
  const state = { agents: agents.map((agent) => ({ ...agent })), issues: [], comments: {} }
  const created = []
  let issueCounter = 0
  let commentCounter = 0
  let clock = BASE_TIME

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === '/api/openapi.json' && openapi) {
      sendJson(res, 200, openapi)
      return
    }

    if (method === 'GET' && path === '/api/companies/comp-1/agents') {
      sendJson(res, 200, state.agents)
      return
    }

    if (method === 'GET' && path === '/api/companies/comp-1/issues') {
      sendJson(res, 200, state.issues)
      return
    }

    if (method === 'POST' && path === '/api/companies/comp-1/issues') {
      const body = await readBody(req)
      created.push(body)
      issueCounter += 1
      const stamp = new Date(BASE_TIME).toISOString()
      const issue = {
        id: `issue-${issueCounter}`,
        identifier: `JC-${issueCounter}`,
        title: body.title,
        description: body.description ?? '',
        status: body.status ?? 'todo',
        priority: body.priority ?? 'medium',
        assigneeAgentId: body.assigneeAgentId ?? null,
        parentId: null,
        assigneeAdapterOverrides: body.assigneeAdapterOverrides ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      }
      state.issues.unshift(issue)
      sendJson(res, 201, issue)
      return
    }

    const commentsRoute = /^\/api\/issues\/([^/]+)\/comments$/.exec(path)
    if (commentsRoute) {
      const issueId = decodeURIComponent(commentsRoute[1])
      if (!state.issues.some((issue) => issue.id === issueId)) {
        sendJson(res, 404, { error: 'Issue not found' })
        return
      }
      if (method === 'GET') {
        sendJson(res, 200, state.comments[issueId] ?? [])
        return
      }
    }

    sendJson(res, 404, { error: 'API route not found' })
  })

  server.on('upgrade', (req, socket) => socket.destroy())

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        state,
        created,
        addComment(issueId, authorAgentId, body) {
          commentCounter += 1
          clock += 1000
          const comment = {
            id: `comment-${commentCounter}`,
            issueId,
            authorAgentId,
            body,
            createdAt: new Date(clock).toISOString(),
          }
          state.comments[issueId] = [...(state.comments[issueId] ?? []), comment]
          return comment
        },
        close() {
          return new Promise((resolveClose) => server.close(() => resolveClose()))
        },
      })
    })
  })
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function writeDocs() {
  const root = makeTempDir('mr-plans-')
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(root, 'docs', 'agents', 'TASKS.md'), SAMPLE_TASKS_MD)
  writeFileSync(join(root, 'docs', 'agents', 'HOUSE-RULES.md'), SAMPLE_HOUSE_RULES_MD)
  writeFileSync(join(root, 'docs', 'agents', 'lanes.json'), JSON.stringify(SAMPLE_LANES))
  return root
}

async function setup(fakeOptions = {}) {
  const fake = await startFakePlanner(fakeOptions)
  cleanups.push(() => fake.close())
  const bridge = createBridge({
    paperclipUrl: fake.url,
    companyId: 'comp-1',
    projectRoot: writeDocs(),
    port: 0,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, fake }
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

async function waitUntil(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

describe('plans routes', () => {
  it('refuses a plan that was not confirmed and creates nothing', async () => {
    const { url, fake } = await setup()
    for (const confirmed of [false, undefined, 'yes', 1]) {
      const answer = await postPlan(url, { goal: 'Do the work', confirmed })
      expect(answer.status, String(confirmed)).toBe(400)
      expect(answer.body).toEqual({ error: 'Confirm the plan request first.' })
    }
    expect(fake.created).toHaveLength(0)
  })

  it('refuses a goal that is not text of 1 to 2000 characters and creates nothing', async () => {
    const { url, fake } = await setup()
    const goals = [undefined, '', '   ', 42, [], {}, 'x'.repeat(2001)]
    for (const goal of goals) {
      const answer = await postPlan(url, { goal, confirmed: true })
      expect(answer.status).toBe(400)
      expect(answer.body).toEqual({ error: 'Write the goal in 1 to 2000 characters.' })
    }
    expect(fake.created).toHaveLength(0)
  })

  it('refuses a plan without a planner, with more than one, or with one that cannot take tasks', async () => {
    const missing = await setup({ agents: [ENGINEER] })
    let answer = await postPlan(missing.url, { goal: 'Do the work', confirmed: true })
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: 'Hire a planner first: an agent with the role pm.' })
    expect(missing.fake.created).toHaveLength(0)

    const many = await setup({ agents: [PLANNER, { ...PLANNER, id: 'agent-planner-2', name: 'Planner Two' }] })
    answer = await postPlan(many.url, { goal: 'Do the work', confirmed: true })
    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({ error: 'More than one agent has the role pm. Keep one.' })
    expect(many.fake.created).toHaveLength(0)

    for (const status of ['pending_approval', 'terminated']) {
      const blocked = await setup({ agents: [{ ...PLANNER, status }] })
      answer = await postPlan(blocked.url, { goal: 'Do the work', confirmed: true })
      expect(answer.status, status).toBe(400)
      expect(answer.body).toEqual({ error: 'That agent cannot take tasks yet.' })
      expect(blocked.fake.created, status).toHaveLength(0)
    }
  })

  it('creates the plan task for the planner with the prompt and no overrides', async () => {
    const { url, fake } = await setup()
    const goal = 'Split the planner and the bridge work into small briefs with tests'
    const answer = await postPlan(url, { goal, confirmed: true })
    expect(answer.status).toBe(201)
    expect(answer.body).toEqual({ issueId: 'issue-1', identifier: 'JC-1' })

    const body = fake.created[0]
    expect(body.title).toBe(`Plan: ${goal.slice(0, 60)}`)
    expect(body.description).toContain(`Goal: ${goal}`)
    expect(body.description).toContain('House rules:')
    expect(body.description).toContain('- Work only in your own worktree and branch. Never push.')
    expect(body.description).toContain('Lanes:')
    expect(body.description).toContain('- opencode (OpenCode): You own the bridge.')
    expect(body.description).toContain('Forbidden: src/ui/**, src/engine/**')
    expect(body.description).toContain('Ids already used: B6.')
    expect(body.description).toContain('{ "briefs": [')
    expect(body.priority).toBe('medium')
    expect(body.status).toBe('todo')
    expect(body.assigneeAgentId).toBe('agent-planner')
    expect(body).not.toHaveProperty('assigneeAdapterOverrides')

    const long = 'a'.repeat(100)
    const second = await postPlan(url, { goal: long, confirmed: true })
    expect(second.status).toBe(201)
    expect(second.body).toEqual({ issueId: 'issue-2', identifier: 'JC-2' })
    expect(fake.created[1].title).toBe(`Plan: ${'a'.repeat(60)}`)
  })

  it('waits for the planner and reads the newest comment that holds a plan', async () => {
    const { url, fake } = await setup()
    const created = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
    const issueId = created.body.issueId

    expect((await getPlan(url, issueId)).body).toEqual({ status: 'waiting', briefs: [], problems: [] })

    fake.addComment(issueId, ENGINEER.id, JSON.stringify(GOOD_PLAN))
    expect((await getPlan(url, issueId)).body).toEqual({ status: 'waiting', briefs: [], problems: [] })

    fake.addComment(issueId, PLANNER.id, 'I am working on it.')
    expect((await getPlan(url, issueId)).body).toEqual({ status: 'waiting', briefs: [], problems: [] })

    fake.addComment(issueId, PLANNER.id, 'Here is a plan.\n```json\n' + JSON.stringify(GOOD_PLAN) + '\n```')
    const first = await getPlan(url, issueId)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ status: 'ready', briefs: GOOD_PLAN.briefs, problems: [] })

    const secondPlan = { briefs: [{ ...GOOD_PLAN.briefs[0], id: 'C7b', title: 'Plan the room work' }] }
    fake.addComment(issueId, PLANNER.id, JSON.stringify(secondPlan))
    const second = await getPlan(url, issueId)
    expect(second.body.briefs.map((brief) => brief.id)).toEqual(['C7b'])
    expect(second.body.problems).toEqual([])
  })

  it('answers ready with a problem when the planner comment holds no readable plan', async () => {
    const { url, fake } = await setup()
    const created = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
    const issueId = created.body.issueId

    fake.addComment(issueId, PLANNER.id, 'I will send a plan soon.')
    expect((await getPlan(url, issueId)).body).toEqual({ status: 'waiting', briefs: [], problems: [] })

    fake.addComment(issueId, PLANNER.id, 'Here: { not json')
    expect((await getPlan(url, issueId)).body).toEqual({
      status: 'ready',
      briefs: [],
      problems: ['The plan is not JSON.'],
    })
  })

  it('answers the not-found sentence when the task is missing', async () => {
    const { url } = await setup()
    const answer = await getPlan(url, 'issue-404')
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: 'That task no longer exists.' })
  })

  it('turns both routes off when Paperclip no longer has the tasks routes', async () => {
    const { url } = await setup({ openapi: { openapi: '3.0.0', info: { version: 'test' }, paths: {} } })
    await waitUntil(async () => {
      const health = await fetch(`${url}/api/health`).then((response) => response.json())
      return Boolean(health.surface?.checkedAt)
    })
    const post = await postPlan(url, { goal: 'Do the work', confirmed: true })
    expect(post.status).toBe(503)
    expect(post.body.error).toContain('tasks is off')
    const get = await getPlan(url, 'issue-1')
    expect(get.status).toBe(503)
    expect(get.body.error).toContain('tasks is off')
  })
})
