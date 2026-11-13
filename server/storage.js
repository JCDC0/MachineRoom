import { readdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rename, unlink, utimes } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { WORKTREES_FOLDER } from '../src/briefs/run.js'
import { isHolderAlive, readLaneLock } from '../scripts/lane-lock.mjs'
import { cleanDecision, collectWorktrees } from '../scripts/worktrees.mjs'
import { listProcesses } from './processTree.js'
import { readAllRunRecords } from './runs.js'

export const DEFAULT_ARCHIVE_DAYS = 30
export const MIN_ARCHIVE_DAYS = 1
export const MAX_ARCHIVE_DAYS = 365
export const ARCHIVE_DIR_NAME = 'archive'
export const STAT_CONCURRENCY = 64
const DIR_STAT_FLUSH_SIZE = 256

export const DAYS_PROBLEM = 'Choose 1 to 365 days.'
export const CONFIRM_PROBLEM = 'Confirm the archive before moving files.'
export const ORIGIN_PROBLEM = 'Archiving storage needs a page Origin.'
export const BUSY_PROBLEM = 'A storage archive is already running.'
export const METHOD_PROBLEM = 'Use GET for /api/storage or POST for /api/storage/preview and /api/storage/archive.'

const DAY_MS = 24 * 60 * 60 * 1000
const META_SUFFIX = /^(.+)\.meta\.json$/i
const USAGE_SUFFIX = /^(.+)\.usage\.json$/i
const LOG_SUFFIX = /^(.+)\.log$/i
const CONVERSATION_FILE = /^orchestrator-.+\.json$/i
const RECORDING_PART = /^(.+)-(run\.jsonl|agents\.json|tree\.json)$/i
const RUN_TIMESTAMP_SUFFIX = /^(.+?)-\d{8}-\d{6}-\d{3}$/i

function refusal(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function resolvedOption(value) {
  const raw = typeof value === 'function' ? value() : value
  return typeof raw === 'string' && raw.trim() ? resolve(raw.trim()) : ''
}

export function cleanArchiveDays(value) {
  if (value === undefined) return DEFAULT_ARCHIVE_DAYS
  if (typeof value === 'number' && Number.isInteger(value) && value >= MIN_ARCHIVE_DAYS && value <= MAX_ARCHIVE_DAYS) {
    return value
  }
  throw refusal(DAYS_PROBLEM, 400)
}

export function worktreesCleanCommand(projectRoot) {
  const project = resolvedOption(projectRoot)
  if (!project) return 'npm run worktrees -- --clean'
  const flag = /[\s"'`]/.test(project) ? JSON.stringify(project) : project
  return `npm run worktrees -- --project ${flag} --clean`
}

function createLimiter(limit = STAT_CONCURRENCY) {
  const maxActive = Number.isInteger(limit) && limit > 0 ? limit : STAT_CONCURRENCY
  let active = 0
  const queue = []
  let head = 0

  function drain() {
    while (active < maxActive && head < queue.length) {
      const entry = queue[head]
      queue[head] = undefined
      head += 1
      if (head === queue.length) {
        queue.length = 0
        head = 0
      } else if (head >= 1024 && head * 2 >= queue.length) {
        queue.splice(0, head)
        head = 0
      }
      active += 1
      let pending
      try {
        pending = Promise.resolve(entry.task())
      } catch (error) {
        active -= 1
        entry.reject(error)
        continue
      }
      pending.then(
        (value) => {
          active -= 1
          drain()
          entry.resolve(value)
        },
        (error) => {
          active -= 1
          drain()
          entry.reject(error)
        }
      )
    }
  }

  return function runLimited(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject })
      drain()
    })
  }
}

async function statFileSafe(filePath, lstatFn = lstat) {
  try {
    const info = await lstatFn(filePath)
    return info && typeof info.isFile === 'function' && info.isFile() ? info : null
  } catch {
    return null
  }
}

async function statDirEntries(dirPath, entries, lstatFn, limit) {
  if (entries.length === 0) return []
  return Promise.all(
    entries.map((entry) => limit(() => statFileSafe(join(dirPath, entry.name), lstatFn)))
  )
}

