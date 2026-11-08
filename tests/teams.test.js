import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIRM_TEAM_PROBLEM,
  LANE_RUN_OPEN_PROBLEM,
  ORIGIN_TEAMS_PROBLEM,
  TEAM_NAME_PROBLEM,
  TURN_RUNNING_PROBLEM,
  UNKNOWN_PROJECT_PROBLEM,
  createTeamsApi,
  readTeams,
  saveTeams,
  teamsFileFor,
} from '../server/teams.js'
import { activeLanesFileFor, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes, writeActiveLanes, writeHiddenLanes } from '../server/active-lanes.js'
import { labelsFileFor, readLabels } from '../server/family.js'
import { chatFileFor, ORCHESTRATOR_KEY } from '../server/orchestrator.js'
import { createBridge } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-teams-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

const SAMPLE_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', model: 'opus' },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', model: 'sonnet' },
  },
}

async function startTestBridge({
  projectRoot = tempDir('mr-proj-'),
  runsFolder = tempDir('mr-runs-'),
  lanes = SAMPLE_LANES,
} = {}) {
  mkdirSync(runsFolder, { recursive: true })
  mkdirSync(join(projectRoot, 'docs', 'agents'), { recursive: true })
  const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(lanes, null, 2))
  writeFileSync(
    join(projectRoot, 'docs', 'agents', 'TASKS.md'),
    '## Open work\n\n**T1. First task (OpenCode).** Test.\n'
  )

  const bridge = createBridge({
    port: 0,
    projectRoot,
    runsFolder,
    lanesFile,
    lanesSource: {
      folder: runsFolder,
      lanes,
      repoRoot: projectRoot,
      pollMs: 20,
      quietMs: 60000,
    },
    runnerCommand: { file: process.execPath, args: ['-e', 'process.exit(0)'] },
    env: {},
  })

  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  return { bridge, url, projectRoot, runsFolder, lanesFile }
}

async function getJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

describe('teams persistence and limits', () => {
  it('reads empty list when file is missing and limits list to 20', () => {
    const runs = tempDir('mr-runs-limits-')
    const file = teamsFileFor(runs)
    expect(readTeams(file)).toEqual([])

    const many = []
    for (let i = 0; i < 25; i += 1) {
      many.push({ name: `team-${i}`, lanes: ['opencode'], labels: {}, ladder: { subs: [] }, savedAt: new Date().toISOString() })
    }
    saveTeams(file, many)
    const readBack = readTeams(file)
    expect(readBack.length).toBe(20)
    expect(readBack[readBack.length - 1].name).toBe('team-24')
    expect(readBack[0].name).toBe('team-5')
  })
})

