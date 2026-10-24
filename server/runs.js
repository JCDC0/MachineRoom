import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { SINCE_PROBLEM, dayStart, laneStats, pathInside, projectProblems } from '../src/briefs/run.js'
import { outcomeTable } from './outcomes.js'
import { gitPath } from './programPath.js'
import { killTree, treeSpawnOptions } from './processTree.js'

export const RECENT_LIMIT = 20
export const LAST_LINE_LIMIT = 5
export const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
export const TASK_LIMIT = 4000
export const TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
export const TASKS_LIMIT = 20
export const TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
export const TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'
export const RUN_KIND_PROBLEM = 'Send a task, a queue or briefs, not more than one.'
export const QUEUE_DIRTY_PROBLEM = 'A queue needs a clean project.'
export const BRIEF_PROJECT_PROBLEM = 'Briefs run in this repository. Use a task or a queue on another project.'
export function notGitProblem(project, { queue = false } = {}) {
  return `The project folder ${project} is not a git folder. ${queue ? 'A queue needs one.' : '--worktree needs one.'}`
}
const NO_PROJECT = 'The bridge has no project folder.'
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const REPO_LANES = join(REPO_ROOT, 'docs', 'agents', 'lanes.json')
const GIT_TIMEOUT_MS = 10 * 1000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const RUNS_BODY_LIMIT = 256 * 1024

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

async function gitCheckout(folder) {
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  return inside !== null && inside.trim() === 'true'
}

async function projectDirty(folder) {
  if (!(await gitCheckout(folder))) return false
  const status = await git(folder, ['status', '--porcelain'])
  return status !== null && status.trim() !== ''
}

function samePath(one, two) {
  return pathInside(one, two) && pathInside(two, one)
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function hasSeparatorLine(text) {
  return text.split(/\r?\n/).some((line) => line.trim() === '---')
}

export function tasksProblem(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > TASKS_LIMIT) return TASKS_PROBLEM
  for (const task of tasks) {
    if (typeof task !== 'string') return TASKS_PROBLEM
    const text = task.trim()
    if (text.length < 1 || text.length > TASK_LIMIT) return TASKS_PROBLEM
    if (hasSeparatorLine(task)) return TASK_SEPARATOR_PROBLEM
  }
  return null
}

function queuePath(lane) {
  return join(dirname(runsFile()), `${lane}-queue-${stamp()}.queue.txt`)
}

function writeQueue(file, tasks) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, tasks.map((task) => task.trim()).join('\n---\n'))
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
  let rootCommonDirPromise = null

  function rootCommonDir() {
    if (!rootCommonDirPromise) {
      rootCommonDirPromise = resolvedRoot ? gitCommonDir(resolvedRoot) : Promise.resolve('')
    }
    return rootCommonDirPromise
  }

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
      ...(item.entry.queue ? { queue: true, tasks: item.entry.tasks } : {}),
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
    if (projectRun?.queue) {
      entry.queue = true
      entry.tasks = projectRun.taskCount
    }
    const item = { entry, tail: '' }
    const args = projectRun
      ? projectRun.queue
        ? [...command.args, lane, '--project', projectRun.project, ...(projectRun.worktree ? ['--worktree'] : []), '--queue', projectRun.queue]
        : [
            ...command.args,
            lane,
            '--project',
            projectRun.project,
            '--task',
            projectRun.task,
            ...(projectRun.worktree ? ['--worktree'] : []),
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

    const body = await readJsonBody(req, res, RUNS_BODY_LIMIT)
    if (body === null) return true

    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: 'Confirm the run first.' })
      return true
    }

    const hasTasks = body.tasks !== undefined
    if (hasTasks && (body.task !== undefined || body.briefs !== undefined)) {
      sendJson(req, res, 400, { error: RUN_KIND_PROBLEM })
      return true
    }

    const projectRun = body.briefs === undefined
    if (!projectRun && (!resolvedRoot || !samePath(await rootCommonDir(), await repoCommonDir()))) {
      sendJson(req, res, 400, { error: BRIEF_PROJECT_PROBLEM })
      return true
    }
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

    if (lane === 'orchestrator') {
      sendJson(req, res, 400, { error: 'The orchestrator lane runs from the room, not as a lane run.' })
      return true
    }

    let briefs = []
    let task = ''
    let allowDirty = false
    const worktree = projectRun && body.worktree === true
    let queueFile = ''
    let taskCount = 0
    if (projectRun) {
      if (hasTasks) {
        if (body.allowDirty === true) {
          sendJson(req, res, 400, { error: QUEUE_DIRTY_PROBLEM })
          return true
        }
        const tasksListProblem = tasksProblem(body.tasks)
        if (tasksListProblem) {
          sendJson(req, res, 400, { error: tasksListProblem })
          return true
        }
        taskCount = body.tasks.length
      } else if (typeof body.task !== 'string' || body.task.trim().length < 1 || body.task.length > TASK_LIMIT) {
        sendJson(req, res, 400, { error: TASK_PROBLEM })
        return true
      } else {
        task = body.task
        allowDirty = body.allowDirty === true
      }
      if (!resolvedRoot) {
        sendJson(req, res, 400, { error: NO_PROJECT })
        return true
      }
      if ((hasTasks || worktree) && !(await gitCheckout(resolvedRoot))) {
        sendJson(req, res, 400, { error: notGitProblem(resolvedRoot, { queue: hasTasks }) })
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
        commonDir: await rootCommonDir(),
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

    if (hasTasks) {
      queueFile = queuePath(lane)
      try {
        writeQueue(queueFile, body.tasks)
      } catch {
        sendJson(req, res, 500, { error: 'The bridge could not write the queue file.' })
        return true
      }
    }

    let entry
    try {
      entry = startRun(
        lane,
        briefs,
        projectRun
          ? { project: resolvedRoot, task, allowDirty, queue: queueFile, taskCount, worktree }
          : null
      )
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