async function readDirentsSafe(dirPath) {
  if (!dirPath) return []
  try {
    return await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function measureDirectoryBytes(dirPath, options = {}) {
  if (!dirPath) return 0
  const lstatFn = typeof options.lstatFn === 'function' ? options.lstatFn : lstat
  const limit = typeof options.limit === 'function' ? options.limit : createLimiter(STAT_CONCURRENCY)
  let bytes = 0
  const stack = [dirPath]
  const pending = []

  async function flushPending() {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    const infos = await Promise.all(batch)
    for (const info of infos) {
      if (info) bytes += info.size
    }
  }

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readDirentsSafe(current)
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile()) {
        pending.push(limit(() => statFileSafe(fullPath, lstatFn)))
      }
    }
    if (pending.length >= DIR_STAT_FLUSH_SIZE) {
      await flushPending()
    }
  }
  await flushPending()
  return bytes
}

function runLogPart(name) {
  const metaMatch = META_SUFFIX.exec(name)
  if (metaMatch) return { stem: metaMatch[1], role: 'meta' }
  const usageMatch = USAGE_SUFFIX.exec(name)
  if (usageMatch) return { stem: usageMatch[1], role: 'usage' }
  const logMatch = LOG_SUFFIX.exec(name)
  if (logMatch) return { stem: logMatch[1], role: 'log' }
  return null
}

function isSavedConversationFile(name) {
  if (!name || name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.lock')) return false
  if (runLogPart(name)) return false
  return CONVERSATION_FILE.test(name)
}

function recordingStemOf(name) {
  const match = RECORDING_PART.exec(name)
  if (match) return match[1]
  return name.replace(/\.[^.]+$/, '')
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function parseTimeMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function utcMonth(ms) {
  return new Date(ms).toISOString().slice(0, 7)
}

function readHeldLanes(runsDir, { platform = process.platform, listProcessesFn = listProcesses, isHolderAliveFn = isHolderAlive } = {}) {
  const held = new Set()
  if (!runsDir) return held
  for (const lockName of readLockFileNames(runsDir)) {
    if (lockName.startsWith('orchestrator-')) continue
    const lockPath = join(runsDir, lockName)
    const holder = readLaneLock(lockPath)
    if (isHolderAliveFn(holder, lockPath, { platform, list: listProcessesFn })) {
      held.add(lockName.slice(0, -5))
    }
  }
  return held
}

function readLockFileNames(runsDir) {
  try {
    return readdirSyncSafe(runsDir).filter((name) => name.endsWith('.lock') && !name.startsWith('.'))
  } catch {
    return []
  }
}

function readdirSyncSafe(dirPath) {
  try {
    return readdirSync(dirPath)
  } catch {
    return []
  }
}

function resolveFolders(options = {}) {
  const runsDir = resolvedOption(options.runsFolder)
  const projectDir = resolvedOption(options.projectRoot)
  const explicitRecordings = resolvedOption(options.recordingsFolder)
  const recordingsDir = explicitRecordings || (projectDir ? join(projectDir, 'public', 'recordings') : '')
  const worktreesDir = projectDir ? join(projectDir, WORKTREES_FOLDER) : ''
  return { runsDir, projectDir, recordingsDir, worktreesDir }
}

async function scanRunsFolder(runsDir, { counts, logGroups, lstatFn, limit }) {
  const entries = (await readDirentsSafe(runsDir)).filter(
    (entry) => !entry.isSymbolicLink() && entry.isFile() && !entry.name.startsWith('.') && !entry.name.endsWith('.tmp')
  )
  const infos = await statDirEntries(runsDir, entries, lstatFn, limit)
  for (let index = 0; index < entries.length; index += 1) {
    const info = infos[index]
    if (!info) continue
    const entry = entries[index]
    const filePath = join(runsDir, entry.name)
    const part = runLogPart(entry.name)
    if (part) {
      counts.logs.count += 1
      counts.logs.bytes += info.size
      const group = logGroups.get(part.stem) ?? []
      group.push({ name: entry.name, path: filePath, role: part.role, bytes: info.size, mtimeMs: info.mtimeMs })
      logGroups.set(part.stem, group)
      continue
    }
    if (isSavedConversationFile(entry.name)) {
      counts.conversations.count += 1
      counts.conversations.bytes += info.size
    }
  }
}

async function scanRecordingsFolder(recordingsDir, { counts, recordingGroups, lstatFn, limit }) {
  const entries = (await readDirentsSafe(recordingsDir)).filter(
    (entry) =>
      !entry.isSymbolicLink() &&
      entry.isFile() &&
      entry.name !== 'index.json' &&
      !entry.name.startsWith('.') &&
      !entry.name.endsWith('.tmp')
  )
  const infos = await statDirEntries(recordingsDir, entries, lstatFn, limit)
  for (let index = 0; index < entries.length; index += 1) {
    const info = infos[index]
    if (!info) continue
    const entry = entries[index]
    const filePath = join(recordingsDir, entry.name)
    counts.recordings.count += 1
    counts.recordings.bytes += info.size
    const stem = recordingStemOf(entry.name)
    const group = recordingGroups.get(stem) ?? []
    group.push({ name: entry.name, path: filePath, bytes: info.size, mtimeMs: info.mtimeMs })
    recordingGroups.set(stem, group)
  }
}

async function scanWorktreesFolder(worktreesDir, { counts, worktreeSizes, lstatFn, limit }) {
  const entries = (await readDirentsSafe(worktreesDir)).filter(
    (entry) => !entry.isSymbolicLink() && entry.isDirectory() && !entry.name.startsWith('.')
  )
  const measured = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(worktreesDir, entry.name)
      const bytes = await measureDirectoryBytes(entryPath, { lstatFn, limit })
      return { path: resolve(entryPath), bytes }
    })
  )
  for (const item of measured) {
    counts.worktrees.count += 1
    counts.worktrees.bytes += item.bytes
    worktreeSizes.set(item.path, item.bytes)
  }
}

