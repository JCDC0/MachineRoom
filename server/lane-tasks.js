import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { laneAgents, readLanes } from './lanes-source.js'

export const LANE_TASK_RECORDS = 30
export const LANE_TASK_REFUSAL = 'Lane runs start from Dispatch, not from a task.'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
const RUN_NAME_TAIL = /-\d{8}-\d{6}$/
const ARCHIVE_PATH = ['docs', 'agents', 'history', 'TASKS-ARCHIVE.md']
const REPEATED_FAILURE = 'repeated failure'
const briefsFileCache = new Map()
const briefLookupCache = new WeakMap()
const combinedBriefsCache = new WeakMap()
const recoveryIndexCache = new WeakMap()

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function timeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : 0
}

function isoOrEmpty(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) <= 8.64e15 ? new Date(value).toISOString() : ''
  }
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function agentFor(agents, lane) {
  const roster = Array.isArray(agents) ? agents : []
  return roster.find((agent) => agent?.key === lane) ?? roster.find((agent) => agent?.id === `agent-${lane}`) ?? null
}

export function laneAgentList(lanes) {
  try {
    const source = typeof lanes === 'function' ? lanes() : lanes
    if (source && Array.isArray(source.agents)) return source.agents
  } catch {}
  return laneAgents(readLanes())
}

export function runNameOf(record) {
  const log = text(record?.log)
  if (!log) return ''
  const file = log.split(/[\\/]/).pop() ?? ''
  return file.replace(/\.log$/i, '')
}

export function runIdentity(name, lane) {
  let rest = text(name)
  const prefix = `${text(lane)}-`
  if (prefix !== '-' && rest.startsWith(prefix)) rest = rest.slice(prefix.length)
  rest = rest.replace(RUN_NAME_TAIL, '')
  const parts = rest
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)
  return { project: parts.includes('project'), ids: parts.filter((part) => BRIEF_ID.test(part)) }
}

function identifierFor({ id, lane, briefs, project }) {
  const ids = Array.isArray(briefs) ? briefs.map(text).filter(Boolean) : []
  if (project) return 'project'
  if (ids.length > 0) return ids.join('+')
  const fromName = runIdentity(id, lane)
  if (fromName.project) return 'project'
  return fromName.ids.length > 0 ? fromName.ids.join('+') : text(id)
}

function titlesFor(ids, titles) {
  const found = []
  for (const id of ids) {
    const title = titles.get(id)
    if (title) found.push(title)
  }
  return found.join(' + ')
}

function issueFor({ id, lane, startedAt, updatedAt, project, briefs, task, status, agents, titles }) {
  const identifier = identifierFor({ id, lane, briefs, project })
  const ids =
    Array.isArray(briefs) && briefs.length > 0
      ? briefs.map(text).filter(Boolean)
      : runIdentity(id, lane).ids
  const title = titlesFor(ids, titles) || text(task).slice(0, 80) || identifier
  const agent = agentFor(agents, lane)
  return {
    id,
    identifier,
    title,
    description: '',
    status,
    priority: 'medium',
    assigneeAgentId: agent?.id ? String(agent.id) : null,
    parentId: null,
    overrides: null,
    createdAt: isoOrEmpty(startedAt),
    updatedAt: isoOrEmpty(updatedAt ?? startedAt),
  }
}

