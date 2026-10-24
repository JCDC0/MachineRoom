import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chooseRoute, readPolicy } from '../src/policy/route.js'
import { readLaneCosts } from './lane-costs.js'
import { laneAgents, readLanes } from './lanes-source.js'

const POLICY_FILE = 'policy.json'
const FAILURES_PROBLEM = 'Failures must be a whole number from 0 to 5.'

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
  const lanes = typeof options.lanes === 'function' ? options.lanes : () => null

  function readMeters() {
    let agents = []
    try {
      const source = lanes()
      agents = source && Array.isArray(source.agents) ? source.agents : laneAgents(readLanes())
    } catch {
      agents = []
    }
    const costs = readLaneCosts({ agents })
    return { quotas: costs.quota, spent: { companyMonthlyUsd: costs.summary.spendCents / 100 } }
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/control/route') return false
    if ((req.method ?? 'GET') !== 'POST') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    if (!isPlainObject(body.profile)) {
      sendJson(req, res, 400, { error: 'Describe the task first.' })
      return true
    }

    const problem = failuresProblem(body.failures)
    if (problem !== null) {
      sendJson(req, res, 400, { error: problem })
      return true
    }

    const text = readText(resolvedBriefs ? join(resolvedBriefs, POLICY_FILE) : null)
    if (text === null) {
      sendJson(req, res, 404, { error: 'The policy file is missing.' })
      return true
    }

    let policy
    try {
      policy = readPolicy(text)
    } catch (error) {
      sendJson(req, res, 400, { error: error.message })
      return true
    }

    const meters = readMeters()
    const answer = chooseRoute({
      policy,
      profile: body.profile,
      failures: body.failures,
      quotas: meters.quotas,
      spent: meters.spent,
    })
    sendJson(req, res, 200, { tier: answer.tier, choice: answer.choice, reason: answer.reason })
    return true
  }

  return { handle }
}
