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

    searchProvider: () => request('GET', '/api/search-provider'),

    setSearchProvider: ({ provider, url, keyName, confirmed = true } = {}) =>
      request('POST', '/api/search-provider', { provider, url, keyName, confirmed }),

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
      let mode
      let value
      let rules
      let percent
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        on = idOrOptions.on
        mode = idOrOptions.mode
        value = idOrOptions.value
        rules = idOrOptions.rules
        percent = idOrOptions.percent
      } else {
        id = idOrOptions
        if (typeof onArg === 'object' && onArg !== null) {
          on = onArg.on
          mode = onArg.mode
          value = onArg.value
          rules = onArg.rules
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
      if (mode !== undefined) body.mode = mode
      if (value !== undefined) body.value = value
      if (rules !== undefined) body.rules = rules
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

    setOrchestratorHarness: (idOrOptions, harnessArg, modelArg, options = {}) => {
      let id
      let harness
      let model
      let confirmed = true
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        harness = idOrOptions.harness
        model = idOrOptions.model
        if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
      } else {
        id = idOrOptions
        harness = harnessArg
        model = modelArg
        if (options.confirmed !== undefined) confirmed = options.confirmed
      }
      const body = { harness, model, confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      return request('POST', '/api/orchestrator/harness', body)
    },

    setOrchestratorEffort: (idOrOptions, effortArg, options = {}) => {
      let id
      let effort
      let confirmed = true
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        effort = idOrOptions.effort
        if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
      } else {
        id = idOrOptions
        effort = effortArg
        if (options.confirmed !== undefined) confirmed = options.confirmed
      }
      const body = { effort, confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      return request('POST', '/api/orchestrator/effort', body)
    },

    orchestratorSessions: ({ id } = {}) => {
      const query = id !== undefined && id !== null && id !== '' ? `?id=${encodeURIComponent(id)}` : ''
      return request('GET', `/api/orchestrator/sessions${query}`)
    },

    orchestratorSession: (idOrOptions, sessionArg) => {
      let id
      let session
      if (typeof idOrOptions === 'object' && idOrOptions !== null) {
        id = idOrOptions.id
        session = idOrOptions.session
      } else {
        session = idOrOptions
        id = sessionArg?.id ?? sessionArg
      }
      const query = id !== undefined && id !== null && id !== '' ? `?id=${encodeURIComponent(id)}` : ''
      return request('GET', `/api/orchestrator/sessions/${encodeURIComponent(session ?? '')}${query}`)
    },

    newOrchestratorSession: ({ id, confirmed = true } = {}) => {
      const body = { confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      return request('POST', '/api/orchestrator/sessions/new', body)
    },

    updateOrchestratorSession: ({ id, session, pinned, starred, title, confirmed = true } = {}) => {
      const body = { confirmed }
      if (pinned !== undefined) body.pinned = pinned
      if (starred !== undefined) body.starred = starred
      if (title !== undefined) body.title = title
      if (id !== undefined && id !== null && id !== '') body.id = id
      const query = id !== undefined && id !== null && id !== '' ? `?id=${encodeURIComponent(id)}` : ''
      return request('POST', `/api/orchestrator/sessions/${encodeURIComponent(session ?? '')}${query}`, body)
    },

    openOrchestratorSession: ({ id, session, confirmed = true } = {}) => {
      const body = { confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      const query = id !== undefined && id !== null && id !== '' ? `?id=${encodeURIComponent(id)}` : ''
      return request('POST', `/api/orchestrator/sessions/${encodeURIComponent(session ?? '')}/open${query}`, body)
    },

    deleteOrchestratorSession: ({ id, session, confirmed = true } = {}) => {
      const body = { confirmed }
      if (id !== undefined && id !== null && id !== '') body.id = id
      const query = id !== undefined && id !== null && id !== '' ? `?id=${encodeURIComponent(id)}` : ''
      return request('POST', `/api/orchestrator/sessions/${encodeURIComponent(session ?? '')}/delete${query}`, body)
    },

    setLadder: (ladder) => request('POST', '/api/orchestrator/ladder', { ladder, by: 'owner', confirmed: true }),

    startRun: (lane, run) => {
      const body = Array.isArray(run) ? { briefs: run } : { ...(run ?? {}) }
      return request('POST', '/api/control/runs', { lane, ...body, confirmed: true })
    },

    lanes: () => request('GET', '/api/lanes'),

    harnesses: () => request('GET', '/api/harnesses'),

    harnessModels: (harnessOrOptions = {}, refreshOption = false) => {
      let harness = ''
      let refresh = false
      if (typeof harnessOrOptions === 'string') {
        harness = harnessOrOptions
        refresh = Boolean(refreshOption)
      } else if (harnessOrOptions && typeof harnessOrOptions === 'object') {
        harness = typeof harnessOrOptions.harness === 'string' ? harnessOrOptions.harness : ''
        refresh = Boolean(harnessOrOptions.refresh)
      }
      const query = refresh ? '?refresh=1' : ''
      return request('GET', `/api/harnesses/${encodeURIComponent(harness)}/models${query}`)
    },

    providers: () => request('GET', '/api/providers'),

    endpoints: async () => {
      const data = await request('GET', '/api/endpoints')
      return Array.isArray(data) ? data : data?.endpoints ?? []
    },

    saveEndpoint: (draft) => request('POST', '/api/endpoints', draft ?? {}),

    deleteEndpoint: ({ name, confirmed = true } = {}) =>
      request('POST', `/api/endpoints/${encodeURIComponent(name ?? '')}/delete`, { confirmed }),

    endpointModels: async (name) => {
      const data = await request('GET', `/api/endpoints/${encodeURIComponent(name ?? '')}/models`)
      return Array.isArray(data) ? data : data?.models ?? []
    },

    createLane: ({ name, harness, model, effort, confirmed = true } = {}) =>
      request('POST', '/api/lanes/create', { name, harness, model, effort, confirmed }),

    updateLane: ({ key, name, model, effort, confirmed = true } = {}) => {
      const body = { confirmed }
      if (name !== undefined) body.name = name
      if (model !== undefined) body.model = model
      if (effort !== undefined) body.effort = effort
      return request('POST', `/api/lanes/${encodeURIComponent(key ?? '')}/update`, body)
    },

    deleteLane: ({ key, confirmed = true } = {}) =>
      request('POST', `/api/lanes/${encodeURIComponent(key ?? '')}/delete`, { confirmed }),

    setActiveLanes: (optionsOrLanes, maybeConfirmed) => {
      let lanes
      let confirmed = true
      if (Array.isArray(optionsOrLanes)) {
        lanes = optionsOrLanes
        if (typeof maybeConfirmed === 'boolean') confirmed = maybeConfirmed
        else if (maybeConfirmed && typeof maybeConfirmed === 'object' && maybeConfirmed.confirmed !== undefined) {
          confirmed = maybeConfirmed.confirmed
        }
      } else if (optionsOrLanes && typeof optionsOrLanes === 'object') {
        lanes = optionsOrLanes.lanes
        if (optionsOrLanes.confirmed !== undefined) confirmed = optionsOrLanes.confirmed
      }
      return request('POST', '/api/lanes/active', { lanes, confirmed })
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

    decide: ({ state, questions, model, confirmed = true } = {}) =>
      request(
        'POST',
        '/api/decide',
        model === undefined ? { state, questions, confirmed } : { state, questions, model, confirmed },
        REQUEST_LIMITS.decide
      ),

    backupStatus: () => request('GET', '/api/backup'),

    backupNow: () => request('POST', '/api/backup', { confirmed: true }, REQUEST_LIMITS.backupNow),

    projects: () => request('GET', '/api/projects'),

    openProject: (pathOrOptions, options = {}) => {
      let path
      let confirmed = true
      if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
        path = pathOrOptions.path
        if (pathOrOptions.confirmed !== undefined) confirmed = pathOrOptions.confirmed
      } else {
        path = pathOrOptions
        if (options.confirmed !== undefined) confirmed = options.confirmed
      }
      return request('POST', '/api/projects/open', { path, confirmed })
    },

    forgetProject: (pathOrOptions, options = {}) => {
      let path
      let confirmed = true
      if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
        path = pathOrOptions.path
        if (pathOrOptions.confirmed !== undefined) confirmed = pathOrOptions.confirmed
      } else {
        path = pathOrOptions
        if (options.confirmed !== undefined) confirmed = options.confirmed
      }
      return request('POST', '/api/projects/forget', { path, confirmed })
    },

    family: () => request('GET', '/api/family'),

    setAgentLabel: ({ id, label, confirmed = true } = {}) =>
      request('POST', '/api/family/label', { id, label, confirmed }),

    keys: async () => {
      const data = await request('GET', '/api/keys')
      return Array.isArray(data) ? data : data?.keys ?? []
    },

    setKey: ({ name, value, confirmed = true } = {}) =>
      request('POST', '/api/keys', { name, value, confirmed }),

    deleteKey: ({ name, confirmed = true } = {}) =>
      request('POST', `/api/keys/${encodeURIComponent(name ?? '')}/delete`, { confirmed }),

    approveProposal: ({ id, confirmed = true } = {}) =>
      request('POST', `/api/family/proposals/${encodeURIComponent(id ?? '')}/approve`, { confirmed }),

    declineProposal: ({ id, confirmed = true } = {}) =>
      request('POST', `/api/family/proposals/${encodeURIComponent(id ?? '')}/decline`, { confirmed }),

    mcpServers: () => request('GET', '/api/mcp/servers'),

    saveMcpServer: ({
      name,
      transport = 'stdio',
      command = '',
      args = [],
      env = {},
      url = '',
      enabled = true,
      confirmed = false,
    } = {}) => request('POST', '/api/mcp/servers', { name, transport, command, args, env, url, enabled, confirmed }),

    deleteMcpServer: ({ name, confirmed = false } = {}) =>
      request('POST', `/api/mcp/servers/${encodeURIComponent(name ?? '')}/delete`, { confirmed }),

    mcpTools: () => request('GET', '/api/mcp/tools'),

    callMcpTool: ({ server, tool, arguments: toolArgs = {}, confirmed = true } = {}) =>
      request('POST', '/api/mcp/call', { server, tool, arguments: toolArgs, confirmed }),

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
