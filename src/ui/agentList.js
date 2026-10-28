const ACTIVE_STATUSES = new Set(['working', 'queued', 'error', 'done'])
const ORCHESTRATOR = /orchestrat/i

export function isOrchestratorAgent(agent) {
  if (!agent) return false
  if (agent.orchestrator === true || agent.role === 'ceo') return true
  return ORCHESTRATOR.test(String(agent.name ?? '')) || ORCHESTRATOR.test(String(agent.key ?? ''))
}

export function isActiveAgent(agent) {
  return Boolean(agent && ACTIVE_STATUSES.has(agent.status))
}

export function displayName(key, labels) {
  const name = key == null ? '' : String(key)
  if (!name || !labels) return name
  if (labels instanceof Map) {
    const value = labels.get(name)
    return typeof value === 'string' && value ? value : name
  }
  if (typeof labels !== 'object') return name
  if (!Object.hasOwn(labels, name)) return name
  const value = labels[name]
  return typeof value === 'string' && value ? value : name
}

function arrange(agents) {
  const list = Array.isArray(agents) ? agents : []
  const known = new Set(list.map((agent) => agent?.key))
  const children = new Map()
  const roots = []
  for (const agent of list) {
    if (!agent) continue
    if (agent.parent && agent.parent !== agent.key && known.has(agent.parent)) {
      if (!children.has(agent.parent)) children.set(agent.parent, [])
      children.get(agent.parent).push(agent)
    } else {
      roots.push(agent)
    }
  }
  return { children, roots }
}

function flatten(roots, children) {
  const rows = []
  const seen = new Set()
  let number = 0
  function visit(agent, depth) {
    if (!agent || seen.has(agent.key)) return
    seen.add(agent.key)
    if (depth === 0) number += 1
    rows.push({ agent, depth, number: depth === 0 ? number : null })
    for (const child of children.get(agent.key) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return rows
}

export function agentRows(agents) {
  const { children, roots } = arrange(agents)
  return flatten(roots, children)
}

function subtreeActive(agent, children, seen = new Set()) {
  if (!agent || seen.has(agent.key)) return false
  seen.add(agent.key)
  if (isActiveAgent(agent)) return true
  return (children.get(agent.key) ?? []).some((child) => subtreeActive(child, children, seen))
}

export function agentList(agents, idleOpen = false) {
  const { children, roots } = arrange(agents)
  const orchestrators = roots.filter(isOrchestratorAgent)
  const lanes = roots.filter((agent) => !isOrchestratorAgent(agent))
  const active = lanes.filter((agent) => subtreeActive(agent, children))
  const idle = lanes.filter((agent) => !subtreeActive(agent, children))
  const groups = [
    ...orchestrators.map((agent) => ({ agent, group: 'orchestrator', visible: true })),
    ...active.map((agent) => ({ agent, group: 'active', visible: true })),
    ...idle.map((agent) => ({ agent, group: 'idle', visible: Boolean(idleOpen) })),
  ]

  const rows = []
  const seen = new Set()
  let number = 0
  for (const { agent, group, visible } of groups) {
    function visit(current, depth) {
      if (!current || seen.has(current.key)) return
      seen.add(current.key)
      if (depth === 0 && visible) number += 1
      rows.push({ agent: current, depth, number: depth === 0 && visible ? number : null, group, visible })
      for (const child of children.get(current.key) ?? []) visit(child, depth + 1)
    }
    visit(agent, 0)
  }

  return {
    rows,
    idleCount: idle.length,
    idleOpen: Boolean(idleOpen),
    top: rows.filter((row) => row.visible && row.depth === 0).map((row) => row.agent),
  }
}

export function agentForNumber(list, number) {
  const index = Number(number) - 1
  if (!Number.isInteger(index) || index < 0) return null
  return list?.top?.[index] ?? null
}
