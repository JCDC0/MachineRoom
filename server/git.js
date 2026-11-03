import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { gitPath } from './programPath.js'

export const GIT_TIMEOUT_MS = 10000
export const CACHE_TTL_MS = 1000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const MAX_COMMITS = 200
export const MAX_CHANGES = 200

export const ORIGIN_SWITCH_PROBLEM = 'A request to switch branches needs a page Origin.'
export const ORIGIN_BRANCH_PROBLEM = 'A request to create a branch needs a page Origin.'
export const CONFIRM_SWITCH_PROBLEM = 'Confirm switching the branch first.'
export const CONFIRM_BRANCH_PROBLEM = 'Confirm creating the branch first.'
export const BRANCH_NOT_FOUND_PROBLEM = 'That branch does not exist.'
export const CHECKOUT_DIRTY_PROBLEM = 'The checkout has uncommitted changes.'
export const TURN_RUNNING_PROBLEM = 'An orchestrator turn is running.'
export const LANE_RUN_OPEN_PROBLEM = 'A lane run on this project is open.'
export const WORKTREE_HOLDS_BRANCH_PROBLEM = 'Another worktree holds that branch.'
export const BAD_BRANCH_NAME_PROBLEM = 'That branch name is not valid.'
export const BRANCH_TAKEN_PROBLEM = 'That branch already exists.'
export const BAD_FROM_BRANCH_PROBLEM = 'Choose a known branch to branch from.'
export const NOT_GIT_PROBLEM = 'That folder is not a git repository.'
export const STATUS_FAILED_PROBLEM = 'Could not check for uncommitted changes.'
export const WRITE_IN_FLIGHT_PROBLEM = 'Another git change is running.'

function pathKey(p) {
  try {
    let norm = resolve(String(p ?? ''))
    try {
      norm = realpathSync.native(norm)
    } catch {}
    return process.platform === 'win32' ? norm.toLowerCase() : norm
  } catch {
    return ''
  }
}

function samePath(a, b) {
  if (!a || !b) return false
  return pathKey(a) === pathKey(b)
}

export function parseStatus(text) {
  const raw = typeof text === 'string' ? text : ''
  const parts = raw.split('\0')
  const changes = []
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]
    if (!entry || entry.length < 3) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (!path) continue
    const first = code[0]
    const second = code[1]
    const status = code === '??' ? 'U' : second !== ' ' ? second : first
    changes.push({ path, status })
    if (first === 'R' || first === 'C' || second === 'R' || second === 'C') index += 1
  }
  return changes
}

export function defaultGitRunner(cwd, args, { timeout = GIT_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolveGit, rejectGit) => {
    execFile(
      gitPath(),
      args,
      {
        cwd,
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
        env: {
          ...env,
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          error.gitStderr = String(stderr ?? '')
          rejectGit(error)
          return
        }
        resolveGit(String(stdout ?? ''))
      }
    )
  })
}

const cacheByProject = new Map()
const writesInFlight = new Set()

export function resetGitCache() {
  cacheByProject.clear()
  writesInFlight.clear()
}

export function invalidateGitCache(folder) {
  if (folder) cacheByProject.delete(pathKey(folder))
  else cacheByProject.clear()
}

export function beginRepoWrite(folder) {
  const key = pathKey(folder)
  if (!key || writesInFlight.has(key)) return ''
  writesInFlight.add(key)
  return key
}

export function endRepoWrite(key) {
  if (key) writesInFlight.delete(key)
}

export async function isGitCheckout(folder, runner = defaultGitRunner) {
  if (!folder) return false
  let resolved
  try {
    resolved = resolve(folder)
    if (!statSync(resolved).isDirectory()) return false
  } catch {
    return false
  }
  try {
    const inside = await runner(resolved, ['rev-parse', '--is-inside-work-tree'])
    return inside.trim() === 'true'
  } catch {
    return false
  }
}

async function gitTopLevel(folder, runner = defaultGitRunner) {
  try {
    const top = (await runner(folder, ['rev-parse', '--show-toplevel'])).trim()
    return top ? resolve(top) : resolve(folder)
  } catch {
    return resolve(folder)
  }
}

