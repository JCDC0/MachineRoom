import { execFile, spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { SINCE_PROBLEM, dayStart, laneStats, projectProblems } from '../src/briefs/run.js'
import { outcomeTable } from './outcomes.js'
import { gitPath } from './programPath.js'
import { killTree, treeSpawnOptions } from './processTree.js'

export const RECENT_LIMIT = 20
export const LAST_LINE_LIMIT = 5
export const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
export const TASK_LIMIT = 4000
export const TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
const NO_PROJECT = 'The bridge has no project folder.'
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const REPO_LANES = join(REPO_ROOT, 'docs', 'agents', 'lanes.json')
const GIT_TIMEOUT_MS = 10 * 1000
const GIT_MAX_BUFFER = 8 * 1024 * 1024

function realPath(value) {
  const folder = resolve(String(value ?? ''))
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

function git(folder, args) {
  return new Promise((done) => {
    let file
    try {
      file = gitPath()
    } catch {
      done(null)
      return
    }
    execFile(
      file,
      args,
      { cwd: folder, encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        done(error ? null : String(stdout ?? ''))
      }
    )
  })
}

async function projectDirty(folder) {
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  if (inside === null || inside.trim() !== 'true') return false
  const status = await git(folder, ['status', '--porcelain'])
  return status !== null && status.trim() !== ''
}

let mainCheckoutPromise = null

function mainCheckout() {
  if (!mainCheckoutPromise) {
    mainCheckoutPromise = git(REPO_ROOT, ['rev-parse', '--git-common-dir']).then((common) => {
      return common && common.trim() ? realPath(dirname(resolve(REPO_ROOT, common.trim()))) : realPath(REPO_ROOT)
    })
  }
  return mainCheckoutPromise
}

function gitCommonDir(folder) {
  return git(folder, ['rev-parse', '--git-common-dir']).then((common) => {
    const text = String(common ?? '').trim()
    return text ? realPath(resolve(folder, text)) : ''
  })
}

let repoCommonDirPromise = null

function repoCommonDir() {
  if (!repoCommonDirPromise) repoCommonDirPromise = gitCommonDir(REPO_ROOT)
  return repoCommonDirPromise
}

function resolvedLanes(lanes) {
  return Object.fromEntries(Object.entries(lanes ?? {}).map(([key, lane]) => {
    if (!lane || typeof lane !== 'object' || typeof lane.worktree !== 'string' || lane.worktree.trim() === '') return [key, lane]
    return [key, { ...lane, worktree: realPath(lane.worktree) }]
  }))
}

export function runsFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'runs.jsonl')
}

export function outcomesFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'outcomes.jsonl')
}

function readJsonLines(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const records = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return records
}

export function readRunRecords(file) {
  return readAllRunRecords(file).slice(-RECENT_LIMIT).reverse()
}

export function readAllRunRecords(file) {
  return readJsonLines(file)
}

export function readOutcomeRecords(file) {
  return readJsonLines(file)
}

