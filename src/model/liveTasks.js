import { visibleText } from './paths.js'

function runTime(run) {
  const stamp = run?.startedAt ?? run?.createdAt ?? run?.timestamp ?? run?.time ?? run?.lastOutputAt ?? null
  if (typeof stamp === 'number') return stamp
  if (typeof stamp === 'string') {
    const ms = Date.parse(stamp)
    if (Number.isFinite(ms)) return ms
  }
  return null
}

function isNewer(candidate, current) {
  if (!current) return true
  const candTime = runTime(candidate)
  const currTime = runTime(current)
  if (candTime !== null && currTime !== null) {
    return candTime > currTime
  }
  if (candTime !== null) return true
  if (currTime !== null) return false
  return false
}

export function agentTasks(liveRuns, issues, roster) {
  const map = new Map()
  if (!Array.isArray(liveRuns) || !Array.isArray(issues) || !Array.isArray(roster)) {
    return map
  }

  const issueMap = new Map()
  for (const issue of issues) {
    if (issue && typeof issue === 'object' && issue.id != null) issueMap.set(issue.id, issue)
  }

  const agentMap = new Map()
  for (const agent of roster) {
    if (agent && typeof agent === 'object' && agent.id != null) agentMap.set(agent.id, agent)
  }

  const bestRuns = new Map()

  for (const run of liveRuns) {
    if (!run || typeof run !== 'object' || run.status !== 'running') continue
    const agent = agentMap.get(run.agentId)
    if (!agent || typeof agent.key !== 'string' || !agent.key) continue
    const task = issueMap.get(run.issueId)
    if (!task || typeof task !== 'object') continue
    const rawId =
      (typeof task.identifier === 'string' && task.identifier.trim()) ||
      (typeof task.name === 'string' && task.name.trim()) ||
      (typeof task.title === 'string' && task.title.trim()) ||
      (typeof task.identifier === 'number' ? String(task.identifier) : null)
    if (!rawId) continue

    const existing = bestRuns.get(agent.key)
    if (isNewer(run, existing?.run)) {
      bestRuns.set(agent.key, { run, rawId })
    }
  }

  for (const [key, { rawId }] of bestRuns) {
    const text = visibleText(rawId).slice(0, 16)
    if (text) map.set(key, text)
  }

  return map
}
