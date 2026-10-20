import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chooseRoute, readPolicy } from '../src/policy/route.js'
import { mapCosts } from './control.js'

const POLICY_FILE = 'policy.json'
const FALLBACK = ' Quota and spend were not read.'
const FAILURES_PROBLEM = 'Failures must be a whole number from 0 to 5.'
const DEFAULT_TIMEOUT_MS = 15000

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
  const { paperclipUrl, companyId, sendJson, readJsonBody, featureOn } = options
  const projectRoot = options.projectRoot ?? ''
  const briefsDir = options.briefsDir ?? ''
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const base = String(paperclipUrl ?? '').replace(/\/+$/, '')
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''

  async function readUpstream(path) {
    let response
    try {
      response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      return null
    }
    if (response.status !== 200) return null
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  async function readMeters() {
    if (typeof featureOn === 'function' && featureOn('meters') === false) return null
    const company = `/api/companies/${encodeURIComponent(companyId)}`
    const [summary, quota] = await Promise.all([readUpstream(`${company}/costs/summary`), readUpstream(`${company}/costs/quota-windows`)])
    if (summary === null || quota === null) return null
    const costs = mapCosts({ summary, rows: [], quota })
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

    const meters = await readMeters()
    const answer = chooseRoute({
      policy,
      profile: body.profile,
      failures: body.failures,
      quotas: meters === null ? undefined : meters.quotas,
      spent: meters === null ? undefined : meters.spent,
    })
    const reason = meters === null ? `${answer.reason}${FALLBACK}` : answer.reason
    sendJson(req, res, 200, { tier: answer.tier, choice: answer.choice, reason })
    return true
  }

  return { handle }
}
