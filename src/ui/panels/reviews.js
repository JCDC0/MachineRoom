export const MOVED_BRANCH_ERROR = 'The branch moved since you read the diff. Open it again.'

export function normalizeChecks(checks) {
  if (checks === 'passed' || checks === 'failed') return checks
  return 'unchecked'
}

export function formatChecks(checks) {
  const state = normalizeChecks(checks)
  if (state === 'passed') return 'checks passed'
  if (state === 'failed') return 'checks failed'
  return 'unchecked'
}

export function formatChecksNotice(checks) {
  const state = normalizeChecks(checks)
  if (state === 'passed') return 'Checks passed for this head.'
  if (state === 'failed') return 'Checks failed for this head.'
  return 'Warning: checks are unchecked for this head.'
}

export function canMerge(review) {
  if (!review || typeof review !== 'object' || review.error) return false
  if (review.dirty) return false
  return typeof review.ahead === 'number' && Number.isFinite(review.ahead) && review.ahead > 0
}

export function isBehindDestination(review) {
  if (!review || typeof review !== 'object' || review.error) return false
  const { ahead, behind } = review
  return Number.isInteger(ahead) && ahead > 0 && Number.isInteger(behind) && behind > 0
}

export function canAskMain(client) {
  return Boolean(
    client &&
      typeof client.sendOrchestrator === 'function' &&
      typeof client.orchestrator === 'function'
  )
}

export function isFastForwardRefusal(error) {
  return typeof error === 'string' && /not a fast forward of/i.test(error)
}

export function mergeHead(row, diff) {
  const rowHead = typeof row?.head === 'string' ? row.head : ''
  if (!diff || typeof diff !== 'object') return { head: rowHead }
  const diffLane = typeof diff.lane === 'string' ? diff.lane : ''
  const rowLane = typeof row?.lane === 'string' ? row.lane : ''
  if (!diffLane || diffLane !== rowLane) return { head: rowHead }
  const diffHead = typeof diff.head === 'string' ? diff.head : ''
  if (!diffHead) return { head: rowHead }
  if (diffHead !== rowHead) return { error: MOVED_BRANCH_ERROR }
  return { head: diffHead }
}

export function defaultMergeMessage(review) {
  if (!review || typeof review !== 'object') return ''
  const lane = typeof review.lane === 'string' ? review.lane.trim() : ''
  const branch = typeof review.branch === 'string' ? review.branch.trim() : ''
  if (!lane) return ''
  if (!branch) return `Merge ${lane}`
  return `Merge ${lane}'s ${branch}`
}

export function prepareMergeMessage(review) {
  if (!review || typeof review !== 'object') return ''
  const lane = typeof review.lane === 'string' ? review.lane.trim() : ''
  const head = typeof review.head === 'string' ? review.head.trim() : ''
  if (!lane || !head) return ''
  const branch =
    typeof review.branch === 'string' && review.branch.trim() ? review.branch.trim() : '(detached)'
  const destination =
    typeof review.base === 'string' && review.base.trim() ? review.base.trim() : 'main'
  return [
    'Prepare a lane for merge. The owner confirmed this in Merge.',
    '',
    `Lane: ${lane}`,
    `Branch: ${branch}`,
    `Head: ${head}`,
    `Destination: ${destination}`,
    '',
    `In the lane's worktree, rebase or merge the branch onto ${destination}. Run the project's checks. Report what you did and the result.`,
    `Do not merge into ${destination}. Do not discard work.`,
  ].join('\n')
}

function formatRunCost(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) {
    return 'cost unknown'
  }
  return `$${costUsd.toFixed(2)}`
}

export function formatLastRun(lastRun) {
  if (!lastRun || typeof lastRun !== 'object') {
    return 'no run yet'
  }
  const minutes = Number.isFinite(lastRun.minutes) ? `${lastRun.minutes} min` : '0 min'
  const cost = formatRunCost(lastRun.costUsd)
  const exit = lastRun.exitCode != null ? `exit ${lastRun.exitCode}` : 'exit unknown'
  return `${minutes}, ${cost}, ${exit}`
}

