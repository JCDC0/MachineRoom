import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const AGENT_DEPTH_DEFAULT = 2
export const AGENT_DEPTH_MIN = 1
export const AGENT_DEPTH_MAX = 4
export const AGENT_DEPTH_UNLOCKED_MAX = 4

export const ORIGIN_DEPTH_PROBLEM = 'A change to the subagent depth needs a page Origin.'
export const TOKEN_DEPTH_PROBLEM = 'An orchestrator cannot change the subagent depth.'
export const CONFIRM_DEPTH_PROBLEM = 'Confirm the subagent depth first.'
export const LIMIT_DEPTH_PROBLEM = 'The subagent depth must be 1, 2, 3 or 4.'
export const UNLOCK_DEPTH_PROBLEM = 'The subagent depth can be 3 or 4 only after an unlock.'

export function agentDepthFileFor(runsFolder) {
  return join(resolve(runsFolder), 'agent-depth.json')
}

function normalized(value) {
  const parsed = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const unlocked = parsed.unlocked === true
  const limit =
    Number.isInteger(parsed.limit) && parsed.limit >= AGENT_DEPTH_MIN && parsed.limit <= AGENT_DEPTH_MAX
      ? parsed.limit
      : AGENT_DEPTH_DEFAULT
  return { limit: limit > AGENT_DEPTH_DEFAULT && !unlocked ? AGENT_DEPTH_DEFAULT : limit, unlocked }
}

export function readAgentDepth(runsFolder) {
  const file = agentDepthFileFor(runsFolder)
  try {
    if (!existsSync(file)) return { limit: AGENT_DEPTH_DEFAULT, unlocked: false }
    return normalized(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return { limit: AGENT_DEPTH_DEFAULT, unlocked: false }
  }
}

export function saveAgentDepth(runsFolder, value, { rename = renameSync } = {}) {
  const file = agentDepthFileFor(runsFolder)
  const saved = normalized(value)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(saved, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
  return saved
}

export function createAgentDepthApi(options = {}) {
  const runsDir = resolve(options.runsFolder ?? 'runs')
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify

  async function handle(req, res, url) {
    if (url.pathname !== '/api/agent-depth') return false
    const method = req.method ?? 'GET'

    if (method === 'GET') {
      sendJson(req, res, 200, readAgentDepth(runsDir))
      return true
    }

    if (method !== 'POST') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    if (!req.headers.origin) {
      sendJson(req, res, 403, { error: ORIGIN_DEPTH_PROBLEM })
      return true
    }

    const tokenHeader = req.headers['x-machineroom-orchestrator']
    const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : Array.isArray(tokenHeader) ? String(tokenHeader[0]).trim() : ''
    if (token) {
      sendJson(req, res, 403, { error: TOKEN_DEPTH_PROBLEM })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: CONFIRM_DEPTH_PROBLEM })
      return true
    }

    if (!Number.isInteger(body.limit) || body.limit < AGENT_DEPTH_MIN || body.limit > AGENT_DEPTH_MAX) {
      sendJson(req, res, 400, { error: LIMIT_DEPTH_PROBLEM })
      return true
    }

    const unlocked = body.unlocked === true
    if (body.limit > AGENT_DEPTH_DEFAULT && !unlocked) {
      sendJson(req, res, 400, { error: UNLOCK_DEPTH_PROBLEM })
      return true
    }

    const saved = saveAgentDepth(runsDir, { limit: body.limit, unlocked })
    if (typeof notify === 'function') notify({ topic: 'agents' })
    sendJson(req, res, 200, { ok: true, ...saved })
    return true
  }

  return { handle }
}