async function otherWorktreeBranches(runner, folder) {
  const held = new Set()
  try {
    const out = await runner(folder, ['worktree', 'list', '--porcelain'])
    for (const block of out.split(/(?:\r?\n){2,}/)) {
      const lines = block.trim().split(/\r?\n/)
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length).trim()
      const branch = lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length).trim()
      if (path && branch && !samePath(path, folder)) held.add(branch)
    }
  } catch {}
  return held
}

export async function computeGitState(projectRoot, runner = defaultGitRunner) {
  if (!projectRoot) return { git: false }
  let resolved
  try {
    resolved = resolve(projectRoot)
    if (!statSync(resolved).isDirectory()) return { git: false }
  } catch {
    return { git: false }
  }

  const isCheckout = await isGitCheckout(resolved, runner)
  if (!isCheckout) return { git: false }

  let branch = null
  let detached = false
  try {
    const current = (await runner(resolved, ['branch', '--show-current'])).trim()
    if (current) {
      branch = current
      detached = false
    } else {
      branch = null
      detached = true
    }
  } catch {
    branch = null
    detached = true
  }

  let head = null
  try {
    head = (await runner(resolved, ['rev-parse', 'HEAD'])).trim() || null
  } catch {
    head = null
  }

  let changes = []
  let changeCount = 0
  try {
    const status = await runner(resolved, ['status', '--porcelain', '-z'])
    const parsed = parseStatus(status)
    changeCount = parsed.length
    changes = parsed.slice(0, MAX_CHANGES)
  } catch {
    changes = []
    changeCount = 0
  }
  const dirty = changeCount > 0

  const topLevel = await gitTopLevel(resolved, runner)
  const heldBranches = await otherWorktreeBranches(runner, topLevel)

  const branches = []
  const branchRefs = new Map()
  try {
    const format = '%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)'
    const refsOut = await runner(resolved, ['for-each-ref', `--format=${format}`, 'refs/heads/'])
    const lines = refsOut.split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      const [refname, objSha, upShort, track] = line.split('\0')
      if (!refname || !refname.startsWith('refs/heads/')) continue
      const name = refname.slice('refs/heads/'.length)
      const sha = (objSha ?? '').trim()
      const upstream = upShort && upShort.trim() ? upShort.trim() : null
      let ahead = null
      let behind = null
      if (upstream !== null) {
        const trackText = track ?? ''
        const aheadMatch = /ahead (\d+)/.exec(trackText)
        const behindMatch = /behind (\d+)/.exec(trackText)
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0
        behind = behindMatch ? Number(behindMatch[1]) : 0
      }
      const isCurrent = !detached && branch === name
      const inOtherWorktree = heldBranches.has(name)
      branches.push({
        name,
        head: sha,
        current: isCurrent,
        worktree: inOtherWorktree,
        upstream,
        ahead,
        behind,
      })
      if (sha) {
        if (!branchRefs.has(sha)) branchRefs.set(sha, [])
        branchRefs.get(sha).push(name)
      }
    }
  } catch {}

  branches.sort((a, b) => a.name.localeCompare(b.name))
  for (const names of branchRefs.values()) {
    names.sort()
  }

  const commits = []
  let truncated = false
  try {
    if (branches.length > 0 || head) {
      const logArgs = [
        'log',
        '--branches',
        ...(head ? ['HEAD'] : []),
        '--topo-order',
        '--format=%x1e%H%x00%P%x00%s%x00%cI',
        '-n',
        String(MAX_COMMITS + 1),
      ]
      const logOut = await runner(resolved, logArgs)
      const records = logOut.split('\x1e').map((r) => r.trim()).filter(Boolean)
      truncated = records.length > MAX_COMMITS
      const kept = records.slice(0, MAX_COMMITS)
      for (const rec of kept) {
        const [cSha, parentsRaw, subject, time] = rec.split('\0')
        const sha = (cSha ?? '').trim()
        const parents = parentsRaw ? parentsRaw.split(' ').map((p) => p.trim()).filter(Boolean) : []
        const refs = branchRefs.get(sha) ?? []
        commits.push({
          sha,
          parents,
          subject: subject ?? '',
          time: time ?? '',
          refs: [...refs],
        })
      }
    }
  } catch {}

  return {
    git: true,
    branch,
    detached,
    head,
    dirty,
    changes,
    changeCount,
    branches,
    commits,
    truncated,
  }
}

