import { execFile, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { attentionItems } from '../src/briefs/attention.js'
import { KEY_MASK, maskKeys } from '../src/briefs/audit.js'
import { SINCE_PROBLEM, checkCommandLines, dayStart, formatInterruptMessage, interruptSenderFrom, laneLockLog, laneLockPids, laneLockStartedAt, laneModeProblem as runnerModeProblem, laneStats, laneWithOverrides, maskProfilePaths, pathInside, projectProblems, runRecord, summarizeRun, worktreeFor } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { profileFromBrief, profileFromTask } from '../src/policy/profile.js'
import { readPolicy, routeLane, tierFor, TIERS } from '../src/policy/route.js'
import { conversationFromLog } from '../src/model/conversation.js'
import { readLaneCosts } from './lane-costs.js'
import { laneAgentList, laneTaskState, mergedBriefIds, readLaneBriefs, recentLaneRecords } from './lane-tasks.js'
import { defaultMode, legacyMode } from '../src/control/modes.js'
import { modelUnavailableProblem } from './model-list.js'
import { modelAllowed } from './harness-models.js'
import { readHarnessSettings } from './harness-settings.js'
import { mergeCommitsFromLog, outcomeTable } from './outcomes.js'
import { gitEnv, gitPath } from './programPath.js'
import { descendantProcesses, isLockHolderStale, killTree, leftoverProcesses, listProcesses, treeSpawnOptions } from './processTree.js'
import { createLaneLockCheck, laneAgents, laneLockAlive, lanesFolder, readAllLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { readLaneLock } from '../scripts/lane-lock.mjs'
import { NO_ACTIVE_CHOICE_PROBLEM, activeLanesFileFor, hiddenLaneProblem, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes } from './active-lanes.js'
import { checkCommandProblem, createProjectSettingsApi, readProjectCheckCommand } from './project-settings.js'

const RECENT_LIMIT = 20
const LAST_LINE_LIMIT = 5
const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
export const TASK_LIMIT = 4000
export const TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
const TASKS_LIMIT = 20
export const TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
export const TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'
export const RUN_KIND_PROBLEM = 'Send a task, a queue or briefs, not more than one.'
export const NO_TOKEN_PROBLEM = 'A request with no Origin needs a valid orchestrator token.'
const TOKEN_MISMATCH_PROBLEM = 'The startedBy orchestrator must match the token.'
export const QUEUE_DIRTY_PROBLEM = 'A queue needs a clean project.'
export const BRIEF_PROJECT_PROBLEM = 'Briefs run in this repository. Use a task or a queue on another project.'
const CONFIRM_STOP_PROBLEM = 'Confirm the stop first.'
const STOP_LANE_PROBLEM = 'Choose a lane to stop.'
const STOP_TIME_PROBLEM = 'Name the start time to stop.'
const STOP_MISMATCH_PROBLEM = 'That start time does not match the running run.'
const STOP_BUSY_PROBLEM = 'That run is already stopping.'
const SECTOR_STOPPING_PROBLEM = 'That sector is stopping.'
const CONVERSATION_UNKNOWN_PROBLEM = 'No run of that lane started at that time.'
const CONVERSATION_LOG_OUTSIDE_PROBLEM = "The run's log is outside the runs folder."
const CONVERSATION_LOG_MISSING_PROBLEM = "The run's log is missing."
const CONVERSATION_LOG_BYTES = 8 * 1024 * 1024
const LIVE_TOUCH_LIMIT = 50
const STOP_TIMEOUT_MS = 15 * 1000
const STOP_SETTLE_MS = 50
export function notGitProblem(project, { queue = false } = {}) {
  return `The project folder ${project} is not a git folder. ${queue ? 'A queue needs one.' : '--worktree needs one.'}`
}
const NO_PROJECT = 'The bridge has no project folder.'
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const GIT_TIMEOUT_MS = 10 * 1000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const MAIN_SUBJECTS_TTL_MS = 30 * 1000
const RUNS_BODY_LIMIT = 256 * 1024

function oneLineTask(value, limit = 120) {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  return `${clean.slice(0, limit - 3)}...`
}

function stopTaskLabel(item) {
  if (Array.isArray(item.entry.briefs) && item.entry.briefs.length > 0) {
    return item.entry.briefs.join(' ')
  }
  const text = oneLineTask(item.task || (item.entry.queue && item.entry.tasks === 1 ? item.firstTask : ''))
  if (text) return text
  if (item.entry.queue) {
    return `${item.entry.tasks} task${item.entry.tasks === 1 ? '' : 's'} in order`
  }
  return 'this project'
}

function realPath(value) {
  const folder = resolve(String(value ?? ''))
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

export function runLogInside(log, folder, resolveReal = realPath) {
  if (pathInside(resolveReal(log), resolveReal(folder))) return true
  const root = resolve(folder)
  const path = resolve(log)
  if (!pathInside(path, root)) return false
  let part = root
  try {
    for (const name of relative(root, path).split(sep).filter(Boolean)) {
      part = join(part, name)
      if (lstatSync(part).isSymbolicLink()) return false
    }
    return true
  } catch {
    return false
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
      { cwd: folder, env: gitEnv(), encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        done(error ? null : String(stdout ?? ''))
      }
    )
  })
}

export async function isGitCheckout(folder) {
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  return inside !== null && inside.trim() === 'true'
}

let mainSubjectsCache = null

export function readMainSubjects({ now = Date.now, run = git } = {}) {
  const startedAt = now()
  if (mainSubjectsCache && startedAt >= mainSubjectsCache.startedAt && startedAt - mainSubjectsCache.startedAt < MAIN_SUBJECTS_TTL_MS) {
    return mainSubjectsCache.promise
  }
  const entry = { startedAt, promise: null }
  entry.promise = Promise.resolve(run(REPO_ROOT, ['log', '--format=%H %cI %s', 'refs/heads/main']))
    .then((text) => {
      if (text === null) {
        if (mainSubjectsCache === entry) mainSubjectsCache = null
        return []
      }
      return mergeCommitsFromLog(text)
    })
    .catch(() => {
      if (mainSubjectsCache === entry) mainSubjectsCache = null
      return []
    })
  mainSubjectsCache = entry
  return entry.promise
}

export function readMainSubjectsSync() {
  let file
  try {
    file = gitPath()
  } catch {
    return []
  }
  const result = spawnSync(file, ['log', '--format=%H %cI %s', 'refs/heads/main'], {
    cwd: REPO_ROOT,
    env: gitEnv(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })
  if (result.error || result.status !== 0) return []
  return mergeCommitsFromLog(String(result.stdout ?? ''))
}

async function projectDirty(folder) {
  if (!(await isGitCheckout(folder))) return false
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

export function findRunLog(folder, record, resolveReal = realPath, lanes = {}) {
  if (!lanes) return ''
  const started = Date.parse(record.startedAt)
  const briefs = Array.isArray(record.briefs) ? record.briefs : []
  const parts = [record.lane, ...(briefs.length ? briefs : ['project'])]
  if (!Number.isFinite(started) || parts.some((part) => typeof part !== 'string' || !part || /[/\\]/.test(part))) return ''
  let names
  try { names = readdirSync(folder) } catch { return '' }
  const prefix = `${parts.join('-')}-`
  const candidates = []
  for (let offset = -5; offset <= 5; offset += 1) {
    const time = Math.floor(started / 1000) * 1000 + offset * 1000
    const base = `${prefix}${stamp(new Date(time))}`.toLowerCase()
    for (const name of names) {
      const lower = name.toLowerCase()
      if (lower !== `${base}.log` && !(lower.startsWith(`${base}-`) && /^\d+\.log$/.test(lower.slice(base.length + 1)))) continue
      if (Object.keys(lanes).some((key) => key.toLowerCase().startsWith(`${record.lane.toLowerCase()}-`) && prefix.toLowerCase().startsWith(`${key.toLowerCase()}-`) && prefix.length > key.length + 1)) continue
      const path = join(folder, name)
      if (runLogInside(path, folder, resolveReal) && existsSync(path)) candidates.push({ path, distance: Math.abs(time - started) })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))
  return candidates[0]?.path ?? ''
}

function hasSeparatorLine(text) {
  return text.split(/\r?\n/).some((line) => line.trim() === '---')
}

function tasksProblem(tasks) {
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
  platform = process.platform,
  list = listProcesses,
  stat = statSync,
} = {}) {
  const helper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
  const hiddenSet = helper && typeof helper.hiddenKeySet === 'function'
    ? helper.hiddenKeySet()
    : folder
      ? new Set(readHiddenLanes(projectLanesFileFor(projectRoot, folder)))
      : new Set()
  const saved = folder ? readActiveLanesChoice(activeLanesFileFor(projectRoot, folder)) : null
  const chosen = helper && typeof helper.isChosen === 'function' ? helper.isChosen() : saved !== null
  const checkLock = createLaneLockCheck({ platform, list, stat })
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
      busy: (running !== null && typeof running.has === 'function' && running.has(key)) || checkLock(folder, key),
    })
  }
  return { lanes, chosen }
}

export const RUN_READ_CHUNK_BYTES = 4 * 1024 * 1024
const RUN_SAMPLE_BYTES = 512

const runRecordCaches = new Map()

export function clearRunsCache() {
  runRecordCaches.clear()
  mainSubjectsCache = null
}

export function runRecordCacheStats(file = runsFile()) {
  const entry = runRecordCaches.get(resolve(file ?? runsFile()))
  if (!entry) return null
  return {
    offset: entry.offset,
    records: entry.records.length,
    fullReads: entry.fullReads,
    incrementalReads: entry.incrementalReads,
    bytesRead: entry.bytesRead,
  }
}

function resetRunCacheEntry(entry) {
  entry.offset = 0
  entry.ino = null
  entry.headSample = null
  entry.tailSample = null
  entry.records = Object.freeze([])
  entry.tail = ''
  entry.decoder = new StringDecoder('utf8')
}

function sampleMatches(fd, offset, expected) {
  if (!expected || expected.length === 0) return true
  const sample = Buffer.allocUnsafe(expected.length)
  let sampleRead = 0
  while (sampleRead < sample.length) {
    const got = readSync(fd, sample, sampleRead, sample.length - sampleRead, offset + sampleRead)
    if (got <= 0) break
    sampleRead += got
  }
  return sampleRead === expected.length && Buffer.compare(sample, expected) === 0
}

