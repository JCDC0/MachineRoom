export const PLAN_REFUSAL = 'Plans come from lane runs.'
const CONFIRM_PROBLEM = 'Confirm the plan request first.'
const GOAL_PROBLEM = 'Write the goal in 1 to 2000 characters.'
const GOAL_LIMIT = 2000

function decodedId(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

export function createPlansApi(options) {
  const { sendJson, readJsonBody } = options

  function refuse(req, res, status = 409) {
    sendJson(req, res, status, { error: PLAN_REFUSAL })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'POST' && path === '/api/control/plans') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body?.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_PROBLEM })
        return true
      }
      const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
      if (goal.length < 1 || goal.length > GOAL_LIMIT) {
        sendJson(req, res, 400, { error: GOAL_PROBLEM })
        return true
      }
      refuse(req, res)
      return true
    }

    const planAccept = /^\/api\/control\/plans\/([^/]+)\/accept$/.exec(path)
    if (method === 'POST' && planAccept) {
      if (decodedId(planAccept[1]) === null) {
        sendJson(req, res, 404, { error: 'That task no longer exists.' })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      refuse(req, res)
      return true
    }

    const planGet = /^\/api\/control\/plans\/([^/]+)$/.exec(path)
    if (method === 'GET' && planGet) {
      if (decodedId(planGet[1]) === null) {
        sendJson(req, res, 404, { error: 'That task no longer exists.' })
        return true
      }
      refuse(req, res)
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