export const CLAIMS_PREVIEW_LINES = 3

export function formatEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null
  const staleNote = evidence.stale === true ? ' (an older head was checked)' : ''
  const checkedHead =
    typeof evidence.checkedHead === 'string' ? evidence.checkedHead.trim() : ''
  if (checkedHead === '') {
    return `Not checked on this head${staleNote}`
  }
  const checks = Array.isArray(evidence.checks) ? evidence.checks : []
  const result = checks.length > 0 ? checks[0]?.result : null
  if (result !== 'passed' && result !== 'failed') return null
  return `Checked on ${checkedHead.slice(0, 7)}: ${result}${staleNote}`
}

export function formatClaims(claims) {
  if (typeof claims !== 'string') return []
  const text = claims.trim()
  if (text === '') return []
  return text.split(/\r?\n/)
}

function formatRunMinutes(minutes) {
  return Number.isFinite(minutes) ? `${minutes}` : '?'
}

function formatRunOne(run) {
  const lane = typeof run?.lane === 'string' && run.lane.trim() !== '' ? run.lane.trim() : '?'
  const model =
    typeof run?.model === 'string' && run.model.trim() !== '' ? run.model.trim() : '?'
  return `${lane} (${model}), ${formatRunMinutes(run?.minutes)} min`
}

export function formatRuns(runs) {
  if (!Array.isArray(runs) || runs.length < 2) return null
  return runs.map(formatRunOne).join(' then ')
}

function sumKnownRuns(runs, field) {
  let total = 0
  let known = 0
  for (const run of runs) {
    if (typeof run?.[field] !== 'number' || !Number.isFinite(run[field])) continue
    total += run[field]
    known += 1
  }
  if (known === 0) return { total: null, known }
  return { total: Math.round(total * 1e6) / 1e6, known }
}

export function formatRunTotals(runs, runTotals) {
  if (!Array.isArray(runs) || runs.length < 2) return null
  let totals = runTotals && typeof runTotals === 'object' ? runTotals : null
  if (!totals) {
    const minutes = sumKnownRuns(runs, 'minutes')
    const cost = sumKnownRuns(runs, 'costUsd')
    totals = {
      runs: runs.length,
      runMinutes: minutes.total,
      costUsd: cost.total,
      partial: minutes.known < runs.length || cost.known < runs.length,
    }
  }
  const count = Number.isFinite(totals.runs) ? totals.runs : runs.length
  const minutes = formatRunMinutes(totals.runMinutes)
  const cost = Number.isFinite(totals.costUsd) ? `$${totals.costUsd.toFixed(2)}` : '?'
  const partial = totals.partial === true ? ' (some runs did not report)' : ''
  return `${count} runs, ${minutes} run minutes, ${cost}${partial}`
}

export function formatScope(review) {
  const groups = review?.fileGroups && typeof review.fileGroups === 'object' ? review.fileGroups : {}
  const counts = Object.entries(groups)
    .filter(([, group]) => group?.count > 0)
    .map(([name, group]) => `${name} ${group.count}`)
    .join(', ')
  const outside = Array.isArray(review?.outsideBrief) ? review.outsideBrief : null
  const lines = review?.added + review?.deleted
  return {
    groupsText: counts || null,
    outsidePaths: outside ?? [],
    outsideText: outside === null ? 'Scope unknown' : outside.length > 0 ? `${outside.length} ${outside.length === 1 ? 'file' : 'files'} outside the brief` : null,
    largeText: review?.largeDiff === true ? `Large change: ${Number.isFinite(lines) ? lines : 0} lines` : null,
  }
}

