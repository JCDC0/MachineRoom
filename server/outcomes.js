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

function mergeEntry(value) {
  if (typeof value === 'string') return { hash: '', committedAt: null, subject: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const subject = typeof value.subject === 'string' ? value.subject : ''
  if (subject.trim() === '') return null
  return {
    hash: typeof value.hash === 'string' ? value.hash : '',
    committedAt: typeof value.committedAt === 'string' ? value.committedAt : null,
    subject,
  }
}

function mergedBySubject(run, merges) {
  const ids = briefIds(run)
  if (ids.length === 0) return null
  for (const merge of merges) {
    const found = MERGE_WORD.exec(merge.subject)
    if (!found) continue
    const tail = merge.subject.slice(found.index + found[0].length)
    for (const id of ids) {
      if (new RegExp(`(^|[^A-Za-z0-9])${escapeText(id)}(?![A-Za-z0-9])`).test(tail)) return merge
    }
  }
  return null
}

function timeOf(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function mergeTime(merge) {
  return merge ? timeOf(merge.committedAt) : null
}

function isRepair(run) {
  return !run.failoverFrom && !run.continues
}

export function mergeCommitsFromLog(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(' ')
      if (parts.length >= 3 && /^[0-9a-f]{7,64}$/i.test(parts[0]) && timeOf(parts[1]) !== null) {
        return { hash: parts[0], committedAt: parts[1], subject: parts.slice(2).join(' ') }
      }
      return { hash: '', committedAt: null, subject: line }
    })
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
  return { lane, model, runs: 0, merged: 0, rejected: 0, pending: 0, ungraded: 0, fixes: [], repairRuns: 0, waits: [], cost: 0, decidedCost: 0, costSeen: false }
}

function medianOf(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function rowOf(row) {
  const decided = row.merged + row.rejected
  const wait = medianOf(row.waits)
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
    repairRuns: row.repairRuns,
    reviewWaitMinutes: wait === null ? null : Math.round(wait * 10) / 10,
    costUsd: row.cost,
    decidedCostUsd: row.decidedCost,
    costPerMerge: row.merged === 0 || !row.costSeen ? null : row.decidedCost / row.merged,
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
  const merges = (Array.isArray(subjects) ? subjects : []).map(mergeEntry).filter(Boolean)
  const newestRun = new Map()
  const branchRuns = new Map()
  list.forEach((run, index) => {
    if (!usable(run) || !branchOf(run)) return
    const branch = branchOf(run)
    newestRun.set(branch, index)
    const group = branchRuns.get(branch)
    if (group) group.push(run)
    else branchRuns.set(branch, [run])
  })
  const settled = new Map()
  for (const [branch, index] of newestRun) {
    const outcome = latest.get(branch)
    const merge = mergedBySubject(list[index], merges)
    if (outcome) {
      const merged = outcome.outcome === 'merged'
      settled.set(branch, {
        merged,
        ungraded: false,
        fixes: outcome.fixes,
        mergedAt: merged ? mergeTime(merge) : null,
      })
    } else if (merge) {
      settled.set(branch, { merged: true, ungraded: true, fixes: null, mergedAt: mergeTime(merge) })
    }
  }
  const branchMetrics = new Map()
  for (const [branch, decision] of settled) {
    if (!decision.merged) continue
    const group = branchRuns.get(branch) ?? []
    const plain = group.filter(isRepair)
    const last = list[newestRun.get(branch)]
    const finished = timeOf(last?.finishedAt)
    const wait = decision.mergedAt !== null && finished !== null ? Math.max(0, (decision.mergedAt - finished) / 60000) : null
    branchMetrics.set(branch, { repairRuns: Math.max(0, plain.length - 1), reviewWaitMinutes: wait })
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
    const reported = typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)
    const cost = reported ? run.costUsd : 0
    row.cost += cost
    const branch = branchOf(run)
    const decision = branch ? settled.get(branch) : null
    if (!decision) {
      row.pending += 1
      continue
    }
    if (newestRun.get(branch) !== index) continue
    row.decidedCost += cost
    if (reported) row.costSeen = true
    if (decision.merged) {
      row.merged += 1
      if (decision.ungraded) row.ungraded += 1
      else if (typeof decision.fixes === 'number' && Number.isFinite(decision.fixes)) row.fixes.push(decision.fixes)
      const metrics = branchMetrics.get(branch)
      if (metrics) {
        row.repairRuns += metrics.repairRuns
        if (metrics.reviewWaitMinutes !== null) row.waits.push(metrics.reviewWaitMinutes)
      }
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
