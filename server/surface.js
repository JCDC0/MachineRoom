const APPROVAL_FIELDS = [
  'id',
  'type',
  'status',
  'summary',
  'requestedByAgentId',
  'createdAt',
  'agentId',
  'decisionNote',
  'payload',
  'payload.summary',
  'payload.title',
  'payload.agentId',
  'payload.decisionNote',
  'decision',
  'decision.note',
]

export const PAPERCLIP_SURFACE = [
  {
    method: 'GET',
    path: '/api/companies/{companyId}/events/ws',
    socket: true,
    fields: ['id', 'companyId', 'type', 'createdAt', 'payload', 'payload.chunk', 'payload.runId', 'payload.seq', 'payload.truncated'],
  },
  {
    method: 'GET',
    path: '/api/heartbeat-runs/{runId}/log',
    fields: ['content'],
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}',
    fields: ['requireBoardApprovalForNewAgents'],
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/agents',
    fields: [
      'id',
      'name',
      'key',
      'urlKey',
      'adapterType',
      'adapter_type',
      'role',
      'status',
      'reportsTo',
      'adapterConfig',
      'metadata',
      'budgetMonthlyCents',
      'spentMonthlyCents',
    ],
  },
  {
    method: 'POST',
    path: '/api/companies/{companyId}/agent-hires',
    body: ['name', 'role', 'adapterType', 'adapterConfig', 'metadata', 'budgetMonthlyCents', 'reportsTo', 'instructionsBundle'],
    fields: ['agent', 'approval'],
  },
  {
    method: 'PATCH',
    path: '/api/agents/{id}',
    body: ['name', 'role', 'reportsTo', 'adapterConfig', 'metadata'],
  },
  {
    method: 'PATCH',
    path: '/api/agents/{agentId}/budgets',
    body: ['budgetMonthlyCents'],
  },
  {
    method: 'POST',
    path: '/api/agents/{id}/pause',
  },
  {
    method: 'POST',
    path: '/api/agents/{id}/resume',
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/issues',
    fields: [
      'id',
      'identifier',
      'title',
      'description',
      'status',
      'priority',
      'assigneeAgentId',
      'parentId',
      'assigneeAdapterOverrides',
      'createdAt',
      'updatedAt',
    ],
  },
  {
    method: 'POST',
    path: '/api/companies/{companyId}/issues',
    body: [
      'title',
      'description',
      'assigneeAgentId',
      'priority',
      'status',
      'projectId',
      'projectWorkspaceId',
      'assigneeAdapterOverrides',
    ],
    fields: [
      'id',
      'identifier',
      'title',
      'description',
      'status',
      'priority',
      'assigneeAgentId',
      'parentId',
      'assigneeAdapterOverrides',
      'createdAt',
      'updatedAt',
    ],
  },
  {
    method: 'GET',
    path: '/api/issues/{id}/comments',
    fields: ['id', 'issueId', 'authorAgentId', 'authorName', 'body', 'createdAt'],
  },
  {
    method: 'POST',
    path: '/api/issues/{id}/comments',
    body: ['body'],
    fields: ['id', 'issueId', 'authorAgentId', 'authorName', 'body', 'createdAt'],
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/approvals',
    fields: APPROVAL_FIELDS,
  },
  {
    method: 'GET',
    path: '/api/approvals/{id}',
    fields: APPROVAL_FIELDS,
  },
  {
    method: 'POST',
    path: '/api/approvals/{id}/approve',
    body: ['decisionNote'],
    fields: APPROVAL_FIELDS,
  },
  {
    method: 'POST',
    path: '/api/approvals/{id}/reject',
    body: ['decisionNote'],
    fields: APPROVAL_FIELDS,
  },
  {
    method: 'POST',
    path: '/api/approvals/{id}/request-revision',
    body: ['decisionNote'],
    fields: APPROVAL_FIELDS,
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/costs/summary',
    fields: ['spendCents', 'budgetCents', 'utilizationPercent'],
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/costs/by-agent',
    fields: ['agentId', 'agentName', 'costCents', 'inputTokens', 'outputTokens'],
  },
  {
    method: 'GET',
    path: '/api/companies/{companyId}/costs/quota-windows',
    fields: ['provider', 'ok', 'error', 'windows[].label', 'windows[].usedPercent', 'windows[].resetsAt', 'windows[].detail'],
  },
]

