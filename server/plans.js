import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { parsePlan, planPrompt } from '../src/briefs/plan.js'
import { CANNOT_TAKE_TASKS } from '../src/control/agents.js'
import { buildCreateIssueBody, mapComment, mapIssue, UPSTREAM_TIMEOUT_MS } from './control.js'

const GOAL_LIMIT = 2000
const TITLE_LIMIT = 60
const CONFIRM_PROBLEM = 'Confirm the plan request first.'
const GOAL_PROBLEM = 'Write the goal in 1 to 2000 characters.'
const NO_PLANNER = 'Hire a planner first: an agent with the role pm.'
const MANY_PLANNERS = 'More than one agent has the role pm. Keep one.'
const MISSING_FILES = 'The brief files are missing.'
const BAD_FILES = 'The lane file is not valid.'

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function decodedId(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

function isPlanner(agent) {
  return String(agent?.role ?? '') === 'pm'
}

export function createPlansApi(options) {
  const { paperclipUrl, companyId, sendJson, readJsonBody, featureOn } = options
  const projectId = options.projectId ?? ''
  const projectWorkspaceId = options.projectWorkspaceId ?? ''
  const base = String(paperclipUrl ?? '').replace(/\/+$/, '')
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : UPSTREAM_TIMEOUT_MS
  const projectRoot = options.projectRoot ?? ''
  const briefsDir = options.briefsDir ?? ''
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''

  async function upstream(method, path, body) {
    const signal = AbortSignal.timeout(timeoutMs)
    let response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch {
      return { status: 0, json: null, timedOut: signal.aborted }
    }
    let json = null
    try {
      json = await response.json()
    } catch {
      if (signal.aborted) return { status: 0, json: null, timedOut: true }
      json = null
    }
    return { status: response.status, json }
  }

  function fail(req, res, status, message) {
    sendJson(req, res, status, { error: message })
  }

  function featureOff(req, res) {
    if (typeof featureOn !== 'function' || featureOn('tasks') !== false) return false
    fail(req, res, 503, 'Paperclip changed: tasks is off. Run npm run doctor to see which routes.')
    return true
  }

  function upstreamFailure(answer, missing, generic) {
    if (answer.status === 0) return answer.timedOut ? [504, 'Paperclip did not answer in time.'] : [502, 'Paperclip is not reachable.']
    if (answer.status === 404) return [404, missing]
    if (answer.status >= 500) return [502, 'Paperclip could not complete that.']
    return [400, generic]
  }

  function readBriefs() {
    const tasksText = resolvedBriefs ? readText(join(resolvedBriefs, 'TASKS.md')) : null
    const rulesText = resolvedBriefs ? readText(join(resolvedBriefs, 'HOUSE-RULES.md')) : null
    const lanesText = resolvedBriefs ? readText(join(resolvedBriefs, 'lanes.json')) : null
    if (tasksText === null || rulesText === null || lanesText === null) return { problem: MISSING_FILES }
    let lanes
    try {
      lanes = JSON.parse(lanesText)
    } catch {
      return { problem: BAD_FILES }
    }
    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) return { problem: BAD_FILES }
    return { tasksText, rulesText, lanes }
  }

  async function readAgents(req, res) {
    const answer = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`)
    if (answer.status !== 200) {
      const [code, message] = upstreamFailure(answer, 'That agent no longer exists.', 'Paperclip could not read the agents.')
      fail(req, res, code, message)
      return null
    }
    return Array.isArray(answer.json) ? answer.json : []
  }

  async function createPlan(req, res) {
    const body = await readJsonBody(req, res)
    if (body === null) return
    if (body?.confirmed !== true) {
      fail(req, res, 400, CONFIRM_PROBLEM)
      return
    }
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
    if (goal.length < 1 || goal.length > GOAL_LIMIT) {
      fail(req, res, 400, GOAL_PROBLEM)
      return
    }
    const list = await readAgents(req, res)
    if (list === null) return
    const planners = list.filter(isPlanner)
    if (planners.length === 0) {
      fail(req, res, 404, NO_PLANNER)
      return
    }
    if (planners.length > 1) {
      fail(req, res, 400, MANY_PLANNERS)
      return
    }
    const planner = planners[0]
    if (CANNOT_TAKE_TASKS.includes(planner.status)) {
      fail(req, res, 400, 'That agent cannot take tasks yet.')
      return
    }
    const files = readBriefs()
    if (files.problem) {
      fail(req, res, files.problem === MISSING_FILES ? 404 : 400, files.problem)
      return
    }
    const prompt = planPrompt({
      goal,
      lanes: files.lanes,
      rules: parseRules(files.rulesText),
      ids: parseBriefs(files.tasksText),
    })
    const created = await upstream(
      'POST',
      `/api/companies/${encodeURIComponent(companyId)}/issues`,
      buildCreateIssueBody(
        {
          title: `Plan: ${goal.slice(0, TITLE_LIMIT)}`,
          description: prompt,
          assigneeAgentId: planner.id,
          priority: 'medium',
        },
        null,
        { projectId, projectWorkspaceId }
      )
    )
    if (created.status >= 300 || !created.json) {
      const [code, message] = upstreamFailure(created, 'Paperclip did not accept that task.', 'Paperclip did not accept that task.')
      fail(req, res, code, message)
      return
    }
    const issue = mapIssue(created.json)
    sendJson(req, res, 201, { issueId: issue.id, identifier: issue.identifier })
  }

  async function readPlan(req, res, issueId) {
    const [commentsAnswer, agentsAnswer] = await Promise.all([
      upstream('GET', `/api/issues/${encodeURIComponent(issueId)}/comments`),
      upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`),
    ])
    if (commentsAnswer.status === 404) {
      fail(req, res, 404, 'That task no longer exists.')
      return
    }
    if (commentsAnswer.status !== 200) {
      const [code, message] = upstreamFailure(commentsAnswer, 'That task no longer exists.', 'Paperclip could not read the thread.')
      fail(req, res, code, message)
      return
    }
    if (agentsAnswer.status !== 200) {
      const [code, message] = upstreamFailure(agentsAnswer, 'That agent no longer exists.', 'Paperclip could not read the agents.')
      fail(req, res, code, message)
      return
    }
    const plannerIds = new Set((Array.isArray(agentsAnswer.json) ? agentsAnswer.json : []).filter(isPlanner).map((agent) => String(agent?.id ?? '')))
    const comments = (Array.isArray(commentsAnswer.json) ? commentsAnswer.json : [])
      .map((entry) => mapComment(entry))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const newest = comments.filter((entry) => plannerIds.has(entry.authorAgentId) && entry.body.includes('{')).at(-1)
    if (!newest) {
      sendJson(req, res, 200, { status: 'waiting', briefs: [], problems: [] })
      return
    }
    const files = readBriefs()
    if (files.problem) {
      fail(req, res, files.problem === MISSING_FILES ? 404 : 400, files.problem)
      return
    }
    const answer = parsePlan(newest.body, { lanes: files.lanes, ids: parseBriefs(files.tasksText) })
    sendJson(req, res, 200, { status: 'ready', briefs: answer.briefs, problems: answer.problems })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'POST' && path === '/api/control/plans') {
      if (featureOff(req, res)) return true
      await createPlan(req, res)
      return true
    }

    const planGet = /^\/api\/control\/plans\/([^/]+)$/.exec(path)
    if (method === 'GET' && planGet) {
      if (featureOff(req, res)) return true
      const issueId = decodedId(planGet[1])
      if (!issueId) {
        fail(req, res, 404, 'That task no longer exists.')
        return true
      }
      await readPlan(req, res, issueId)
      return true
    }

    if (path === '/api/control/plans' || planGet) {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    return false
  }

  return { handle }
}
