import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseBriefs } from '../src/briefs/briefs.js'
import { profileFromBrief, profileFromTask } from '../src/policy/profile.js'
import { chooseRoute, readPolicy, routeLane } from '../src/policy/route.js'
import { NO_ACTIVE_CHOICE_PROBLEM } from './active-lanes.js'
import { readLaneCosts } from './lane-costs.js'
import { laneAgents, lanesFolder, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { TASK_LIMIT, TASK_PROBLEM, laneStatesFor, readStartLanes } from './runs.js'

const POLICY_FILE = 'policy.json'
const TASKS_FILE = 'TASKS.md'
const FAILURES_PROBLEM = 'Failures must be a whole number from 0 to 5.'
const NO_BRIEF_OR_TASK_PROBLEM = 'Name a brief or a task.'
const BOTH_BRIEF_AND_TASK_PROBLEM = 'Send a brief or a task, not both.'
const BRIEF_PROBLEM = 'Choose a brief from the list.'
const BRIEF_FILES_PROBLEM = 'The brief files are missing.'
const LANE_FILE_PROBLEM = 'The lane file is not valid.'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function failuresProblem(failures) {
  if (failures === undefined) return null
  if (!Number.isInteger(failures) || failures < 0 || failures > 5) return FAILURES_PROBLEM
  return null
}

export function createPolicyApi(options) {
  const { sendJson, readJsonBody } = options
  const projectRoot = options.projectRoot ?? ''
  const briefsDir = options.briefsDir ?? ''
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const resolvedRuns = resolve(options.runsFolder ?? defaultRunsFolder())
  const lanesDir = options.lanesFile ? dirname(resolve(options.lanesFile)) : lanesFolder()
  const lanes = typeof options.lanes === 'function' ? options.lanes : () => null

  function readMeters() {
    let agents = []
    try {
      const source = lanes()
      agents = source && Array.isArray(source.agents)
        ? source.agents
        : laneAgents(readStartLanes({ lanesFile: options.lanesFile, runsFolder: resolvedRuns }) ?? {})
    } catch {
      agents = []
    }
    const costs = readLaneCosts({ agents, file: join(resolvedRuns, 'runs.jsonl') })
    return { quotas: costs.quota, spent: { companyMonthlyUsd: costs.summary.spendCents / 100 } }
  }

  function readPolicyFile() {
    const text = readText(join(lanesDir, POLICY_FILE))
    if (text === null) return { status: 404, error: 'The policy file is missing.' }
    try {
      return { policy: readPolicy(text) }
    } catch (error) {
      return { status: 400, error: error.message }
    }
  }

  function readLaneConfig() {
    const config = readStartLanes({ lanesFile: options.lanesFile, runsFolder: resolvedRuns })
    if (config === null) return { status: 400, error: LANE_FILE_PROBLEM }
    return { lanes: config }
  }

  function profileFor(body) {
    const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
    const task = typeof body.task === 'string' ? body.task.trim() : ''
    if (brief !== '' && task !== '') return { status: 400, error: BOTH_BRIEF_AND_TASK_PROBLEM }
    if (brief === '' && task === '') return { status: 400, error: NO_BRIEF_OR_TASK_PROBLEM }
    if (task !== '') {
      if (task.length > TASK_LIMIT) return { status: 400, error: TASK_PROBLEM }
      return { profile: profileFromTask(task) }
    }
    const text = readText(resolvedBriefs ? join(resolvedBriefs, TASKS_FILE) : null)
    if (text === null) return { status: 404, error: BRIEF_FILES_PROBLEM }
    const found = parseBriefs(text).find((entry) => entry.id === brief)
    if (!found) return { status: 400, error: BRIEF_PROBLEM }
    return { profile: profileFromBrief(found) }
  }

  async function handleLane(req, res, body) {
    const problem = failuresProblem(body.failures)
    if (problem !== null) {
      sendJson(req, res, 400, { error: problem })
      return
    }

    const source = profileFor(body)
    if (source.error) {
      sendJson(req, res, source.status, { error: source.error })
      return
    }

    const read = readPolicyFile()
    if (read.error) {
      sendJson(req, res, read.status, { error: read.error })
      return
    }

    const config = readLaneConfig()
    if (config.error) {
      sendJson(req, res, config.status, { error: config.error })
      return
    }

    const meters = readMeters()
    const state = laneStatesFor({ lanesConfig: config.lanes, projectRoot: resolvedRoot, runsFolder: resolvedRuns })
    if (!state.chosen) {
      sendJson(req, res, 400, { error: NO_ACTIVE_CHOICE_PROBLEM })
      return
    }
    const answer = routeLane({
      policy: read.policy,
      profile: source.profile,
      failures: body.failures,
      quotas: meters.quotas,
      spent: meters.spent,
      lanes: state.lanes,
    })
    const anyLane = state.lanes.some((lane) => lane.eligible && lane.active)
    const ownerOnly = read.policy.tiers[answer.tier].every((choice) => choice.lane === 'owner')
    if (answer.lane === null && !anyLane && ownerOnly) {
      answer.reason = `There is no lane for the ${answer.tier} tier. Make one in the room.`
    }
    sendJson(req, res, 200, answer)
  }

  async function handleRoute(req, res, body) {
    if (!isPlainObject(body.profile)) {
      sendJson(req, res, 400, { error: 'Describe the task first.' })
      return
    }

    const problem = failuresProblem(body.failures)
    if (problem !== null) {
      sendJson(req, res, 400, { error: problem })
      return
    }

    const read = readPolicyFile()
    if (read.error) {
      sendJson(req, res, read.status, { error: read.error })
      return
    }

    const meters = readMeters()
    const answer = chooseRoute({
      policy: read.policy,
      profile: body.profile,
      failures: body.failures,
      quotas: meters.quotas,
      spent: meters.spent,
    })
    sendJson(req, res, 200, { tier: answer.tier, choice: answer.choice, reason: answer.reason })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    if (path !== '/api/control/route' && path !== '/api/control/route/lane') return false
    if ((req.method ?? 'GET') !== 'POST') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    if (path === '/api/control/route/lane') await handleLane(req, res, body)
    else await handleRoute(req, res, body)
    return true
  }

  return { handle }
}
