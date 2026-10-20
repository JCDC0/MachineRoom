export function createClient({ baseUrl = '', fetchImpl = fetch, EventSourceImpl = globalThis.EventSource } = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  const listeners = new Set()
  let source = null

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

  function ensureStream() {
    if (source || typeof EventSourceImpl !== 'function') return
    source = new EventSourceImpl(`${base}/events`)
    source.addEventListener('change', handleChange)
  }

  function closeStreamIfIdle() {
    if (listeners.size > 0 || !source) return
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
