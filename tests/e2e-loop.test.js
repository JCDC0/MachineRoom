import { afterEach, describe, expect, it } from 'vitest'
import { runDoctor } from '../server/doctor.js'
import { FEATURES } from '../server/surface.js'
import { FAKE_VERSION, LIVE_CHUNK_LIMIT, parseFakeArgs } from '../scripts/fake-paperclip.mjs'
import { makeTree } from '../src/model/paths.js'
import { createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { getJson, postJson, readFrames, runEnded, startLoop, waitFor, waitForPaperclip } from './helpers/loop.js'

const loops = []

async function loop(options) {
  const started = await startLoop(options)
  loops.push(started)
  return started
}

afterEach(async () => {
  while (loops.length > 0) await loops.pop().stop()
})

function playFrames(frames, agents, tree) {
  const pipeline = createPipeline({ agents, tree })
  const state = createState(tree, agents)
  const activities = []
  for (const frame of frames) {
    for (const activity of pipeline.push(frame)) {
      apply(state, activity)
      activities.push(activity)
    }
  }
  for (const activity of pipeline.flush()) {
    apply(state, activity)
    activities.push(activity)
  }
  return { state, activities }
}

async function roomInputs(url) {
  const agents = (await getJson(`${url}/api/agents`)).body
  const raw = (await getJson(`${url}/api/tree`)).body
  return { agents, tree: makeTree({ root: raw.root, files: raw.files, created: [] }) }
}

describe('the whole loop through the bridge and the fake Paperclip', () => {
  it('reports every feature on, runs a Hermes task in the room, answers in the thread and makes a backup', async () => {
    const { url } = await loop()
    const health = await waitForPaperclip(url)
    expect(health.ok).toBe(true)
    expect(health.paperclipVersion).toBe(FAKE_VERSION)
    expect(health.surface.ok).toBe(true)
    expect(health.features).toEqual(Object.fromEntries(FEATURES.map((name) => [name, true])))

    const { agents, tree } = await roomInputs(url)
    expect(agents.map((agent) => agent.key)).toEqual(['claude', 'hermes', 'opencode', 'agy'])
    expect(tree.files).toContain('src/math.js')
    const hermes = agents.find((agent) => agent.key === 'hermes')

    const created = await postJson(`${url}/api/control/issues`, {
      title: 'Add a strings helper',
      assigneeAgentId: hermes.id,
      confirmed: true,
    })
    expect(created.status).toBe(201)
    expect(created.body.identifier).toBe('MR-1')

    const frames = await readFrames(url, runEnded(hermes.id))
    const { state, activities } = playFrames(frames, agents, tree)
    const mine = activities.filter((activity) => activity.agent === 'hermes')
    expect(mine.map((activity) => activity.type)).toEqual(expect.arrayContaining(['run.queued', 'run.start', 'tool.start', 'run.end']))
    const touched = mine.filter((activity) => activity.type === 'tool.start').flatMap((activity) => activity.touches)
    expect(touched.length).toBeGreaterThan(3)
    const projectFiles = [...state.files.values()].filter((file) => tree.files.includes(file.path) && file.reads + file.writes > 0)
    expect(projectFiles.length).toBeGreaterThan(0)
    expect(state.files.get('docs/hermes-summary.md')).toMatchObject({ writes: 1, yellow: true })
    expect(mine.at(-1)).toMatchObject({ type: 'run.end', ok: true })
    expect(state.agents.get('hermes')).toMatchObject({ status: 'done', runs: 1 })

    const thread = await waitFor(
      async () => {
        const { body } = await getJson(`${url}/api/control/comments?issueId=${encodeURIComponent(created.body.id)}`)
        return body.find((comment) => comment.authorAgentId === hermes.id) ? body : null
      },
      { what: 'the reply comment' }
    )
    expect(thread.at(-1)).toMatchObject({ authorName: 'Hermes', issueId: created.body.id })
    expect(thread.at(-1).body).toContain('Add a strings helper')

    const issues = await waitFor(async () => {
      const { body } = await getJson(`${url}/api/control/issues`)
      return body[0]?.status === 'done' ? body : null
    })
    expect(issues).toHaveLength(1)

    const costs = (await getJson(`${url}/api/control/costs`)).body
    expect(costs.byAgent.find((row) => row.agentId === hermes.id).costCents).toBeGreaterThan(0)
    expect(costs.summary.spendCents).toBeGreaterThan(0)

    const before = (await getJson(`${url}/api/backup`)).body
    expect(before).toMatchObject({ enabled: true, status: 'ok', warnings: [] })
    expect(before.ageHours).toBeGreaterThan(1)
    expect((await postJson(`${url}/api/backup`, {})).status).toBe(400)
    const backup = await postJson(`${url}/api/backup`, { confirmed: true })
    expect(backup.status).toBe(200)
    expect(backup.body.ok).toBe(true)
    expect(backup.body.name).toMatch(/^paperclip-\d{8}-\d{6}\.sql\.gz$/)
    const after = (await getJson(`${url}/api/backup`)).body
    expect(after.ageHours).toBe(0)
    expect(Date.parse(after.latestAt)).toBeGreaterThan(Date.parse(before.latestAt))
  })

  it('decides an approval, sets a budget and hires an agent through the control routes', async () => {
    const { url } = await loop()
    await waitForPaperclip(url)
    const approvals = (await getJson(`${url}/api/control/approvals`)).body
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ type: 'request_board_approval', status: 'pending' })
    const decided = await postJson(`${url}/api/control/approvals/${approvals[0].id}/decide`, { decision: 'approve', note: 'Fine.' })
    expect(decided.status).toBe(200)
    expect(decided.body).toMatchObject({ status: 'approved', decisionNote: 'Fine.' })
    const again = await postJson(`${url}/api/control/approvals/${approvals[0].id}/decide`, { decision: 'reject' })
    expect(again.body.error).toBe('That approval is already decided.')

    const agents = (await getJson(`${url}/api/control/agents`)).body
    const opencode = agents.find((agent) => agent.adapterType === 'opencode_local')
    const budget = await postJson(`${url}/api/control/agents/${opencode.id}/budget`, { budgetMonthlyCents: 2500 })
    expect(budget.status).toBe(200)
    expect(budget.body.budgetMonthlyCents).toBe(2500)

    const hired = await postJson(`${url}/api/control/agents`, { name: 'Reviewer', adapterType: 'claude_local', role: 'qa' })
    expect(hired.status).toBe(201)
    expect(hired.body.agent).toMatchObject({ name: 'Reviewer', status: 'idle' })
    expect(hired.body.approval).toBe(null)

    const costs = (await getJson(`${url}/api/control/costs`)).body
    expect(costs.quota.map((entry) => entry.ok)).toEqual([true, false])
  })

  it('passes every doctor check', async () => {
    const { fake } = await loop()
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: fake.companyId, projectRoot: process.cwd() })
    expect(result.lines.filter((line) => !line.startsWith('ok '))).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  it('turns approvals off when Paperclip stops listing its route, while the room still streams', async () => {
    const { missing } = parseFakeArgs(['--missing', '/api/companies/{companyId}/approvals'])
    const { url } = await loop({ fake: { missing } })
    const health = await waitForPaperclip(url)
    expect(health.surface.ok).toBe(false)
    expect(health.surface.missing).toEqual([{ method: 'GET', path: '/api/companies/{companyId}/approvals' }])
    expect(health.features.approvals).toBe(false)
    for (const name of FEATURES.filter((feature) => feature !== 'approvals')) expect(health.features[name]).toBe(true)

    const listed = await getJson(`${url}/api/control/approvals`)
    expect(listed.status).toBe(503)
    expect(listed.body.error).toMatch(/^Paperclip changed: approvals is off\./)
    const decided = await postJson(`${url}/api/control/approvals/x/decide`, { decision: 'approve' })
    expect(decided.status).toBe(503)

    const { agents, tree } = await roomInputs(url)
    const opencode = agents.find((agent) => agent.key === 'opencode')
    const created = await postJson(`${url}/api/control/issues`, { title: 'Tidy the notes', assigneeAgentId: opencode.id, confirmed: true })
    expect(created.status).toBe(201)
    const frames = await readFrames(url, runEnded(opencode.id))
    const { state } = playFrames(frames, agents, tree)
    expect(state.agents.get('opencode')).toMatchObject({ status: 'done', runs: 1 })
  })

  it('restores a cut chunk from the fake run log before it reaches the page', async () => {
    const long = `${'y'.repeat(LIVE_CHUNK_LIMIT + 1000)}\n`
    const scripts = new Map([['hermes_local', { source: 'test', steps: [{ type: 'heartbeat.run.log', gapMs: 0, payload: { seq: 1, stream: 'stdout', chunk: long, truncated: false } }] }]])
    const { url } = await loop({ fake: { scripts } })
    await waitForPaperclip(url)
    const { agents } = await roomInputs(url)
    const hermes = agents.find((agent) => agent.key === 'hermes')
    await postJson(`${url}/api/control/issues`, { title: 'Long line', assigneeAgentId: hermes.id, confirmed: true })
    const frames = await readFrames(url, runEnded(hermes.id))
    const restored = frames.find((frame) => frame.type === 'heartbeat.run.log')
    expect(restored.payload).toMatchObject({ truncated: false, chunk: long })
  })

  it('answers 504 within its limit when Paperclip never answers the agents route', async () => {
    const { slow } = parseFakeArgs(['--slow', '/api/companies/{companyId}/agents'])
    const { url } = await loop({ fake: { slow }, bridge: { upstreamTimeoutMs: 400 } })
    await waitForPaperclip(url)
    const started = Date.now()
    const answer = await getJson(`${url}/api/control/agents`)
    const took = Date.now() - started
    expect(answer.status).toBe(504)
    expect(answer.body.error).toBe('Paperclip did not answer in time.')
    expect(took).toBeGreaterThanOrEqual(350)
    expect(took).toBeLessThan(5000)
    expect((await getJson(`${url}/api/health`)).body.features.room).toBe(true)
  })
})
