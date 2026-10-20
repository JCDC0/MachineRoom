export function areAllTerminalsOpen(agents, openTerminals) {
  if (!Array.isArray(agents) || agents.length === 0) return false
  const openSet = openTerminals instanceof Set
    ? openTerminals
    : new Set(Array.isArray(openTerminals) ? openTerminals : [])
  if (openSet.size === 0) return false
  return agents.every((agent) => Boolean(agent?.key && openSet.has(agent.key)))
}

export function toggleAllTerminalsLabel(agents, openTerminals) {
  return areAllTerminalsOpen(agents, openTerminals) ? 'Hide all' : 'Show all'
}

export function isTerminalOpen(openTerminals, key) {
  if (!key) return false
  if (Array.isArray(openTerminals)) return openTerminals.includes(key)
  if (openTerminals instanceof Set) return openTerminals.has(key)
  return false
}

export function logButtonAriaLabel(agentName, isOpen) {
  const label = agentName || 'agent'
  return isOpen ? `Hide the log of ${label}` : `Show the log of ${label}`
}