function startTimeOf(record) {
  const value = record?.startedAt
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = text(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function setMaxTime(map, key, time) {
  const prev = map.get(key)
  if (prev === undefined || time > prev) map.set(key, time)
}

function buildRecoveryIndex(records) {
  const anyBriefMax = new Map()
  const editBriefMax = new Map()
  const anyTaskMax = new Map()
  const editTaskMax = new Map()
  for (const candidate of records) {
    if (
      !candidate ||
      candidate.exitCode !== 0 ||
      candidate.killed ||
      candidate.startFailed ||
      text(candidate.stopReason) === REPEATED_FAILURE ||
      candidate.repeatedFailure?.count >= 5
    ) {
      continue
    }
    const time = startTimeOf(candidate)
    if (time === null) continue
    const isPlan = candidate.mode === 'plan'
    if (Array.isArray(candidate.briefs)) {
      for (const brief of candidate.briefs) {
        if (typeof brief !== 'string' || !brief) continue
        setMaxTime(anyBriefMax, brief, time)
        if (!isPlan) setMaxTime(editBriefMax, brief, time)
      }
    }
    const task = text(candidate.task)
    if (task) {
      setMaxTime(anyTaskMax, task, time)
      if (!isPlan) setMaxTime(editTaskMax, task, time)
    }
  }
  return { anyBriefMax, editBriefMax, anyTaskMax, editTaskMax }
}

function getRecoveryIndex(records) {
  if (Object.isFrozen(records)) {
    let cached = recoveryIndexCache.get(records)
    if (!cached) {
      cached = buildRecoveryIndex(records)
      recoveryIndexCache.set(records, cached)
    }
    return cached
  }
  return buildRecoveryIndex(records)
}

function succeededLaterIndexed(record, index) {
  const failedAt = startTimeOf(record)
  if (failedAt === null) return false
  const briefs = Array.isArray(record.briefs) ? record.briefs.map(text).filter(Boolean) : []
  const planFailure = record.mode === 'plan'
  if (briefs.length > 0) {
    const map = planFailure ? index.anyBriefMax : index.editBriefMax
    return briefs.every((brief) => {
      const latest = map.get(brief)
      return latest !== undefined && latest > failedAt
    })
  }
  const task = text(record.task)
  if (!task) return false
  const map = planFailure ? index.anyTaskMax : index.editTaskMax
  const latest = map.get(task)
  return latest !== undefined && latest > failedAt
}

function statusFor(record, getIndex, mergedBriefs) {
  const failed = record?.killed === true || record?.exitCode !== 0
  if (!failed) return 'done'
  if (
    Array.isArray(record?.briefs) &&
    record.briefs.length > 0 &&
    record.briefs.every((brief) => mergedBriefs.has(text(brief).toLowerCase()))
  ) return 'done'
  return succeededLaterIndexed(record, getIndex()) ? 'done' : 'blocked'
}

export function mergedBriefIds(subjects) {
  const ids = new Set()
  for (const subject of subjects) {
    const match = /^\d+\.\d+\.\d+: Merge (P\d+[a-z]?)\b/i.exec(subject)
    if (match) ids.add(match[1].toLowerCase())
  }
  return ids
}

function buildBriefLookup(briefs) {
  const titles = new Map()
  const known = new Set()
  const byLowerId = new Map()
  for (const brief of Array.isArray(briefs) ? briefs : []) {
    if (!brief || typeof brief.id !== 'string') continue
    if (typeof brief.title === 'string') titles.set(brief.id, brief.title)
    const lower = text(brief.id).toLowerCase()
    if (!lower) continue
    known.add(lower)
    if (!byLowerId.has(lower)) byLowerId.set(lower, [])
    byLowerId.get(lower).push(brief)
  }
  return { titles, known, byLowerId }
}

function getBriefLookup(briefs) {
  if (Array.isArray(briefs) && Object.isFrozen(briefs)) {
    let cached = briefLookupCache.get(briefs)
    if (!cached) {
      cached = buildBriefLookup(briefs)
      briefLookupCache.set(briefs, cached)
    }
    return cached
  }
  return buildBriefLookup(briefs)
}

export function laneTaskIssues({ openRuns = [], records = [], recoveryRecords, agents = [], briefs = [], mergedBriefs = new Set() } = {}) {
  const { titles } = getBriefLookup(briefs)
  const list = Array.isArray(records) ? records : []
  const runs = Array.isArray(openRuns) ? openRuns : []
  const recoverySource = Array.isArray(recoveryRecords) ? recoveryRecords : list
  let recoveryIndex = null
  const readRecoveryIndex = () => {
    if (recoveryIndex === null) recoveryIndex = getRecoveryIndex(recoverySource)
    return recoveryIndex
  }
  const runningBriefs = new Set()
  for (const run of runs) {
    for (const brief of runIdentity(text(run?.name), text(run?.lane)).ids) {
      runningBriefs.add(brief.toLowerCase())
    }
  }
  const issues = new Map()
  for (const record of list) {
    const id = runNameOf(record)
    if (!id || issues.has(id)) continue
    const status = statusFor(record, readRecoveryIndex, mergedBriefs)
    const recordBriefs = Array.isArray(record?.briefs) ? record.briefs.map(text).filter(Boolean) : []
    if (
      status === 'blocked' &&
      recordBriefs.length > 0 &&
      recordBriefs.every((brief) => runningBriefs.has(brief.toLowerCase()))
    ) {
      continue
    }
    const lane = text(record?.lane)
    const minutes = Number.isFinite(record?.minutes) ? record.minutes : 0
    const updatedAt = minutes > 0 ? timeValue(record?.startedAt) + minutes * 60000 : record?.startedAt
    const project = text(record?.project) !== '' || runIdentity(id, lane).project
    issues.set(
      id,
      issueFor({
        id,
        lane,
        startedAt: record?.startedAt,
        updatedAt,
        project,
        briefs: record?.briefs,
        task: record?.task,
        status,
        agents,
        titles,
      })
    )
  }
  for (const run of runs) {
    const id = text(run?.name)
    if (!id) continue
    const lane = text(run?.lane)
    issues.set(
      id,
      issueFor({
        id,
        lane,
        startedAt: run?.startedAt,
        updatedAt: run?.startedAt,
        project: text(run?.project) !== '' || runIdentity(id, lane).project,
        briefs: [],
        task: '',
        status: 'in_progress',
        agents,
        titles,
      })
    )
  }
  return [...issues.values()].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt) || a.id.localeCompare(b.id))
}

