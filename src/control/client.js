export const STREAM_START = 1000
export const STREAM_LIMIT = 15000
export const REQUEST_TIMEOUT_MS = 30000

export const REQUEST_LIMITS = {
  createIssue: 40000,
  postComment: 40000,
  decideApproval: 40000,
  setAgentBudget: 40000,
  hireAgent: 70000,
  updateAgent: 85000,
  askPlanner: 40000,
  reviewDiff: 50000,
  reviews: 210000,
  mergeReview: 140000,
  backupNow: 130000,
  decide: 10000,
}

function timeoutError(timeoutMs) {
  return new Error(`The bridge did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
}

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

  async function request(method, path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    let expired = false
    const timer = setTimer(() => {
      expired = true
      controller.abort()
    }, timeoutMs)
    try {
      let response
      try {
        response = await fetchImpl(`${base}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch {
        if (expired) throw timeoutError(timeoutMs)
        throw new Error('The bridge is not reachable.')
      }
      let json = null
      try {
        json = await response.json()
      } catch {
        if (expired) throw timeoutError(timeoutMs)
        json = null
      }
      if (!response.ok) {
        const message = typeof json?.error === 'string' && json.error.trim() ? json.error : 'The request failed.'
        const error = new Error(message)
        if (Array.isArray(json?.files)) error.files = json.files.filter((file) => typeof file === 'string')
        if (Array.isArray(json?.problems)) error.problems = json.problems.filter((item) => typeof item === 'string')
        throw error
      }
      return json
    } finally {
      clearTimer(timer)
    }
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

    createIssue: (draft) => request('POST', '/api/control/issues', draft ?? {}, REQUEST_LIMITS.createIssue),

    comments: (issueId) => request('GET', `/api/control/comments?issueId=${encodeURIComponent(issueId ?? '')}`),

    postComment: (issueId, body) => request('POST', '/api/control/comments', { issueId, body }, REQUEST_LIMITS.postComment),

    approvals: () => request('GET', '/api/control/approvals'),

    decideApproval: (id, decision, note) =>
      request(
        'POST',
        `/api/control/approvals/${encodeURIComponent(id ?? '')}/decide`,
        note !== undefined ? { decision, note } : { decision },
        REQUEST_LIMITS.decideApproval
      ),

    costs: () => request('GET', '/api/control/costs'),

    setAgentBudget: (agentId, budgetMonthlyCents) =>
      request(
        'POST',
        `/api/control/agents/${encodeURIComponent(agentId ?? '')}/budget`,
        { budgetMonthlyCents },
        REQUEST_LIMITS.setAgentBudget
      ),

    hireAgent: (draft) => request('POST', '/api/control/agents', draft ?? {}, REQUEST_LIMITS.hireAgent),

    updateAgent: (agentId, patch) =>
      request('PATCH', `/api/control/agents/${encodeURIComponent(agentId ?? '')}`, patch ?? {}, REQUEST_LIMITS.updateAgent),

    models: () => request('GET', '/api/control/models'),

    health: () => request('GET', '/api/health'),

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

    liveRuns: async () => {
      const data = await request('GET', '/api/control/live-runs')
      return Array.isArray(data?.runs) ? data.runs : []
    },

    orchestrators: () => request('GET', '/api/orchestrators'),

    orchestrator: (id) =>
      request('GET', id === undefined || id === null || id === '' ? '/api/orchestrator' : `/api/orchestrator?id=${encodeURIComponent(id)}`),

    sendOrchestrator: (text, { id } = {}) => {
      const body = id === undefined || id === null || id === '' ? { text, confirmed: true } : { text, id, confirmed: true }
      return request('POST', '/api/orchestrator/messages', body)
    },

    sendToOrchestrator: (text, { confirmed } = {}) =>
      request('POST', '/api/orchestrator/messages', { text, confirmed }),

    stopOrchestrator: ({ confirmed = true, id } = {}) => {
      const body = id === undefined || id === null || id === '' ? { confirmed } : { confirmed, id }
      return request('POST', '/api/orchestrator/stop', body)
    },

    compactOrchestrator: ({ id, keep, confirmed = true } = {}) => {
      const body = { confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      if (keep !== undefined && keep !== null) body.keep = keep
      return request('POST', '/api/orchestrator/compact', body)
    },

    setAutocompact: (idOrOptions, onArg, percentArg) => {
      let id
      let on
      let percent
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        on = idOrOptions.on
        percent = idOrOptions.percent
      } else {
        id = idOrOptions
        if (typeof onArg === 'object' && onArg !== null) {
          on = onArg.on
          percent = onArg.percent
        } else {
          on = onArg
          percent = percentArg
        }
      }
      const body = {
        id: id === undefined || id === null || id === '' ? 'orchestrator' : id,
      }
      if (on !== undefined) body.on = on
      if (percent !== undefined) body.percent = percent
      body.confirmed = true
      return request('POST', '/api/orchestrator/autocompact', body)
    },

    setOrchestratorModel: (idOrOptions, modelArg, options = {}) => {
      let id
      let model
      let confirmed = true
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        model = idOrOptions.model
        if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
      } else {
        id = idOrOptions
        model = modelArg
        if (options.confirmed !== undefined) confirmed = options.confirmed
      }
      const body = { model, confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      return request('POST', '/api/orchestrator/model', body)
    },

    setLadder: (ladder) => request('POST', '/api/orchestrator/ladder', { ladder, by: 'owner', confirmed: true }),

    startRun: (lane, run) => {
      const body = Array.isArray(run) ? { briefs: run } : { ...(run ?? {}) }
      return request('POST', '/api/control/runs', { lane, ...body, confirmed: true })
    },

    reviews: async () => {
      const data = await request('GET', '/api/control/reviews', undefined, REQUEST_LIMITS.reviews)
      return Array.isArray(data) ? data : data?.lanes ?? []
    },

    reviewDiff: (lane) =>
      request('GET', `/api/control/reviews/${encodeURIComponent(lane ?? '')}/diff`, undefined, REQUEST_LIMITS.reviewDiff),

    mergeReview: (lane, { head, message } = {}) =>
      request(
        'POST',
        `/api/control/reviews/${encodeURIComponent(lane ?? '')}/merge`,
        { confirmed: true, head, message },
        REQUEST_LIMITS.mergeReview
      ),

    askPlanner: (goal) => request('POST', '/api/control/plans', { goal, confirmed: true }, REQUEST_LIMITS.askPlanner),

    plan: (issueId) => request('GET', `/api/control/plans/${encodeURIComponent(issueId ?? '')}`),

    acceptPlan: (issueId, ids, planId) =>
      request('POST', `/api/control/plans/${encodeURIComponent(issueId ?? '')}/accept`, { ids, planId, confirmed: true }),

    decide: ({ state, questions, model } = {}) =>
      request(
        'POST',
        '/api/decide',
        model === undefined ? { state, questions } : { state, questions, model },
        REQUEST_LIMITS.decide
      ),

    backupStatus: () => request('GET', '/api/backup'),

    backupNow: () => request('POST', '/api/backup', { confirmed: true }, REQUEST_LIMITS.backupNow),

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