export function reviewRow(review) {
  if (!review || typeof review !== 'object') {
    return {
      lane: '',
      branch: '',
      head: '',
      headShort: '',
      base: '',
      baseHead: '',
      strategy: 'merge-commit',
      ahead: 0,
      aheadText: '0 commits ahead',
      files: 0,
      added: 0,
      deleted: 0,
      filesText: '0 files +0 -0',
      diffCountsText: '+0 -0',
      dirty: false,
      dirtyText: null,
      checks: 'unchecked',
      checksText: formatChecks('unchecked'),
      evidenceText: null,
      scope: formatScope(null),
      claimsLines: [],
      claimsMore: false,
      runsText: null,
      runTotalsText: null,
      lastRunText: 'no run yet',
      error: null,
      canMerge: false,
      behindDestination: false,
    }
  }

  const lane = typeof review.lane === 'string' ? review.lane : ''
  const branch = typeof review.branch === 'string' ? review.branch : ''
  const head = typeof review.head === 'string' ? review.head : ''
  const headShort = head.slice(0, 7)
  const base = typeof review.base === 'string' ? review.base : ''
  const baseHead = typeof review.baseHead === 'string' ? review.baseHead : ''
  const strategy = review.strategy === 'fast-forward' ? 'fast-forward' : 'merge-commit'

  if (review.error) {
    return {
      lane,
      branch,
      head,
      headShort,
      base,
      baseHead,
      strategy,
      ahead: 0,
      aheadText: null,
      files: 0,
      added: 0,
      deleted: 0,
      filesText: null,
      diffCountsText: null,
      dirty: false,
      dirtyText: null,
      checks: null,
      checksText: null,
      evidenceText: null,
      scope: formatScope(null),
      claimsLines: [],
      claimsMore: false,
      runsText: null,
      runTotalsText: null,
      lastRunText: null,
      error: String(review.error),
      canMerge: false,
      behindDestination: false,
    }
  }

  const ahead = typeof review.ahead === 'number' && Number.isFinite(review.ahead) ? review.ahead : 0
  const files = typeof review.files === 'number' && Number.isFinite(review.files) ? review.files : 0
  const added = typeof review.added === 'number' && Number.isFinite(review.added) ? review.added : 0
  const deleted = typeof review.deleted === 'number' && Number.isFinite(review.deleted) ? review.deleted : 0
  const dirty = Boolean(review.dirty)
  const checks = normalizeChecks(review.checks)
  const diffCountsText = `+${added} -${deleted}`
  const filesWord = files === 1 ? 'file' : 'files'
  const claimsLines = formatClaims(review.claims)

  return {
    lane,
    branch,
    head,
    headShort,
    base,
    baseHead,
    strategy,
    ahead,
    aheadText: `${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead`,
    files,
    added,
    deleted,
    filesText: `${files} ${filesWord} ${diffCountsText}`,
    diffCountsText,
    dirty,
    dirtyText: dirty ? 'uncommitted changes' : null,
    checks,
    checksText: formatChecks(checks),
    evidenceText: formatEvidence(review.evidence),
    scope: formatScope(review),
    claimsLines,
    claimsMore: claimsLines.length > CLAIMS_PREVIEW_LINES,
    runsText: formatRuns(review.runs),
    runTotalsText: formatRunTotals(review.runs, review.runTotals),
    lastRunText: formatLastRun(review.lastRun),
    error: null,
    canMerge: canMerge(review),
    behindDestination: isBehindDestination(review),
  }
}

function classifyPatchLine(line) {
  if (line.startsWith('@@')) return 'hunk'
  if (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line === '---' ||
    line === '+++' ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ')
  ) {
    return 'file'
  }
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

export function patchLines(patch) {
  if (typeof patch !== 'string' || patch.length === 0) return []
  const raw = patch.split(/\r?\n/)
  if (raw.length > 0 && raw[raw.length - 1] === '' && /\r?\n$/.test(patch)) {
    raw.pop()
  }
  return raw.map((text) => ({
    kind: classifyPatchLine(text),
    text,
  }))
}