describe('teams routes and validation', () => {
  it('refuses team writes without a page Origin with 403', async () => {
    const { url } = await startTestBridge()

    const saveNoOrigin = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alpha', confirmed: true }),
    })
    expect(saveNoOrigin.status).toBe(403)
    expect(saveNoOrigin.body.error).toBe(ORIGIN_TEAMS_PROBLEM)

    const applyNoOrigin = await getJson(`${url}/api/teams/Alpha/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(applyNoOrigin.status).toBe(403)
    expect(applyNoOrigin.body.error).toBe(ORIGIN_TEAMS_PROBLEM)

    const deleteNoOrigin = await getJson(`${url}/api/teams/Alpha/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(deleteNoOrigin.status).toBe(403)
    expect(deleteNoOrigin.body.error).toBe(ORIGIN_TEAMS_PROBLEM)

    const copyNoOrigin = await getJson(`${url}/api/teams/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'C:/sample', confirmed: true }),
    })
    expect(copyNoOrigin.status).toBe(403)
    expect(copyNoOrigin.body.error).toBe(ORIGIN_TEAMS_PROBLEM)
  })

  it('refuses team writes without confirmed true with 400', async () => {
    const { url } = await startTestBridge()

    const saveNotConfirmed = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Alpha', confirmed: false }),
    })
    expect(saveNotConfirmed.status).toBe(400)
    expect(saveNotConfirmed.body.error).toBe(CONFIRM_TEAM_PROBLEM)

    const applyNotConfirmed = await getJson(`${url}/api/teams/Alpha/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({}),
    })
    expect(applyNotConfirmed.status).toBe(400)
    expect(applyNotConfirmed.body.error).toBe(CONFIRM_TEAM_PROBLEM)

    const deleteNotConfirmed = await getJson(`${url}/api/teams/Alpha/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: 'yes' }),
    })
    expect(deleteNotConfirmed.status).toBe(400)
    expect(deleteNotConfirmed.body.error).toBe(CONFIRM_TEAM_PROBLEM)

    const copyNotConfirmed = await getJson(`${url}/api/teams/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ path: 'C:/sample' }),
    })
    expect(copyNotConfirmed.status).toBe(400)
    expect(copyNotConfirmed.body.error).toBe(CONFIRM_TEAM_PROBLEM)
  })

  it('refuses saving a team with empty or oversized name with 400', async () => {
    const { url } = await startTestBridge()

    const emptyName = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: '   ', confirmed: true }),
    })
    expect(emptyName.status).toBe(400)
    expect(emptyName.body.error).toBe(TEAM_NAME_PROBLEM)

    const longName = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'a'.repeat(41), confirmed: true }),
    })
    expect(longName.status).toBe(400)
    expect(longName.body.error).toBe(TEAM_NAME_PROBLEM)
  })

  it('saves and answers teams, replacing one with the same name', async () => {
    const { url, projectRoot, runsFolder } = await startTestBridge()

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })

    await getJson(`${url}/api/family/label`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ id: 'opencode', label: 'Coder One', confirmed: true }),
    })

    const saveRes = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Solo', confirmed: true }),
    })
    expect(saveRes.status).toBe(200)
    expect(saveRes.body.ok).toBe(true)
    expect(saveRes.body.team.name).toBe('Solo')
    expect(saveRes.body.team.lanes).toEqual(['opencode'])
    expect(saveRes.body.team.labels.opencode).toBe('Coder One')

    const listRes = await getJson(`${url}/api/teams`)
    expect(listRes.status).toBe(200)
    expect(listRes.body.teams.length).toBe(1)
    expect(listRes.body.teams[0].name).toBe('Solo')

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode', 'claude'], confirmed: true }),
    })

    const replaceRes = await getJson(`${url}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Solo', confirmed: true }),
    })
    expect(replaceRes.status).toBe(200)
    expect(replaceRes.body.team.lanes).toEqual(['opencode', 'claude'])

    const listAfterReplace = await getJson(`${url}/api/teams`)
    expect(listAfterReplace.body.teams.length).toBe(1)
    expect(listAfterReplace.body.teams[0].lanes).toEqual(['opencode', 'claude'])
  })

  it('applies a saved team, hides non-team lanes, and reports drops', async () => {
    const { url, projectRoot, runsFolder } = await startTestBridge()

    const runsDir = runsFolder
    const file = teamsFileFor(runsDir)
    const team = {
      name: 'Pair',
      lanes: ['opencode', 'claude', 'vanished-lane'],
      labels: { opencode: 'Lead Coder' },
      ladder: {
        subs: [
          {
            id: 'sub-one',
            name: 'Sub One',
            lanes: ['opencode', 'vanished-lane'],
          },
        ],
      },
      savedAt: new Date().toISOString(),
    }
    saveTeams(file, [team])

    const applyRes = await getJson(`${url}/api/teams/Pair/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(applyRes.status).toBe(200)
    expect(applyRes.body.ok).toBe(true)
    expect(applyRes.body.applied.lanes).toEqual(['opencode', 'claude'])
    expect(applyRes.body.dropped.lanes).toEqual(['vanished-lane'])

    const active = readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder))
    expect(active).toEqual(['opencode', 'claude'])

    const hidden = readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder))
    expect(hidden).toEqual(['opencode2'])

    const labels = readLabels(labelsFileFor(projectRoot, runsFolder))
    expect(labels.opencode).toBe('Lead Coder')

    const deleteRes = await getJson(`${url}/api/teams/Pair/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body).toEqual({ ok: true, deleted: 'Pair' })
    expect(readTeams(file)).toEqual([])
  })

  it('copies team from another known project in projects.json', async () => {
    const runsFolder = tempDir('mr-runs-shared-')
    const projSource = tempDir('mr-source-')
    const projTarget = tempDir('mr-target-')

    const projectsFile = join(runsFolder, 'projects.json')
    writeFileSync(
      projectsFile,
      JSON.stringify({ recent: [{ path: projSource, openedAt: new Date().toISOString() }] })
    )

    writeActiveLanes(activeLanesFileFor(projSource, runsFolder), ['claude'])
    writeHiddenLanes(projectLanesFileFor(projSource, runsFolder), ['opencode2'])
    const labelsFile = labelsFileFor(projSource, runsFolder)
    writeFileSync(labelsFile, JSON.stringify({ claude: 'Claude Specialist' }))

    const bridgeTarget = await startTestBridge({ projectRoot: projTarget, runsFolder })

    const unknownProjectRes = await getJson(`${bridgeTarget.url}/api/teams/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bridgeTarget.url },
      body: JSON.stringify({ path: tempDir('mr-unknown-'), confirmed: true }),
    })
    expect(unknownProjectRes.status).toBe(400)
    expect(unknownProjectRes.body.error).toBe(UNKNOWN_PROJECT_PROBLEM)

    const copyRes = await getJson(`${bridgeTarget.url}/api/teams/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bridgeTarget.url },
      body: JSON.stringify({ path: projSource, confirmed: true }),
    })
    expect(copyRes.status).toBe(200)
    expect(copyRes.body.ok).toBe(true)
    expect(copyRes.body.applied.lanes).toEqual(['claude'])

    const targetActive = readActiveLanesChoice(activeLanesFileFor(projTarget, runsFolder))
    expect(targetActive).toEqual(['claude'])

    const targetHidden = readHiddenLanes(projectLanesFileFor(projTarget, runsFolder))
    expect(targetHidden).toEqual(['opencode2'])

    const targetLabels = readLabels(labelsFileFor(projTarget, runsFolder))
    expect(targetLabels.claude).toBe('Claude Specialist')
  })

  it('refuses apply and copy with 409 when no lanes belong to this project and leaves files untouched', async () => {
    const runsFolder = tempDir('mr-runs-empty-')
    const projSource = tempDir('mr-source-empty-')
    const projTarget = tempDir('mr-target-empty-')

    const projectsFile = join(runsFolder, 'projects.json')
    writeFileSync(
      projectsFile,
      JSON.stringify({ recent: [{ path: projSource, openedAt: new Date().toISOString() }] })
    )

    writeActiveLanes(activeLanesFileFor(projSource, runsFolder), ['nonexistent'])
    writeActiveLanes(activeLanesFileFor(projTarget, runsFolder), ['claude'])
    writeHiddenLanes(projectLanesFileFor(projTarget, runsFolder), ['opencode'])

    saveTeams(teamsFileFor(runsFolder), [
      { name: 'Foreign', lanes: ['nonexistent'], labels: {}, savedAt: new Date().toISOString() },
    ])

    const bridge = await startTestBridge({ projectRoot: projTarget, runsFolder })

    const applyRes = await getJson(`${bridge.url}/api/teams/Foreign/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bridge.url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(applyRes.status).toBe(409)
    expect(applyRes.body.error).toBe('None of the lanes in Foreign are in this project.')

    expect(readActiveLanesChoice(activeLanesFileFor(projTarget, runsFolder))).toEqual(['claude'])
    expect(readHiddenLanes(projectLanesFileFor(projTarget, runsFolder))).toEqual(['opencode'])

    const copyRes = await getJson(`${bridge.url}/api/teams/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bridge.url },
      body: JSON.stringify({ path: projSource, confirmed: true }),
    })
    expect(copyRes.status).toBe(409)
    expect(copyRes.body.error).toBe(`${basename(projSource)} has no active lanes to copy.`)

    expect(readActiveLanesChoice(activeLanesFileFor(projTarget, runsFolder))).toEqual(['claude'])
    expect(readHiddenLanes(projectLanesFileFor(projTarget, runsFolder))).toEqual(['opencode'])
  })

  it('reports a ladder the bridge refuses instead of saying it applied', async () => {
    const root = tempDir('mr-ladder-proj-')
    const runs = tempDir('mr-ladder-runs-')
    saveTeams(teamsFileFor(runs), [
      { name: 'Subs', lanes: ['opencode'], labels: {}, ladder: { subs: [{ id: 'one', lanes: ['opencode'] }] }, savedAt: new Date().toISOString() },
    ])
    const answers = []
    const api = createTeamsApi({
      projectRoot: root,
      runsFolder: runs,
      lanes: SAMPLE_LANES,
      orchestrators: {
        list: () => [],
        ladderChange: () => ({ status: 400, body: { error: 'Sub "one" needs a name.' } }),
      },
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ confirmed: true }),
    })
    await api.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/teams/Subs/apply')
    )
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.ladderError).toBe('Sub "one" needs a name.')
    expect(answers[0].body.applied.ladder).toBeNull()
  })

  it('refuses apply and copy with 409 while turn or lane runs', async () => {
    const root = tempDir('mr-409-proj-')
    const runs = tempDir('mr-409-runs-')
    const file = teamsFileFor(runs)
    saveTeams(file, [{ name: 'Solo', lanes: ['opencode'], labels: {}, ladder: { subs: [] }, savedAt: new Date().toISOString() }])

    const projectsFile = join(runs, 'projects.json')
    writeFileSync(projectsFile, JSON.stringify({ recent: [{ path: root, openedAt: new Date().toISOString() }] }))

    const turnRunningAnswers = []
    const apiTurn = createTeamsApi({
      projectRoot: root,
      runsFolder: runs,
      orchestrators: { list: () => [{ id: 'orchestrator', state: 'working' }] },
      sendJson: (_req, _res, status, body) => turnRunningAnswers.push({ status, body }),
      readJsonBody: async () => ({ confirmed: true, path: root }),
    })

    const applyHandledTurn = await apiTurn.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/teams/Solo/apply')
    )
    expect(applyHandledTurn).toBe(true)
    expect(turnRunningAnswers[0].status).toBe(409)
    expect(turnRunningAnswers[0].body.error).toBe(TURN_RUNNING_PROBLEM)

    const copyHandledTurn = await apiTurn.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/teams/copy')
    )
    expect(copyHandledTurn).toBe(true)
    expect(turnRunningAnswers[1].status).toBe(409)
    expect(turnRunningAnswers[1].body.error).toBe(TURN_RUNNING_PROBLEM)

    const laneRunningAnswers = []
    const apiLane = createTeamsApi({
      projectRoot: root,
      runsFolder: runs,
      runs: { isRunning: () => true },
      sendJson: (_req, _res, status, body) => laneRunningAnswers.push({ status, body }),
      readJsonBody: async () => ({ confirmed: true, path: root }),
    })

    const applyHandledLane = await apiLane.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/teams/Solo/apply')
    )
    expect(applyHandledLane).toBe(true)
    expect(laneRunningAnswers[0].status).toBe(409)
    expect(laneRunningAnswers[0].body.error).toBe(LANE_RUN_OPEN_PROBLEM)

    const copyHandledLane = await apiLane.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/teams/copy')
    )
    expect(copyHandledLane).toBe(true)
    expect(laneRunningAnswers[1].status).toBe(409)
    expect(laneRunningAnswers[1].body.error).toBe(LANE_RUN_OPEN_PROBLEM)
  })
})

describe('client and mock team methods', () => {
  it('manages teams through createClient and createMockClient', async () => {
    const { url, projectRoot } = await startTestBridge()
    const client = createClient({
      baseUrl: url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
    })

    const initial = await client.teams()
    expect(initial.teams).toEqual([])

    await client.setActiveLanes({ lanes: ['opencode', 'claude'], confirmed: true })
    const saved = await client.saveTeam({ name: 'Alpha Squad', confirmed: true })
    expect(saved.ok).toBe(true)
    expect(saved.team.name).toBe('Alpha Squad')

    const list = await client.teams()
    expect(list.teams.length).toBe(1)
    expect(list.teams[0].name).toBe('Alpha Squad')

    const applied = await client.applyTeam({ name: 'Alpha Squad', confirmed: true })
    expect(applied.ok).toBe(true)

    const copied = await client.copyProjectTeam({ path: projectRoot, confirmed: true })
    expect(copied.ok).toBe(true)

    const deleted = await client.deleteTeam({ name: 'Alpha Squad', confirmed: true })
    expect(deleted.ok).toBe(true)

    const mock = createMockClient({ latencyMs: 0 })
    const mockInitial = await mock.teams()
    expect(mockInitial.teams).toEqual([])

    const mockSaved = await mock.saveTeam({ name: 'Beta', confirmed: true })
    expect(mockSaved.ok).toBe(true)

    const mockList = await mock.teams()
    expect(mockList.teams.length).toBe(1)

    const mockApplied = await mock.applyTeam({ name: 'Beta', confirmed: true })
    expect(mockApplied.ok).toBe(true)

    const mockCopy = await mock.copyProjectTeam({ path: 'C:/fake/path', confirmed: true })
    expect(mockCopy.ok).toBe(true)

    const mockDeleted = await mock.deleteTeam({ name: 'Beta', confirmed: true })
    expect(mockDeleted.ok).toBe(true)
  })
})
