import { isOrchestratorAgent } from './agentList.js'

function isSubOrchestrator(agent) {
  if (!agent) return false
  if (agent.subOrchestrator === true) return true
  return typeof agent.key === 'string' && agent.key.trim().startsWith('sub-')
}

export function lensStatus(agents, log) {
  const roster = Array.isArray(agents) ? agents : []
  const lanes = roster
    .filter((agent) => (agent?.depth ?? 0) === 0)
    .filter((agent) => !isOrchestratorAgent(agent) && !isSubOrchestrator(agent))
  const working = lanes.filter((agent) => agent?.status === 'working').length
  const total = lanes.length
  const share = total > 0 ? working / total : 0
  const entries = Array.isArray(log) ? log : []
  const last = entries.length > 0 ? entries[entries.length - 1] : null
  const text = last && typeof last.text === 'string' ? last.text.trim() : ''
  const agent = last && typeof last.agent === 'string' ? last.agent.trim() : ''
  const activity = text ? (agent ? `${agent} ${text}` : text) : ''
  const tone = last && typeof last.tone === 'string' ? last.tone : 'normal'
  return { working, total, share, activity, tone }
}
