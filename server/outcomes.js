const MODEL_UNKNOWN = 'model unknown'

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
  return { lane, model, runs: 0, merged: 0, rejected: 0, pending: 0, fixes: [], cost: 0 }
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
    mergeRate: decided === 0 ? null : row.merged / decided,
    averageFixes: row.fixes.length === 0 ? null : row.fixes.reduce((sum, value) => sum + value, 0) / row.fixes.length,
    costUsd: row.cost,
    costPerMerge: row.merged === 0 ? null : row.cost / row.merged,
  }
}

export function outcomeTable(runs, outcomes) {
  const latest = newestOutcomes(outcomes)
  const rows = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) continue
    if (typeof run.lane !== 'string' || run.lane.trim() === '') continue
    const lane = run.lane.trim()
    const model = typeof run.model === 'string' && run.model.trim() !== '' ? run.model.trim() : MODEL_UNKNOWN
    const key = `${lane}\u0000${model}`
    let row = rows.get(key)
    if (!row) {
      row = emptyRow(lane, model)
      rows.set(key, row)
    }
    row.runs += 1
    if (typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)) row.cost += run.costUsd
    const branch = typeof run.branch === 'string' ? run.branch.trim() : ''
    const outcome = branch ? latest.get(branch) : null
    if (outcome?.outcome === 'merged') {
      row.merged += 1
      if (typeof outcome.fixes === 'number' && Number.isFinite(outcome.fixes)) row.fixes.push(outcome.fixes)
    } else if (outcome?.outcome === 'rejected') {
      row.rejected += 1
    } else {
      row.pending += 1
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