async function scanStorage(options = {}) {
  const { runsDir, projectDir, recordingsDir, worktreesDir } = resolveFolders(options)
  const lstatFn = typeof options.lstatFn === 'function' ? options.lstatFn : lstat
  const limit = createLimiter(STAT_CONCURRENCY)
  const logGroups = new Map()
  const recordingGroups = new Map()
  const worktreeSizes = new Map()
  const counts = {
    logs: { count: 0, bytes: 0 },
    recordings: { count: 0, bytes: 0 },
    conversations: { count: 0, bytes: 0 },
    worktrees: { count: 0, bytes: 0 },
  }

  await Promise.all([
    scanRunsFolder(runsDir, { counts, logGroups, lstatFn, limit }),
    scanRecordingsFolder(recordingsDir, { counts, recordingGroups, lstatFn, limit }),
    scanWorktreesFolder(worktreesDir, { counts, worktreeSizes, lstatFn, limit }),
  ])

  return { runsDir, projectDir, recordingsDir, worktreesDir, counts, logGroups, recordingGroups, worktreeSizes }
}

function cleanWorktreesSummary({ projectDir, runsDir, platform = process.platform, collectWorktreesFn = collectWorktrees, worktreeSizes }) {
  const command = worktreesCleanCommand(projectDir)
  if (!projectDir) return { clean: [], command }
  let listed
  try {
    listed = collectWorktreesFn({ project: projectDir, runs: runsDir || undefined, platform })
  } catch {
    return { clean: [], command }
  }
  const rows = Array.isArray(listed?.worktrees) ? listed.worktrees : []
  const clean = []
  for (const row of rows) {
    if (!cleanDecision(row).remove) continue
    const rowPath = resolve(String(row.path ?? ''))
    clean.push({
      lane: String(row.lane ?? basename(rowPath)),
      branch: String(row.branch ?? ''),
      path: String(row.path ?? rowPath),
      bytes: worktreeSizes.get(rowPath) ?? 0,
    })
  }
  return { clean, command }
}