function appendTailSample(prev, chunk) {
  if (chunk.length >= RUN_SAMPLE_BYTES) {
    return Buffer.from(chunk.subarray(chunk.length - RUN_SAMPLE_BYTES))
  }
  if (!prev || prev.length === 0) return Buffer.from(chunk)
  const keep = Math.min(prev.length, RUN_SAMPLE_BYTES - chunk.length)
  return Buffer.concat([prev.subarray(prev.length - keep), chunk])
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
      ino: null,
      headSample: null,
      tailSample: null,
      records: Object.freeze([]),
      tail: '',
      decoder: new StringDecoder('utf8'),
      fullReads: 0,
      incrementalReads: 0,
      bytesRead: 0,
    }
    runRecordCaches.set(target, entry)
  }

  const inoChanged = entry.ino !== null && stat.ino !== entry.ino
  const sizeMismatch = stat.size < entry.offset || (stat.size === entry.offset && stat.mtimeMs !== entry.mtimeMs)
  if (sizeMismatch || stat.mtimeMs < entry.mtimeMs || inoChanged) {
    const hadContent = entry.offset > 0
    resetRunCacheEntry(entry)
    if (hadContent && stat.size === 0) entry.fullReads += 1
  } else if (stat.size === entry.offset && stat.mtimeMs === entry.mtimeMs) {
    return entry.records
  }

  let fd
  try {
    fd = openSync(target, 'r')
  } catch {
    return entry.records
  }

  const fresh = []
  try {
    if (entry.offset > 0) {
      const headOk = sampleMatches(fd, 0, entry.headSample)
      const tailOffset = entry.tailSample ? entry.offset - entry.tailSample.length : 0
      const tailOk =
        !entry.tailSample ||
        entry.tailSample.length === 0 ||
        entry.offset <= (entry.headSample?.length ?? 0) ||
        sampleMatches(fd, tailOffset, entry.tailSample)
      if (!headOk || !tailOk) {
        resetRunCacheEntry(entry)
      }
    }

    let remaining = stat.size - entry.offset
    if (remaining > 0) {
      if (entry.offset === 0) entry.fullReads += 1
      else entry.incrementalReads += 1
      const buffer = Buffer.alloc(Math.min(remaining, RUN_READ_CHUNK_BYTES))
      while (remaining > 0) {
        const want = Math.min(remaining, buffer.length)
        const got = readSync(fd, buffer, 0, want, entry.offset)
        if (got <= 0) break
        const chunk = buffer.subarray(0, got)
        if (entry.offset === 0) {
          entry.headSample = Buffer.from(chunk.subarray(0, Math.min(got, RUN_SAMPLE_BYTES)))
        }
        entry.tailSample = appendTailSample(entry.tailSample, chunk)
        entry.offset += got
        entry.bytesRead += got
        remaining -= got
        const text = entry.decoder.write(chunk)
        const parts = (entry.tail + text).split(/\r?\n/)
        entry.tail = parts.pop() ?? ''
        for (const line of parts) {
          if (!line.trim()) continue
          try {
            fresh.push(Object.freeze(JSON.parse(line)))
          } catch {}
        }
      }
      if (entry.tail.trim()) {
        try {
          fresh.push(Object.freeze(JSON.parse(entry.tail)))
          entry.tail = ''
        } catch {}
      }
    }
    entry.mtimeMs = stat.mtimeMs
    entry.ino = stat.ino
  } finally {
    if (fresh.length > 0) entry.records = Object.freeze(entry.records.concat(fresh))
    closeSync(fd)
  }

  return entry.records
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

function readLogTail(path) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  const start = Math.max(0, stat.size - CONVERSATION_LOG_BYTES)
  if (start === 0) {
    try {
      return { text: readFileSync(path, 'utf8'), cut: false }
    } catch {
      return null
    }
  }
  let fd
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    let read = 0
    while (read < buffer.length) {
      const got = readSync(fd, buffer, read, buffer.length - read, start + read)
      if (got <= 0) break
      read += got
    }
    let text = buffer.subarray(0, read).toString('utf8')
    const newline = text.indexOf('\n')
    if (newline !== -1 && newline + 1 < text.length) text = text.slice(newline + 1)
    return { text, cut: true }
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {}
    }
  }
}

function conversationPrompt(record, tasksText) {
  if (typeof record?.task === 'string' && record.task.trim() !== '') return record.task
  const ids = Array.isArray(record?.briefs) ? record.briefs.filter((id) => typeof id === 'string' && id.trim() !== '') : []
  if (ids.length === 0) return ''
  if (tasksText) {
    const briefs = parseBriefs(tasksText).filter((brief) => ids.includes(brief.id))
    if (briefs.length > 0) {
      return briefs
        .map((brief) => {
          const title = brief.title.trim().replace(/[.:;!?]+$/, '')
          return `Task ${brief.id}: ${title}.\n${brief.text}`
        })
        .join('\n\n')
    }
  }
  return `Task ${ids.join(', ')}.`
}

function newestRecordPerLane(records) {
  const latest = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue
    const lane = typeof record.lane === 'string' ? record.lane.trim() : ''
    if (!lane) continue
    const kept = latest.get(lane)
    if (!kept) {
      latest.set(lane, { record, time: Date.parse(record.startedAt) })
      continue
    }
    const started = Date.parse(record.startedAt)
    if (!Number.isFinite(kept.time) || (Number.isFinite(started) && started >= kept.time)) {
      latest.set(lane, { record, time: started })
    }
  }
  return Array.from(latest.values(), (entry) => entry.record)
}

function isAppendOnlyExtension(list, prev) {
  if (prev === null || list.length < prev.length) return false
  if (prev.length === 0) return true
  return list[0] === prev[0] && list[prev.length - 1] === prev[prev.length - 1]
}

export function readAllRunRecords(file = runsFile()) {
  return cachedRunRecords(file)
}

export function readOutcomeRecords(file) {
  return readJsonLines(file)
}

const RECORD_PATH_KEYS = new Set(['log', 'project', 'worktree', 'folder', 'path', 'cwd'])

const REPO_CHECK_FLOOR_MS = 5000
const PATH_CACHE_TTL_MS = 30 * 1000
const PATH_CACHE_LIMIT = 1024

function readTimedCache(map, key, timestamp) {
  const entry = map.get(key)
  if (!entry) return undefined
  if (timestamp >= entry.at && timestamp - entry.at < PATH_CACHE_TTL_MS) {
    return entry.value
  }
  map.delete(key)
  return undefined
}

function writeTimedCache(map, key, value, timestamp) {
  if (!map.has(key) && map.size >= PATH_CACHE_LIMIT) map.clear()
  map.set(key, { value, at: timestamp })
}

