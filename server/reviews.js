import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readRunRecords, runsFile } from './runs.js'

const GIT_TIMEOUT_MS = 10 * 1000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const COMMIT_LIMIT = 50
export const DEFAULT_PATCH_LIMIT = 400 * 1024

function readText(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function git(worktree, args) {
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

export function createReviewsApi({ projectRoot = '', briefsDir = '', patchLimit = DEFAULT_PATCH_LIMIT, sendJson }) {
  const resolvedRoot = projectRoot ? resolve(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const limit = Number.isInteger(patchLimit) && patchLimit > 0 ? patchLimit : DEFAULT_PATCH_LIMIT

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
    const log = await git(worktree, ['log', '--oneline', 'main..HEAD'])
    const commits = log.split(/\r?\n/).filter(Boolean)
    const status = await git(worktree, ['status', '--porcelain'])
    const stat = parseNumstat(await git(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'main...HEAD']))
    return {
      lane,
      worktree,
      branch,
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

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const diffRoute = /^\/api\/control\/reviews\/([^/]+)\/diff$/.exec(path)
    if (path !== '/api/control/reviews' && !diffRoute) return false

    if (method !== 'GET') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const read = readLanes()
    if (read.status) {
      sendJson(req, res, read.status, { error: read.error })
      return true
    }

    if (!diffRoute) {
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

    let lane
    try {
      lane = decodeURIComponent(diffRoute[1])
    } catch {
      sendJson(req, res, 404, { error: 'Choose a lane from the list.' })
      return true
    }
    const worktree = laneWorktree(read.lanes, lane)
    if (!worktree) {
      sendJson(req, res, 404, { error: 'Choose a lane from the list.' })
      return true
    }
    try {
      sendJson(req, res, 200, await laneDiff(lane, worktree))
    } catch (error) {
      sendJson(req, res, 404, { error: worktreeError(error) })
    }
    return true
  }

  return { handle }
}
