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
  const head = typeof review.head === 'string' ? review.head.trim().toLowerCase() : ''
  const baseHead = typeof review.baseHead === 'string' ? review.baseHead.trim().toLowerCase() : ''
  const ahead = review.ahead
  return Boolean(
    head &&
      baseHead &&
      head !== baseHead &&
      typeof ahead === 'number' &&
      Number.isFinite(ahead) &&
      ahead === 0
  )
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
    'Prepare a lane for merge. The owner confirmed this in Reviews.',
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