export function createRunsApi({ projectRoot = '', briefsDir = '', runnerCommand, sendJson, readJsonBody, notify = () => {}, orchestrators = () => null, lanesSource = () => null, lanesFile = '', runsFolder = '', activeLanes = null, isLaneActive = null, onMessage = () => {}, onRefusal = null, platform = process.platform, list = listProcesses, stat = statSync, readFile = readFileSync, summarize = summarizeRun, resolvePath = realPath, bridgeUrl = '', refreshModelDetails = () => {}, now = Date.now }) {
  let resolvedRoot = projectRoot ? resolvePath(projectRoot) : ''
  const resolvedBriefs = briefsDir ? resolve(briefsDir) : resolvedRoot ? join(resolvedRoot, 'docs', 'agents') : ''
  const laneFile = lanesFile ? resolve(lanesFile) : join(lanesFolder(), 'lanes.json')
  const lanesDir = dirname(laneFile)
  const recordsDir = () => (runsFolder ? resolve(runsFolder) : dirname(runsFile()))
  const readSavedCheckCommand = () => readProjectCheckCommand(resolvedRoot, recordsDir())
  const recordsPath = () => join(recordsDir(), 'runs.jsonl')
  const outcomesPath = () => join(recordsDir(), 'outcomes.jsonl')
  const command = runnerCommand ?? { file: process.execPath, args: ['scripts/run-lane.mjs'] }
  const projectSettings = createProjectSettingsApi({
    projectRoot: resolvedRoot,
    runsFolder: recordsDir,
    sendJson,
    readJsonBody,
    notify,
  })
  const running = new Map()
  const laneTickets = new Map()
  const activeInterrupts = new Map()
  const touchedCache = new Map()
  let lastStartMs = 0
  let stopped = false
  let rootCommonDirPromise = null
  let rootCommonDirStamp = null

  function bridgeAddress() {
    const value = typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl
    return typeof value === 'string' ? value.trim() : ''
  }

  function statStamp(target) {
    try {
      const info = stat(target)
      return `${info.ino ?? ''}:${info.mtimeMs ?? ''}:${info.ctimeMs ?? ''}:${info.size ?? ''}`
    } catch {
      return 'missing'
    }
  }

  function projectRepoStamp() {
    if (!projectRoot) return ''
    return `${statStamp(projectRoot)}|${statStamp(join(projectRoot, '.git'))}`
  }

  function rootCommonDir() {
    if (!projectRoot) return Promise.resolve('')
    const stamp = projectRepoStamp()
    if (rootCommonDirStamp !== null && stamp !== rootCommonDirStamp) {
      const nextRoot = resolvePath(projectRoot)
      if (nextRoot !== resolvedRoot) {
        resolvedRoot = nextRoot
        resolvedPathCache.clear()
        rootMatchCache.clear()
        worktreeResolvedCache.clear()
        worktreeMatchCache.clear()
        cachedRoomSource = null
      }
      rootCommonDirPromise = null
    }
    if (!rootCommonDirPromise) {
      rootCommonDirStamp = stamp
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
    const policyText = readPath(join(lanesDir, 'policy.json'))
    if (policyText === null) return { status: 404, error: 'The policy file is missing.' }
    let policy
    try {
      policy = readPolicy(policyText)
    } catch (error) {
      return { status: 400, error: error.message }
    }
    const costs = readLaneCosts({ agents: laneAgents(lanesConfig), records: readAllRunRecords(recordsPath()) })
    const state = laneStatesFor({ lanesConfig, projectRoot, runsFolder: recordsDir(), activeLanes, isLaneActive, running, platform, list, stat })
    if (!state.chosen) return { status: 400, error: NO_ACTIVE_CHOICE_PROBLEM }
    const states = state.lanes.filter((lane) => only === null || only.includes(lane.key))
    const answer = routeLane({
      policy,
      profile,
      quotas: costs.quota,
      spent: { companyMonthlyUsd: costs.summary.spendCents / 100 },
      lanes: states,
    })
    const anyLane = states.some((lane) => lane.eligible && lane.active)
    const ownerOnly = policy.tiers[answer.tier]?.every((choice) => choice.lane === 'owner')
    if (answer.lane === null && !anyLane && ownerOnly) {
      answer.reason = `There is no lane for the ${answer.tier} tier. Make one in the room.`
    }
    if (answer.lane === null) return { status: 409, error: answer.reason }
    return { lane: answer.lane, routed: { tier: answer.tier, reason: answer.reason } }
  }

  function readActor(req, body) {
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    const page = Boolean(req.headers.origin)
    if (!page) {
      if (!registry) return { status: 403, error: NO_TOKEN_PROBLEM }
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

  function allowedLanesFor(info) {
    if (!info || !info.sector || !Array.isArray(info.sector.lanes)) return null
    const lanes = info.sector.lanes
      .map((lane) => (typeof lane === 'string' ? lane.trim() : ''))
      .filter((lane) => lane !== '')
    return lanes.length > 0 ? lanes : null
  }

  function sectorStoppingError(lane = '', startedBy = '') {
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    if (!registry) return ''
    if (lane && typeof registry.isLaneStopping === 'function' && registry.isLaneStopping(lane)) {
      return SECTOR_STOPPING_PROBLEM
    }
    if (startedBy && typeof registry.isSectorStopping === 'function' && registry.isSectorStopping(startedBy)) {
      return SECTOR_STOPPING_PROBLEM
    }
    return ''
  }

  function safeListProcesses() {
    try {
      const items = list({ platform })
      return Array.isArray(items) && items.length > 0 ? items : null
    } catch {
      return null
    }
  }

  function safeLockMtime(path) {
    try {
      return stat(path).mtimeMs
    } catch {
      return null
    }
  }

  function lockFileNames(folder) {
    try {
      return readdirSync(folder)
        .filter((name) => name.endsWith('.lock') && !name.endsWith('.takeover.lock'))
        .map((name) => name.slice(0, -5))
    } catch {
      return []
    }
  }

  function captureTrackedLane(lane, item, processesBefore, byPidBefore, lanesConfig) {
    const rootPid = item?.child?.pid ?? 0
    const lockPath = join(recordsDir(), `${lane}.lock`)
    const holder = readLaneLock(lockPath)
    const lockMtime = safeLockMtime(lockPath)
    const rootCreated = rootPid > 0 ? (byPidBefore.get(rootPid)?.created ?? null) : null
    const holderPid = holder.pid > 0 && !isLockHolderStale(holder.pid, lockMtime, { platform, processes: byPidBefore }) ? holder.pid : 0
    const holderChild = holder.child > 0 && !isLockHolderStale(holder.child, lockMtime, { platform, processes: byPidBefore }) ? holder.child : 0
    const holderPidCreated = holderPid > 0 ? (byPidBefore.get(holderPid)?.created ?? null) : null
    const holderChildCreated = holderChild > 0 ? (byPidBefore.get(holderChild)?.created ?? null) : null
    const descendants = new Map()
    for (const pid of [rootPid, holderPid, holderChild]) {
      if (!pid) continue
      for (const proc of descendantProcesses(processesBefore, { rootPid: pid, ownPid: process.pid })) {
        descendants.set(proc.pid, proc.created ?? null)
      }
    }
    const worktree = holder.projectRun !== true
      ? (holder.folder || (!item?.project && typeof lanesConfig?.[lane]?.worktree === 'string' ? lanesConfig[lane].worktree : ''))
      : ''
    return {
      lane,
      item,
      rootPid,
      rootCreated,
      holderPid,
      holderPidCreated,
      holderChild,
      holderChildCreated,
      descendants,
      worktree,
    }
  }

  function pidMatchesProcess(pid, created, byPid) {
    if (!pid || !byPid.has(pid)) return false
    const row = byPid.get(pid)
    if (typeof created === 'number' && typeof row?.created === 'number') {
      return row.created === created
    }
    return true
  }

  function isTrackedLaneAlive(tracked, processesAfter, byPidAfter) {
    if (tracked.item?.child && (tracked.item.child.exitCode ?? tracked.item.child.signalCode ?? null) === null) {
      return true
    }
    if (pidMatchesProcess(tracked.rootPid, tracked.rootCreated, byPidAfter)) return true
    if (pidMatchesProcess(tracked.holderPid, tracked.holderPidCreated, byPidAfter)) return true
    if (pidMatchesProcess(tracked.holderChild, tracked.holderChildCreated, byPidAfter)) return true
    for (const [pid, created] of tracked.descendants) {
      if (pidMatchesProcess(pid, created, byPidAfter)) return true
    }
    for (const [pid, created] of [
      [tracked.rootPid, tracked.rootCreated],
      [tracked.holderPid, tracked.holderPidCreated],
      [tracked.holderChild, tracked.holderChildCreated],
    ]) {
      if (!pid) continue
      if (byPidAfter.has(pid) && !pidMatchesProcess(pid, created, byPidAfter)) continue
      if (descendantProcesses(processesAfter, { rootPid: pid, ownPid: process.pid }).length > 0) return true
    }
    if (tracked.worktree && leftoverProcesses(processesAfter, { worktree: tracked.worktree, ownPid: process.pid, spareAncestor: process.pid, platform }).length > 0) {
      return true
    }
    return laneLockAlive(recordsDir(), tracked.lane, { platform, list: () => processesAfter, stat })
  }

  function laneStartProblem(lane, lanes) {
    if (!Object.hasOwn(lanes, lane) || !lanes[lane] || typeof lanes[lane] !== 'object') {
      return { status: 400, error: 'Choose a lane from the list.' }
    }
    if (lanes[lane].retired === true) {
      return { status: 400, error: `The ${lane} lane is retired.` }
    }
    if (!Object.hasOwn(lanes[lane], 'cli') || !lanes[lane].cli || typeof lanes[lane].cli !== 'object') {
      return { status: 400, error: 'That lane has no command line.' }
    }
    if (lane === 'orchestrator') {
      return { status: 400, error: 'The orchestrator lane runs from the room, not as a lane run.' }
    }
    const activeHelper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
    const isHidden = activeHelper && typeof activeHelper.isLaneHidden === 'function'
      ? activeHelper.isLaneHidden(lane)
      : runsFolder && projectRoot
        ? readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder)).includes(lane)
        : false
    if (isHidden) return { status: 400, error: hiddenLaneProblem(lane) }
    const chosen = activeHelper && typeof activeHelper.isChosen === 'function'
      ? activeHelper.isChosen()
      : runsFolder
        ? readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder)) !== null
        : true
    if (!chosen) return { status: 400, error: 'Pick the lanes for this project first.' }
    const laneActive = typeof isLaneActive === 'function'
      ? isLaneActive(lane)
      : activeHelper && typeof activeHelper.isLaneActive === 'function'
        ? activeHelper.isLaneActive(lane)
        : true
    if (!laneActive) return { status: 400, error: `The lane ${lane} is not active. Add it in Agents first.` }
    return null
  }

  function laneModeProblem(lane, laneKey, value) {
    if (value === '') return ''
    return runnerModeProblem(laneWithOverrides(lane, { mode: value }), laneKey)
  }

  function modelProblemFor(lane, model) {
    const wanted = typeof model === 'string' ? model.trim() : ''
    if (wanted === '') return ''
    const harness = typeof lane?.cli?.harness === 'string' ? lane.cli.harness : ''
    return modelAllowed(harness, wanted, recordsDir()) ? '' : modelUnavailableProblem(wanted, harness)
  }

  async function startProjectTask({ lane = '', task = '', worktree = false, allowDirty = false, startedBy = '', checkCommand = '', model = '', mode = '', allowedLanes = null } = {}) {
    syncOrchestratorsRuns()
    const lanesText = readPath(laneFile)
    if (lanesText === null) return { status: 404, body: { error: 'The brief files are missing.' } }
    const lanes = readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })
    if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
      return { status: 400, body: { error: 'The lane file is not valid.' } }
    }
    const checkProblem = checkCommandProblem(checkCommand)
    if (checkProblem) return { status: 400, body: { error: checkProblem } }
    const laneProblem = laneStartProblem(lane, lanes)
    if (laneProblem) return { status: laneProblem.status, body: { error: laneProblem.error } }
    const stoppingBefore = sectorStoppingError(lane, startedBy)
    if (stoppingBefore) return { status: 409, body: { error: stoppingBefore } }
    const modelProblem = modelProblemFor(lanes[lane], model)
    if (modelProblem) return { status: 400, body: { error: modelProblem } }
    if (typeof task !== 'string' || task.trim().length < 1 || task.length > TASK_LIMIT) {
      return { status: 400, body: { error: TASK_PROBLEM } }
    }
    if (!resolvedRoot) return { status: 400, body: { error: NO_PROJECT } }
    if (worktree && !(await isGitCheckout(resolvedRoot))) {
      return { status: 400, body: { error: notGitProblem(resolvedRoot) } }
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
      return { status: 400, body: { error: problems.join(' ') } }
    }
    const stoppingAfter = sectorStoppingError(lane, startedBy)
    if (stoppingAfter) return { status: 409, body: { error: stoppingAfter } }
    if (running.has(lane)) {
      return { status: 409, body: { error: 'That lane is already running.' } }
    }
    let entry
    try {
      const reasoning = lanes[lane]?.effort || ''
      entry = startRun(lane, [], { project: resolvedRoot, task, allowDirty, worktree, checkCommand, model }, startedBy, reasoning, '', mode, allowedLanes)
    } catch {
      return { status: 500, body: { error: 'The bridge could not start that run.' } }
    }
    notify({ topic: 'runs' })
    return { status: 202, body: entry }
  }

  function readLockState(laneKey) {
    const text = readTextAt(join(recordsDir(), `${laneKey}.lock`))
    if (!text) return { log: '', startedAt: '', folder: '' }
    return {
      log: laneLockLog(text),
      startedAt: laneLockStartedAt(text),
      folder: laneLockPids(text).folder,
    }
  }

  function currentOpenRuns() {
    try {
      const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
      const open = source && typeof source.openRuns === 'function' ? source.openRuns() : []
      return Array.isArray(open) ? open : []
    } catch {
      return []
    }
  }

  function touchedForLog(logPath, { harness = '', worktree = '' } = {}) {
    if (!logPath) return null
    const folder = recordsDir()
    if (!runLogInside(logPath, folder)) return null
    const resolvedLog = resolve(logPath)
    let info
    try {
      info = stat(resolvedLog)
    } catch {
      touchedCache.delete(resolvedLog)
      return null
    }
    if (!info || (typeof info.isFile === 'function' && !info.isFile())) {
      touchedCache.delete(resolvedLog)
      return null
    }
    if (!Number.isFinite(info.size) || !Number.isFinite(info.mtimeMs) || info.size < 0 || info.size > CONVERSATION_LOG_BYTES) {
      touchedCache.delete(resolvedLog)
      return null
    }
    if (!harness || !Object.hasOwn(harnessByKey, harness)) {
      touchedCache.delete(resolvedLog)
      return null
    }
    const cached = touchedCache.get(resolvedLog)
    if (
      cached &&
      cached.size === info.size &&
      cached.mtimeMs === info.mtimeMs &&
      cached.harness === harness &&
      cached.worktree === worktree
    ) {
      return cached.partial ? Object.assign([...cached.touched], { partial: true }) : [...cached.touched]
    }
    let text
    try {
      text = readFile(resolvedLog, 'utf8')
    } catch {
      touchedCache.delete(resolvedLog)
      return null
    }
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > CONVERSATION_LOG_BYTES) {
      touchedCache.delete(resolvedLog)
      return null
    }
    let summary
    try {
      summary = summarize({ harness, log: text, worktree })
    } catch {
      touchedCache.delete(resolvedLog)
      return null
    }
    if (!Array.isArray(summary?.written)) {
      touchedCache.delete(resolvedLog)
      return null
    }
    const touched = []
    const seen = new Set()
    let cut = false
    for (const raw of summary.written) {
      const safe = maskProfilePaths(maskKeys(String(raw ?? '')).text).trim()
      if (!safe || seen.has(safe)) continue
      if (touched.length >= LIVE_TOUCH_LIMIT) {
        cut = true
        break
      }
      seen.add(safe)
      touched.push(safe)
    }
    const partial = summary.shellUnplaced > 0 || cut
    touchedCache.set(resolvedLog, {
      partial,
      size: info.size,
      mtimeMs: info.mtimeMs,
      harness,
      worktree,
      touched,
    })
    return partial ? Object.assign([...touched], { partial }) : [...touched]
  }

  function touchedForItem(item, lanes, openRuns) {
    const folder = recordsDir()
    const lane = item.entry.lane
    const lock = readLockState(lane)
    const lockMatches = lock.startedAt !== '' && matchesLockStart(lock.startedAt, item.entry.startedAt)
    const openMatch = openRuns.find((run) => {
      if (!run || !run.name || run.lane !== lane) return false
      return matchesLockStart(run.startedAt, item.entry.startedAt)
    })
    const candidate =
      (lockMatches && lock.log !== '' ? join(folder, lock.log) : '') ||
      item.logPath ||
      (openMatch ? join(folder, `${openMatch.name}.log`) : '')
    if (!candidate) {
      if (item.liveLogPath) {
        touchedCache.delete(item.liveLogPath)
        item.liveLogPath = ''
      }
      return null
    }
    const resolvedLog = resolve(candidate)
    if (item.liveLogPath && item.liveLogPath !== resolvedLog) {
      touchedCache.delete(item.liveLogPath)
    }
    item.liveLogPath = resolvedLog
    const meta = readMeta(resolvedLog)
    const logLane = typeof meta?.lane === 'string' && meta.lane.trim() !== '' ? meta.lane.trim() : lane
    const harness =
      (typeof lanes?.[logLane]?.cli?.harness === 'string' && lanes[logLane].cli.harness) ||
      (typeof lanes?.[lane]?.cli?.harness === 'string' && lanes[lane].cli.harness) ||
      ''
    const worktree =
      (typeof meta?.project === 'string' && meta.project.trim()) ||
      (lockMatches && lock.folder) ||
      (item.projectRun?.worktree && item.project ? worktreeFor(item.project, lane) : '') ||
      item.project ||
      lanes?.[logLane]?.worktree ||
      lanes?.[lane]?.worktree ||
      resolvedRoot ||
      ''
    return touchedForLog(resolvedLog, { harness, worktree })
  }

  function touchedFields(list) {
    return { touched: list === null ? null : [...list], ...(list?.partial ? { touchedPartial: true } : {}) }
  }

  function snapshot(item, { lanes = null, openRuns = [] } = {}) {
    const out = {
      lane: item.entry.lane,
      briefs: [...item.entry.briefs],
      startedAt: item.entry.startedAt,
      lastLines: [...item.entry.lastLines],
      ...touchedFields(touchedForItem(item, lanes, openRuns)),
      ...(item.entry.queue ? { queue: true, tasks: item.entry.tasks } : {}),
    }
    const taskLabel = item.task || (item.entry.queue && item.entry.tasks === 1 ? item.firstTask : '')
    if (taskLabel) out.task = taskLabel
    return out
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
    if (item.liveLogPath) touchedCache.delete(item.liveLogPath)
    if (item.ticket && !item.interrupting) laneTickets.delete(item.ticket)
    flushTail(item)
    running.delete(item.entry.lane)
    if (stopped) return
    notify({ topic: 'runs' })
  }

  function logRunName(logPath) {
    const raw = typeof logPath === 'string' ? logPath.trim() : ''
    if (!raw) return ''
    return basename(raw).replace(/\.log$/i, '')
  }

  function readLockInfo(laneKey) {
    const text = readTextAt(join(recordsDir(), `${laneKey}.lock`))
    if (!text) return { log: '', startedAt: '' }
    return {
      log: laneLockLog(text),
      startedAt: laneLockStartedAt(text),
    }
  }

  function readMeta(logPath) {
    if (!logPath) return null
    const text = readTextAt(logPath.replace(/\.log$/i, '.meta.json'))
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function gitReadSync(folder, args) {
    if (!folder) return ''
    let file
    try {
      file = gitPath()
    } catch {
      return ''
    }
    const result = spawnSync(file, args, {
      cwd: folder,
      env: gitEnv(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    })
    if (result.error || result.status !== 0) return ''
    return String(result.stdout ?? '').trim()
  }

  function continuesChainCount(startFrom) {
    const first = typeof startFrom === 'string' ? startFrom.trim() : ''
    if (first === '') return 0
    const records = readAllRunRecords(recordsPath())
    const byName = new Map()
    for (const record of records) {
      const name = logRunName(record?.log)
      if (name !== '') byName.set(name, record)
    }
    let count = 0
    let cursor = first
    const visited = new Set()
    while (cursor !== '' && !visited.has(cursor)) {
      visited.add(cursor)
      count += 1
      const rec = byName.get(cursor)
      cursor = typeof rec?.continues === 'string' ? rec.continues.trim() : ''
    }
    return count
  }

  function hasRecordForLaneSince(lane, startedAt, logPath = '') {
    try {
      const records = readAllRunRecords(recordsPath())
      const startTime = new Date(startedAt).getTime()
      const wantedName = logPath ? logRunName(logPath) : ''
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i]
        if (wantedName !== '' && logRunName(r.log) === wantedName) return true
        if (r.lane === lane && new Date(r.startedAt).getTime() >= startTime) {
          return true
        }
      }
    } catch {}
    return false
  }

  function maskRunText(text, ticket) {
    if (typeof text !== 'string' || text === '') return ''
    const masked = maskKeys(text).text
    return ticket ? masked.split(ticket).join(KEY_MASK) : masked
  }

  function recordRefusal(item, exitCode) {
    const folder = recordsDir()
    const lock = readLockInfo(item.entry.lane)
    const lockedLog = matchesLockStart(lock.startedAt, item.entry.startedAt) && lock.log ? join(folder, lock.log) : ''
    if (!item.logPath && lockedLog && runLogInside(lockedLog, folder) && existsSync(lockedLog)) item.logPath = lockedLog
    if (!item.logPath) item.logPath = findRunLog(folder, item.entry, realPath, readStartLanes({ lanesFile: laneFile, runsFolder: folder }))
    if (hasRecordForLaneSince(item.entry.lane, item.entry.startedAt, item.logPath)) return
    const note = maskRunText(item.entry.lastLines.join(' ').trim(), item.ticket)
    const meta = item.logPath ? readMeta(item.logPath) : null
    let branch = ''
    let queueInfo
    let laneModel = item.model || null
    let workFolder = meta?.project || item.project || ''
    try {
      const lanes = readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })
      const entry = lanes?.[item.entry.lane]
      if (!laneModel && entry?.cli?.model) laneModel = entry.cli.model
      if (!workFolder && entry?.worktree) workFolder = entry.worktree
    } catch {}
    if (workFolder && item.logPath) {
      branch = gitReadSync(workFolder, ['branch', '--show-current'])
    }
    let taskText = item.task || item.firstTask
    if (meta?.queue) {
      queueInfo = {
        branch: meta.queue,
        ...(Number.isInteger(meta.index) ? { index: meta.index } : {}),
        ...(Number.isInteger(item.entry.tasks) ? { size: item.entry.tasks } : {}),
      }
      if (Number.isInteger(meta.index) && meta.index >= 1 && item.projectRun?.queue) {
        const queueRaw = readTextAt(item.projectRun.queue)
        if (queueRaw !== null) {
          const items = queueRaw.split(/\r?\n---\r?\n/)
          const chosen = items[meta.index - 1]?.trim()
          if (chosen) taskText = chosen
        }
      }
    }
    const minutes = Math.max(0, Math.round(((Date.now() - Date.parse(item.entry.startedAt)) / 60000) * 10) / 10)
    const killed = Boolean(item.stoppedByOwner || item.interrupting)
    const recordNote = item.interrupting
      ? 'interrupted'
      : item.stoppedByOwner
        ? 'stopped by the owner'
        : note !== ''
          ? note.slice(0, 200)
          : 'the runner refused to start or could not start'
    const interruptedBy = item.continueFrom
      ? (item.interruptedBy || interruptSenderFrom(readTextAt(join(recordsDir(), `${item.continueFrom}.interrupt.txt`)) ?? ''))
      : ''
    const record = runRecord({
      lane: item.entry.lane,
      briefs: item.entry.briefs,
      model: laneModel,
      reasoning: item.reasoning || null,
      ...(item.mode ? { mode: item.mode } : {}),
      startedAt: item.entry.startedAt,
      minutes: Number.isFinite(minutes) ? minutes : 0,
      exitCode,
      killed,
      ...(item.logPath ? { log: item.logPath } : {}),
      ...(branch ? { branch } : {}),
      ...(meta?.base ? { base: meta.base } : {}),
      note: recordNote,
      ...(item.project ? { project: item.project, task: taskText } : {}),
      ...(queueInfo ? { queue: queueInfo } : {}),
      ...(item.startedBy ? { startedBy: item.startedBy } : {}),
      ...(item.continueFrom ? { continues: item.continueFrom } : {}),
      ...(item.continueFrom && interruptedBy ? { interruptedBy } : {}),
    })
    try {
      appendFileSync(recordsPath(), `${JSON.stringify(record)}\n`)
    } catch {}
  }

  function newestRecordForRun(lane, startedAt) {
    try {
      const records = readAllRunRecords(recordsPath())
      const startTime = Date.parse(startedAt)
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const record = records[i]
        if (!record || record.lane !== lane) continue
        if (record.startedAt === startedAt) return record
        const recordTime = Date.parse(record.startedAt)
        if (Number.isFinite(startTime) && Number.isFinite(recordTime) && recordTime >= startTime) return record
      }
    } catch {}
    return null
  }

  function notifyRefusal(item, exitCode) {
    if (stopped || item.stoppedByOwner || item.interrupting || item.refusalNotified) return
    item.refusalNotified = true
    const record = newestRecordForRun(item.entry.lane, item.entry.startedAt)
    if (!record) return
    if (typeof record.log === 'string' && record.log.trim() !== '') return
    const starter = (typeof record.startedBy === 'string' && record.startedBy) || item.startedBy || ''
    let refusalRecord = record
    if (item.ticket && typeof record.note === 'string' && record.note.includes(item.ticket)) {
      refusalRecord = { ...refusalRecord, note: record.note.split(item.ticket).join(KEY_MASK) }
    }
    if (starter && refusalRecord.startedBy !== starter) {
      refusalRecord = { ...refusalRecord, startedBy: starter }
    }
    const frame = {
      type: 'heartbeat.run.status',
      payload: {
        runId: `refused-${item.entry.lane}-${item.entry.startedAt}`,
        agentId: `agent-${item.entry.lane}`,
        status: 'failed',
        refused: true,
        exitCode,
        record: refusalRecord,
      },
    }
    if (typeof onRefusal === 'function') {
      try {
        onRefusal(frame)
      } catch {}
      return
    }
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    if (registry && typeof registry.onFrame === 'function') {
      try {
        registry.onFrame(frame)
      } catch {}
    }
  }

  function startRun(lane, briefs, projectRun = null, startedBy = '', reasoning = '', model = '', mode = '', allowedLanes = null, extraOptions = {}) {
    const startMs = Math.max(Date.now(), lastStartMs + 1)
    lastStartMs = startMs
    const entry = { lane, briefs: [...briefs], startedAt: new Date(startMs).toISOString(), lastLines: [] }
    const givenTicket = typeof extraOptions?.ticket === 'string' ? extraOptions.ticket.trim() : ''
    const ticket = givenTicket || randomBytes(16).toString('hex')
    const continueFrom = typeof extraOptions?.continueFrom === 'string' ? extraOptions.continueFrom.trim() : ''
    const interruptedBy = continueFrom !== '' && typeof extraOptions?.interruptedBy === 'string' ? extraOptions.interruptedBy.trim() : ''
    if (projectRun?.queue) {
      entry.queue = true
      entry.tasks = projectRun.taskCount
    }
    const startedArgs = startedBy ? ['--started-by', startedBy] : []
    const allowedArgs = Array.isArray(allowedLanes) && allowedLanes.length > 0 ? ['--allowed-lanes', allowedLanes.join(',')] : []
    const reasoningArgs = reasoning ? ['--reasoning', reasoning] : []
    const testArgs = projectRun?.checkCommand
      ? checkCommandLines(projectRun.checkCommand).flatMap((command) => ['--test', command])
      : []
    const chosenModel = typeof model === 'string' && model.trim() ? model.trim() : projectRun?.model && String(projectRun.model).trim()
    const modelArgs = chosenModel ? ['--model', chosenModel] : []
    const modeArgs = mode ? ['--mode', mode] : []
    const continueArgs = continueFrom ? ['--continue-from', continueFrom] : []
    const item = {
      entry,
      ticket,
      tail: '',
      briefs: [...briefs],
      projectRun: projectRun ? { ...projectRun } : null,
      project: projectRun?.project || '',
      task: projectRun?.task || '',
      firstTask: projectRun?.firstTask || '',
      startedBy,
      reasoning,
      model: chosenModel || '',
      mode,
      allowedLanes: Array.isArray(allowedLanes) ? [...allowedLanes] : null,
      continueFrom,
      stopping: false,
      stoppedByOwner: false,
      interrupting: false,
      interruptedBy,
      logPath: '',
      closed: false,
      onClose: [],
    }
    const args = projectRun
      ? projectRun.queue
        ? [...command.args, lane, '--project', projectRun.project, ...(projectRun.worktree ? ['--worktree'] : []), '--queue', projectRun.queue, ...testArgs, ...modelArgs, ...modeArgs, ...allowedArgs, ...startedArgs, ...reasoningArgs, ...continueArgs, '--started-at', entry.startedAt]
        : [
            ...command.args,
            lane,
            '--project',
            projectRun.project,
            '--task',
            projectRun.task,
            ...(projectRun.worktree ? ['--worktree'] : []),
            ...(projectRun.allowDirty ? ['--allow-dirty'] : []),
            ...testArgs,
            ...modelArgs,
            ...modeArgs,
            ...allowedArgs,
            ...startedArgs,
            ...reasoningArgs,
            ...continueArgs,
            '--started-at',
            entry.startedAt,
          ]
      : [...command.args, lane, ...briefs, ...modelArgs, ...modeArgs, ...allowedArgs, ...startedArgs, ...reasoningArgs, ...continueArgs, '--started-at', entry.startedAt]
    const existingTicket = givenTicket ? laneTickets.get(ticket) : null
    laneTickets.set(ticket, {
      lane: existingTicket?.lane ?? lane,
      startedBy: existingTicket?.startedBy ?? startedBy,
      startedAt: entry.startedAt,
      inbox: existingTicket?.inbox ?? [],
    })
    const child = spawn(command.file, args, {
      cwd: projectRun ? REPO_ROOT : resolvedRoot || undefined,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MACHINEROOM_RUNS: recordsDir(),
        MACHINEROOM_LANE_TICKET: ticket,
        MACHINEROOM_LANE_REPLIES: readHarnessSettings(recordsDir()).laneReplies,
        MACHINEROOM_BRIDGE: bridgeAddress(),
        MACHINEROOM_BRIDGE_PID: String(process.pid),
        ...(lanesFile ? { MACHINEROOM_LANES_FILE: laneFile } : {}),
      },
      ...treeSpawnOptions(),
    })
    item.child = child
    running.set(lane, item)
    const take = (chunk) => {
      const masked = maskRunText(item.tail + chunk.toString('utf8'), ticket)
      const parts = masked.split(/\r?\n/)
      item.tail = parts.pop() ?? ''
      for (const line of parts) {
        entry.lastLines.push(line)
        if (entry.lastLines.length > LAST_LINE_LIMIT) entry.lastLines.shift()
      }
    }
    const settleItem = () => {
      item.closed = true
      while (item.onClose.length > 0) {
        const done = item.onClose.shift()
        try {
          done()
        } catch {}
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => {
      entry.lastLines.push(maskRunText(`start failed: ${String(error?.message ?? error)}`, ticket))
      if (entry.lastLines.length > LAST_LINE_LIMIT) entry.lastLines.shift()
      flushTail(item)
      if (!stopped) recordRefusal(item, 1)
      finish(item)
      if (!stopped) notifyRefusal(item, 1)
      settleItem()
    })
    child.on('close', (code) => {
      flushTail(item)
      const failed = !stopped && (code === null || code !== 0)
      if (failed) recordRefusal(item, code ?? 1)
      finish(item)
      if (failed) notifyRefusal(item, code ?? 1)
      settleItem()
    })
    if (startedBy) {
      const dispatchText = projectRun?.task || (Array.isArray(briefs) && briefs.length > 0 ? briefs.join(' ') : '')
      try {
        onMessage({ from: startedBy === 'orchestrator' ? 'orchestrator' : `sub-${startedBy}`, to: lane, kind: 'dispatch' }, dispatchText)
      } catch {}
    }
    return entry
  }

  function waitForItemClose(item, timeoutMs = STOP_SETTLE_MS) {
    if (item.closed) return Promise.resolve(true)
    return new Promise((done) => {
      let finished = false
      const onClosed = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        done(true)
      }
      const timer = setTimeout(() => {
        if (finished) return
        finished = true
        const index = item.onClose.indexOf(onClosed)
        if (index !== -1) item.onClose.splice(index, 1)
        done(false)
      }, timeoutMs)
      timer.unref?.()
      item.onClose.push(onClosed)
    })
  }

  function runStopCommand(lane, projectRun, startedAt = '') {
    return new Promise((resolveStop) => {
      const startArgs = startedAt ? ['--started-at', startedAt] : []
      const args = [...command.args, '--stop', lane, ...startArgs]
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer = null
      let child
      const finishStop = (result) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolveStop(result)
      }
      try {
        child = spawn(command.file, args, {
          cwd: projectRun ? REPO_ROOT : resolvedRoot || undefined,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            MACHINEROOM_RUNS: recordsDir(),
            MACHINEROOM_BRIDGE_PID: String(process.pid),
            ...(lanesFile ? { MACHINEROOM_LANES_FILE: laneFile } : {}),
          },
        })
      } catch {
        finishStop({ ok: false, status: 500, error: 'The bridge could not stop that run.', output: '' })
        return
      }
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
      timer = setTimeout(() => {
        killTree(child)
        finishStop({ ok: false, status: 500, error: 'Stopping that run took too long.', output: '' })
      }, STOP_TIMEOUT_MS)
      timer.unref?.()
      child.on('error', () => {
        finishStop({ ok: false, status: 500, error: 'The bridge could not stop that run.', output: '' })
      })
      child.on('close', (code) => {
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
        if (code === 0) {
          finishStop({ ok: true, output })
          return
        }
        finishStop({ ok: false, status: 500, error: output || 'The bridge could not stop that run.', output })
      })
    })
  }

  function headForLane(lane) {
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    if (!registry) return null
    const sector = typeof registry.sectorForLane === 'function' ? registry.sectorForLane(lane) : null
    return (
      (sector?.id && typeof registry.find === 'function' ? registry.find(sector.id) : null) ??
      (typeof registry.find === 'function' ? registry.find('orchestrator') : null) ??
      registry.main ??
      null
    )
  }

  function notifyLaneHead(lane, note) {
    const head = headForLane(lane)
    if (!head || typeof head.addNote !== 'function') return false
    try {
      head.addNote(note)
      return true
    } catch {
      return false
    }
  }

  function notifyHeadStop(item, lane, stoppedAt) {
    const taskLabel = stopTaskLabel(item)
    notifyLaneHead(lane, `The owner stopped ${lane}'s run on ${taskLabel} at ${stoppedAt}.`)
  }

  const notedFailovers = new Set()
  let failoversSeen = false
  let lastNotedSource = null

  function noteFailovers(records) {
    const list = Array.isArray(records) ? records : []
    if (list === lastNotedSource) return
    const start = isAppendOnlyExtension(list, lastNotedSource) ? lastNotedSource.length : 0
    const quiet = !failoversSeen
    failoversSeen = true
    for (let index = start; index < list.length; index += 1) {
      const record = list[index]
      const failover = record?.failover
      if (!failover || typeof failover !== 'object' || Array.isArray(failover)) continue
      const lane = typeof record.lane === 'string' ? record.lane.trim() : ''
      const kind = typeof failover.kind === 'string' ? failover.kind.trim() : ''
      const to = typeof failover.to === 'string' ? failover.to.trim() : ''
      if (!lane || !kind || !to) continue
      const mark = `${lane}\u0000${record.startedAt ?? ''}\u0000${kind}\u0000${to}`
      if (notedFailovers.has(mark)) continue
      notedFailovers.add(mark)
      if (!quiet) {
        const note = failover.refused === true
          ? `${lane} hit ${kind} and its backup ${to} could not start.`
          : `${lane} hit ${kind} and its run moved to ${to}.`
        notifyLaneHead(lane, note)
      }
    }
    lastNotedSource = list
  }

  async function stopRunningItem(item, targetLane, wantedStart) {
    const result = await runStopCommand(targetLane, Boolean(item?.project), wantedStart)
    if (stopped) {
      return { ok: false, status: 500, error: 'The bridge stopped.', output: '' }
    }
    if (!result.ok) {
      return result
    }
    if (item && running.get(item.entry.lane) === item && !item.closed) {
      await waitForItemClose(item, STOP_SETTLE_MS)
      if (!item.closed && running.get(item.entry.lane) === item) {
        if (item.child?.pid) killTree(item.child)
        await waitForItemClose(item, STOP_SETTLE_MS)
        if (!item.closed) {
          recordRefusal(item, 1)
          finish(item)
          item.closed = true
        }
      }
    }
    return result
  }

  async function stopRun({ lane = '', startedAt = '', confirmed = false } = {}) {
    if (confirmed !== true) return { status: 400, body: { error: CONFIRM_STOP_PROBLEM } }
    const targetLane = typeof lane === 'string' ? lane.trim() : ''
    if (!targetLane || !/^[A-Za-z0-9_-]+$/.test(targetLane)) {
      return { status: 400, body: { error: STOP_LANE_PROBLEM } }
    }
    const wantedStart = typeof startedAt === 'string' ? startedAt.trim() : ''
    if (!wantedStart) {
      return { status: 400, body: { error: STOP_TIME_PROBLEM } }
    }
    let item = running.get(targetLane)
    let sourceRun = null
    if (!item) {
      let open = []
      try {
        const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
        open = source && typeof source.openRuns === 'function' ? source.openRuns() : []
      } catch {
        open = []
      }
      const wantedTime = Date.parse(wantedStart)
      sourceRun = (Array.isArray(open) ? open : []).find((run) => {
        if (!run || run.lane !== targetLane) return false
        if (run.startedAt === wantedStart) return true
        return Number.isFinite(wantedTime) && Date.parse(run.startedAt) === wantedTime
      }) ?? null
      if (!sourceRun) {
        return { status: 409, body: { error: `No run is running on ${targetLane}.` } }
      }
    } else {
      if (item.entry.startedAt !== wantedStart) {
        return { status: 409, body: { error: STOP_MISMATCH_PROBLEM } }
      }
      if (item.stopping) {
        return { status: 409, body: { error: STOP_BUSY_PROBLEM } }
      }
      item.stopping = true
      item.stoppedByOwner = true
      if (!item.logPath) {
        const lockInfo = readLockInfo(targetLane)
        if (lockInfo.log) item.logPath = join(recordsDir(), lockInfo.log)
      }
    }
    const result = await stopRunningItem(item, targetLane, wantedStart)
    if (stopped) {
      return { status: 500, body: { error: 'The bridge stopped.' } }
    }
    if (!result.ok) {
      if (item && running.get(targetLane) === item) {
        item.stopping = false
        item.stoppedByOwner = false
      }
      return {
        status: result.status,
        body: { error: result.error, ...(result.output ? { output: result.output } : {}) },
      }
    }
    const stoppedAt = new Date().toISOString()
    const noticeItem = item ?? { entry: { lane: targetLane, briefs: [], startedAt: sourceRun.startedAt }, task: '' }
    notifyHeadStop(noticeItem, targetLane, stoppedAt)
    return {
      status: 200,
      body: { ok: true, lane: targetLane, startedAt: sourceRun ? sourceRun.startedAt : wantedStart, output: result.output },
    }
  }

  async function stopSectorLanes({ isWholeTree = false, targetOrchestrators = [], targetLanes = null, backupLanes = null } = {}) {
    const orchSet = new Set(targetOrchestrators)
    const laneSet = targetLanes instanceof Set ? targetLanes : new Set(targetLanes ?? [])
    const extraSet = backupLanes instanceof Set ? backupLanes : new Set(backupLanes ?? [])
    for (const state of activeInterrupts.values()) {
      const lane = state.item.entry.lane
      if (isWholeTree || laneSet.has(lane) || extraSet.has(lane) || (state.item.startedBy && orchSet.has(state.item.startedBy))) {
        state.cancelled = true
      }
    }
    const folder = recordsDir()
    const lanesConfig = readStartLanes({ lanesFile: laneFile, runsFolder: folder }) ?? {}
    let open = []
    try {
      const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
      open = source && typeof source.openRuns === 'function' ? source.openRuns() : []
    } catch {
      open = []
    }
    const openList = Array.isArray(open) ? open : []
    const lockLanes = lockFileNames(folder)
    if (running.size === 0 && openList.length === 0 && lockLanes.length === 0) {
      return { stoppedLanes: [], stillRunning: [] }
    }

    const seedRuns = []
    const targets = new Map()
    for (const item of running.values()) {
      const lane = item.entry.lane
      const matches = isWholeTree || laneSet.has(lane) || extraSet.has(lane) || (item.startedBy && orchSet.has(item.startedBy))
      if (!matches) continue
      seedRuns.push({ lane, startedAt: item.entry.startedAt })
      targets.set(lane, { lane, startedAt: item.entry.startedAt, item, lockOnly: false })
    }
    for (const held of laneTickets.values()) {
      if (isWholeTree || laneSet.has(held.lane) || extraSet.has(held.lane) || (held.startedBy && orchSet.has(held.startedBy))) {
        seedRuns.push({ lane: held.lane, startedAt: held.startedAt })
      }
    }
    if (!isWholeTree && seedRuns.length > 0) {
      const records = readAllRunRecords(recordsPath())
      for (const record of records) {
        if (!record || typeof record !== 'object') continue
        const recStart = Date.parse(record.startedAt)
        const to = typeof record.failover?.to === 'string' ? record.failover.to.trim() : ''
        if (to && seedRuns.some((seed) => seed.lane === record.lane && (!Number.isFinite(Date.parse(seed.startedAt)) || recStart >= Date.parse(seed.startedAt)))) {
          extraSet.add(to)
        }
        const fromLane = typeof record.failoverFrom?.lane === 'string' ? record.failoverFrom.lane.trim() : ''
        const fromStart = Date.parse(record.failoverFrom?.startedAt)
        if (fromLane && seedRuns.some((seed) => seed.lane === fromLane && (!Number.isFinite(Date.parse(seed.startedAt)) || !Number.isFinite(fromStart) || fromStart >= Date.parse(seed.startedAt)))) {
          extraSet.add(record.lane)
        }
      }
    }

    const isOrchestratorAgent = (lane) => lane === 'orchestrator' || (lane.startsWith('sub-') && !Object.hasOwn(lanesConfig, lane))
    for (const run of openList) {
      if (!run || !run.lane || isOrchestratorAgent(run.lane)) continue
      const matches = isWholeTree || laneSet.has(run.lane) || extraSet.has(run.lane) || (run.startedBy && orchSet.has(run.startedBy))
      if (!matches || targets.has(run.lane)) continue
      targets.set(run.lane, { lane: run.lane, startedAt: run.startedAt, item: running.get(run.lane) ?? null, lockOnly: false })
    }

    const candidateLockLanes = lockLanes.filter((lane) => !isOrchestratorAgent(lane) && (isWholeTree || laneSet.has(lane) || extraSet.has(lane)) && !targets.has(lane))
    const processesBefore = targets.size > 0 || candidateLockLanes.length > 0 ? safeListProcesses() : []
    const byPidBefore = new Map((processesBefore ?? []).map((proc) => [proc.pid, proc]))

    for (const lane of candidateLockLanes) {
      if (!laneLockAlive(folder, lane, { platform, list: () => processesBefore ?? [], stat })) continue
      const lockStart = laneLockStartedAt(readTextAt(join(folder, `${lane}.lock`)) ?? '')
      if (!lockStart) continue
      targets.set(lane, { lane, startedAt: lockStart, item: null, lockOnly: true })
    }

    if (targets.size === 0) {
      return { stoppedLanes: [], stillRunning: [] }
    }

    const tracked = [...targets.values()].map((entry) => captureTrackedLane(entry.lane, entry.item ?? running.get(entry.lane) ?? null, processesBefore ?? [], byPidBefore, lanesConfig))

    await Promise.all([...targets.values()].map(async (entry) => {
      if (!entry.lockOnly) {
        await stopRun({ lane: entry.lane, startedAt: entry.startedAt, confirmed: true })
        return
      }
      const result = await runStopCommand(entry.lane, false, entry.startedAt)
      if (!stopped && result.ok) {
        notifyHeadStop({ entry: { lane: entry.lane, briefs: [], startedAt: entry.startedAt }, task: '' }, entry.lane, new Date().toISOString())
      }
    }))

    let processesAfter = safeListProcesses()
    let byPidAfter = new Map((processesAfter ?? []).map((proc) => [proc.pid, proc]))
    if (processesAfter === null || tracked.some((entry) => isTrackedLaneAlive(entry, processesAfter, byPidAfter))) {
      await new Promise((done) => setTimeout(done, STOP_SETTLE_MS))
      processesAfter = safeListProcesses()
      byPidAfter = new Map((processesAfter ?? []).map((proc) => [proc.pid, proc]))
    }

    const stoppedLanes = []
    const stillRunning = []
    for (const entry of tracked) {
      if (processesAfter === null || isTrackedLaneAlive(entry, processesAfter, byPidAfter)) {
        stillRunning.push(entry.lane)
      } else {
        stoppedLanes.push(entry.lane)
      }
    }
    return { stoppedLanes, stillRunning }
  }

  function matchesLockStart(lockStartedAt, itemStartedAt) {
    if (!lockStartedAt || !itemStartedAt) return false
    if (lockStartedAt === itemStartedAt) return true
    const lockMs = Date.parse(lockStartedAt)
    const itemMs = Date.parse(itemStartedAt)
    return Number.isFinite(lockMs) && Number.isFinite(itemMs) && lockMs === itemMs
  }

  function currentRunName(item, activeLane, runKey) {
    const candidates = activeLane !== runKey ? [activeLane, runKey] : [runKey]
    for (const key of candidates) {
      const info = readLockInfo(key)
      if (info.log !== '' && (key !== item.entry.lane || matchesLockStart(info.startedAt, item.entry.startedAt))) {
        return logRunName(info.log)
      }
    }
    try {
      const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
      const open = source && typeof source.openRuns === 'function' ? source.openRuns() : []
      if (Array.isArray(open)) {
        const found = open.find((run) => {
          if (!run || !run.name) return false
          if (!candidates.includes(run.lane)) return false
          return run.lane !== item.entry.lane || matchesLockStart(run.startedAt, item.entry.startedAt)
        })
        if (found?.name) return found.name
      }
    } catch {}
    return ''
  }

  async function waitForRunName(item, activeLane, runKey) {
    const deadline = Date.now() + 5000
    for (;;) {
      if (stopped || item.closed) return ''
      const found = currentRunName(item, activeLane, runKey)
      if (found) return found
      if (Date.now() >= deadline) return ''
      await new Promise((done) => {
        const timer = setTimeout(done, 20)
        timer.unref?.()
      })
    }
  }

  function writeInterruptFile(folder, runName, messages) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${runName}.interrupt.txt`), formatInterruptMessage(messages), 'utf8')
  }

  async function interruptLane({ lane = '', held = null, takeUnseen, markSeen } = {}) {
    if (stopped) return false
    const runKey = typeof held?.lane === 'string' && held.lane.trim() ? held.lane.trim() : lane
    const item = running.get(runKey) ?? running.get(lane)
    if (!item || item.closed || item.stopping || item.interrupting) return false
    const backup = lane !== item.entry.lane
    if (backup && !readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })?.[lane]) return false
    if (activeInterrupts.has(item.ticket)) return false
    const interruptCount = laneTickets.get(item.ticket)?.interruptCount ?? continuesChainCount(item.continueFrom)
    if (interruptCount >= 3) return false
    const interruptState = { item, cancelled: false }
    activeInterrupts.set(item.ticket, interruptState)
    try {
      const runName = await waitForRunName(item, lane, runKey)
      if (!runName || stopped || item.closed || item.stopping || item.interrupting) return false
      const unseen = typeof takeUnseen === 'function' ? takeUnseen() : []
      if (!Array.isArray(unseen) || unseen.length === 0) return false
      const sender = String(unseen[0]?.from ?? '').trim() || 'orchestrator'
      item.interrupting = true
      item.stopping = true
      item.logPath = join(recordsDir(), `${runName}.log`)
      writeInterruptFile(recordsDir(), runName, unseen)
      const stopTarget = lane !== item.entry.lane && existsSync(join(recordsDir(), `${lane}.lock`)) ? lane : item.entry.lane
      const stopStartedAt = stopTarget === item.entry.lane ? item.entry.startedAt : readLockInfo(stopTarget).startedAt
      const stopResult = await stopRunningItem(item, stopTarget, stopStartedAt)
      if (stopped) {
        laneTickets.delete(item.ticket)
        return false
      }
      if (!stopResult.ok) {
        item.stopping = false
        item.interrupting = false
        if (item.closed) laneTickets.delete(item.ticket)
        return false
      }
      if (stopTarget !== item.entry.lane && existsSync(join(recordsDir(), `${item.entry.lane}.lock`))) {
        await runStopCommand(item.entry.lane, Boolean(item.project), item.entry.startedAt)
      }
      const more = typeof takeUnseen === 'function' ? takeUnseen() : []
      const fresh = Array.isArray(more) ? more.filter((entry) => !unseen.includes(entry)) : []
      if (fresh.length > 0) {
        unseen.push(...fresh)
        writeInterruptFile(recordsDir(), runName, unseen)
      }
      const nextLane = lane !== item.entry.lane ? lane : item.entry.lane
      if (interruptState.cancelled || sectorStoppingError(nextLane, item.startedBy)) {
        item.stopping = false
        item.interrupting = false
        return false
      }
      startRun(
        nextLane,
        item.briefs,
        backup && item.projectRun ? { ...item.projectRun, model: '' } : item.projectRun,
        item.startedBy,
        item.reasoning,
        backup ? '' : item.model,
        backup ? '' : item.mode,
        item.allowedLanes,
        { continueFrom: runName, ticket: item.ticket, interruptedBy: sender }
      )
      if (typeof markSeen === 'function') markSeen(unseen)
      laneTickets.get(item.ticket).interruptCount = interruptCount + 1
      notify({ topic: 'runs' })
      return true
    } catch {
      if (item.closed) laneTickets.delete(item.ticket)
      return false
    } finally {
      activeInterrupts.delete(item.ticket)
    }
  }

  const resolvedPathCache = new Map()
  const rootMatchCache = new Map()
  const worktreeResolvedCache = new Map()
  const worktreeMatchCache = new Map()
  let thisRepoCache = null
  let thisRepoStamp = null
  let thisRepoCheckedAt = 0
  let thisRepoPending = null
  let cachedRoomSource = null
  let cachedRoomThisRepo = null
  let cachedRoomAt = 0
  let cachedRoomFallbacks = new Set()
  let cachedRoomOverflow = false
  let cachedRoomList = Object.freeze([])
  let cachedRunsViewSource = null
  const cachedRunsViewByLane = new Map()

  function stopAll() {
    stopped = true
    laneTickets.clear()
    touchedCache.clear()
    resolvedPathCache.clear()
    rootMatchCache.clear()
    worktreeResolvedCache.clear()
    worktreeMatchCache.clear()
    thisRepoCache = null
    thisRepoStamp = null
    thisRepoCheckedAt = 0
    thisRepoPending = null
    rootCommonDirPromise = null
    rootCommonDirStamp = null
    cachedRoomSource = null
    cachedRoomThisRepo = null
    cachedRoomAt = 0
    cachedRoomFallbacks = new Set()
    cachedRoomOverflow = false
    cachedRoomList = Object.freeze([])
    cachedRunsViewSource = null
    cachedRunsViewByLane.clear()
    lastNotedSource = null
    for (const item of running.values()) {
      if (item.child?.pid) killTree(item.child)
    }
    running.clear()
  }

  async function inThisRepository() {
    if (!projectRoot) return false
    const stamp = projectRepoStamp()
    const result = samePath(await rootCommonDir(), await repoCommonDir())
    thisRepoStamp = stamp
    thisRepoCache = result
    thisRepoCheckedAt = now()
    return result
  }

  async function isThisRepo() {
    if (!projectRoot) return false
    const timestamp = now()
    if (thisRepoCache !== null && timestamp >= thisRepoCheckedAt && timestamp - thisRepoCheckedAt < REPO_CHECK_FLOOR_MS) {
      return thisRepoCache
    }
    const stamp = projectRepoStamp()
    if (thisRepoCache !== null && stamp === thisRepoStamp) {
      thisRepoCheckedAt = timestamp
      return thisRepoCache
    }
    if (thisRepoPending) return thisRepoPending
    thisRepoPending = inThisRepository().finally(() => {
      thisRepoPending = null
    })
    return thisRepoPending
  }

  function resolveWithStatus(folder) {
    const target = resolve(String(folder ?? ''))
    if (resolvePath === realPath) {
      try {
        return { value: realpathSync.native(target), fallback: false }
      } catch {
        return { value: target, fallback: true }
      }
    }
    const resolved = resolvePath(folder)
    let fallback = false
    try {
      stat(target)
    } catch {
      fallback = true
    }
    return { value: resolved, fallback }
  }

  function resolveCached(folder, memo, timestamp) {
    if (memo) {
      const local = memo.resolved.get(folder)
      if (local !== undefined) return local
    }
    const cached = readTimedCache(resolvedPathCache, folder, timestamp)
    if (cached !== undefined) {
      const hit = { value: cached, fallback: false }
      if (memo) memo.resolved.set(folder, hit)
      return hit
    }
    const res = resolveWithStatus(folder)
    if (!res.fallback) {
      writeTimedCache(resolvedPathCache, folder, res.value, timestamp)
    }
    if (memo) memo.resolved.set(folder, res)
    return res
  }

  function noteFallback(fallbacks, path) {
    if (!fallbacks) return
    if (fallbacks.paths.has(path)) return
    if (fallbacks.paths.size >= PATH_CACHE_LIMIT) {
      fallbacks.overflow = true
      return
    }
    fallbacks.paths.add(path)
  }

  function hasFallbackAppeared(paths) {
    for (const target of paths) {
      try {
        stat(target)
        return true
      } catch {}
    }
    return false
  }

  function matchesRoom(record, thisRepo, memo, timestamp, fallbacks) {
    if (!record || typeof record !== 'object') return false
    const raw = typeof record.project === 'string' ? record.project.trim() : ''
    if (raw === '') return thisRepo
    if (thisRepo || !resolvedRoot) return false

    let matchesRoot = memo ? memo.rootMatch.get(raw) : undefined
    let rawRes = null
    if (matchesRoot === undefined) {
      const cachedRoot = readTimedCache(rootMatchCache, raw, timestamp)
      if (cachedRoot !== undefined) {
        matchesRoot = cachedRoot
      } else {
        rawRes = resolveCached(raw, memo, timestamp)
        matchesRoot = samePath(rawRes.value, resolvedRoot)
        if (!rawRes.fallback) {
          writeTimedCache(rootMatchCache, raw, matchesRoot, timestamp)
        } else {
          noteFallback(fallbacks, raw)
        }
      }
      if (memo) memo.rootMatch.set(raw, matchesRoot)
    }
    if (matchesRoot) return true

    const lane = typeof record.lane === 'string' ? record.lane.trim() : ''
    if (!lane) return false

    const canKeyPair = !raw.includes('\u0000') && !lane.includes('\u0000')
    const wtKey = `${raw}\u0000${lane}`
    let matchesWt = memo && canKeyPair ? memo.wtMatch.get(wtKey) : undefined
    if (matchesWt === undefined) {
      const cachedWtMatch = canKeyPair ? readTimedCache(worktreeMatchCache, wtKey, timestamp) : undefined
      if (cachedWtMatch !== undefined) {
        matchesWt = cachedWtMatch
      } else {
        let wtEntry = memo ? memo.wtResolved.get(lane) : undefined
        if (wtEntry === undefined) {
          const cachedWt = readTimedCache(worktreeResolvedCache, lane, timestamp)
          if (cachedWt !== undefined) {
            wtEntry = { value: cachedWt, fallback: false }
          } else {
            const worktree = worktreeFor(resolvedRoot, lane)
            if (!worktree) {
              wtEntry = { value: '', fallback: false }
            } else {
              wtEntry = resolveCached(worktree, memo, timestamp)
              if (wtEntry.fallback) noteFallback(fallbacks, worktree)
            }
            if (!wtEntry.fallback) {
              writeTimedCache(worktreeResolvedCache, lane, wtEntry.value, timestamp)
            }
          }
          if (memo) memo.wtResolved.set(lane, wtEntry)
        }
        if (!wtEntry.value) {
          matchesWt = false
          if (canKeyPair && !wtEntry.fallback) {
            writeTimedCache(worktreeMatchCache, wtKey, false, timestamp)
          }
        } else {
          if (!rawRes) rawRes = resolveCached(raw, memo, timestamp)
          matchesWt = samePath(rawRes.value, wtEntry.value)
          if (rawRes.fallback) noteFallback(fallbacks, raw)
          if (canKeyPair && !rawRes.fallback && !wtEntry.fallback) {
            writeTimedCache(worktreeMatchCache, wtKey, matchesWt, timestamp)
          }
        }
      }
      if (memo && canKeyPair) memo.wtMatch.set(wtKey, matchesWt)
    }
    return matchesWt
  }

  async function roomRecords(records) {
    const thisRepo = await isThisRepo()
    const list = Array.isArray(records) ? records : []
    const timestamp = now()
    const freshCache =
      thisRepo === cachedRoomThisRepo &&
      cachedRoomSource !== null &&
      !cachedRoomOverflow &&
      timestamp >= cachedRoomAt &&
      timestamp - cachedRoomAt < PATH_CACHE_TTL_MS &&
      !hasFallbackAppeared(cachedRoomFallbacks)

    if (freshCache && list === cachedRoomSource) {
      return cachedRoomList
    }
    if (freshCache && isAppendOnlyExtension(list, cachedRoomSource)) {
      const memo = {
        resolved: new Map(),
        rootMatch: new Map(),
        wtResolved: new Map(),
        wtMatch: new Map(),
      }
      const fallbacks = { paths: cachedRoomFallbacks, overflow: cachedRoomOverflow }
      const added = []
      for (let index = cachedRoomSource.length; index < list.length; index += 1) {
        if (matchesRoom(list[index], thisRepo, memo, timestamp, fallbacks)) added.push(list[index])
      }
      cachedRoomSource = list
      cachedRoomOverflow = fallbacks.overflow
      if (added.length > 0) cachedRoomList = Object.freeze(cachedRoomList.concat(added))
      return cachedRoomList
    }
    const memo = {
      resolved: new Map(),
      rootMatch: new Map(),
      wtResolved: new Map(),
      wtMatch: new Map(),
    }
    const fallbacks = { paths: new Set(), overflow: false }
    const matched = []
    for (const record of list) {
      if (matchesRoom(record, thisRepo, memo, timestamp, fallbacks)) matched.push(record)
    }
    cachedRoomSource = list
    cachedRoomThisRepo = thisRepo
    cachedRoomAt = timestamp
    cachedRoomFallbacks = fallbacks.paths
    cachedRoomOverflow = fallbacks.overflow
    cachedRoomList = Object.freeze(matched)
    return cachedRoomList
  }

  function recentForLane(scoped, lane) {
    if (!lane) return scoped.slice(-RECENT_LIMIT).reverse()
    return scoped
      .map((record) => ({ record, time: Date.parse(record.startedAt) }))
      .sort((a, b) => b.time - a.time)
      .slice(0, RECENT_LIMIT)
      .map((entry) => entry.record)
  }

  function runsViewFor(roomList, lane) {
    if (roomList !== cachedRunsViewSource) {
      cachedRunsViewSource = roomList
      cachedRunsViewByLane.clear()
    }
    let view = cachedRunsViewByLane.get(lane)
    if (!view) {
      if (cachedRunsViewByLane.size >= 64) cachedRunsViewByLane.clear()
      const scoped = lane ? roomList.filter((record) => record.lane === lane) : roomList
      view = {
        recentRaw: recentForLane(scoped, lane),
        lastRaw: newestRecordPerLane(scoped),
        attentionRaw: attentionItems(scoped),
      }
      cachedRunsViewByLane.set(lane, view)
    }
    return view
  }

  function maskRecordCommits(record, key = '') {
    if (typeof record === 'string') {
      const text = maskKeys(record).text
      return RECORD_PATH_KEYS.has(key) ? text : maskProfilePaths(text)
    }
    if (Array.isArray(record)) return record.map((item) => maskRecordCommits(item, key))
    if (record && typeof record === 'object') return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, maskRecordCommits(value, name)]))
    return record
  }

  async function handle(req, res, url) {
    syncOrchestratorsRuns()
    const path = url.pathname
    const method = req.method ?? 'GET'
    if (method === 'GET' && path === '/api/control/issues') {
      const status = url.searchParams.get('status')
      const records = await roomRecords(readAllRunRecords(recordsPath()))
      const thisRepo = await isThisRepo()
      const subjects = thisRepo ? (await readMainSubjects()).map(({ subject }) => subject) : []
      const { issues } = laneTaskState({
        openRuns: currentOpenRuns(),
        agents: laneAgentList(lanesSource),
        records: recentLaneRecords(records),
        recoveryRecords: records,
        briefs: thisRepo ? readLaneBriefs() : [],
        mergedBriefs: mergedBriefIds(subjects),
      })
      const visible = status ? issues.filter((issue) => issue.status === status) : issues
      sendJson(req, res, 200, visible.map(maskRecordCommits))
      return true
    }
    if (path === '/api/control/runs/stop') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const body = await readJsonBody(req, res, RUNS_BODY_LIMIT)
      if (body === null) return true
      const actor = readActor(req, {})
      if (actor.status) {
        sendJson(req, res, actor.status, { error: actor.error })
        return true
      }
      const finish = finishActor(actor, typeof body.lane === 'string' ? body.lane.trim() : body.lane)
      if (finish.status) {
        sendJson(req, res, finish.status, { error: finish.error })
        return true
      }
      const out = await stopRun(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (await projectSettings.handle(req, res, url)) return true
    if (path === '/api/control/runs/conversation') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const lane = (url.searchParams.get('lane') ?? '').trim()
      const startedAt = (url.searchParams.get('startedAt') ?? '').trim()
      const wantedTime = Date.parse(startedAt)
      const records = readAllRunRecords(recordsPath())
      let record = null
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const item = records[index]
        if (!item || item.lane !== lane) continue
        if (item.startedAt === startedAt) {
          record = item
          break
        }
        if (Number.isFinite(wantedTime) && Date.parse(item.startedAt) === wantedTime) {
          record = item
          break
        }
      }
      let liveRun = null
      if (!record) {
        let open = []
        try {
          const source = typeof lanesSource === 'function' ? lanesSource() : lanesSource
          open = source && typeof source.openRuns === 'function' ? source.openRuns() : []
        } catch {
          open = []
        }
        liveRun = (Array.isArray(open) ? open : []).find((item) => {
          if (!item || item.lane !== lane) return false
          if (item.startedAt === startedAt) return true
          return Number.isFinite(wantedTime) && Date.parse(item.startedAt) === wantedTime
        }) ?? null
      }
      if (!record && !liveRun) {
        sendJson(req, res, 404, { error: CONVERSATION_UNKNOWN_PROBLEM })
        return true
      }
      const folder = recordsDir()
      let logPath = ''
      if (liveRun) {
        const name = typeof liveRun.name === 'string' ? liveRun.name.trim() : ''
        logPath = name === '' ? '' : resolve(folder, `${name}.log`)
      } else {
        const lock = readLockInfo(lane)
        const lockedLog = matchesLockStart(lock.startedAt, record.startedAt) && lock.log ? join(folder, lock.log) : ''
        logPath = typeof record.log === 'string' && record.log.trim() !== '' ? resolve(record.log.trim()) : lockedLog || findRunLog(folder, record, realPath, readStartLanes({ lanesFile: laneFile, runsFolder: folder }))
      }
      if (logPath !== '' && !runLogInside(logPath, folder)) {
        sendJson(req, res, 400, { error: CONVERSATION_LOG_OUTSIDE_PROBLEM })
        return true
      }
      if (logPath === '') {
        sendJson(req, res, 404, { error: CONVERSATION_LOG_MISSING_PROBLEM })
        return true
      }
      const log = readLogTail(logPath)
      if (log === null) {
        sendJson(req, res, 404, { error: CONVERSATION_LOG_MISSING_PROBLEM })
        return true
      }
      let harness = ''
      try {
        const startLanes = readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })
        if (startLanes && Object.hasOwn(startLanes, lane) && startLanes[lane] && typeof startLanes[lane] === 'object') {
          harness = typeof startLanes[lane].cli?.harness === 'string' ? startLanes[lane].cli.harness : ''
        }
      } catch {}
      let isRunning = Boolean(liveRun)
      if (record) {
        for (const item of running.values()) {
          if (item.entry.lane === lane && item.entry.startedAt === record.startedAt) {
            isRunning = true
            break
          }
        }
      }
      const started = liveRun ? liveRun.startedAt : record.startedAt
      const prompt = liveRun ? '' : conversationPrompt(record, readText('TASKS.md'))
      const entries = conversationFromLog(harness, log.text, prompt)
      if (entries.length > 0 && entries[0].role === 'prompt') entries[0] = { ...entries[0], at: started }
      sendJson(req, res, 200, {
        lane,
        startedAt: started,
        harness,
        running: isRunning,
        entries,
        ...(log.cut ? { cut: true } : {}),
      })
      return true
    }
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
      noteFailovers(records)
      const lane = (url.searchParams.get('lane') ?? '').trim()
      const roomList = await roomRecords(records)
      const view = runsViewFor(roomList, lane)
      const runningItems = [...running.values()].filter((item) => !lane || item.entry.lane === lane)
      const lanes = runningItems.length > 0 ? readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() }) : null
      const openRuns = runningItems.length > 0 ? currentOpenRuns() : []
      sendJson(req, res, 200, {
        project: resolvedRoot ? basename(resolvedRoot) : '',
        running: runningItems.map((item) => snapshot(item, { lanes, openRuns })),
        recent: view.recentRaw.map(maskRecordCommits),
        last: view.lastRaw.map(maskRecordCommits),
        attention: view.attentionRaw.map(maskRecordCommits),
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
    if (!projectRun && !(await inThisRepository())) {
      sendJson(req, res, 400, { error: BRIEF_PROJECT_PROBLEM })
      return true
    }
    let checkCommand = ''
    if (projectRun) {
      const given = Object.hasOwn(body, 'checkCommand')
        ? body.checkCommand
        : readSavedCheckCommand()
      const checkProblem = checkCommandProblem(given)
      if (checkProblem) {
        sendJson(req, res, 400, { error: checkProblem })
        return true
      }
      checkCommand = typeof given === 'string' ? given.trim() : ''
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
      const lanesText = readPath(laneFile)
      tasksText = readText('TASKS.md')
      if (lanesText === null || tasksText === null) {
        sendJson(req, res, 404, { error: 'The brief files are missing.' })
        return true
      }
      lanes = readStartLanes({ lanesFile: laneFile, runsFolder: recordsDir() })
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
      const stoppingActor = sectorStoppingError('', startInfo.actor || startInfo.startedBy)
      if (stoppingActor) {
        sendJson(req, res, 409, { error: stoppingActor })
        return true
      }
    }

    let lane = typeof body.lane === 'string' ? body.lane : ''
    if (!wantsAuto) {
      const laneProblem = laneStartProblem(lane, lanes)
      if (laneProblem) {
        sendJson(req, res, laneProblem.status, { error: laneProblem.error })
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
      const stoppingLane = sectorStoppingError(lane, startedBy)
      if (stoppingLane) {
        sendJson(req, res, 409, { error: stoppingLane })
        return true
      }
    }

    let briefs = []
    let parsedBriefs = null
    let task = ''
    let allowDirty = false
    let model = ''
    if (Object.hasOwn(body, 'model') && body.model !== null && body.model !== undefined && body.model !== '') {
      if (typeof body.model !== 'string') {
        sendJson(req, res, 400, { error: 'Choose a model from the lane list.' })
        return true
      }
      model = body.model.trim()
    }
    const requestedMode = body.mode === undefined || body.mode === null ? '' : typeof body.mode === 'string' ? body.mode.trim() : String(body.mode)
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
      const stoppingRouted = sectorStoppingError(lane, startedBy)
      if (stoppingRouted) {
        sendJson(req, res, 409, { error: stoppingRouted })
        return true
      }
    }

    const allowedLanes = allowedLanesFor(startInfo)
    const modelProblem = modelProblemFor(lanes[lane], model)
    if (modelProblem) {
      sendJson(req, res, 400, { error: modelProblem })
      return true
    }

    const savedMode = lanes[lane].cli?.mode
    const fixedMode = savedMode && savedMode !== 'choice' ? savedMode : legacyMode(lanes[lane].cli?.harness)
    if (!startInfo.page && requestedMode && savedMode !== 'choice' && requestedMode !== fixedMode) {
      sendJson(req, res, 400, { error: `The ${lane} lane uses ${fixedMode} mode.` })
      return true
    }
    const chosenMode = requestedMode || (savedMode === 'choice' ? defaultMode(lanes[lane].cli?.harness) || '' : '')
    const modeProblem = laneModeProblem(lanes[lane], lane, chosenMode)
    if (modeProblem) {
      sendJson(req, res, 400, { error: modeProblem })
      return true
    }

    if (projectRun && !hasTasks) {
      const started = await startProjectTask({ lane, task, worktree, allowDirty, startedBy, checkCommand, model, mode: chosenMode, allowedLanes })
      sendJson(
        req,
        res,
        started.status,
        routedAnswer && started.status === 202 ? { ...started.body, routed: routedAnswer } : started.body
      )
      return true
    }

    if (projectRun) {
      if (!resolvedRoot) {
        sendJson(req, res, 400, { error: NO_PROJECT })
        return true
      }
      if ((hasTasks || worktree) && !(await isGitCheckout(resolvedRoot))) {
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

    const stoppingAfter = sectorStoppingError(lane, startedBy)
    if (stoppingAfter) {
      sendJson(req, res, 409, { error: stoppingAfter })
      return true
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
      refreshModelDetails(model || laneConfig?.cli?.model || '', laneConfig?.cli?.endpoint || '')
      const reasoning = laneConfig?.effort || ''
      const firstTask = hasTasks && body.tasks.length > 0 ? body.tasks[0].trim() : ''
      entry = startRun(
        lane,
        briefs,
        projectRun
          ? { project: resolvedRoot, task, firstTask, allowDirty, queue: queueFile, taskCount, worktree, checkCommand, model }
          : null,
        startedBy,
        reasoning,
        model,
        chosenMode,
        allowedLanes
      )
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not start that run.' })
      return true
    }
    notify({ topic: 'runs' })
    sendJson(req, res, 202, routedAnswer ? { ...entry, routed: routedAnswer } : entry)
    return true
  }

  const runsApi = {
    handle,
    stopAll,
    stopRun,
    stopSectorLanes,
    interruptLane,
    isRunning: (lane) => (lane !== undefined ? running.has(lane) : running.size > 0),
    startRun,
    startProjectTask,
    readSavedCheckCommand,
    laneTicket: (value) => {
      const ticket = typeof value === 'string' ? value.trim() : ''
      if (!ticket) return null
      const held = laneTickets.get(ticket)
      return held ? { lane: held.lane, startedBy: held.startedBy, startedAt: held.startedAt, inbox: held.inbox } : null
    },
    laneTicketsFor: (lane) => {
      const key = typeof lane === 'string' ? lane.trim() : ''
      if (!key) return []
      const found = []
      for (const held of laneTickets.values()) {
        if (held.lane === key) found.push(held)
      }
      return found
    },
  }

  function syncOrchestratorsRuns() {
    const registry = typeof orchestrators === 'function' ? orchestrators() : null
    if (registry && typeof registry.attachRuns === 'function') {
      registry.attachRuns(runsApi)
    }
    return registry
  }

  return runsApi
}
