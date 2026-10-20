import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readRunRecords, runsFile } from './runs.js'

const GIT_TIMEOUT_MS = 10 * 1000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const COMMIT_LIMIT = 50
const MESSAGE_LIMIT = 200
const HEAD_PATTERN = /^[0-9a-fA-F]{40}$/
const MERGE_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
export const DEFAULT_PATCH_LIMIT = 400 * 1024

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function git(worktree, args, extraEnv = null) {
  return new Promise((resolveGit, rejectGit) => {
    execFile(
      'git',
      args,
      {
        cwd: worktree,
        shell: false,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
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

function worktreeError(error) {
  if (error?.code === 'ENOENT') return 'That worktree is missing.'
  if (/not a git repository/i.test(String(error?.gitStderr ?? ''))) return 'That folder is not a git repository.'
  return 'The bridge could not read that worktree.'
}

function worktreeUnreadable(error) {
  return error?.code === 'ENOENT' || /not a git repository/i.test(String(error?.gitStderr ?? ''))
}

async function isAncestor(cwd, ancestor, descendant) {
  try {
    await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch (error) {
    if (error?.code === 1) return false
    throw error
  }
}

async function conflictedPaths(cwd) {
  const text = await git(cwd, ['diff', '--name-only', '--diff-filter=U'])
  return text.split(/\r?\n/).filter(Boolean)
}

async function mergeInProgress(cwd) {
  try {
    await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

async function abortMerge(cwd) {
  try {
    await git(cwd, ['merge', '--abort'])
    return true
  } catch {
    return false
  }
}

async function checkoutMatches(cwd, sha) {
  try {
    const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    if (head !== sha) return false
    const status = await git(cwd, ['status', '--porcelain', '--untracked-files=no'])
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

function laneWorktree(lanes, lane) {
  if (typeof lane !== 'string' || !lane) return null
  if (!Object.hasOwn(lanes, lane)) return null
  const info = lanes[lane]
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  if (!Object.hasOwn(info, 'worktree')) return null
  const worktree = info.worktree
  if (typeof worktree !== 'string' || !worktree) return null
  return worktree
}

export function createReviewsApi({ projectRoot = '', briefsDir = '', patchLimit = DEFAULT_PATCH_LIMIT, sendJson, readJsonBody }) {
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const limit = Number.isInteger(patchLimit) && patchLimit > 0 ? patchLimit : DEFAULT_PATCH_LIMIT
  let merging = false

  function readLanes() {
    const text = resolvedBriefs ? readText(join(resolvedBriefs, 'lanes.json')) : null
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
    return { lanes: parsed }
  }

  function lastRunFor(lane) {
    return readRunRecords(runsFile()).find((record) => record && record.lane === lane) ?? null
  }

  async function laneReview(lane, worktree) {
    const branch = (await git(worktree, ['branch', '--show-current'])).trim()
    const head = (await git(worktree, ['rev-parse', 'HEAD'])).trim()
    const log = await git(worktree, ['log', '--oneline', 'main..HEAD'])
    const commits = log.split(/\r?\n/).filter(Boolean)
    const status = await git(worktree, ['status', '--porcelain'])
    const stat = parseNumstat(await git(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'main...HEAD']))
    return {
      lane,
      worktree,
      branch,
      head,
      ahead: commits.length,
      commits: commits.slice(0, COMMIT_LIMIT),
      dirty: status.trim() !== '',
      files: stat.files.length,
      added: stat.added,
      deleted: stat.deleted,
      lastRun: lastRunFor(lane),
    }
  }

  async function laneDiff(lane, worktree) {
    const branch = (await git(worktree, ['branch', '--show-current'])).trim()
    const stat = parseNumstat(await git(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'main...HEAD']))
    const full = await git(worktree, ['diff', '--no-ext-diff', '--no-textconv', 'main...HEAD'])
    const truncated = full.length > limit
    return {
      lane,
      branch,
      files: stat.files,
      patch: truncated ? full.slice(0, limit) : full,
      truncated,
    }
  }

  async function mergeLane(lane, worktree, head, message) {
    if (!resolvedRoot) {
      return { status: 500, body: { error: 'The bridge could not read the main checkout.' } }
    }

    const mainBranch = (await git(resolvedRoot, ['branch', '--show-current'])).trim()
    if (mainBranch !== 'main') {
      return { status: 409, body: { error: 'The main checkout is not on main.' } }
    }
    const mainStatus = await git(resolvedRoot, ['status', '--porcelain', '--untracked-files=no'])
    if (mainStatus.trim() !== '') {
      return { status: 409, body: { error: 'The main checkout has uncommitted changes.' } }
    }

    let laneHead
    try {
      laneHead = (await git(worktree, ['rev-parse', 'HEAD'])).trim()
    } catch (error) {
      if (worktreeUnreadable(error)) {
        return { status: 404, body: { error: worktreeError(error) } }
      }
      throw error
    }
    if (laneHead !== head) {
      return { status: 409, body: { error: 'The lane moved since you read it. Read it again.' } }
    }
    const laneStatus = await git(worktree, ['status', '--porcelain'])
    if (laneStatus.trim() !== '') {
      return { status: 409, body: { error: 'The lane has uncommitted changes.' } }
    }
    if (await isAncestor(resolvedRoot, laneHead, 'main')) {
      return { status: 409, body: { error: 'Nothing to merge.' } }
    }

    const branch = (await git(worktree, ['branch', '--show-current'])).trim()
    const oldHead = (await git(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
    try {
      await git(resolvedRoot, ['merge', '--no-ff', '--no-edit', '-m', message, laneHead], MERGE_ENV)
    } catch {
      let files = []
      try {
        files = await conflictedPaths(resolvedRoot)
      } catch {}
      if (files.length > 0) {
        const aborted = await abortMerge(resolvedRoot)
        const restored = aborted && (await checkoutMatches(resolvedRoot, oldHead))
        if (restored) {
          return {
            status: 409,
            body: { error: 'The merge stopped on a conflict. Nothing changed.', files },
          }
        }
        return { status: 500, body: { error: 'The merge stopped on a conflict and the checkout could not be put back.' } }
      }
      if (await mergeInProgress(resolvedRoot)) {
        const aborted = await abortMerge(resolvedRoot)
        const restored = aborted && (await checkoutMatches(resolvedRoot, oldHead))
        if (!restored) {
          return { status: 500, body: { error: 'The merge failed and the checkout could not be put back.' } }
        }
      }
      return { status: 500, body: { error: 'The merge failed.' } }
    }

    const commit = (await git(resolvedRoot, ['rev-parse', 'HEAD'])).trim()
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
      const worktree = laneWorktree(read.lanes, lane)
      if (!worktree) {
        sendJson(req, res, 404, { error: 'Choose a lane from the list.' })
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
        const message = body.message
        if (
          typeof head !== 'string' ||
          !HEAD_PATTERN.test(head) ||
          typeof message !== 'string' ||
          message.length < 1 ||
          message.length > MESSAGE_LIMIT ||
          /[\r\n]/.test(message)
        ) {
          sendJson(req, res, 400, { error: 'Send the head you read and a message of one line.' })
          return true
        }
        if (merging) {
          sendJson(req, res, 409, { error: 'A merge is already running.' })
          return true
        }
        merging = true
        let answer
        try {
          answer = await mergeLane(lane, worktree, head, message)
        } catch {
          answer = { status: 500, body: { error: 'The merge failed.' } }
        } finally {
          merging = false
        }
        sendJson(req, res, answer.status, answer.body)
        return true
      }

      try {
        sendJson(req, res, 200, await laneDiff(lane, worktree))
      } catch (error) {
        sendJson(req, res, 404, { error: worktreeError(error) })
      }
      return true
    }

    const entries = []
    for (const lane of Object.keys(read.lanes)) {
      const worktree = laneWorktree(read.lanes, lane)
      if (!worktree) continue
      try {
        entries.push(await laneReview(lane, worktree))
      } catch (error) {
        entries.push({ lane, worktree, error: worktreeError(error) })
      }
    }
    sendJson(req, res, 200, { lanes: entries })
    return true
  }

  return { handle }
}