export function createRunsApi({ projectRoot = '', briefsDir = '', runnerCommand, sendJson, readJsonBody, notify = () => {} }) {
  const resolvedRoot = projectRoot ? realPath(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const command = runnerCommand ?? { file: process.execPath, args: ['scripts/run-lane.mjs'] }
  const running = new Map()
  let stopped = false

  function readPath(path) {
    if (!path) return null
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  function readText(name) {
    if (!resolvedBriefs) return null
    return readPath(join(resolvedBriefs, name))
  }

  function snapshot(item) {
    return {
      lane: item.entry.lane,
      briefs: [...item.entry.briefs],
      startedAt: item.entry.startedAt,
      lastLines: [...item.entry.lastLines],
    }
  }

  function finish(item) {
    if (running.get(item.entry.lane) !== item) return
    const tail = item.tail.trim()
    if (tail) {
      item.entry.lastLines.push(tail)
      if (item.entry.lastLines.length > LAST_LINE_LIMIT) item.entry.lastLines.shift()
    }
    running.delete(item.entry.lane)
    if (stopped) return
    notify({ topic: 'runs' })
  }

  function startRun(lane, briefs, projectRun = null) {
    const entry = { lane, briefs: [...briefs], startedAt: new Date().toISOString(), lastLines: [] }
    const item = { entry, tail: '' }
    const args = projectRun
      ? [
          ...command.args,
          lane,
          '--project',
          projectRun.project,
          '--task',
          projectRun.task,
          ...(projectRun.allowDirty ? ['--allow-dirty'] : []),
        ]
      : [...command.args, lane, ...briefs]
    const child = spawn(command.file, args, {
      cwd: projectRun ? REPO_ROOT : resolvedRoot || undefined,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(),
    })
    item.child = child
    running.set(lane, item)
    const take = (chunk) => {
      item.tail += chunk.toString('utf8')
      const parts = item.tail.split(/\r?\n/)
      item.tail = parts.pop() ?? ''
      for (const line of parts) {
        entry.lastLines.push(line)
        if (entry.lastLines.length > LAST_LINE_LIMIT) entry.lastLines.shift()
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', () => finish(item))
    child.on('close', () => finish(item))
    return entry
  }

  function stopAll() {
    stopped = true
    for (const item of running.values()) {
      if (item.child?.pid) killTree(item.child)
    }
    running.clear()
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    if (path === '/api/control/runs/outcomes') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const records = readAllRunRecords(runsFile())
      const outcomes = readOutcomeRecords(outcomesFile())
      sendJson(req, res, 200, { rows: outcomeTable(records, outcomes) })
      return true
    }
    if (path === '/api/control/runs/stats') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const since = url.searchParams.get('since')
      if (since !== null && dayStart(since) === null) {
        sendJson(req, res, 400, { error: SINCE_PROBLEM })
        return true
      }
      const records = readAllRunRecords(runsFile())
      sendJson(req, res, 200, laneStats(records, since === null ? {} : { since }))
      return true
    }
    if (path !== '/api/control/runs') return false

    if (method === 'GET') {
      sendJson(req, res, 200, {
        project: resolvedRoot ? basename(resolvedRoot) : '',
        running: [...running.values()].map(snapshot),
        recent: readRunRecords(runsFile()),
      })
      return true
    }

    if (method !== 'POST') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const body = await readJsonBody(req, res)
    if (body === null) return true

    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: 'Confirm the run first.' })
      return true
    }

    const projectRun = body.briefs === undefined
    const lanesText = projectRun ? readPath(REPO_LANES) : readText('lanes.json')
    const tasksText = projectRun ? null : readText('TASKS.md')
    if (lanesText === null || (!projectRun && tasksText === null)) {
      sendJson(req, res, 404, { error: 'The brief files are missing.' })
      return true
    }

    let lanes
    try {
      lanes = JSON.parse(lanesText)
    } catch {
      lanes = null
    }
    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
      sendJson(req, res, 400, { error: 'The lane file is not valid.' })
      return true
    }

    const lane = typeof body.lane === 'string' ? body.lane : ''
    if (!Object.hasOwn(lanes, lane) || !lanes[lane] || typeof lanes[lane] !== 'object') {
      sendJson(req, res, 400, { error: 'Choose a lane from the list.' })
      return true
    }
    if (lanes[lane].retired === true) {
      sendJson(req, res, 400, { error: `The ${lane} lane is retired.` })
      return true
    }
    if (!Object.hasOwn(lanes[lane], 'cli') || !lanes[lane].cli || typeof lanes[lane].cli !== 'object') {
      sendJson(req, res, 400, { error: 'That lane has no command line.' })
      return true
    }

    let briefs = []
    let task = ''
    let allowDirty = false
    if (projectRun) {
      if (typeof body.task !== 'string' || body.task.trim().length < 1 || body.task.length > TASK_LIMIT) {
        sendJson(req, res, 400, { error: TASK_PROBLEM })
        return true
      }
      task = body.task
      allowDirty = body.allowDirty === true
      if (!resolvedRoot) {
        sendJson(req, res, 400, { error: NO_PROJECT })
        return true
      }
      const dirty = await projectDirty(resolvedRoot)
      const problems = projectProblems({
        project: resolvedRoot,
        root: realPath(REPO_ROOT),
        mainCheckout: await mainCheckout(),
        lanes: resolvedLanes(lanes),
        home: realPath(homedir()),
        temp: realPath(process.env.TEMP || tmpdir()),
        runs: realPath(join(process.env.TEMP || tmpdir(), 'machineroom-runs')),
        commonDir: await gitCommonDir(resolvedRoot),
        repoCommonDir: await repoCommonDir(),
        dirty,
        allowDirty,
      })
      if (problems.length > 0) {
        sendJson(req, res, 400, { error: problems.join(' ') })
        return true
      }
    } else {
      briefs = body.briefs
      if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 5) {
        sendJson(req, res, 400, { error: 'Choose one to five briefs.' })
        return true
      }
      const known = new Set(parseBriefs(tasksText).map((brief) => brief.id))
      if (briefs.some((id) => typeof id !== 'string' || !BRIEF_ID.test(id) || !known.has(id))) {
        sendJson(req, res, 400, { error: 'Choose a brief from the list.' })
        return true
      }
    }

    if (running.has(lane)) {
      sendJson(req, res, 409, { error: 'That lane is already running.' })
      return true
    }

    let entry
    try {
      entry = startRun(lane, briefs, projectRun ? { project: resolvedRoot, task, allowDirty } : null)
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not start that run.' })
      return true
    }
    notify({ topic: 'runs' })
    sendJson(req, res, 202, entry)
    return true
  }

  return { handle, stopAll }
}
