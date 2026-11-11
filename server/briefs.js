import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readAgentDepth } from './agent-depth.js'
import { readAllLanes } from './agents-config.js'
import { runsFolder } from './lanes-source.js'
import { branchFor, buildPrompt, modelFor, nextVersion, parseBriefs, parseRules } from '../src/briefs/briefs.js'

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function promptLane(lane) {
  if (!lane || typeof lane !== 'object' || lane.custom !== true) return lane
  return {
    ...lane,
    worktree: typeof lane.worktree === 'string' ? lane.worktree : '',
    role: typeof lane.role === 'string' ? lane.role : '',
    forbidden: Array.isArray(lane.forbidden) ? lane.forbidden : [],
    notes: Array.isArray(lane.notes) ? lane.notes : [],
  }
}

function laneProblem(lanes) {
  const names = Object.keys(lanes)
  if (names.length === 0) return 'The room has no lanes to run.'
  return `Choose one of the lanes: ${names.join(', ')}.`
}

export function createBriefsApi({ projectRoot = '', briefsDir = '', sendJson }) {
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (path !== '/api/control/briefs' && path !== '/api/control/brief-prompt') {
      return false
    }

    if (method !== 'GET') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    if (path === '/api/control/briefs') {
      const tasksText = resolvedBriefs ? readText(join(resolvedBriefs, 'TASKS.md')) : null
      if (tasksText === null) {
        sendJson(req, res, 200, { briefs: [] })
        return true
      }
      sendJson(req, res, 200, { briefs: parseBriefs(tasksText) })
      return true
    }

    const tasksText = resolvedBriefs ? readText(join(resolvedBriefs, 'TASKS.md')) : null
    const rulesText = resolvedBriefs ? readText(join(resolvedBriefs, 'HOUSE-RULES.md')) : null
    const pkgText =
      (resolvedRoot ? readText(join(resolvedRoot, 'package.json')) : null) ??
      (resolvedBriefs ? readText(join(resolvedBriefs, 'package.json')) : null)

    if (tasksText === null || rulesText === null || pkgText === null) {
      sendJson(req, res, 404, { error: 'The brief files are missing.' })
      return true
    }

    let lanes
    let version
    try {
      lanes = readAllLanes()
      version = JSON.parse(pkgText)?.version
      nextVersion(version)
    } catch {
      sendJson(req, res, 400, { error: 'The lane or version file is not valid.' })
      return true
    }

    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
      sendJson(req, res, 400, { error: 'The lane file is not valid.' })
      return true
    }

    const ids = String(url.searchParams.get('ids') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const lane = String(url.searchParams.get('lane') ?? '').trim()

    const all = parseBriefs(tasksText)
    const picked = ids.map((id) => all.find((brief) => brief.id === id))
    if (picked.length === 0 || picked.some((brief) => !brief)) {
      sendJson(req, res, 400, { error: 'Choose a brief from the list.' })
      return true
    }

    if (!Object.hasOwn(lanes, lane) || !lanes[lane] || typeof lanes[lane] !== 'object') {
      sendJson(req, res, 400, { error: laneProblem(lanes) })
      return true
    }

    const chosen = promptLane(lanes[lane])
    const rules = parseRules(rulesText)
    const prompt = buildPrompt({
      briefs: picked,
      laneKey: lane,
      lanes: { ...lanes, [lane]: chosen },
      rules,
      version,
      agentDepth: readAgentDepth(runsFolder()).limit,
    })
    sendJson(req, res, 200, {
      prompt,
      lane,
      model: modelFor(chosen, picked[0].id),
      branch: branchFor(picked[0]),
    })
    return true
  }

  return { handle }
}