export async function measureStorage(options = {}) {
  const scanned = await scanStorage(options)
  const totalBytes =
    scanned.counts.logs.bytes +
    scanned.counts.recordings.bytes +
    scanned.counts.conversations.bytes +
    scanned.counts.worktrees.bytes
  const worktrees = cleanWorktreesSummary({
    projectDir: scanned.projectDir,
    runsDir: scanned.runsDir,
    platform: options.platform ?? process.platform,
    collectWorktreesFn: options.collectWorktreesFn ?? collectWorktrees,
    worktreeSizes: scanned.worktreeSizes,
  })
  return {
    runsFolder: scanned.runsDir,
    projectRoot: scanned.projectDir,
    kinds: scanned.counts,
    totalBytes,
    worktrees: {
      count: scanned.counts.worktrees.count,
      bytes: scanned.counts.worktrees.bytes,
      clean: worktrees.clean,
      command: worktrees.command,
    },
  }
}

function recordStem(record) {
  if (!record || typeof record !== 'object') return ''
  if (typeof record.log === 'string' && record.log.trim()) {
    return basename(record.log.trim()).replace(/\.log$/i, '')
  }
  return ''
}

function recordRecordingNames(record) {
  const names = []
  const stem = recordStem(record)
  if (stem) names.push(stem)
  if (typeof record?.recording === 'string' && record.recording.trim()) {
    const clean = basename(record.recording.trim())
      .replace(/\.log$/i, '')
      .replace(/-(run\.jsonl|agents\.json|tree\.json)$/i, '')
    if (clean) names.push(clean)
  }
  return names
}

function inferLaneForGroup(stem, groupFiles, recordsByStem) {
  const record = recordsByStem.get(stem)
  if (record && typeof record.lane === 'string' && record.lane.trim()) return record.lane.trim()
  const metaEntry = groupFiles.find((file) => file.role === 'meta')
  if (metaEntry) {
    const meta = readJsonSafe(metaEntry.path)
    if (meta && typeof meta.lane === 'string' && meta.lane.trim()) return meta.lane.trim()
  }
  const match = RUN_TIMESTAMP_SUFFIX.exec(stem)
  if (match) return match[1]
  return ''
}

function isProtectedByLaneOrRun({ stem, lane, runningStems, runningLanes, heldLanes, isRunningFn }) {
  if (runningStems.has(stem)) return true
  if (lane) {
    if (runningLanes.has(lane) || heldLanes.has(lane)) return true
    if (typeof isRunningFn === 'function' && isRunningFn(lane)) return true
    return false
  }
  for (const activeLane of runningLanes) {
    if (stem === activeLane || stem.startsWith(`${activeLane}-`)) return true
  }
  for (const heldLane of heldLanes) {
    if (stem === heldLane || stem.startsWith(`${heldLane}-`)) return true
  }
  return false
}

function indexRecordingNames(recordingsDir) {
  const names = new Set()
  if (!recordingsDir) return names
  const entries = readJsonSafe(join(recordingsDir, 'index.json'))
  if (!Array.isArray(entries)) return names
  for (const entry of entries) {
    if (entry && typeof entry.name === 'string' && entry.name.trim()) {
      names.add(entry.name.trim())
    }
  }
  return names
}

