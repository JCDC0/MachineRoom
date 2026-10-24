import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { createPlansApi } from '../server/plans.js'
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

const TWO_BRIEFS_PLAN = {
  briefs: [
    GOOD_PLAN.briefs[0],
    {
      id: 'C7b',
      title: 'Plan the room work',
      owner: 'opencode',
      size: 'medium',
      files: ['server/plans.js'],
      tests: ['tests/plans.test.js'],
      text: 'Plan the room work in the drawer with tests.',
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

function writeDocs(tasks = SAMPLE_TASKS_MD) {
  const root = makeTempDir('mr-plans-')
  cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  mkdirSync(join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(root, 'docs', 'agents', 'TASKS.md'), tasks)
  writeFileSync(join(root, 'docs', 'agents', 'HOUSE-RULES.md'), SAMPLE_HOUSE_RULES_MD)
  writeFileSync(join(root, 'docs', 'agents', 'lanes.json'), JSON.stringify(SAMPLE_LANES))
  return root
}

function writeEmptyRoot() {
  const root = makeTempDir('mr-plans-empty-')
  cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}

async function setup(fakeOptions = {}, { briefs = true, tasks = SAMPLE_TASKS_MD } = {}) {
  const fake = await startFakePlanner(fakeOptions)
  cleanups.push(() => fake.close())
  const root = briefs ? writeDocs(tasks) : writeEmptyRoot()
  const bridge = createBridge({
    paperclipUrl: fake.url,
    companyId: 'comp-1',
    projectRoot: root,
    port: 0,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, fake, root, tasksPath: join(root, 'docs', 'agents', 'TASKS.md') }
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

async function createReadyPlan(url, fake, plan = GOOD_PLAN) {
  const created = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
  const comment = fake.addComment(created.body.issueId, PLANNER.id, JSON.stringify(plan))
  return { issueId: created.body.issueId, planId: comment.id }
}

async function waitUntil(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

function planComment(plan = TWO_BRIEFS_PLAN) {
  return {
    id: 'comment-plan-1',
    issueId: 'issue-1',
    authorAgentId: PLANNER.id,
    body: JSON.stringify(plan),
    createdAt: new Date(BASE_TIME).toISOString(),
  }
}

function startGatedPlans(root, comment) {
  const pending = []
  let open = false
  const answerFor = (url) => {
    const path = new URL(url).pathname
    if (path === '/api/issues/issue-1/comments') return { status: 200, json: async () => [comment] }
    if (path === '/api/companies/comp-1/agents') return { status: 200, json: async () => [PLANNER] }
    return { status: 404, json: async () => ({}) }
  }
  vi.stubGlobal('fetch', (url) => {
    const answer = answerFor(url)
    if (open) return Promise.resolve(answer)
    return new Promise((resolve) => pending.push({ answer, resolve }))
  })
  cleanups.push(() => vi.unstubAllGlobals())

  const api = createPlansApi({
    paperclipUrl: 'http://paperclip.test',
    companyId: 'comp-1',
    projectRoot: root,
    timeoutMs: 5000,
    readJsonBody: async (req) => req.body,
    sendJson: (req, res, status, body) => res.send({ status, body }),
  })

  return {
    pending,
    accept(ids, planId = comment.id) {
      return new Promise((resolve) => {
        const req = { method: 'POST', body: { ids, planId, confirmed: true } }
        const res = { send: resolve }
        api.handle(req, res, new URL('/api/control/plans/issue-1/accept', 'http://bridge.test')).catch((error) => {
          res.send({ status: 0, body: { error: String(error) } })
        })
      })
    },
    release() {
      open = true
      for (const entry of pending.splice(0)) entry.resolve(entry.answer)
    },
  }
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

    const firstComment = fake.addComment(issueId, PLANNER.id, 'Here is a plan.\n```json\n' + JSON.stringify(GOOD_PLAN) + '\n```')
    const first = await getPlan(url, issueId)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ status: 'ready', briefs: GOOD_PLAN.briefs, problems: [], planId: firstComment.id })

    const secondPlan = { briefs: [{ ...GOOD_PLAN.briefs[0], id: 'C7b', title: 'Plan the room work' }] }
    const secondComment = fake.addComment(issueId, PLANNER.id, JSON.stringify(secondPlan))
    const second = await getPlan(url, issueId)
    expect(second.body.briefs.map((brief) => brief.id)).toEqual(['C7b'])
    expect(second.body.problems).toEqual([])
    expect(second.body.planId).toBe(secondComment.id)
  })

  it('answers ready with a problem when the planner comment holds no readable plan', async () => {
    const { url, fake } = await setup()
    const created = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
    const issueId = created.body.issueId

    fake.addComment(issueId, PLANNER.id, 'I will send a plan soon.')
    expect((await getPlan(url, issueId)).body).toEqual({ status: 'waiting', briefs: [], problems: [] })

    const comment = fake.addComment(issueId, PLANNER.id, 'Here: { not json')
    expect((await getPlan(url, issueId)).body).toEqual({
      status: 'ready',
      briefs: [],
      problems: ['The plan is not JSON.'],
      planId: comment.id,
    })
  })

  it('answers the not-found sentence when the task is missing', async () => {
    const { url } = await setup()
    const answer = await getPlan(url, 'issue-404')
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: 'That task no longer exists.' })
  })

  it('refuses an accept that was not confirmed or with bad ids and writes nothing', async () => {
    const { url, fake, tasksPath } = await setup()
    const { issueId } = await createReadyPlan(url, fake)
    const before = readFileSync(tasksPath, 'utf8')

    for (const confirmed of [false, undefined, 'yes', 1]) {
      const answer = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed })
      expect(answer.status, String(confirmed)).toBe(400)
      expect(answer.body).toEqual({ error: 'Confirm adding the briefs first.' })
    }

    const badIds = [
      undefined,
      [],
      'C7a',
      {},
      [1],
      [''],
      ['   '],
      ['C7a', 'C7b', 'C7c', 'C7d', 'C7e', 'C7f', 'C7g', 'C7h', 'C7i'],
    ]
    for (const ids of badIds) {
      const answer = await acceptPlan(url, issueId, { ids, confirmed: true })
      expect(answer.status, JSON.stringify(ids)).toBe(400)
      expect(answer.body).toEqual({ error: 'Choose 1 to 8 briefs.' })
    }
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)
  })

  it('refuses an accept when the bridge has no briefs folder', async () => {
    const { url } = await setup({}, { briefs: false })
    const answer = await acceptPlan(url, 'issue-1', { ids: ['C7a'], confirmed: true })
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: 'The bridge has no briefs folder.' })
  })

  it('refuses an accept while the plan is still waiting and writes nothing', async () => {
    const { url, tasksPath } = await setup()
    const created = await postPlan(url, { goal: 'Plan the next work', confirmed: true })
    const before = readFileSync(tasksPath, 'utf8')
    const answer = await acceptPlan(url, created.body.issueId, { ids: ['C7a'], confirmed: true })
    expect(answer.status).toBe(409)
    expect(answer.body).toEqual({ error: 'The plan is not ready.' })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)
  })

  it('refuses an id that is not in the plan or has a problem now and writes nothing', async () => {
    const { url, fake, tasksPath } = await setup()
    const { issueId, planId } = await createReadyPlan(url, fake)
    const before = readFileSync(tasksPath, 'utf8')

    const missing = await acceptPlan(url, issueId, { ids: ['C7b'], confirmed: true, planId })
    expect(missing.status).toBe(400)
    expect(missing.body).toEqual({ error: 'Brief C7b is not in the plan, or has a problem now.' })

    const second = await acceptPlan(url, issueId, { ids: ['C7a', 'C7b'], confirmed: true, planId })
    expect(second.status).toBe(400)
    expect(second.body).toEqual({ error: 'Brief C7b is not in the plan, or has a problem now.' })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)

    const brokenPlan = {
      briefs: [
        GOOD_PLAN.briefs[0],
        {
          ...GOOD_PLAN.briefs[0],
          id: 'C7c',
          title: 'Broken brief',
          tests: [],
        },
      ],
    }
    const brokenReady = await createReadyPlan(url, fake, brokenPlan)
    const broken = await acceptPlan(url, brokenReady.issueId, { ids: ['C7c'], confirmed: true, planId: brokenReady.planId })
    expect(broken.status).toBe(400)
    expect(broken.body).toEqual({ error: 'Brief C7c is not in the plan, or has a problem now.' })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)
  })

  it('refuses an accept when the plan changed since it was read and writes nothing', async () => {
    const { url, fake, tasksPath } = await setup()
    const { issueId, planId } = await createReadyPlan(url, fake)
    const before = readFileSync(tasksPath, 'utf8')
    const newer = fake.addComment(
      issueId,
      PLANNER.id,
      JSON.stringify({ briefs: [{ ...GOOD_PLAN.briefs[0], text: 'Write the newer text.' }] })
    )

    const stale = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed: true, planId })
    expect(stale.status).toBe(409)
    expect(stale.body).toEqual({ error: 'The plan changed since you read it. Read it again.' })
    expect(readFileSync(tasksPath, 'utf8')).toBe(before)

    const fresh = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed: true, planId: newer.id })
    expect(fresh.status).toBe(201)
    expect(fresh.body).toEqual({ added: ['C7a'] })
    expect(readFileSync(tasksPath, 'utf8')).toContain('Write the newer text.')
  })

  it('adds two chosen briefs in plan order under one new heading', async () => {
    const { url, fake, tasksPath } = await setup()
    const { issueId, planId } = await createReadyPlan(url, fake, TWO_BRIEFS_PLAN)
    const before = readFileSync(tasksPath, 'utf8')
    const answer = await acceptPlan(url, issueId, { ids: ['C7b', 'C7a'], confirmed: true, planId })
    expect(answer.status).toBe(201)
    expect(answer.body).toEqual({ added: ['C7a', 'C7b'] })

    const after = readFileSync(tasksPath, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect((after.match(/^## Briefs from the planner[ \t]*\r?$/gm) ?? [])).toHaveLength(1)
    expect(after).toContain('## Briefs from the planner\n\n**C7a. Add the plan route (OpenCode).**')
    expect(after).toContain('\n\n**C7b. Plan the room work (OpenCode).**')
    expect(after.indexOf('**C7a.')).toBeLessThan(after.indexOf('**C7b.'))
    expect(after).toContain('Tests in `tests/plans.test.js`. Files: `server/plans.js`, `tests/plans.test.js`, `docs/agents/CHANGELOG.md`.')
  })

  it('keeps one heading when a second accept adds another brief, and refuses an id taken since the plan was read', async () => {
    const { url, fake, tasksPath } = await setup()
    const { issueId, planId } = await createReadyPlan(url, fake, TWO_BRIEFS_PLAN)

    const first = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed: true, planId })
    expect(first.status).toBe(201)
    expect(first.body).toEqual({ added: ['C7a'] })
    const afterFirst = readFileSync(tasksPath, 'utf8')

    const second = await acceptPlan(url, issueId, { ids: ['C7b'], confirmed: true, planId })
    expect(second.status).toBe(201)
    expect(second.body).toEqual({ added: ['C7b'] })
    const afterSecond = readFileSync(tasksPath, 'utf8')
    expect((afterSecond.match(/^## Briefs from the planner[ \t]*\r?$/gm) ?? [])).toHaveLength(1)
    expect((afterSecond.match(/\*\*C7a\./g) ?? [])).toHaveLength(1)
    expect((afterSecond.match(/\*\*C7b\./g) ?? [])).toHaveLength(1)

    const taken = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed: true, planId })
    expect(taken.status).toBe(400)
    expect(taken.body).toEqual({ error: 'Brief C7a is not in the plan, or has a problem now.' })
    expect(readFileSync(tasksPath, 'utf8')).toBe(afterSecond)
    expect(afterFirst.length).toBeLessThan(afterSecond.length)
  })

  it('adds both briefs when a fake Paperclip answers two accepts at once', async () => {
    const root = writeDocs()
    const tasksPath = join(root, 'docs', 'agents', 'TASKS.md')
    const gate = startGatedPlans(root, planComment())

    const first = gate.accept(['C7a'])
    const second = gate.accept(['C7b'])
    await waitUntil(() => gate.pending.length >= 2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    gate.release()

    const [firstAnswer, secondAnswer] = await Promise.all([first, second])
    expect(firstAnswer.status).toBe(201)
    expect(secondAnswer.status).toBe(201)
    const after = readFileSync(tasksPath, 'utf8')
    expect((after.match(/\*\*C7a\./g) ?? [])).toHaveLength(1)
    expect((after.match(/\*\*C7b\./g) ?? [])).toHaveLength(1)
  })

  it('lets a second accept through after the first one fails', async () => {
    const root = writeDocs()
    const tasksPath = join(root, 'docs', 'agents', 'TASKS.md')
    const gate = startGatedPlans(root, planComment())

    const stale = gate.accept(['C7a'], 'comment-old')
    await waitUntil(() => gate.pending.length >= 2)
    const fresh = gate.accept(['C7b'])
    gate.release()

    const [staleAnswer, freshAnswer] = await Promise.all([stale, fresh])
    expect(staleAnswer.status).toBe(409)
    expect(staleAnswer.body).toEqual({ error: 'The plan changed since you read it. Read it again.' })
    expect(freshAnswer.status).toBe(201)
    expect(readFileSync(tasksPath, 'utf8')).toContain('**C7b.')
  })

  it('keeps the line endings of TASKS.md when it adds the briefs', async () => {
    const crlfTasks = SAMPLE_TASKS_MD.split('\n').join('\r\n')
    const { url, fake, tasksPath } = await setup({}, { tasks: crlfTasks })
    const { issueId, planId } = await createReadyPlan(url, fake)
    const before = readFileSync(tasksPath, 'utf8')
    expect(before).toContain('\r\n')

    const answer = await acceptPlan(url, issueId, { ids: ['C7a'], confirmed: true, planId })
    expect(answer.status).toBe(201)
    const after = readFileSync(tasksPath, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect(after.replace(/\r\n/g, '')).not.toContain('\n')
    expect(after).toContain('## Briefs from the planner\r\n\r\n**C7a.')
  })

})
