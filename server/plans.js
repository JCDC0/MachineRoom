import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { briefMarkdown, parsePlan, planPrompt } from '../src/briefs/plan.js'
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
const CONFIRM_ADD_PROBLEM = 'Confirm adding the briefs first.'
const IDS_PROBLEM = 'Choose 1 to 8 briefs.'
const NO_BRIEFS_FOLDER = 'The bridge has no briefs folder.'
const NOT_READY = 'The plan is not ready.'
const PLAN_CHANGED = 'The plan changed since you read it. Read it again.'
const ACCEPT_HEADING = '## Briefs from the planner'
const ACCEPT_HEADING_LINE = /^## Briefs from the planner[ \t]*\r?$/m
const WRITE_PROBLEM = 'Could not write TASKS.md.'

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

  function hasBriefsFolder() {
    if (!resolvedBriefs) return false
    try {
      return statSync(resolvedBriefs).isDirectory()
    } catch {
      return false
    }
  }

  function appendedTasks(tasksText, lines) {
    const eol = tasksText.includes('\r\n') ? '\r\n' : '\n'
    let base = tasksText
    if (base.length > 0) {
      if (!base.endsWith('\n')) base += eol
      if (!base.endsWith(`${eol}${eol}`)) base += eol
    }
    const parts = []
    if (!ACCEPT_HEADING_LINE.test(tasksText)) parts.push(ACCEPT_HEADING, '')
    parts.push(lines.join(`${eol}${eol}`))
    return `${base}${parts.join(eol)}${eol}`
  }

  function writeTasks(tasksText, lines) {
    const tasksPath = join(resolvedBriefs, 'TASKS.md')
    const tempPath = join(resolvedBriefs, `.TASKS.md.${process.pid}.${Date.now()}.tmp`)
    try {
      writeFileSync(tempPath, appendedTasks(tasksText, lines), 'utf8')
      renameSync(tempPath, tasksPath)
      return true
    } catch {
      try {
        unlinkSync(tempPath)
      } catch {}
      return false
    }
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

  async function planFor(issueId) {
    const [commentsAnswer, agentsAnswer] = await Promise.all([
      upstream('GET', `/api/issues/${encodeURIComponent(issueId)}/comments`),
      upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`),
    ])
    if (commentsAnswer.status === 404) return { problem: [404, 'That task no longer exists.'] }
    if (commentsAnswer.status !== 200) {
      return { problem: upstreamFailure(commentsAnswer, 'That task no longer exists.', 'Paperclip could not read the thread.') }
    }
    if (agentsAnswer.status !== 200) {
      return { problem: upstreamFailure(agentsAnswer, 'That agent no longer exists.', 'Paperclip could not read the agents.') }
    }
    const plannerIds = new Set((Array.isArray(agentsAnswer.json) ? agentsAnswer.json : []).filter(isPlanner).map((agent) => String(agent?.id ?? '')))
    const comments = (Array.isArray(commentsAnswer.json) ? commentsAnswer.json : [])
      .map((entry) => mapComment(entry))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const newest = comments.filter((entry) => plannerIds.has(entry.authorAgentId) && entry.body.includes('{')).at(-1)
    if (!newest) return { waiting: true }
    const files = readBriefs()
    if (files.problem) return { problem: [files.problem === MISSING_FILES ? 404 : 400, files.problem] }
    const answer = parsePlan(newest.body, { lanes: files.lanes, ids: parseBriefs(files.tasksText) })
    return { files, answer, planId: newest.id }
  }

  async function readPlan(req, res, issueId) {
    const plan = await planFor(issueId)
    if (plan.problem) {
      fail(req, res, plan.problem[0], plan.problem[1])
      return
    }
    if (plan.waiting) {
      sendJson(req, res, 200, { status: 'waiting', briefs: [], problems: [] })
      return
    }
    sendJson(req, res, 200, { status: 'ready', briefs: plan.answer.briefs, problems: plan.answer.problems, planId: plan.planId })
  }

  async function acceptPlan(req, res, issueId) {
    const body = await readJsonBody(req, res)
    if (body === null) return
    if (body?.confirmed !== true) {
      fail(req, res, 400, CONFIRM_ADD_PROBLEM)
      return
    }
    const rawIds = body?.ids
    if (
      !Array.isArray(rawIds) ||
      rawIds.length < 1 ||
      rawIds.length > 8 ||
      rawIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
    ) {
      fail(req, res, 400, IDS_PROBLEM)
      return
    }
    if (!hasBriefsFolder()) {
      fail(req, res, 404, NO_BRIEFS_FOLDER)
      return
    }
    const plan = await planFor(issueId)
    if (plan.problem) {
      fail(req, res, plan.problem[0], plan.problem[1])
      return
    }
    if (plan.waiting) {
      fail(req, res, 409, NOT_READY)
      return
    }
    const planId = typeof body?.planId === 'string' ? body.planId.trim() : ''
    if (!planId || planId !== plan.planId) {
      fail(req, res, 409, PLAN_CHANGED)
      return
    }
    const ids = rawIds.map((id) => id.trim())
    const chosen = Object.create(null)
    for (const id of ids) chosen[id] = true
    const good = Object.create(null)
    for (const brief of plan.answer.briefs) good[brief.id] = true
    const missing = ids.find((id) => !Object.hasOwn(good, id))
    if (missing) {
      fail(req, res, 400, `Brief ${missing} is not in the plan, or has a problem now.`)
      return
    }
    const selected = plan.answer.briefs.filter((brief) => Object.hasOwn(chosen, brief.id))
    const lines = selected.map((brief) => briefMarkdown(brief, plan.files.lanes))
    const written = writeTasks(plan.files.tasksText, lines)
    if (!written) {
      fail(req, res, 500, WRITE_PROBLEM)
      return
    }
    sendJson(req, res, 201, { added: selected.map((brief) => brief.id) })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'POST' && path === '/api/control/plans') {
      if (featureOff(req, res)) return true
      await createPlan(req, res)
      return true
    }

    const planAccept = /^\/api\/control\/plans\/([^/]+)\/accept$/.exec(path)
    if (method === 'POST' && planAccept) {
      if (featureOff(req, res)) return true
      const issueId = decodedId(planAccept[1])
      if (!issueId) {
        fail(req, res, 404, 'That task no longer exists.')
        return true
      }
      await acceptPlan(req, res, issueId)
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

    if (path === '/api/control/plans' || planGet || planAccept) {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    return false
  }

  return { handle }
}
