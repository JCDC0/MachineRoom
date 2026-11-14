import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { worktreeFor } from '../src/briefs/run.js'
import { lanesFolder, mainCheckoutOf, readAllLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { gitPath } from './programPath.js'
import {
  beginRepoWrite,
  endRepoWrite,
  GIT_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  invalidateGitCache,
  WRITE_IN_FLIGHT_PROBLEM,
} from './git.js'
import { readAllRunRecords, runsFile } from './runs.js'

const GIT_MAX_BUFFER = 64 * 1024 * 1024
const COMMIT_LIMIT = 50
const MESSAGE_LIMIT = 200
const HEAD_PATTERN = /^[0-9a-fA-F]{40}$/
const MERGE_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
const MAIN_REF = 'refs/heads/main'
const MAIN_BASE = { ref: MAIN_REF, name: 'main' }
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
export const DEFAULT_PATCH_LIMIT = 400 * 1024
export const DEFAULT_REVIEW_CONCURRENCY = 4
export const NOT_OWNER_PROBLEM = 'The caller is not the owner, so the lane was not merged.'
export const MERGE_TIMEOUT_PROBLEM = 'The merge took too long, so it was stopped.'
export const FAILED_CHECKS_PROBLEM = 'Checks failed on this head, so the lane was not merged.'
let codeCheckoutPath = ''

export function resetCodeCheckout() {
  codeCheckoutPath = ''
}

export function codeCheckout() {
  if (!codeCheckoutPath) {
    const found = mainCheckoutOf(REPO_ROOT)
    if (found) codeCheckoutPath = found
    else return REPO_ROOT
  }
  return codeCheckoutPath
}

function pathKey(path) {
  if (!path) return ''
  try {
    const raw = String(path)
    let resolved
    try {
      resolved = realpathSync.native(raw)
    } catch {
      resolved = resolve(raw)
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

function inside(folder, root) {
  if (!folder || !root) return false
  const key = pathKey(folder)
  const base = pathKey(root)
  if (!key || !base) return false
  const sep = process.platform === 'win32' ? '\\' : '/'
  return key === base || key.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

function inGitWorkTree(folder) {
  if (!folder) return false
  let current = pathKey(folder)
  if (!current) return false
  while (true) {
    if (existsSync(join(current, '.git'))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const NO_HOOKS_DIR = join(tmpdir(), `machineroom-no-hooks-${randomBytes(12).toString('hex')}`)

export function emptyHooksDir() {
  return NO_HOOKS_DIR
}

export function defaultGitRunner(worktree, args, { timeout = GIT_TIMEOUT_MS, extraEnv = null } = {}) {
  const env = { ...process.env, ...(extraEnv ?? {}) }
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (upper === 'GIT_DIR' || upper === 'GIT_WORK_TREE' || upper === 'GIT_INDEX_FILE') {
      delete env[key]
    }
  }
  const hooksDir = emptyHooksDir()
  const gitArgs = args[0] === '-c' && typeof args[1] === 'string' && args[1].startsWith('core.hooksPath=')
    ? args
    : ['-c', `core.hooksPath=${hooksDir}`, ...args]
  return new Promise((resolveGit, rejectGit) => {
    execFile(
      gitPath(),
      gitArgs,
      {
        cwd: worktree,
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
        env,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.gitStderr = String(stderr ?? '')
          rejectGit(error)
          return
        }
        resolveGit(String(stdout))
      }
    )
  })
}

function timedOut(error) {
  return error?.killed === true || error?.code === 'ETIMEDOUT'
}

async function checkoutState(runGit, cwd) {
  try {
    const head = (await runGit(cwd, ['rev-parse', 'HEAD'])).trim()
    const status = await runGit(cwd, ['status', '--porcelain', '--untracked-files=no'])
    if (!head) return null
    return { head, clean: status.trim() === '' }
  } catch {
    return null
  }
}

function timeoutProblem(state) {
  if (!state) return `${MERGE_TIMEOUT_PROBLEM} The checkout could not be read.`
  return `${MERGE_TIMEOUT_PROBLEM} The checkout is at ${state.head.slice(0, 12)} and it ${state.clean ? 'is clean' : 'has uncommitted changes'}.`
}

function worktreeError(error) {
  if (error?.code === 'ENOGIT') return 'Git is not on the PATH.'
  if (error?.code === 'ENOENT') return 'That worktree is missing.'
  if (/not a git repository/i.test(String(error?.gitStderr ?? ''))) return 'That folder is not a git repository.'
  return 'The bridge could not read that worktree.'
}

function worktreeUnreadable(error) {
  return error?.code === 'ENOENT' || /not a git repository/i.test(String(error?.gitStderr ?? ''))
}

async function isAncestor(runGit, cwd, ancestor, descendant) {
  try {
    await runGit(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch (error) {
    if (error?.code === 1) return false
    throw error
  }
}

async function conflictedPaths(runGit, cwd) {
  const text = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U'])
  return text.split(/\r?\n/).filter(Boolean)
}

async function mergeInProgress(runGit, cwd) {
  try {
    await runGit(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

async function abortMerge(runGit, cwd) {
  try {
    await runGit(cwd, ['merge', '--abort'], { timeout: GIT_WRITE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

async function checkoutMatches(runGit, cwd, sha) {
  try {
    const head = (await runGit(cwd, ['rev-parse', 'HEAD'])).trim()
    if (head !== sha) return false
    const status = await runGit(cwd, ['status', '--porcelain', '--untracked-files=no'])
    return status.trim() === ''
  } catch {
    return false
  }
}

function parseNumstat(output) {
  const files = []
  let added = 0
  let deleted = 0
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [addText, delText, ...rest] = line.split('\t')
    const fileAdded = /^\d+$/.test(addText) ? Number(addText) : 0
    const fileDeleted = /^\d+$/.test(delText) ? Number(delText) : 0
    added += fileAdded
    deleted += fileDeleted
    files.push({ path: rest.join('\t'), added: fileAdded, deleted: fileDeleted })
  }
  return { files, added, deleted }
}

function laneEntry(lanes, lane) {
  if (typeof lane !== 'string' || !lane) return null
  if (!Object.hasOwn(lanes, lane)) return null
  const info = lanes[lane]
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  return info
}

export async function mapConcurrent(items, limit, fn) {
  if (!Array.isArray(items) || items.length === 0) return []
  const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_REVIEW_CONCURRENCY
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function createReviewsApi({
  projectRoot = '',
  briefsDir = '',
  patchLimit = DEFAULT_PATCH_LIMIT,
  concurrency = DEFAULT_REVIEW_CONCURRENCY,
  sendJson,
  readJsonBody,
  orchestrators,
  readRuns = readAllRunRecords,
  runsFolder = '',
  notify = () => {},
  gitRunner = defaultGitRunner,
}) {
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const limit = Number.isInteger(patchLimit) && patchLimit > 0 ? patchLimit : DEFAULT_PATCH_LIMIT
  const roomCheckout = resolvedRoot ? mainCheckoutOf(resolvedRoot) : ''
  const codeCheckoutHere = roomCheckout ? codeCheckout() : ''
  const projectCheckout = roomCheckout || resolvedRoot
  const codeBase = codeCheckoutHere || REPO_ROOT
  const otherProject = Boolean(
    projectCheckout &&
      inGitWorkTree(projectCheckout) &&
      (roomCheckout && codeCheckoutHere
        ? pathKey(roomCheckout) !== pathKey(codeCheckoutHere)
        : !inside(projectCheckout, codeBase) && !inside(codeBase, projectCheckout))
  )
  const roomLanesDir = lanesFolder()
  const lanesDir =
    briefsDir && (existsSync(join(resolve(briefsDir), 'lanes.json')) || !otherProject)
      ? resolve(briefsDir)
      : roomLanesDir
  const lanesCheckout = mainCheckoutOf(lanesDir)
  const lanesPlain = !inGitWorkTree(lanesDir)
  const sameCheckout =
    pathKey(lanesDir) === pathKey(roomLanesDir)
      ? !otherProject
      : roomCheckout && lanesCheckout
        ? pathKey(roomCheckout) === pathKey(lanesCheckout)
        : inside(lanesDir, projectCheckout) || lanesPlain
  const onProject = Boolean(resolvedRoot && !sameCheckout)
  const runGit = (cwd, args, options = {}) => gitRunner(cwd, args, { timeout: GIT_TIMEOUT_MS, ...options })
  let merging = false

  function ownerRequest(req) {
    const headers = req.headers ?? {}
    if (headers.origin) return true
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    if (!registry || typeof registry.idForToken !== 'function') return false
    const header = headers['x-machineroom-orchestrator']
    const token = typeof header === 'string' ? header.trim() : Array.isArray(header) ? header[0].trim() : ''
    return Boolean(registry.idForToken(token))
  }

  function readLanes() {
    const text = readText(join(lanesDir, 'lanes.json'))
    if (text === null) return { status: 404, error: 'The lane file is missing.' }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { status: 400, error: 'The lane file is not valid.' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 400, error: 'The lane file is not valid.' }
    }
    const lanes = readAllLanes({
      lanesJson: parsed,
      runsFolder: runsFolder ? resolve(runsFolder) : defaultRunsFolder(),
    })
    return { lanes }
  }

  function recordsFile() {
    return runsFolder ? join(resolve(runsFolder), 'runs.jsonl') : runsFile()
  }

  function runMatchesProject(record, worktree) {
    const raw = typeof record?.project === 'string' ? record.project.trim() : ''
    if (raw === '') return !onProject
    const key = pathKey(raw)
    if (!key) return false
    if (worktree && key === pathKey(worktree)) return true
    if (resolvedRoot && key === pathKey(resolvedRoot)) return true
    return false
  }

  function newestRecord(records) {
    if (records.length === 0) return null
    return records.reduce((newest, record) => {
      const time = Number.isFinite(Date.parse(record.startedAt ?? '')) ? Date.parse(record.startedAt) : 0
      const best = Number.isFinite(Date.parse(newest.startedAt ?? '')) ? Date.parse(newest.startedAt) : 0
      return time >= best ? record : newest
    })
  }

  function projectRunsFor(lane, worktree, runs = null) {
    const list = runs ?? readRuns(recordsFile())
    return list.filter((record) => record && record.lane === lane && runMatchesProject(record, worktree))
  }

  function lastRunFor(lane, worktree, runs = null) {
    return newestRecord(projectRunsFor(lane, worktree, runs))
  }

  function checkStateFor(lane, worktree, head, runs = null) {
    const key = typeof head === 'string' ? head.trim().toLowerCase() : ''
    if (!HEAD_PATTERN.test(key)) return 'unchecked'
    const matches = projectRunsFor(lane, worktree, runs).filter(
      (record) =>
        typeof record.head === 'string' &&
        record.head.trim().toLowerCase() === key &&
        (record.tests === 'passed' || record.tests === 'failed')
    )
    const latest = newestRecord(matches)
    if (latest?.tests === 'passed') return 'passed'
    if (latest?.tests === 'failed') return 'failed'
    return 'unchecked'
  }

  function laneFolder(lanes, lane) {
    const info = laneEntry(lanes, lane)
    if (!info) return null
    if (onProject) return worktreeFor(resolvedRoot, lane)
    if (typeof info.worktree === 'string' && info.worktree) return info.worktree
    if (info.custom === true && resolvedRoot) return worktreeFor(resolvedRoot, lane)
    return null
  }

  function destinationMismatch(currentBranch, currentHead, expectedBase, expectedBaseHead) {
    if (currentBranch !== expectedBase) {
      if (!onProject && expectedBase === 'main') {
        return 'The main checkout is not on main.'
      }
      const current = currentBranch || 'no branch'
      return `The project is on ${current} now, not ${expectedBase}, so refresh reviews first.`
    }
    if (currentHead !== expectedBaseHead) {
      return `The ${expectedBase} branch moved since you read it, so refresh reviews first.`
    }
    return ''
  }

  async function projectBase() {
    try {
      const branch = (await runGit(resolvedRoot, ['symbolic-ref', '--short', 'HEAD'])).trim()
      if (!branch) return null
      const head = (await runGit(resolvedRoot, ['rev-parse', `refs/heads/${branch}`])).trim()
      return head ? { ref: `refs/heads/${branch}`, name: branch, head } : null
    } catch {
      return null
    }
  }

  async function mainBase() {
    let head = ''
    if (resolvedRoot && inGitWorkTree(resolvedRoot)) {
      try {
        head = (await runGit(resolvedRoot, ['rev-parse', MAIN_REF])).trim()
      } catch {
        head = ''
      }
    }
    return { ...MAIN_BASE, head }
  }

  async function baseFor() {
    return onProject ? projectBase() : mainBase()
  }

  async function playWorktree() {
    const play = join(resolvedRoot, '.worktrees', 'play')
    if (!resolvedRoot || !existsSync(play)) return ''
    let list
    try {
      list = await runGit(resolvedRoot, ['worktree', 'list', '--porcelain'])
    } catch {
      return ''
    }
    const key = pathKey(play)
    for (const line of list.split(/\r?\n/)) {
      if (!line.startsWith('worktree ')) continue
      if (pathKey(line.slice('worktree '.length)) === key) return play
    }
    return ''
  }

  async function movePlayWorktree(commit) {
    const play = await playWorktree()
    if (!play) return null
    try {
      const branch = (await runGit(play, ['branch', '--show-current'])).trim()
      if (branch) return { play: 'not detached' }
      const status = await runGit(play, ['status', '--porcelain'])
      if (status.trim() !== '') return { play: 'dirty' }
      await runGit(play, ['checkout', '--no-overwrite-ignore', '--detach', commit], { timeout: GIT_WRITE_TIMEOUT_MS })
      return { play: 'moved' }
    } catch {
      return { play: 'failed' }
    }
  }

  async function laneReview(lane, worktree, base, runs = null) {
    const branch = (await runGit(worktree, ['branch', '--show-current'])).trim()
    const head = (await runGit(worktree, ['rev-parse', 'HEAD'])).trim()
    const log = await runGit(worktree, ['log', '--oneline', `${base.ref}..HEAD`])
    const commits = log.split(/\r?\n/).filter(Boolean)
    const behind = Number.parseInt((await runGit(worktree, ['rev-list', '--count', `HEAD..${base.ref}`])).trim(), 10)
    const status = await runGit(worktree, ['status', '--porcelain'])
    const stat = parseNumstat(await runGit(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', `${base.ref}...HEAD`]))
    return {
      lane,
      worktree,
      branch,
      head,
      base: base.name,
      baseHead: base.head,
      strategy: onProject ? 'fast-forward' : 'merge-commit',
      ahead: commits.length,
      behind: Number.isFinite(behind) ? behind : null,
      commits: commits.slice(0, COMMIT_LIMIT),
      dirty: status.trim() !== '',
      files: stat.files.length,
      added: stat.added,
      deleted: stat.deleted,
      checks: checkStateFor(lane, worktree, head, runs),
      lastRun: lastRunFor(lane, worktree, runs),
    }
  }

  async function laneDiff(lane, worktree, base) {
    const branch = (await runGit(worktree, ['branch', '--show-current'])).trim()
    const head = (await runGit(worktree, ['rev-parse', 'HEAD'])).trim()
    const range = `${base.ref}...${head}`
    const stat = parseNumstat(await runGit(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', range]))
    const full = await runGit(worktree, ['diff', '--no-ext-diff', '--no-textconv', range])
    const truncated = full.length > limit
    return {
      lane,
      branch,
      head,
      files: stat.files,
      patch: truncated ? full.slice(0, limit) : full,
      truncated,
    }
  }

  async function mergeLane(lane, worktree, head, message, expectedBase, expectedBaseHead) {
    if (!resolvedRoot) {
      return { status: 500, body: { error: 'The bridge could not read the main checkout.' } }
    }

    const mainBranch = (await runGit(resolvedRoot, ['branch', '--show-current'])).trim()
    const mainHead = mainBranch === 'main' ? (await runGit(resolvedRoot, ['rev-parse', 'HEAD'])).trim() : ''
    const mismatch = destinationMismatch(mainBranch, mainHead, expectedBase, expectedBaseHead)
    if (mismatch) {
      return { status: 409, body: { error: mismatch } }
    }
    const mainStatus = await runGit(resolvedRoot, ['status', '--porcelain', '--untracked-files=no'])
    if (mainStatus.trim() !== '') {
      return { status: 409, body: { error: 'The main checkout has uncommitted changes.' } }
    }

    let laneHead
    try {
      laneHead = (await runGit(worktree, ['rev-parse', 'HEAD'])).trim()
    } catch (error) {
      if (worktreeUnreadable(error)) {
        return { status: 404, body: { error: worktreeError(error) } }
      }
      throw error
    }
    if (laneHead !== head) {
      return { status: 409, body: { error: 'The lane moved since you read it. Read it again.' } }
    }
    if (checkStateFor(lane, worktree, laneHead) === 'failed') {
      return { status: 409, body: { error: FAILED_CHECKS_PROBLEM } }
    }
    const laneStatus = await runGit(worktree, ['status', '--porcelain'])
    if (laneStatus.trim() !== '') {
      return { status: 409, body: { error: 'The lane has uncommitted changes.' } }
    }
    if (await isAncestor(runGit, resolvedRoot, laneHead, MAIN_REF)) {
      return { status: 409, body: { error: 'Nothing to merge.' } }
    }

    const branch = (await runGit(worktree, ['branch', '--show-current'])).trim()
    const oldHead = (await runGit(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
    try {
      await runGit(resolvedRoot, ['merge', '--no-ff', '--no-edit', '-m', message, laneHead], {
        timeout: GIT_WRITE_TIMEOUT_MS,
        extraEnv: MERGE_ENV,
      })
    } catch (error) {
      const timed = timedOut(error)
      let files = []
      try {
        files = await conflictedPaths(runGit, resolvedRoot)
      } catch {}
      if (files.length > 0) {
        const aborted = await abortMerge(runGit, resolvedRoot)
        const restored = aborted && (await checkoutMatches(runGit, resolvedRoot, oldHead))
        if (restored) {
          return {
            status: 409,
            body: {
              error: timed
                ? 'The merge took too long and stopped on a conflict. The checkout was put back.'
                : 'The merge stopped on a conflict. Nothing changed.',
              files,
            },
          }
        }
        return {
          status: 500,
          body: {
            error: timed
              ? 'The merge took too long and stopped on a conflict. The checkout could not be put back.'
              : 'The merge stopped on a conflict and the checkout could not be put back.',
          },
        }
      }
      if (await mergeInProgress(runGit, resolvedRoot)) {
        const aborted = await abortMerge(runGit, resolvedRoot)
        const restored = aborted && (await checkoutMatches(runGit, resolvedRoot, oldHead))
        if (!restored) {
          return {
            status: 500,
            body: {
              error: timed
                ? `${MERGE_TIMEOUT_PROBLEM} The checkout could not be put back.`
                : 'The merge failed and the checkout could not be put back.',
            },
          }
        }
        if (timed) {
          return { status: 500, body: { error: `${MERGE_TIMEOUT_PROBLEM} The checkout was put back.` } }
        }
        return { status: 500, body: { error: 'The merge failed.' } }
      }
      if (timed) {
        if (await checkoutMatches(runGit, resolvedRoot, laneHead)) {
          return { status: 200, body: { ok: true, lane, branch, head: laneHead, commit: laneHead } }
        }
        if (await checkoutMatches(runGit, resolvedRoot, oldHead)) {
          return { status: 500, body: { error: `${MERGE_TIMEOUT_PROBLEM} The checkout was not changed.` } }
        }
        return { status: 500, body: { error: timeoutProblem(await checkoutState(runGit, resolvedRoot)) } }
      }
      return { status: 500, body: { error: 'The merge failed.' } }
    }

    const commit = (await runGit(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
    return { status: 200, body: { ok: true, lane, branch, head: laneHead, commit } }
  }

  async function fastForwardLane(lane, worktree, head, expectedBase, expectedBaseHead) {
    if (!resolvedRoot) {
      return { status: 500, body: { error: 'The bridge could not read the project folder.' } }
    }

    const base = await projectBase()
    if (!base) {
      return { status: 409, body: { error: 'The project is not on a branch.' } }
    }
    const mismatch = destinationMismatch(base.name, base.head, expectedBase, expectedBaseHead)
    if (mismatch) {
      return { status: 409, body: { error: mismatch } }
    }
    const projectStatus = await runGit(resolvedRoot, ['status', '--porcelain', '--untracked-files=no'])
    if (projectStatus.trim() !== '') {
      return { status: 409, body: { error: 'The project has uncommitted changes.' } }
    }

    let laneHead
    try {
      laneHead = (await runGit(worktree, ['rev-parse', 'HEAD'])).trim()
    } catch (error) {
      if (worktreeUnreadable(error)) {
        return { status: 404, body: { error: worktreeError(error) } }
      }
      throw error
    }
    if (laneHead !== head) {
      return { status: 409, body: { error: 'The lane moved since you read it. Read it again.' } }
    }
    if (checkStateFor(lane, worktree, laneHead) === 'failed') {
      return { status: 409, body: { error: FAILED_CHECKS_PROBLEM } }
    }
    const laneStatus = await runGit(worktree, ['status', '--porcelain'])
    if (laneStatus.trim() !== '') {
      return { status: 409, body: { error: 'The lane has uncommitted changes.' } }
    }
    if (await isAncestor(runGit, resolvedRoot, laneHead, base.ref)) {
      return { status: 409, body: { error: 'Nothing to merge.' } }
    }
    if (!(await isAncestor(runGit, resolvedRoot, base.ref, laneHead))) {
      return {
        status: 409,
        body: { error: `The lane is not a fast forward of ${base.name}. Rebase it onto ${base.name} and read it again.` },
      }
    }

    const branch = (await runGit(worktree, ['branch', '--show-current'])).trim()
    const oldHead = (await runGit(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
    try {
      await runGit(resolvedRoot, ['merge', '--ff-only', laneHead], {
        timeout: GIT_WRITE_TIMEOUT_MS,
        extraEnv: MERGE_ENV,
      })
    } catch (error) {
      if (timedOut(error)) {
        if (await checkoutMatches(runGit, resolvedRoot, laneHead)) {
          return { status: 200, body: { ok: true, lane, branch, head: laneHead, commit: laneHead } }
        }
        if (await checkoutMatches(runGit, resolvedRoot, oldHead)) {
          return { status: 500, body: { error: `${MERGE_TIMEOUT_PROBLEM} The checkout was not changed.` } }
        }
        return { status: 500, body: { error: timeoutProblem(await checkoutState(runGit, resolvedRoot)) } }
      }
      return { status: 500, body: { error: 'The merge failed.' } }
    }

    const commit = (await runGit(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
    return { status: 200, body: { ok: true, lane, branch, head: laneHead, commit } }
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const diffRoute = /^\/api\/control\/reviews\/([^/]+)\/diff$/.exec(path)
    const mergeRoute = /^\/api\/control\/reviews\/([^/]+)\/merge$/.exec(path)
    if (path !== '/api/control/reviews' && !diffRoute && !mergeRoute) return false

    if (mergeRoute) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!ownerRequest(req)) {
        sendJson(req, res, 403, { error: NOT_OWNER_PROBLEM })
        return true
      }
    } else if (method !== 'GET') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const read = readLanes()
    if (read.status) {
      sendJson(req, res, read.status, { error: read.error })
      return true
    }

    const route = mergeRoute ?? diffRoute
    if (route) {
      let lane
      try {
        lane = decodeURIComponent(route[1])
      } catch {
        sendJson(req, res, 404, { error: 'Choose a lane from the list.' })
        return true
      }
      const worktree = laneFolder(read.lanes, lane)
      if (!worktree) {
        sendJson(req, res, 404, { error: 'Choose a lane from the list.' })
        return true
      }
      if (!existsSync(worktree)) {
        sendJson(req, res, 404, { error: 'That worktree is missing.' })
        return true
      }
      if (mergeRoute) {
        if (typeof readJsonBody !== 'function') {
          sendJson(req, res, 500, { error: 'The bridge cannot read a request body.' })
          return true
        }
        const body = await readJsonBody(req, res)
        if (body === null) return true
        if (body.confirmed !== true) {
          sendJson(req, res, 400, { error: 'Confirm the merge first.' })
          return true
        }
        const head = body.head
        const baseName = body.base
        const baseHead = body.baseHead
        const message = body.message
        if (typeof head !== 'string' || !HEAD_PATTERN.test(head)) {
          sendJson(req, res, 400, {
            error: onProject
              ? 'Send the lane head, destination branch and destination head you read.'
              : 'Send the head you read and a message of one line.',
          })
          return true
        }
        if (
          !onProject &&
          (typeof message !== 'string' || message.length < 1 || message.length > MESSAGE_LIMIT || /[\r\n]/.test(message))
        ) {
          sendJson(req, res, 400, { error: 'Send the head you read and a message of one line.' })
          return true
        }
        if (
          typeof baseName !== 'string' ||
          baseName.trim().length < 1 ||
          baseName.trim() !== baseName ||
          /[\r\n]/.test(baseName) ||
          typeof baseHead !== 'string' ||
          !HEAD_PATTERN.test(baseHead)
        ) {
          sendJson(req, res, 400, { error: 'Send the destination branch and head you read.' })
          return true
        }
        if (merging) {
          sendJson(req, res, 409, { error: 'A merge is already running.' })
          return true
        }
        const lockKey = beginRepoWrite(resolvedRoot)
        if (!lockKey) {
          sendJson(req, res, 409, { error: WRITE_IN_FLIGHT_PROBLEM })
          return true
        }
        merging = true
        let answer
        try {
          answer = onProject
            ? await fastForwardLane(lane, worktree, head, baseName, baseHead)
            : await mergeLane(lane, worktree, head, message, baseName, baseHead)
          if (answer.status === 200 && answer.body && typeof answer.body.commit === 'string') {
            try {
              const play = await movePlayWorktree(answer.body.commit)
              if (play) answer = { ...answer, body: { ...answer.body, ...play } }
            } catch {}
            invalidateGitCache(resolvedRoot)
            notify({ topic: 'git' })
          }
        } catch {
          answer = { status: 500, body: { error: 'The merge failed.' } }
        } finally {
          merging = false
          endRepoWrite(lockKey)
        }
        sendJson(req, res, answer.status, answer.body)
        return true
      }

      const base = await baseFor()
      if (!base) {
        sendJson(req, res, 409, { error: 'The project is not on a branch.' })
        return true
      }

      try {
        sendJson(req, res, 200, await laneDiff(lane, worktree, base))
      } catch (error) {
        sendJson(req, res, 404, { error: worktreeError(error) })
      }
      return true
    }

    const base = await baseFor()
    if (!base) {
      sendJson(req, res, 409, { error: 'The project is not on a branch.' })
      return true
    }
    const runs = readRuns(recordsFile())
    const targets = []
    for (const lane of Object.keys(read.lanes)) {
      const worktree = laneFolder(read.lanes, lane)
      if (!worktree) continue
      if (onProject && !existsSync(worktree)) continue
      targets.push({ lane, worktree })
    }
    const entries = await mapConcurrent(targets, concurrency, async ({ lane, worktree }) => {
      try {
        return await laneReview(lane, worktree, base, runs)
      } catch (error) {
        return { lane, worktree, error: worktreeError(error) }
      }
    })
    sendJson(req, res, 200, { lanes: entries })
    return true
  }

  return { handle }
}
