export const BRANCH_LIST_LIMIT = 200
export const BRANCH_EMPTY_PROBLEM = 'Write a name for the new branch.'
export const BRANCH_LONG_PROBLEM = 'Keep the branch name to 200 characters.'
export const BRANCH_NAME_PROBLEM = 'That is not a valid branch name.'
export const BRANCH_EXISTS_PROBLEM = 'That branch already exists.'
export const BRANCH_FROM_PROBLEM = 'Choose the branch to start from.'
export const DIRTY_REASON = 'Commit or stash the uncommitted changes first.'
export const WORKTREE_REASON = 'Another worktree holds this branch.'

const BAD_BRANCH_CHARS = /[\u0000-\u0020\u007f~^:?*\[\\]/

export function isGitState(value) {
  return Boolean(value && typeof value === 'object' && value.git === true)
}

export function shortSha(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 7 ? text.slice(0, 7) : text
}

export function repositoryHead(state) {
  if (!isGitState(state)) return ''
  const branch = typeof state.branch === 'string' ? state.branch.trim() : ''
  if (state.detached !== true && branch !== '') return branch
  return `Detached at ${shortSha(state.head) || 'HEAD'}`
}

export function repositoryProjectName(project) {
  const text = typeof project === 'string' ? project : ''
  const parts = text.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : 'Project'
}

function countOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.floor(number)
}

export function switchBlockReason(state, branch) {
  if (!isGitState(state)) return ''
  if (state.dirty === true) return DIRTY_REASON
  if (branch?.worktree === true) return WORKTREE_REASON
  return ''
}

export function branchRows(state) {
  if (!isGitState(state)) return []
  const seen = new Set()
  const rows = []
  for (const entry of Array.isArray(state.branches) ? state.branches : []) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    const current =
      state.detached !== true &&
      (entry.current === true ||
        (typeof state.branch === 'string' && state.branch === name))
    const worktree = entry.worktree === true
    const reason = current ? '' : switchBlockReason(state, { worktree })
    rows.push({
      name,
      current,
      worktree,
      ahead: countOrNull(entry.ahead),
      behind: countOrNull(entry.behind),
      reason,
      switchable: !current && reason === '',
    })
  }
  return rows
}

export function visibleBranches(rows, query, limit = BRANCH_LIST_LIMIT) {
  const list = Array.isArray(rows) ? rows : []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : BRANCH_LIST_LIMIT
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const matching =
    text === ''
      ? list.slice()
      : list.filter((row) => String(row?.name ?? '').toLowerCase().includes(text))
  const currentIndex = matching.findIndex((row) => row?.current === true)
  const ordered =
    currentIndex > 0
      ? [matching[currentIndex], ...matching.slice(0, currentIndex), ...matching.slice(currentIndex + 1)]
      : matching
  const shown = ordered.slice(0, cap)
  const line =
    text !== '' || shown.length < list.length
      ? `Showing ${shown.length} of ${list.length} branches.`
      : ''
  return { rows: shown, total: list.length, shown: shown.length, line }
}

export function validBranchName(value) {
  const name = typeof value === 'string' ? value : ''
  if (name === '' || name === '@') return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.endsWith('.') || name.includes('..') || name.includes('@{') || name.includes('//')) return false
  if (BAD_BRANCH_CHARS.test(name)) return false
  return !name.split('/').some((part) => part === '' || part.endsWith('.lock'))
}

export function newBranchProblem(name, state) {
  const text = typeof name === 'string' ? name.trim() : ''
  if (text === '') return BRANCH_EMPTY_PROBLEM
  if (text.length > 200) return BRANCH_LONG_PROBLEM
  if (!validBranchName(text)) return BRANCH_NAME_PROBLEM
  if (branchRows(state).some((row) => row.name === text)) return BRANCH_EXISTS_PROBLEM
  return ''
}

export function branchFromProblem(from, state) {
  const name = typeof from === 'string' ? from.trim() : ''
  if (name === '' || !branchRows(state).some((row) => row.name === name)) return BRANCH_FROM_PROBLEM
  return ''
}

export function defaultBranchFrom(state) {
  if (!isGitState(state)) return ''
  const current = typeof state.branch === 'string' ? state.branch.trim() : ''
  const rows = branchRows(state)
  if (state.detached !== true && current !== '' && rows.some((row) => row.name === current)) {
    return current
  }
  return rows[0]?.name ?? ''
}

export function switchConfirmText(project, branch) {
  return `Switch ${repositoryProjectName(project)} to ${branch}? New lanes start from it and reviews compare against it.`
}

export function createConfirmText(name, from) {
  return `Create ${name} from ${from}? The new branch is made without switching to it.`
}
