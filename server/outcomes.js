const MODEL_UNKNOWN = 'model unknown'
const MERGE_WORD = /\bMerge\b/

function escapeText(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function briefIds(run) {
  if (!Array.isArray(run?.briefs)) return []
  return run.briefs
    .filter((id) => typeof id === 'string' && id.trim() !== '')
    .map((id) => id.trim())
}

function mergedBySubject(run, subjects) {
  const ids = briefIds(run)
  if (ids.length === 0) return false
  for (const subject of Array.isArray(subjects) ? subjects : []) {
    if (typeof subject !== 'string') continue
    const found = MERGE_WORD.exec(subject)
    if (!found) continue
    const tail = subject.slice(found.index + found[0].length)
    for (const id of ids) {
      if (new RegExp(`(^|[^A-Za-z0-9])${escapeText(id)}(?![A-Za-z0-9])`).test(tail)) return true
    }
  }
  return false
}

export function subjectsFromLog(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function newestOutcomes(outcomes) {
  const latest = new Map()
  for (const entry of Array.isArray(outcomes) ? outcomes : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const branch = typeof entry.branch === 'string' ? entry.branch.trim() : ''
    if (!branch) continue
    if (entry.outcome !== 'merged' && entry.outcome !== 'rejected') continue
    latest.set(branch, entry)
  }
  return latest
}

function emptyRow(lane, model) {
  return { lane, model, runs: 0, merged: 0, rejected: 0, pending: 0, ungraded: 0, fixes: [], cost: 0, decidedCost: 0 }
}

function rowOf(row) {
  const decided = row.merged + row.rejected
  return {
    lane: row.lane,
    model: row.model,
    runs: row.runs,
    merged: row.merged,
    rejected: row.rejected,
    pending: row.pending,
    ungraded: row.ungraded,
    mergeRate: decided === 0 ? null : row.merged / decided,
    averageFixes: row.fixes.length === 0 ? null : row.fixes.reduce((sum, value) => sum + value, 0) / row.fixes.length,
    costUsd: row.cost,
    decidedCostUsd: row.decidedCost,
    costPerMerge: row.merged === 0 ? null : row.decidedCost / row.merged,
  }
}

function branchOf(run) {
  return typeof run?.branch === 'string' ? run.branch.trim() : ''
}

function usable(run) {
  return Boolean(run) && typeof run === 'object' && !Array.isArray(run) && typeof run.lane === 'string' && run.lane.trim() !== ''
}

export function outcomeTable(runs, outcomes, subjects = []) {
  const latest = newestOutcomes(outcomes)
  const list = Array.isArray(runs) ? runs : []
  const newestRun = new Map()
  list.forEach((run, index) => {
    if (usable(run) && branchOf(run)) newestRun.set(branchOf(run), index)
  })
  const settled = new Map()
  for (const [branch, index] of newestRun) {
    const outcome = latest.get(branch)
    if (outcome) {
      settled.set(branch, { merged: outcome.outcome === 'merged', ungraded: false, fixes: outcome.fixes })
    } else if (mergedBySubject(list[index], subjects)) {
      settled.set(branch, { merged: true, ungraded: true, fixes: null })
    }
  }
  const rows = new Map()
  for (const [index, run] of list.entries()) {
    if (!usable(run)) continue
    const lane = run.lane.trim()
    const model = typeof run.model === 'string' && run.model.trim() !== '' ? run.model.trim() : MODEL_UNKNOWN
    const key = `${lane}\u0000${model}`
    let row = rows.get(key)
    if (!row) {
      row = emptyRow(lane, model)
      rows.set(key, row)
    }
    row.runs += 1
    const cost = typeof run.costUsd === 'number' && Number.isFinite(run.costUsd) ? run.costUsd : 0
    row.cost += cost
    const branch = branchOf(run)
    const decision = branch ? settled.get(branch) : null
    if (!decision) {
      row.pending += 1
      continue
    }
    if (newestRun.get(branch) !== index) continue
    row.decidedCost += cost
    if (decision.merged) {
      row.merged += 1
      if (decision.ungraded) row.ungraded += 1
      else if (typeof decision.fixes === 'number' && Number.isFinite(decision.fixes)) row.fixes.push(decision.fixes)
    } else {
      row.rejected += 1
    }
  }
  return [...rows.values()]
    .sort((left, right) => {
      if (left.lane !== right.lane) return left.lane < right.lane ? -1 : 1
      if (left.model !== right.model) return left.model < right.model ? -1 : 1
      return 0
    })
    .map(rowOf)
}