export function laneLiveRuns({ openRuns = [], agents = [] } = {}) {
  const runs = []
  for (const run of Array.isArray(openRuns) ? openRuns : []) {
    const name = text(run?.name)
    if (!name) continue
    const lane = text(run?.lane)
    const agent = agentFor(agents, lane)
    runs.push({
      runId: `run-${name}`,
      agentId: agent?.id ? String(agent.id) : null,
      agentName: agent?.name ? String(agent.name) : lane || null,
      adapterType: agent?.adapterType ? String(agent.adapterType) : null,
      status: 'running',
      issueId: name,
      startedAt: isoOrEmpty(run?.startedAt) || null,
      lastOutputAt: null,
      ...(run.contextTokens != null ? { contextTokens: run.contextTokens } : {}),
      ...(run.contextWindow != null ? { contextWindow: run.contextWindow } : {}),
      ...(run?.startedBy ? { startedBy: run.startedBy } : {}),
    })
  }
  return runs.sort((a, b) => timeValue(b.startedAt) - timeValue(a.startedAt))
}

function wantedBriefIds({ openRuns = [], records = [] } = {}) {
  const ids = new Set()
  for (const record of Array.isArray(records) ? records : []) {
    for (const id of Array.isArray(record?.briefs) ? record.briefs : []) {
      const value = text(id)
      if (value) ids.add(value)
    }
    for (const id of runIdentity(runNameOf(record), record?.lane).ids) ids.add(id)
  }
  for (const run of Array.isArray(openRuns) ? openRuns : []) {
    for (const id of runIdentity(text(run?.name), run?.lane).ids) ids.add(id)
  }
  return [...ids]
}

function readCachedBriefs(file) {
  let stamp = ''
  try {
    const stat = statSync(file)
    stamp = `${stat.mtimeMs}:${stat.size}`
  } catch {
    briefsFileCache.delete(file)
    return Object.freeze([])
  }
  const cached = briefsFileCache.get(file)
  if (cached && cached.stamp === stamp) return cached.briefs
  try {
    const briefs = Object.freeze(parseBriefs(readFileSync(file, 'utf8')))
    briefsFileCache.set(file, { stamp, briefs })
    return briefs
  } catch {
    return Object.freeze([])
  }
}

export function readArchivedBriefs(folder = REPO_ROOT) {
  return readCachedBriefs(join(folder, ...ARCHIVE_PATH))
}

function withArchivedBriefs(briefs, ids, folder) {
  const list = Array.isArray(briefs) ? briefs : []
  const { known } = getBriefLookup(list)
  const missing = []
  const seenMissing = new Set()
  for (const id of ids) {
    const lower = id.toLowerCase()
    if (known.has(lower) || seenMissing.has(lower)) continue
    seenMissing.add(lower)
    missing.push(lower)
  }
  if (missing.length === 0) return list
  const archiveList = readArchivedBriefs(folder)
  const cacheKey = missing.slice().sort().join('\u0000')
  let listCache = Object.isFrozen(list) ? combinedBriefsCache.get(list) : null
  if (listCache && listCache.archiveList === archiveList && listCache.byKey.has(cacheKey)) {
    return listCache.byKey.get(cacheKey)
  }
  const archiveLookup = getBriefLookup(archiveList)
  const archived = []
  for (const lower of missing) {
    const found = archiveLookup.byLowerId.get(lower)
    if (found) archived.push(...found)
  }
  const combined = archived.length > 0 ? Object.freeze([...list, ...archived]) : list
  if (Object.isFrozen(list)) {
    if (!listCache || listCache.archiveList !== archiveList) {
      listCache = { archiveList, byKey: new Map() }
      combinedBriefsCache.set(list, listCache)
    }
    if (listCache.byKey.size >= 16) listCache.byKey.clear()
    listCache.byKey.set(cacheKey, combined)
  }
  return combined
}

export function laneTaskState(options = {}) {
  const briefs = withArchivedBriefs(options.briefs, wantedBriefIds(options), options.folder ?? REPO_ROOT)
  return {
    issues: laneTaskIssues({ ...options, briefs }),
    liveRuns: laneLiveRuns(options),
  }
}

export function recentLaneRecords(records, limit = LANE_TASK_RECORDS) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : LANE_TASK_RECORDS
  const list = Array.isArray(records) ? records : []
  const out = []
  for (let index = list.length - 1; index >= 0 && out.length < size; index -= 1) {
    const record = list[index]
    if (record && typeof record === 'object' && !Array.isArray(record) && typeof record.lane === 'string') {
      out.push(record)
    }
  }
  return out
}

export function readLaneBriefs(folder = REPO_ROOT) {
  return readCachedBriefs(join(folder, 'docs', 'agents', 'TASKS.md'))
}
