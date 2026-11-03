import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readAgentDepth } from './agent-depth.js'
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
    const lanesText = resolvedBriefs ? readText(join(resolvedBriefs, 'lanes.json')) : null
    const pkgText =
      (resolvedRoot ? readText(join(resolvedRoot, 'package.json')) : null) ??
      (resolvedBriefs ? readText(join(resolvedBriefs, 'package.json')) : null)

    if (tasksText === null || rulesText === null || lanesText === null || pkgText === null) {
      sendJson(req, res, 404, { error: 'The brief files are missing.' })
      return true
    }

    let lanes
    let version
    try {
      lanes = JSON.parse(lanesText)
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

    if (!Object.hasOwn(lanes, lane)) {
      sendJson(req, res, 400, { error: 'Choose hermes, opencode or agy.' })
      return true
    }

    const rules = parseRules(rulesText)
    const prompt = buildPrompt({ briefs: picked, laneKey: lane, lanes, rules, version, agentDepth: readAgentDepth(runsFolder()).limit })
    sendJson(req, res, 200, {
      prompt,
      lane,
      model: modelFor(lanes[lane], picked[0].id),
      branch: branchFor(picked[0]),
    })
    return true
  }

  return { handle }
}
