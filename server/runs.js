import { execFile, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { SINCE_PROBLEM, dayStart, laneLockPids, laneStats, pathInside, projectProblems, runRecord } from '../src/briefs/run.js'
import { profileFromBrief, profileFromTask } from '../src/policy/profile.js'
import { readPolicy, routeLane, tierFor, TIERS } from '../src/policy/route.js'
import { readLaneCosts } from './lane-costs.js'
import { outcomeTable, subjectsFromLog } from './outcomes.js'
import { gitPath } from './programPath.js'
import { killTree, treeSpawnOptions } from './processTree.js'
import { laneAgents, lanesFolder, readAllLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { NO_ACTIVE_CHOICE_PROBLEM, activeLanesFileFor, hiddenLaneProblem, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes } from './active-lanes.js'

export const RECENT_LIMIT = 20
export const LAST_LINE_LIMIT = 5
export const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
export const TASK_LIMIT = 4000
export const TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
export const TASKS_LIMIT = 20
export const TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
export const TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'
export const RUN_KIND_PROBLEM = 'Send a task, a queue or briefs, not more than one.'
export const MAIN_RUN_PROBLEM = 'A request with no Origin cannot start a run as the main orchestrator.'
export const NO_TOKEN_PROBLEM = 'A request with no Origin needs a valid orchestrator token.'
export const TOKEN_MISMATCH_PROBLEM = 'The startedBy orchestrator must match the token.'
export const QUEUE_DIRTY_PROBLEM = 'A queue needs a clean project.'
export const BRIEF_PROJECT_PROBLEM = 'Briefs run in this repository. Use a task or a queue on another project.'
export function notGitProblem(project, { queue = false } = {}) {
  return `The project folder ${project} is not a git folder. ${queue ? 'A queue needs one.' : '--worktree needs one.'}`
}
const NO_PROJECT = 'The bridge has no project folder.'
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
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

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readTextAt(path) {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function laneLockAlive(folder, key) {
  if (!folder) return false
  const holder = laneLockPids(readTextAt(join(folder, `${key}.lock`)))
  return processAlive(holder.pid) || processAlive(holder.child)
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

export function readMainSubjects() {
  return git(REPO_ROOT, ['log', '--format=%s', 'refs/heads/main']).then((text) => (text === null ? [] : subjectsFromLog(text)))
}

export function readMainSubjectsSync() {
  let file
  try {
    file = gitPath()
  } catch {
    return []
  }
  const result = spawnSync(file, ['log', '--format=%s', 'refs/heads/main'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })
  if (result.error || result.status !== 0) return []
  return subjectsFromLog(String(result.stdout ?? ''))
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

function queuePath(lane, folder = dirname(runsFile())) {
  return join(folder, `${lane}-queue-${stamp()}.queue.txt`)
}

export function writeQueue(file, tasks, { rename = renameSync } = {}) {
  mkdirSync(dirname(file), { recursive: true })
  const content = tasks.map((task) => task.trim()).join('\n---\n')
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
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
  return join(defaultRunsFolder(), 'runs.jsonl')
}

export function outcomesFile() {
  return join(defaultRunsFolder(), 'outcomes.jsonl')
}

export function readStartLanes({ lanesFile = '', runsFolder: folder = '' } = {}) {
  const text = readTextAt(lanesFile ? resolve(lanesFile) : join(lanesFolder(), 'lanes.json'))
  if (text === null) return null
  let base
  try {
    base = JSON.parse(text)
  } catch {
    return null
  }
  if (!base || typeof base !== 'object' || Array.isArray(base)) return null
  return readAllLanes({ lanesJson: base, runsFolder: folder || defaultRunsFolder() })
}

export function laneStatesFor({
  lanesConfig,
  projectRoot = '',
  runsFolder: folder = '',
  activeLanes = null,
  isLaneActive = null,
  running = null,
} = {}) {
  const helper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
  const hiddenSet = helper && typeof helper.hiddenKeySet === 'function'
    ? helper.hiddenKeySet()
    : folder
      ? new Set(readHiddenLanes(projectLanesFileFor(projectRoot, folder)))
      : new Set()
  const saved = folder ? readActiveLanesChoice(activeLanesFileFor(projectRoot, folder)) : null
  const chosen = helper && typeof helper.isChosen === 'function' ? helper.isChosen() : saved !== null
  const lanes = []
  for (const [key, entry] of Object.entries(lanesConfig ?? {})) {
    if (key === 'orchestrator') continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const active = typeof isLaneActive === 'function'
      ? isLaneActive(key)
      : helper && typeof helper.isLaneActive === 'function'
        ? helper.isLaneActive(key)
        : saved !== null && saved.includes(key)
    lanes.push({
      key,
      eligible: entry.retired !== true && entry.cli !== null && typeof entry.cli === 'object',
      active: active === true && !hiddenSet.has(key),
      busy: (running !== null && typeof running.has === 'function' && running.has(key)) || laneLockAlive(folder, key),
    })
  }
  return { lanes, chosen }
}

const runRecordCaches = new Map()

export function clearRunsCache() {
  runRecordCaches.clear()
}

export function cachedRunRecords(file = runsFile()) {
  const target = resolve(file ?? runsFile())
  let stat
  try {
    stat = statSync(target)
  } catch {
    runRecordCaches.delete(target)
    return []
  }

  let entry = runRecordCaches.get(target)
  if (!entry) {
    entry = {
      offset: 0,
      mtimeMs: 0,
      records: [],
      tail: '',
      decoder: new StringDecoder('utf8'),
    }
    runRecordCaches.set(target, entry)
  }

  if (stat.size < entry.offset || stat.mtimeMs < entry.mtimeMs || (stat.size === entry.offset && stat.mtimeMs !== entry.mtimeMs)) {
    entry.offset = 0
    entry.records = []
    entry.tail = ''
    entry.decoder = new StringDecoder('utf8')
  } else if (stat.size === entry.offset && stat.mtimeMs === entry.mtimeMs) {
    return entry.records.slice()
  }

  let fd
  try {
    fd = openSync(target, 'r')
  } catch {
    return entry.records.slice()
  }

  try {
    const length = stat.size - entry.offset
    if (length > 0) {
      const buffer = Buffer.alloc(length)
      const got = readSync(fd, buffer, 0, length, entry.offset)
      const text = entry.decoder.write(buffer.subarray(0, got))
      const parts = (entry.tail + text).split(/\r?\n/)
      entry.tail = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        try {
          entry.records.push(JSON.parse(line))
        } catch {}
      }
      if (entry.tail.trim()) {
        try {
          entry.records.push(JSON.parse(entry.tail))
          entry.tail = ''
        } catch {}
      }
      entry.offset += got
    }
    entry.mtimeMs = stat.mtimeMs
  } finally {
    closeSync(fd)
  }

  return entry.records.slice()
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

export function newestRecordPerLane(records) {
  const latest = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue
    const lane = typeof record.lane === 'string' ? record.lane.trim() : ''
    if (!lane) continue
    const kept = latest.get(lane)
    if (!kept) {
      latest.set(lane, record)
      continue
    }
    const started = Date.parse(record.startedAt)
    const keptStarted = Date.parse(kept.startedAt)
    if (!Number.isFinite(keptStarted) || (Number.isFinite(started) && started >= keptStarted)) latest.set(lane, record)
  }
  return [...latest.values()]
}

export function readAllRunRecords(file = runsFile()) {
  return cachedRunRecords(file)
}

export function readOutcomeRecords(file) {
  return readJsonLines(file)
}

export function createRunsApi({ projectRoot = '', briefsDir = '', runnerCommand, sendJson, readJsonBody, notify = () => {}, orchestrators = () => null, lanesFile = '', runsFolder = '', activeLanes = null, isLaneActive = null, onMessage = () => {} }) {
  const resolvedRoot = projectRoot ? realPath(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const laneFile = lanesFile ? resolve(lanesFile) : join(lanesFolder(), 'lanes.json')
  const recordsDir = () => (runsFolder ? resolve(runsFolder) : dirname(runsFile()))
  const recordsPath = () => join(recordsDir(), 'runs.jsonl')
  const outcomesPath = () => join(recordsDir(), 'outcomes.jsonl')
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

  function profileForTasks(tasks) {
    let best = null
    let rank = -1
    for (const text of tasks) {
      const profile = profileFromTask(text)
      const next = TIERS.indexOf(tierFor(profile))
      if (next > rank) {
        best = profile
        rank = next
      }
    }
    return best ?? profileFromTask('')
  }

  function routeStart({ lanesConfig, profile, only }) {
    const policyText = readText('policy.json') ?? readPath(join(lanesFolder(), 'policy.json'))
    if (policyText === null) return { status: 404, error: 'The policy file is missing.' }
    let policy
    try {
      policy = readPolicy(policyText)
    } catch (error) {
      return { status: 400, error: error.message }
    }
    const costs = readLaneCosts({ agents: laneAgents(lanesConfig), records: readAllRunRecords(recordsPath()) })
    const state = laneStatesFor({ lanesConfig, projectRoot, runsFolder: recordsDir(), activeLanes, isLaneActive, running })
    if (!state.chosen) return { status: 400, error: NO_ACTIVE_CHOICE_PROBLEM }
    const states = state.lanes.filter((lane) => only === null || only.includes(lane.key))
    const answer = routeLane({
      policy,
      profile,
      quotas: costs.quota,
      spent: { companyMonthlyUsd: costs.summary.spendCents / 100 },
      lanes: states,
    })
    if (answer.lane === null) return { status: 409, error: answer.reason }
    return { lane: answer.lane, routed: { tier: answer.tier, reason: answer.reason } }
  }

  function readActor(req, body) {
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    const page = Boolean(req.headers.origin)
    if (!page) {
      if (!registry) return { registry: null, page, actor: '', startedBy: '', sector: null, missingSector: false }
      const tokenHeader = req.headers['x-machineroom-orchestrator']
      const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : Array.isArray(tokenHeader) ? tokenHeader[0].trim() : ''
      const actor = registry.idForToken(token)
      if (!actor) return { status: 403, error: NO_TOKEN_PROBLEM }
      const main = actor === 'orchestrator'
      let startedBy = ''
      if (Object.hasOwn(body, 'startedBy')) {
        const wanted = typeof body.startedBy === 'string' ? body.startedBy.trim() : ''
        if (!wanted) return { status: 403, error: TOKEN_MISMATCH_PROBLEM }
        if (wanted !== actor) {
          const target = main ? registry.sector(wanted) : null
          if (!target) return { status: 403, error: TOKEN_MISMATCH_PROBLEM }
          startedBy = wanted
        } else {
          startedBy = wanted
        }
      } else if (!main) {
        startedBy = actor
      }
      let sector = null
      let missingSector = false
      if (!main) {
        sector = registry.sector(actor)
        missingSector = !sector
      } else if (startedBy !== '' && startedBy !== actor) {
        sector = registry.sector(startedBy)
      }
      return { registry, page, actor, startedBy, sector, missingSector }
    }
    if (Object.hasOwn(body, 'startedBy')) {
      const wanted = typeof body.startedBy === 'string' ? body.startedBy.trim() : ''
      if (!wanted) return { status: 400, error: 'startedBy needs an orchestrator id.' }
      const sector = registry ? registry.sector(wanted) : null
      if (!sector) return { status: 400, error: 'There is no orchestrator with that id.' }
      return { registry, page, actor: '', startedBy: wanted, sector: wanted === 'orchestrator' ? null : sector, missingSector: false }
    }
    return { registry, page, actor: '', startedBy: '', sector: null, missingSector: false }
  }

  function finishActor(info, lane) {
    const { registry, page, actor, sector } = info
    if (sector && Array.isArray(sector.lanes) && !sector.lanes.includes(lane)) {
      const name = typeof sector.name === 'string' && sector.name.trim() ? sector.name.trim() : actor || info.startedBy
      return { status: 403, error: `The ${name} sector does not hold the lane ${lane}.` }
    }
    if (info.missingSector) {
      const name = actor || info.startedBy
      return { status: 403, error: `The ${name} sector does not hold the lane ${lane}.` }
    }
    let startedBy = info.startedBy
    if (!startedBy) {
      const holder = registry && typeof registry.sectorForLane === 'function' ? registry.sectorForLane(lane) : null
      if (holder) startedBy = holder.id
      else if (!page && registry && actor === 'orchestrator') startedBy = actor
    }
    return { startedBy }
  }

  function laneRestriction(info) {
    if (info.missingSector) return []
    if (info.sector && Array.isArray(info.sector.lanes)) return info.sector.lanes
    return null
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

  function flushTail(item) {
    const tail = item.tail.trim()
    if (tail) {
      item.entry.lastLines.push(tail)
      if (item.entry.lastLines.length > LAST_LINE_LIMIT) item.entry.lastLines.shift()
      item.tail = ''
    }
  }

  function finish(item) {
    if (running.get(item.entry.lane) !== item) return
    flushTail(item)
    running.delete(item.entry.lane)
    if (stopped) return
    notify({ topic: 'runs' })
  }

  function hasRecordForLaneSince(lane, startedAt) {
    try {
      const records = readAllRunRecords(recordsPath())
      const startTime = new Date(startedAt).getTime()
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i]
        if (r.lane === lane && new Date(r.startedAt).getTime() >= startTime) {
          return true
        }
      }
    } catch {}
    return false
  }

  function recordRefusal(item, exitCode) {
    if (hasRecordForLaneSince(item.entry.lane, item.entry.startedAt)) return
    const note = item.entry.lastLines.join(' ').trim()
    const record = runRecord({
      lane: item.entry.lane,
      briefs: item.entry.briefs,
      startedAt: item.entry.startedAt,
      minutes: 0,
      exitCode,
      killed: false,
      note: note !== '' ? note.slice(0, 200) : 'the runner refused to start or could not start',
      ...(item.project ? { project: item.project, task: item.task } : {}),
      ...(item.startedBy ? { startedBy: item.startedBy } : {}),
    })
    try {
      appendFileSync(recordsPath(), `${JSON.stringify(record)}\n`)
    } catch {}
  }

  function startRun(lane, briefs, projectRun = null, startedBy = '', reasoning = '') {
    const entry = { lane, briefs: [...briefs], startedAt: new Date().toISOString(), lastLines: [] }
    if (projectRun?.queue) {
      entry.queue = true
      entry.tasks = projectRun.taskCount
    }
    const startedArgs = startedBy ? ['--started-by', startedBy] : []
    const reasoningArgs = reasoning ? ['--reasoning', reasoning] : []
    const item = {
      entry,
      tail: '',
      project: projectRun?.project || '',
      task: projectRun?.task || '',
      startedBy,
    }
    const args = projectRun
      ? projectRun.queue
        ? [...command.args, lane, '--project', projectRun.project, ...(projectRun.worktree ? ['--worktree'] : []), '--queue', projectRun.queue, ...startedArgs, ...reasoningArgs]
        : [
            ...command.args,
            lane,
            '--project',
            projectRun.project,
            '--task',
            projectRun.task,
            ...(projectRun.worktree ? ['--worktree'] : []),
            ...(projectRun.allowDirty ? ['--allow-dirty'] : []),
            ...startedArgs,
            ...reasoningArgs,
          ]
      : [...command.args, lane, ...briefs, ...startedArgs]
    const child = spawn(command.file, args, {
      cwd: projectRun ? REPO_ROOT : resolvedRoot || undefined,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MACHINEROOM_RUNS: recordsDir(),
        ...(lanesFile && projectRun ? { MACHINEROOM_LANES_FILE: laneFile } : {}),
      },
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
    child.on('error', (error) => {
      entry.lastLines.push(`start failed: ${String(error?.message ?? error)}`)
      if (entry.lastLines.length > LAST_LINE_LIMIT) entry.lastLines.shift()
      flushTail(item)
      if (!stopped) recordRefusal(item, 1)
      finish(item)
    })
    child.on('close', (code) => {
      flushTail(item)
      if (!stopped && (code === null || code !== 0)) recordRefusal(item, code ?? 1)
      finish(item)
    })
    if (startedBy) {
      try {
        onMessage({ from: startedBy === 'orchestrator' ? 'orchestrator' : `sub-${startedBy}`, to: lane, kind: 'dispatch' })
      } catch {}
    }
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
      const records = readAllRunRecords(recordsPath())
      const outcomes = readOutcomeRecords(outcomesPath())
      const subjects = await readMainSubjects()
      sendJson(req, res, 200, { rows: outcomeTable(records, outcomes, subjects) })
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
      const records = readAllRunRecords(recordsPath())
      sendJson(req, res, 200, laneStats(records, since === null ? {} : { since }))
      return true
    }
    if (path !== '/api/control/runs') return false

    if (method === 'GET') {
      const records = readAllRunRecords(recordsPath())
      sendJson(req, res, 200, {
        project: resolvedRoot ? basename(resolvedRoot) : '',
        running: [...running.values()].map(snapshot),
        recent: records.slice(-RECENT_LIMIT).reverse(),
        last: newestRecordPerLane(records),
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
    let lanes
    let tasksText = null
    if (projectRun) {
      const lanesText = readPath(laneFile)
      if (lanesText === null) {
        sendJson(req, res, 404, { error: 'The brief files are missing.' })
        return true
      }
      lanes = readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })
    } else {
      const lanesText = readText('lanes.json')
      tasksText = readText('TASKS.md')
      if (lanesText === null || tasksText === null) {
        sendJson(req, res, 404, { error: 'The brief files are missing.' })
        return true
      }
      try {
        lanes = JSON.parse(lanesText)
      } catch {
        lanes = null
      }
    }
    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
      sendJson(req, res, 400, { error: 'The lane file is not valid.' })
      return true
    }

    const wantsAuto = body.lane === undefined || body.lane === null || body.lane === 'auto' || body.lane === ''
    let startInfo = null
    let startedBy = ''
    if (wantsAuto) {
      startInfo = readActor(req, body)
      if (startInfo.error) {
        sendJson(req, res, startInfo.status, { error: startInfo.error })
        return true
      }
    }

    let lane = typeof body.lane === 'string' ? body.lane : ''
    if (!wantsAuto) {
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

      const activeHelper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
      const isHidden = typeof isLaneHidden === 'function'
        ? isLaneHidden(lane)
        : activeHelper && typeof activeHelper.isLaneHidden === 'function'
          ? activeHelper.isLaneHidden(lane)
          : runsFolder && projectRoot
            ? readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder)).includes(lane)
            : false
      if (isHidden) {
        sendJson(req, res, 400, { error: hiddenLaneProblem(lane) })
        return true
      }
      const chosen = activeHelper && typeof activeHelper.isChosen === 'function'
        ? activeHelper.isChosen()
        : runsFolder
          ? readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder)) !== null
          : true
      if (!chosen) {
        sendJson(req, res, 400, { error: 'Pick the lanes for this project first.' })
        return true
      }

      const laneActive = typeof isLaneActive === 'function'
        ? isLaneActive(lane)
        : activeHelper && typeof activeHelper.isLaneActive === 'function'
          ? activeHelper.isLaneActive(lane)
          : true
      if (!laneActive) {
        sendJson(req, res, 400, { error: `The lane ${lane} is not active. Add it in Agents first.` })
        return true
      }

      startInfo = readActor(req, body)
      if (startInfo.error) {
        sendJson(req, res, startInfo.status, { error: startInfo.error })
        return true
      }
      const finish = finishActor(startInfo, lane)
      if (finish.error) {
        sendJson(req, res, finish.status, { error: finish.error })
        return true
      }
      startedBy = finish.startedBy
    }

    let briefs = []
    let parsedBriefs = null
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
    } else {
      briefs = body.briefs
      if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 5) {
        sendJson(req, res, 400, { error: 'Choose one to five briefs.' })
        return true
      }
      parsedBriefs = parseBriefs(tasksText)
      const known = new Set(parsedBriefs.map((brief) => brief.id))
      if (briefs.some((id) => typeof id !== 'string' || !BRIEF_ID.test(id) || !known.has(id))) {
        sendJson(req, res, 400, { error: 'Choose a brief from the list.' })
        return true
      }
    }

    let routedAnswer = null
    if (wantsAuto) {
      const profile = projectRun
        ? profileForTasks(hasTasks ? body.tasks : [task])
        : profileFromBrief(parsedBriefs.find((brief) => brief.id === briefs[0]) ?? { text: '' })
      const routed = routeStart({ lanesConfig: lanes, profile, only: laneRestriction(startInfo) })
      if (routed.error) {
        sendJson(req, res, routed.status, { error: routed.error })
        return true
      }
      lane = routed.lane
      routedAnswer = routed.routed
      const finish = finishActor(startInfo, lane)
      if (finish.error) {
        sendJson(req, res, finish.status, { error: finish.error })
        return true
      }
      startedBy = finish.startedBy
    }

    if (projectRun) {
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
        runs: realPath(recordsDir()),
        commonDir: await rootCommonDir(),
        repoCommonDir: await repoCommonDir(),
        dirty,
        allowDirty,
      })
      if (problems.length > 0) {
        sendJson(req, res, 400, { error: problems.join(' ') })
        return true
      }
    }

    if (running.has(lane)) {
      sendJson(req, res, 409, { error: 'That lane is already running.' })
      return true
    }

    if (hasTasks) {
      queueFile = queuePath(lane, recordsDir())
      try {
        writeQueue(queueFile, body.tasks)
      } catch {
        sendJson(req, res, 500, { error: 'The bridge could not write the queue file.' })
        return true
      }
    }

    let entry
    try {
      const laneConfig = lanes[lane]
      const reasoning = laneConfig?.effort || ''
      entry = startRun(
        lane,
        briefs,
        projectRun
          ? { project: resolvedRoot, task, allowDirty, queue: queueFile, taskCount, worktree }
          : null,
        startedBy,
        reasoning
      )
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not start that run.' })
      return true
    }
    notify({ topic: 'runs' })
    sendJson(req, res, 202, routedAnswer ? { ...entry, routed: routedAnswer } : entry)
    return true
  }

  return { handle, stopAll, isRunning: (lane) => (lane !== undefined ? running.has(lane) : running.size > 0) }
}