export async function readGitState(projectRoot, { runner = defaultGitRunner, force = false, ttlMs = CACHE_TTL_MS } = {}) {
  const key = pathKey(projectRoot)
  const cached = cacheByProject.get(key)
  const now = Date.now()
  if (!force && cached?.state && now - cached.at < ttlMs) {
    return cached.state
  }
  if (!force && cached?.inflight) {
    return cached.inflight
  }
  const inflight = (async () => {
    try {
      const state = await computeGitState(projectRoot, runner)
      const current = cacheByProject.get(key)
      if (current?.inflight === inflight) {
        cacheByProject.set(key, { state, at: Date.now(), inflight: null })
      }
      return state
    } finally {
      const entry = cacheByProject.get(key)
      if (entry?.inflight === inflight) {
        entry.inflight = null
      }
    }
  })()
  cacheByProject.set(key, { ...cached, inflight })
  return inflight
}

export function createGitApi({
  projectRoot,
  sendJson,
  readJsonBody,
  orchestrators = null,
  lanesSource = null,
  notify = null,
  gitRunner = defaultGitRunner,
  ttlMs = CACHE_TTL_MS,
} = {}) {
  const currentRoot = () => (typeof projectRoot === 'function' ? projectRoot() : projectRoot)

  function isTurnRunning() {
    const orchs = typeof orchestrators === 'function' ? orchestrators() : orchestrators
    return Boolean(orchs?.list?.().some((item) => item.state === 'working'))
  }

  // The lane source shows only this project's runs, and a run in its own worktree still starts from this branch.
  function laneRunOpen() {
    const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
    return Boolean(source?.openRuns?.().length)
  }

  async function branchRefExists(folder, branchName) {
    try {
      await gitRunner(folder, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`])
      return true
    } catch {
      return false
    }
  }

  async function branchExistsLoose(folder, branchName) {
    try {
      const refs = await gitRunner(folder, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
      return String(refs)
        .split(/\r?\n/)
        .map((name) => name.trim())
        .some((name) => name !== '' && name.toLowerCase() === branchName.toLowerCase())
    } catch {
      return false
    }
  }

  async function checkRefFormat(folder, branchName) {
    try {
      await gitRunner(folder, ['check-ref-format', '--branch', branchName])
      return true
    } catch {
      return false
    }
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (path !== '/api/git' && path !== '/api/git/switch' && path !== '/api/git/branch') {
      return false
    }

    if (path === '/api/git') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const root = currentRoot()
      const state = await readGitState(root, { runner: gitRunner, ttlMs })
      sendJson(req, res, 200, state)
      return true
    }

    if (path === '/api/git/switch') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const page = Boolean(req.headers.origin)
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_SWITCH_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_SWITCH_PROBLEM })
        return true
      }

      const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
      if (!branch || branch.startsWith('-')) {
        sendJson(req, res, 400, { error: BRANCH_NOT_FOUND_PROBLEM })
        return true
      }

      const root = currentRoot()
      let resolved
      try {
        resolved = resolve(root)
      } catch {
        sendJson(req, res, 400, { error: BRANCH_NOT_FOUND_PROBLEM })
        return true
      }

      const isCheckout = await isGitCheckout(resolved, gitRunner)
      if (!isCheckout) {
        sendJson(req, res, 400, { error: BRANCH_NOT_FOUND_PROBLEM })
        return true
      }

      const exists = await branchRefExists(resolved, branch)
      if (!exists) {
        sendJson(req, res, 400, { error: BRANCH_NOT_FOUND_PROBLEM })
        return true
      }

      const topLevel = await gitTopLevel(resolved, gitRunner)
      const lockKey = beginRepoWrite(topLevel)
      if (!lockKey) {
        sendJson(req, res, 409, { error: WRITE_IN_FLIGHT_PROBLEM })
        return true
      }

      try {
        if (isTurnRunning()) {
          sendJson(req, res, 409, { error: TURN_RUNNING_PROBLEM })
          return true
        }

        if (laneRunOpen()) {
          sendJson(req, res, 409, { error: LANE_RUN_OPEN_PROBLEM })
          return true
        }

        let dirty = false
        try {
          const status = await gitRunner(resolved, ['status', '--porcelain'])
          dirty = status.trim().length > 0
        } catch {
          sendJson(req, res, 409, { error: STATUS_FAILED_PROBLEM })
          return true
        }
        if (dirty) {
          sendJson(req, res, 409, { error: CHECKOUT_DIRTY_PROBLEM })
          return true
        }

        if ((await otherWorktreeBranches(gitRunner, topLevel)).has(branch)) {
          sendJson(req, res, 409, { error: WORKTREE_HOLDS_BRANCH_PROBLEM })
          return true
        }

        try {
          await gitRunner(resolved, ['switch', '--', branch])
        } catch {
          sendJson(req, res, 500, { error: 'The bridge could not switch branches.' })
          return true
        }

        invalidateGitCache(resolved)
        if (topLevel && !samePath(topLevel, resolved)) invalidateGitCache(topLevel)
        const nextState = await readGitState(resolved, { runner: gitRunner, force: true, ttlMs })
        notify?.({ topic: 'git' })
        sendJson(req, res, 200, nextState)
        return true
      } finally {
        endRepoWrite(lockKey)
      }
    }

    if (path === '/api/git/branch') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const page = Boolean(req.headers.origin)
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_BRANCH_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_BRANCH_PROBLEM })
        return true
      }

      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.startsWith('-')) {
        sendJson(req, res, 400, { error: BAD_BRANCH_NAME_PROBLEM })
        return true
      }

      const root = currentRoot()
      let resolved
      try {
        resolved = resolve(root)
      } catch {
        sendJson(req, res, 400, { error: NOT_GIT_PROBLEM })
        return true
      }

      const isCheckout = await isGitCheckout(resolved, gitRunner)
      if (!isCheckout) {
        sendJson(req, res, 400, { error: NOT_GIT_PROBLEM })
        return true
      }

      const validName = await checkRefFormat(resolved, name)
      if (!validName) {
        sendJson(req, res, 400, { error: BAD_BRANCH_NAME_PROBLEM })
        return true
      }

      // A name that differs only by case breaks a checkout on Windows, so it counts as taken everywhere.
      const alreadyTaken = await branchExistsLoose(resolved, name)
      if (alreadyTaken) {
        sendJson(req, res, 400, { error: BRANCH_TAKEN_PROBLEM })
        return true
      }

      const from = typeof body.from === 'string' ? body.from.trim() : ''
      if (!from || from.startsWith('-')) {
        sendJson(req, res, 400, { error: BAD_FROM_BRANCH_PROBLEM })
        return true
      }

      const fromExists = await branchRefExists(resolved, from)
      if (!fromExists) {
        sendJson(req, res, 400, { error: BAD_FROM_BRANCH_PROBLEM })
        return true
      }

      const topLevel = await gitTopLevel(resolved, gitRunner)
      const lockKey = beginRepoWrite(topLevel)
      if (!lockKey) {
        sendJson(req, res, 409, { error: WRITE_IN_FLIGHT_PROBLEM })
        return true
      }

      try {
        try {
          await gitRunner(resolved, ['branch', '--', name, `refs/heads/${from}`])
        } catch {
          sendJson(req, res, 500, { error: 'The bridge could not create that branch.' })
          return true
        }

        invalidateGitCache(resolved)
        if (topLevel && !samePath(topLevel, resolved)) invalidateGitCache(topLevel)
        const nextState = await readGitState(resolved, { runner: gitRunner, force: true, ttlMs })
        notify?.({ topic: 'git' })
        sendJson(req, res, 200, nextState)
        return true
      } finally {
        endRepoWrite(lockKey)
      }
    }

    return false
  }

  return {
    handle,
    invalidateCache: (folder) => invalidateGitCache(folder ?? currentRoot()),
  }
}
