import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskKeys } from '../src/briefs/audit.js'
import { maskProfilePaths, worktreeFor } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { outsideScope } from '../src/model/hierarchy.js'
import { lanesFolder, mainCheckoutOf, readAllLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { gitEnv, gitPath } from './programPath.js'
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
  const env = { ...gitEnv(), ...(extraEnv ?? {}) }
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
  const scopeWarned = new Set()

  function orchestratorRegistry() {
    return typeof orchestrators === 'function' ? orchestrators() : null
  }

  function callerId(req) {
    const registry = orchestratorRegistry()
    if (!registry || typeof registry.idForToken !== 'function') return null
    const header = req.headers?.['x-machineroom-orchestrator']
    const token = typeof header === 'string' ? header.trim() : Array.isArray(header) ? header[0].trim() : ''
    return registry.idForToken(token)
  }

  function ownerRequest(req) {
    const headers = req.headers ?? {}
    if (headers.origin) return true
    return Boolean(callerId(req))
  }

  function ladderSubFor(lane) {
    const registry = orchestratorRegistry()
    if (!registry || typeof registry.getLadder !== 'function') return null
    const ladder = registry.getLadder()
    if (!ladder || !Array.isArray(ladder.subs)) return null
    const sub = ladder.subs.find((entry) => entry && Array.isArray(entry.lanes) && entry.lanes.includes(lane))
    return sub && typeof sub === 'object' ? sub : null
  }

  function parentIdFor(sub) {
    const parent = typeof sub.parent === 'string' ? sub.parent.trim() : ''
    return parent || 'orchestrator'
  }

  function warnOutsideScope(lane, head, sub, parent, files) {
    const key = `${lane}:${head}`
    if (scopeWarned.has(key)) return
    scopeWarned.add(key)
    const registry = orchestratorRegistry()
    if (!registry || typeof registry.find !== 'function') return
    const target = registry.find(parent)
    if (!target || typeof target.deliver !== 'function') return
    const name = typeof sub.name === 'string' && sub.name.trim() ? sub.name.trim() : sub.id
    const text = [
      'Outside the scope, do not merge:',
      ...files.map((file) => `- ${file}`),
      '',
      `Lane ${lane} changed files outside the scope of ${name}, so its merge was refused.`,
      'Allow it with allowOutside if the files are right.',
    ].join('\n')
    try {
      target.deliver('room', text)
    } catch {}
  }

  async function scopeRefusal(lane, worktree, head, baseRef, request) {
    const sub = ladderSubFor(lane)
    if (!sub || sub.restricted !== true) return null
    const parent = parentIdFor(sub)
    const headers = request?.headers ?? {}
    const allowed = request?.allowOutside === true && (Boolean(headers.origin) || callerId({ headers }) === parent)
    let changed
    try {
      const text = await runGit(worktree, [
        'diff',
        '--name-only',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
        `${baseRef}...${head}`,
      ])
      changed = text.split(/\r?\n/).filter(Boolean)
    } catch {
      if (allowed) return null
      return {
        status: 409,
        body: {
          error: "The bridge could not read the lane's changed files, so it was not merged.",
          files: [],
          outside: true,
        },
      }
    }
    const outside = outsideScope(changed, sub, { windows: process.platform === 'win32' })
    if (outside.length === 0) return null
    if (allowed) return null
    warnOutsideScope(lane, head, sub, parent, outside)
    const name = typeof sub.name === 'string' && sub.name.trim() ? sub.name.trim() : sub.id
    return {
      status: 409,
      body: {
        error: `The lane changed files outside the scope of ${name}, so it was not merged.`,
        files: outside,
        outside: true,
      },
    }
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

  function harnessFor(lanes, lane) {
    const info = laneEntry(lanes, lane)
    const fromCli = info?.cli?.harness
    if (typeof fromCli === 'string' && fromCli.trim() !== '') return fromCli.trim()
    const plain = info?.harness
    if (typeof plain === 'string' && plain.trim() !== '') return plain.trim()
    return null
  }

  function recordName(record) {
    const log = typeof record?.log === 'string' ? record.log.trim() : ''
    if (log === '') return ''
    const file = log.split(/[\\/]/).pop() ?? ''
    return file.replace(/\.log$/i, '')
  }

  function taskBranchOf(record, baseName = '') {
    const raw = typeof record?.branch === 'string' ? record.branch.trim() : ''
    const branch = raw || (typeof record?.queue === 'string' ? record.queue.trim() : '')
    if (!branch || branch === 'main' || branch === 'master') return ''
    if (baseName && branch === baseName) return ''
    return branch
  }

  function recordTime(record) {
    const parsed = Date.parse(record?.startedAt ?? '')
    return Number.isFinite(parsed) ? parsed : null
  }

  function isEarlierOrSame(candidate, current, indexMap) {
    const candidateTime = recordTime(candidate)
    const currentTime = recordTime(current)
    if (candidateTime !== null && currentTime !== null) return candidateTime <= currentTime
    return (indexMap.get(candidate) ?? 0) <= (indexMap.get(current) ?? 0)
  }

  function isRetryPair(left, right) {
    const leftName = recordName(left)
    const rightName = recordName(right)
    if (!leftName || !rightName) return false
    if (left.retried === true && rightName === `${leftName}-retry`) return true
    if (right.retried === true && leftName === `${rightName}-retry`) return true
    return false
  }

  function sameRun(record, lane, startedAt) {
    const wanted = typeof lane === 'string' ? lane.trim() : ''
    return Boolean(record) && record.lane === wanted && (record.startedAt ?? null) === (startedAt ?? null)
  }

  function linkedRuns(lane, worktree, runs = null, baseName = '') {
    const allRuns = runs ?? readRuns(recordsFile())
    const list = allRuns.filter((record) => record && runMatchesProject(record, worktree))
    const indexMap = new Map(list.map((record, index) => [record, index]))
    const found = new Set()
    const pending = []
    const add = (record) => {
      if (!record || found.has(record)) return
      found.add(record)
      pending.push(record)
    }
    add(lastRunFor(lane, worktree, allRuns))
    while (pending.length > 0) {
      const current = pending.pop()
      const from = current.failoverFrom
      if (from && typeof from === 'object') {
        add(list.find((record) => sameRun(record, from.lane, from.startedAt)))
      }
      const currentName = recordName(current)
      const currentBranch = taskBranchOf(current, baseName)
      for (const record of list) {
        const back = record.failoverFrom
        if (back && typeof back === 'object' && sameRun(current, back.lane, back.startedAt)) add(record)
        const continued = typeof record.continues === 'string' ? record.continues.trim() : ''
        if (continued !== '' && currentName !== '' && continued === currentName) add(record)
        if (record.lane === current.lane) {
          if (isRetryPair(record, current)) {
            add(record)
          } else if (
            currentBranch !== '' &&
            taskBranchOf(record, baseName) === currentBranch &&
            isEarlierOrSame(record, current, indexMap)
          ) {
            add(record)
          }
        }
      }
      const earlier = typeof current.continues === 'string' ? current.continues.trim() : ''
      if (earlier !== '') add(list.find((record) => recordName(record) === earlier))
    }
    return [...found].sort((left, right) => {
      const leftTime = recordTime(left) ?? 0
      const rightTime = recordTime(right) ?? 0
      return leftTime - rightTime || (indexMap.get(left) ?? 0) - (indexMap.get(right) ?? 0)
    })
  }

  function runEntry(record, lanes) {
    return {
      lane: record.lane,
      harness: harnessFor(lanes, record.lane),
      model: typeof record.model === 'string' && record.model.trim() !== '' ? record.model : null,
      branch: typeof record.branch === 'string' ? record.branch : '',
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : null,
      minutes: Number.isFinite(record.minutes) ? record.minutes : null,
      costUsd: Number.isFinite(record.costUsd) ? record.costUsd : null,
      inputTokens: Number.isFinite(record.inputTokens) ? record.inputTokens : null,
      outputTokens: Number.isFinite(record.outputTokens) ? record.outputTokens : null,
      exitCode: Number.isInteger(record.exitCode) ? record.exitCode : null,
      killed: record.killed === true,
    }
  }

  function sumKnown(runs, field) {
    let total = 0
    let known = 0
    for (const run of runs) {
      const value = run[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      total += value
      known += 1
    }
    return { total: known === 0 ? null : Math.round(total * 1e6) / 1e6, known }
  }

  function runTotalsFor(runs) {
    const minutes = sumKnown(runs, 'minutes')
    const cost = sumKnown(runs, 'costUsd')
    const input = sumKnown(runs, 'inputTokens')
    const output = sumKnown(runs, 'outputTokens')
    return {
      runs: runs.length,
      runMinutes: minutes.total,
      costUsd: cost.total,
      inputTokens: input.total,
      outputTokens: output.total,
      partial:
        runs.length === 0 ||
        minutes.known < runs.length ||
        cost.known < runs.length ||
        input.known < runs.length ||
        output.known < runs.length,
    }
  }

  function evidenceFor(lane, worktree, head, runs = null) {
    const key = typeof head === 'string' ? head.trim().toLowerCase() : ''
    const tested = projectRunsFor(lane, worktree, runs).filter(
      (record) =>
        typeof record.head === 'string' &&
        HEAD_PATTERN.test(record.head.trim()) &&
        (record.tests === 'passed' || record.tests === 'failed')
    )
    const matches = HEAD_PATTERN.test(key)
      ? tested.filter((record) => record.head.trim().toLowerCase() === key)
      : []
    const latest = newestRecord(matches)
    if (latest) {
      return {
        checkedHead: head,
        checks: [
          {
            command: null,
            result: latest.tests,
            at: typeof latest.startedAt === 'string' ? latest.startedAt : null,
          },
        ],
        stale: false,
      }
    }
    return { checkedHead: null, checks: [], stale: tested.length > 0 }
  }

  function claimsFor(record, lanes) {
    if (!record) return null
    const log = typeof record.log === 'string' ? record.log.trim() : ''
    if (log === '' || !inside(log, dirname(recordsFile()))) return null
    const text = readText(log)
    if (text === null) return null
    const harness = harnessFor(lanes, record.lane)
    if (!harness || !Object.hasOwn(harnessByKey, harness)) return null
    const descriptor = harnessByKey[harness]
    if (typeof descriptor.reply !== 'function') return null
    let reply
    try {
      reply = descriptor.reply(text)
    } catch {
      return null
    }
    if (typeof reply !== 'string' || reply.trim() === '') return null
    return maskProfilePaths(maskKeys(reply.trim()).text)
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
      const playHead = (await runGit(play, ['rev-parse', 'HEAD'])).trim()
      const branch = (await runGit(play, ['branch', '--show-current'])).trim()
      if (branch) return { play: 'not detached', playHead }
      const status = await runGit(play, ['status', '--porcelain'])
      if (status.trim() !== '') return { play: 'dirty', playHead }
      await runGit(play, ['checkout', '--no-overwrite-ignore', '--detach', commit], { timeout: GIT_WRITE_TIMEOUT_MS })
      return { play: 'moved' }
    } catch {
      return { play: 'failed' }
    }
  }

  async function laneReview(lane, worktree, base, runs = null, lanes = null) {
    const laneList = lanes ?? readLanes().lanes ?? {}
    const branch = (await runGit(worktree, ['branch', '--show-current'])).trim()
    const head = (await runGit(worktree, ['rev-parse', 'HEAD'])).trim()
    const log = await runGit(worktree, ['log', '--oneline', `${base.ref}..HEAD`])
    const commits = log.split(/\r?\n/).filter(Boolean)
    const behind = Number.parseInt((await runGit(worktree, ['rev-list', '--count', `HEAD..${base.ref}`])).trim(), 10)
    const status = await runGit(worktree, ['status', '--porcelain'])
    const stat = parseNumstat(await runGit(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', `${base.ref}...HEAD`]))
    const lastRun = lastRunFor(lane, worktree, runs)
    const laneRuns = linkedRuns(lane, worktree, runs, base.name).map((record) => runEntry(record, laneList))
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
      evidence: evidenceFor(lane, worktree, head, runs),
      claims: claimsFor(lastRun, laneList),
      lastRun,
      runs: laneRuns,
      runTotals: runTotalsFor(laneRuns),
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

  async function mergeLane(lane, worktree, head, message, expectedBase, expectedBaseHead, request) {
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
    const outside = await scopeRefusal(lane, worktree, laneHead, MAIN_REF, request)
    if (outside) return outside

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

  async function fastForwardLane(lane, worktree, head, expectedBase, expectedBaseHead, request) {
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
    const outside = await scopeRefusal(lane, worktree, laneHead, base.ref, request)
    if (outside) return outside

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
      if (mergeRoute && !req.headers?.origin) {
        const actor = callerId(req)
        const sector = actor === 'orchestrator' ? null : orchestratorRegistry()?.sector?.(actor)
        if (actor !== 'orchestrator' && (!sector || !Array.isArray(sector.lanes) || !sector.lanes.includes(lane))) {
          sendJson(req, res, 403, { error: `The ${sector?.name?.trim() || actor} sector does not hold the lane ${lane}.` })
          return true
        }
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
          const scopeRequest = { allowOutside: body.allowOutside === true, headers: req.headers ?? {} }
          answer = onProject
            ? await fastForwardLane(lane, worktree, head, baseName, baseHead, scopeRequest)
            : await mergeLane(lane, worktree, head, message, baseName, baseHead, scopeRequest)
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
        return await laneReview(lane, worktree, base, runs, read.lanes)
      } catch (error) {
        return { lane, worktree, error: worktreeError(error) }
      }
    })
    sendJson(req, res, 200, { lanes: entries })
    return true
  }

  return { handle }
}