function resolveSchema(spec, schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return null
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null
    const name = schema.$ref.replace(/^#\/components\/schemas\//, '')
    return resolveSchema(spec, spec?.components?.schemas?.[name], new Set([...seen, schema.$ref]))
  }
  if (Array.isArray(schema.allOf)) {
    const merged = { type: 'object', properties: {}, required: [] }
    for (const part of schema.allOf) {
      const inner = resolveSchema(spec, part, seen)
      if (!inner) continue
      Object.assign(merged.properties, inner.properties ?? {})
      merged.required.push(...(inner.required ?? []))
    }
    if (Object.keys(merged.properties).length > 0) return merged
  }
  return schema
}

function typedRoot(spec, schema) {
  let current = resolveSchema(spec, schema)
  if (!current) return null
  if (current.type === 'array' && current.items) current = resolveSchema(spec, current.items)
  if (!current || !current.properties || Object.keys(current.properties).length === 0) return null
  return current
}

function fieldState(spec, schema, field) {
  let current = typedRoot(spec, schema)
  if (!current) return 'untyped'
  const parts = field.split('.')
  for (let index = 0; index < parts.length; index += 1) {
    let part = parts[index]
    let expectsArray = false
    if (part.endsWith('[]')) {
      expectsArray = true
      part = part.slice(0, -2)
    }
    if (!Object.hasOwn(current.properties, part)) {
      if (current.additionalProperties && current.additionalProperties !== false) return 'untyped'
      return 'missing'
    }
    current = resolveSchema(spec, current.properties[part])
    if (!current) return 'untyped'
    if (expectsArray || current.type === 'array') {
      current = resolveSchema(spec, current.items)
      if (!current) return 'untyped'
    }
    if (!current.properties || Object.keys(current.properties).length === 0) {
      return index === parts.length - 1 ? 'found' : 'untyped'
    }
  }
  return 'found'
}

function successSchema(operation) {
  const responses = operation?.responses ?? {}
  for (const code of ['200', '201', '202', '204']) {
    const schema = responses[code]?.content?.['application/json']?.schema
    if (schema) return schema
  }
  for (const [code, response] of Object.entries(responses)) {
    if (/^2\d\d$/.test(code)) {
      const schema = response?.content?.['application/json']?.schema
      if (schema) return schema
    }
  }
  return null
}

export function compareSurface(spec, routes = PAPERCLIP_SURFACE) {
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {}
  const result = {
    ok: true,
    checked: 0,
    missing: [],
    changed: [],
    sockets: [],
    untypedAnswers: 0,
    untypedBodies: 0,
  }
  for (const route of routes) {
    if (route.socket) {
      result.sockets.push({ method: route.method, path: route.path })
      continue
    }
    result.checked += 1
    const item = paths[route.path]
    if (!item || typeof item !== 'object') {
      result.missing.push({ method: route.method, path: route.path, reason: 'route' })
      continue
    }
    const operation = item[route.method.toLowerCase()]
    if (!operation || typeof operation !== 'object') {
      result.missing.push({ method: route.method, path: route.path, reason: 'method' })
      continue
    }
    const changed = { method: route.method, path: route.path, answerFields: [], bodyFields: [] }
    if (Array.isArray(route.fields) && route.fields.length > 0) {
      const schema = successSchema(operation)
      if (!typedRoot(spec, schema)) {
        result.untypedAnswers += 1
      } else {
        for (const field of route.fields) {
          if (fieldState(spec, schema, field) === 'missing') changed.answerFields.push(field)
        }
      }
    }
    if (Array.isArray(route.body) && route.body.length > 0) {
      const schema = operation.requestBody?.content?.['application/json']?.schema
      if (!typedRoot(spec, schema)) {
        result.untypedBodies += 1
      } else {
        for (const field of route.body) {
          if (fieldState(spec, schema, field) === 'missing') changed.bodyFields.push(field)
        }
      }
    }
    if (changed.answerFields.length > 0 || changed.bodyFields.length > 0) result.changed.push(changed)
  }
  result.ok = result.missing.length === 0 && result.changed.length === 0
  return result
}

function fieldList(fields) {
  return fields.map((field) => `\`${field}\``).join(', ')
}

export function describeSurface(result) {
  const lines = []
  for (const item of result.missing) {
    if (item.reason === 'method') {
      lines.push(`${item.method} ${item.path}: the spec does not list this method.`)
    } else {
      lines.push(`${item.method} ${item.path}: the spec does not list this route.`)
    }
  }
  for (const item of result.changed) {
    if (item.bodyFields.length > 0) {
      lines.push(`${item.method} ${item.path}: the spec does not list the request field ${fieldList(item.bodyFields)}.`)
    }
    if (item.answerFields.length > 0) {
      lines.push(`${item.method} ${item.path}: the spec does not list the answer field ${fieldList(item.answerFields)}.`)
    }
  }
  return lines
}