export async function previewStorageArchive(options = {}) {
  const days = cleanArchiveDays(options.days)
  const nowMs = typeof options.now === 'function' ? options.now() : Date.now()
  const cutoffMs = nowMs - days * DAY_MS
  const scanned = await scanStorage(options)
  if (!scanned.runsDir) {
    return { days, cutoff: new Date(cutoffMs).toISOString(), count: 0, totalBytes: 0, files: [] }
  }

  const openListRaw = typeof options.openRuns === 'function' ? options.openRuns() : options.openRuns
  const openList = Array.isArray(openListRaw) ? openListRaw : []
  const runningStems = new Set(openList.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean))
  const runningLanes = new Set([
    ...(Array.isArray(options.runningLanes) ? options.runningLanes.map((lane) => String(lane ?? '').trim()).filter(Boolean) : []),
    ...openList.map((entry) => String(entry?.lane ?? '').trim()).filter(Boolean),
  ])
  const heldLanes = readHeldLanes(scanned.runsDir, {
    platform: options.platform ?? process.platform,
    listProcessesFn: options.listProcessesFn ?? listProcesses,
    isHolderAliveFn: options.isHolderAliveFn ?? isHolderAlive,
  })

  const records = readAllRunRecords(join(scanned.runsDir, 'runs.jsonl'))
  const recordsByStem = new Map()
  for (const record of records) {
    const stem = recordStem(record)
    if (stem) recordsByStem.set(stem, record)
  }

  const candidateFiles = []
  const archivedStems = new Set()

  for (const [stem, groupFiles] of scanned.logGroups) {
    const lane = inferLaneForGroup(stem, groupFiles, recordsByStem)
    if (isProtectedByLaneOrRun({ stem, lane, runningStems, runningLanes, heldLanes, isRunningFn: options.isRunningFn })) {
      continue
    }
    const newestMtimeMs = Math.max(...groupFiles.map((file) => file.mtimeMs))
    const record = recordsByStem.get(stem)
    if (record?.running === true) continue
    const recordMs = record ? parseTimeMs(record.startedAt) : null
    if (newestMtimeMs >= cutoffMs || (recordMs !== null && recordMs >= cutoffMs)) continue

    const month = utcMonth(recordMs ?? newestMtimeMs)
    const archiveDir = `${ARCHIVE_DIR_NAME}/${month}`
    let groupReady = true
    const groupCandidates = []
    for (const file of groupFiles) {
      const destination = join(scanned.runsDir, ARCHIVE_DIR_NAME, month, file.name)
      if (await statFileSafe(destination)) {
        groupReady = false
        break
      }
      groupCandidates.push({
        name: file.name,
        kind: 'logs',
        bytes: file.bytes,
        mtimeMs: file.mtimeMs,
        archiveDir,
        source: file.path,
        destination,
      })
    }
    if (!groupReady) continue
    archivedStems.add(stem)
    candidateFiles.push(...groupCandidates)
  }

  const protectedRecordings = indexRecordingNames(scanned.recordingsDir)
  for (const record of records) {
    const names = recordRecordingNames(record)
    if (names.length === 0) continue
    const stem = recordStem(record)
    const lane = typeof record?.lane === 'string' ? record.lane.trim() : ''
    const recordMs = parseTimeMs(record?.startedAt)
    const liveLogKept = stem && scanned.logGroups.has(stem) && !archivedStems.has(stem)
    const active = record?.running === true || isProtectedByLaneOrRun({ stem, lane, runningStems, runningLanes, heldLanes, isRunningFn: options.isRunningFn })
    const recent = recordMs !== null && recordMs >= cutoffMs
    if (liveLogKept || active || recent) {
      for (const name of names) protectedRecordings.add(name)
    }
  }

  for (const [recStem, groupFiles] of scanned.recordingGroups) {
    if (protectedRecordings.has(recStem)) continue
    if (isProtectedByLaneOrRun({ stem: recStem, lane: '', runningStems, runningLanes, heldLanes, isRunningFn: options.isRunningFn })) {
      continue
    }
    const newestMtimeMs = Math.max(...groupFiles.map((file) => file.mtimeMs))
    if (newestMtimeMs >= cutoffMs) continue

    const month = utcMonth(newestMtimeMs)
    const archiveDir = `${ARCHIVE_DIR_NAME}/${month}`
    let groupReady = true
    const groupCandidates = []
    for (const file of groupFiles) {
      const destination = join(scanned.runsDir, ARCHIVE_DIR_NAME, month, file.name)
      if (await statFileSafe(destination)) {
        groupReady = false
        break
      }
      groupCandidates.push({
        name: file.name,
        kind: 'recordings',
        bytes: file.bytes,
        mtimeMs: file.mtimeMs,
        archiveDir,
        source: file.path,
        destination,
      })
    }
    if (groupReady) candidateFiles.push(...groupCandidates)
  }

  candidateFiles.sort((left, right) =>
    left.kind < right.kind ? -1
    : left.kind > right.kind ? 1
    : left.archiveDir < right.archiveDir ? -1
    : left.archiveDir > right.archiveDir ? 1
    : left.name < right.name ? -1
    : left.name > right.name ? 1
    : 0
  )

  const totalBytes = candidateFiles.reduce((sum, item) => sum + item.bytes, 0)
  return {
    days,
    cutoff: new Date(cutoffMs).toISOString(),
    count: candidateFiles.length,
    totalBytes,
    files: candidateFiles,
  }
}

