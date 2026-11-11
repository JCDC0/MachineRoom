import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseBriefs } from '../src/briefs/briefs.js'
import { laneLockPids } from '../src/briefs/run.js'
import { profileFromBrief } from '../src/policy/profile.js'
import { chooseRoute, readPolicy, routeLane } from '../src/policy/route.js'
import { activeLanesFileFor, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes } from './active-lanes.js'
import { readLaneCosts } from './lane-costs.js'
import { laneAgents, readLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { REPO_POLICY, TASK_LIMIT, TASK_PROBLEM } from './runs.js'

const POLICY_FILE = 'policy.json'
const LANES_FILE = 'lanes.json'
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

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function laneLockAlive(folder, key) {
  if (!folder) return false
  const holder = laneLockPids(readText(join(folder, `${key}.lock`)))
  return processAlive(holder.pid) || processAlive(holder.child)
}

export function laneStatesFor({ lanesConfig, projectRoot = '', runsFolder = '' } = {}) {
  const saved = readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder))
  const activeSet = saved === null ? new Set() : new Set(saved)
  const hiddenSet = new Set(readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder)))
  const states = []
  for (const [key, entry] of Object.entries(lanesConfig ?? {})) {
    if (key === 'orchestrator') continue
    if (!isPlainObject(entry)) continue
    states.push({
      key,
      eligible: entry.retired !== true && isPlainObject(entry.cli),
      active: activeSet.has(key) && !hiddenSet.has(key),
      busy: laneLockAlive(runsFolder, key),
    })
  }
  return states
}

export function createPolicyApi(options) {
  const { sendJson, readJsonBody } = options
  const projectRoot = options.projectRoot ?? ''
  const briefsDir = options.briefsDir ?? ''
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const resolvedRuns = resolve(options.runsFolder ?? defaultRunsFolder())
  const lanes = typeof options.lanes === 'function' ? options.lanes : () => null

  function readMeters() {
    let agents = []
    try {
      const source = lanes()
      agents = source && Array.isArray(source.agents) ? source.agents : laneAgents(readLanes())
    } catch {
      agents = []
    }
    const costs = readLaneCosts({ agents, file: join(resolvedRuns, 'runs.jsonl') })
    return { quotas: costs.quota, spent: { companyMonthlyUsd: costs.summary.spendCents / 100 } }
  }

  function readPolicyFile({ fallback = false } = {}) {
    const text = readText(resolvedBriefs ? join(resolvedBriefs, POLICY_FILE) : null) ?? (fallback ? readText(REPO_POLICY) : null)
    if (text === null) return { status: 404, error: 'The policy file is missing.' }
    try {
      return { policy: readPolicy(text) }
    } catch (error) {
      return { status: 400, error: error.message }
    }
  }

  function readLaneConfig() {
    const text = readText(resolvedBriefs ? join(resolvedBriefs, LANES_FILE) : null)
    if (text === null) {
      try {
        const fallback = readLanes()
        return isPlainObject(fallback) ? { lanes: fallback } : { status: 400, error: LANE_FILE_PROBLEM }
      } catch {
        return { status: 400, error: LANE_FILE_PROBLEM }
      }
    }
    try {
      const parsed = JSON.parse(text)
      if (!isPlainObject(parsed)) return { status: 400, error: LANE_FILE_PROBLEM }
      return { lanes: parsed }
    } catch {
      return { status: 400, error: LANE_FILE_PROBLEM }
    }
  }

  function profileFor(body) {
    const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
    const task = typeof body.task === 'string' ? body.task.trim() : ''
    if (brief !== '' && task !== '') return { status: 400, error: BOTH_BRIEF_AND_TASK_PROBLEM }
    if (brief === '' && task === '') return { status: 400, error: NO_BRIEF_OR_TASK_PROBLEM }
    if (task !== '') {
      if (task.length > TASK_LIMIT) return { status: 400, error: TASK_PROBLEM }
      return { profile: profileFromBrief({ text: task }) }
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

    const read = readPolicyFile({ fallback: true })
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
    const answer = routeLane({
      policy: read.policy,
      profile: source.profile,
      failures: body.failures,
      quotas: meters.quotas,
      spent: meters.spent,
      lanes: laneStatesFor({ lanesConfig: config.lanes, projectRoot: resolvedRoot, runsFolder: resolvedRuns }),
    })
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
