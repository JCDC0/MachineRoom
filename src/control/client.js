export const STREAM_START = 1000
export const STREAM_LIMIT = 15000

export function createClient({
  baseUrl = '',
  fetchImpl = fetch,
  EventSourceImpl = globalThis.EventSource,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  const listeners = new Set()
  let source = null
  let timer = null
  let delay = STREAM_START

  async function request(method, path, body) {
    let response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new Error('The bridge is not reachable.')
    }
    let json = null
    try {
      json = await response.json()
    } catch {
      json = null
    }
    if (!response.ok) {
      const message = typeof json?.error === 'string' && json.error.trim() ? json.error : 'The request failed.'
      const error = new Error(message)
      if (Array.isArray(json?.files)) error.files = json.files.filter((file) => typeof file === 'string')
      throw error
    }
    return json
  }

  function handleChange(event) {
    let parsed
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.topic !== 'string') return
    const payload = parsed.id !== undefined ? { topic: parsed.topic, id: parsed.id } : { topic: parsed.topic }
    for (const listener of [...listeners]) {
      listener({ ...payload })
    }
  }

  function reopenStream() {
    timer = null
    if (listeners.size === 0) return
    ensureStream()
  }

  function ensureStream() {
    if (source || timer !== null || typeof EventSourceImpl !== 'function') return
    const current = new EventSourceImpl(`${base}/events`)
    source = current
    current.addEventListener('change', handleChange)
    current.addEventListener('open', () => {
      if (source !== current) return
      delay = STREAM_START
    })
    current.addEventListener('error', () => {
      if (source !== current || current.readyState !== 2) return
      source = null
      if (listeners.size === 0 || timer !== null) return
      timer = setTimer(reopenStream, delay)
      delay = Math.min(delay * 2, STREAM_LIMIT)
    })
  }

  function closeStreamIfIdle() {
    if (listeners.size > 0) return
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (!source) return
    const current = source
    source = null
    try {
      current.close()
    } catch {}
  }

  return {
    agents: () => request('GET', '/api/control/agents'),

    issues: ({ status } = {}) => {
      const query = status ? `?status=${encodeURIComponent(status)}` : ''
      return request('GET', `/api/control/issues${query}`)
    },

    createIssue: (draft) => request('POST', '/api/control/issues', draft ?? {}),

    comments: (issueId) => request('GET', `/api/control/comments?issueId=${encodeURIComponent(issueId ?? '')}`),

    postComment: (issueId, body) => request('POST', '/api/control/comments', { issueId, body }),

    approvals: () => request('GET', '/api/control/approvals'),

    decideApproval: (id, decision, note) =>
      request(
        'POST',
        `/api/control/approvals/${encodeURIComponent(id ?? '')}/decide`,
        note !== undefined ? { decision, note } : { decision }
      ),

    costs: () => request('GET', '/api/control/costs'),

    setAgentBudget: (agentId, budgetMonthlyCents) =>
      request('POST', `/api/control/agents/${encodeURIComponent(agentId ?? '')}/budget`, { budgetMonthlyCents }),

    hireAgent: (draft) => request('POST', '/api/control/agents', draft ?? {}),

    updateAgent: (agentId, patch) => request('PATCH', `/api/control/agents/${encodeURIComponent(agentId ?? '')}`, patch ?? {}),

    models: () => request('GET', '/api/control/models'),

    suggestRoute: (profile, { failures } = {}) =>
      request('POST', '/api/control/route', failures === undefined ? { profile } : { profile, failures }),

    briefs: async () => {
      const data = await request('GET', '/api/control/briefs')
      return Array.isArray(data) ? data : data?.briefs ?? []
    },

    briefPrompt: (ids, lane) => {
      const list = Array.isArray(ids) ? ids.map((id) => encodeURIComponent(id ?? '')).join(',') : encodeURIComponent(ids ?? '')
      return request('GET', `/api/control/brief-prompt?ids=${list}&lane=${encodeURIComponent(lane ?? '')}`)
    },

    runs: () => request('GET', '/api/control/runs'),

    runStats: ({ since } = {}) => {
      const query = since ? `?since=${encodeURIComponent(since)}` : ''
      return request('GET', `/api/control/runs/stats${query}`)
    },

    outcomes: async () => {
      const data = await request('GET', '/api/control/runs/outcomes')
      return Array.isArray(data) ? data : data?.rows ?? []
    },

    startRun: (lane, briefs) => request('POST', '/api/control/runs', { lane, briefs, confirmed: true }),

    reviews: async () => {
      const data = await request('GET', '/api/control/reviews')
      return Array.isArray(data) ? data : data?.lanes ?? []
    },

    reviewDiff: (lane) => request('GET', `/api/control/reviews/${encodeURIComponent(lane ?? '')}/diff`),

    mergeReview: (lane, { head, message } = {}) =>
      request('POST', `/api/control/reviews/${encodeURIComponent(lane ?? '')}/merge`, { confirmed: true, head, message }),

    askPlanner: (goal) => request('POST', '/api/control/plans', { goal, confirmed: true }),

    plan: (issueId) => request('GET', `/api/control/plans/${encodeURIComponent(issueId ?? '')}`),

    acceptPlan: (issueId, ids) =>
      request('POST', `/api/control/plans/${encodeURIComponent(issueId ?? '')}/accept`, { ids, confirmed: true }),

    decide: ({ state, questions, model } = {}) =>
      request('POST', '/api/decide', model === undefined ? { state, questions } : { state, questions, model }),

    backupStatus: () => request('GET', '/api/backup'),

    backupNow: () => request('POST', '/api/backup', { confirmed: true }),

    subscribe(listener) {
      listeners.add(listener)
      ensureStream()
      return () => {
        listeners.delete(listener)
        closeStreamIfIdle()
      }
    },
  }
}