async function moveFileSafe(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  try {
    await rename(source, destination)
    return
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
  }
  const info = await lstat(source)
  await copyFile(source, destination)
  await utimes(destination, info.atime, info.mtime)
  await unlink(source)
}

export async function applyStorageArchive(options = {}) {
  const preview = await previewStorageArchive(options)
  const moved = []
  for (const item of preview.files) {
    if (await statFileSafe(item.destination)) continue
    await moveFileSafe(item.source, item.destination)
    moved.push({
      name: item.name,
      kind: item.kind,
      bytes: item.bytes,
      archiveDir: item.archiveDir,
      destination: item.destination,
    })
  }
  return {
    ok: true,
    days: preview.days,
    count: moved.length,
    totalBytes: moved.reduce((sum, item) => sum + item.bytes, 0),
    moved,
  }
}

export function createStorageApi({
  runsFolder,
  projectRoot,
  recordingsFolder,
  sendJson,
  readJsonBody,
  lanesSource,
  runs,
  now,
  collectWorktreesFn,
  listProcessesFn,
  isHolderAliveFn,
  platform,
} = {}) {
  let archiving = false

  function sourceOptions(extra = {}) {
    const lanesApi = typeof lanesSource === 'function' ? lanesSource() : lanesSource
    const runsApi = typeof runs === 'function' ? runs() : runs
    return {
      runsFolder,
      projectRoot,
      recordingsFolder,
      now,
      collectWorktreesFn,
      listProcessesFn,
      isHolderAliveFn,
      platform,
      openRuns: lanesApi && typeof lanesApi.openRuns === 'function' ? () => lanesApi.openRuns() : undefined,
      isRunningFn: runsApi && typeof runsApi.isRunning === 'function' ? (lane) => runsApi.isRunning(lane) : undefined,
      ...extra,
    }
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/storage') {
      if (req.method !== 'GET') {
        sendJson(req, res, 405, { error: METHOD_PROBLEM })
        return true
      }
      const summary = await measureStorage(sourceOptions())
      sendJson(req, res, 200, summary)
      return true
    }

    if (url.pathname === '/api/storage/preview') {
      if (req.method !== 'POST') {
        sendJson(req, res, 405, { error: METHOD_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (!body) return true
      let days
      try {
        days = cleanArchiveDays(body.days)
      } catch (error) {
        sendJson(req, res, error.status ?? 400, { error: error.message })
        return true
      }
      const preview = await previewStorageArchive(sourceOptions({ days }))
      sendJson(req, res, 200, preview)
      return true
    }

    if (url.pathname === '/api/storage/archive') {
      if (req.method !== 'POST') {
        sendJson(req, res, 405, { error: METHOD_PROBLEM })
        return true
      }
      if (!req.headers.origin) {
        sendJson(req, res, 403, { error: ORIGIN_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (!body) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_PROBLEM })
        return true
      }
      let days
      try {
        days = cleanArchiveDays(body.days)
      } catch (error) {
        sendJson(req, res, error.status ?? 400, { error: error.message })
        return true
      }
      if (archiving) {
        sendJson(req, res, 409, { error: BUSY_PROBLEM })
        return true
      }
      archiving = true
      try {
        const result = await applyStorageArchive(sourceOptions({ days }))
        sendJson(req, res, 200, result)
      } finally {
        archiving = false
      }
      return true
    }

    return false
  }

  return { handle }
}
