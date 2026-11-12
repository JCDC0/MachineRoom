import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBriefs } from '../src/briefs/briefs.js'
import { readAllRunRecords } from './runs.js'

export const LANE_TASK_RECORDS = 30
export const LANE_TASK_REFUSAL = 'Lane runs start from Dispatch, not from a task.'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const BRIEF_ID = /^[A-Z]\d+[a-z]?$/
const RUN_NAME_TAIL = /-\d{8}-\d{6}$/
const ARCHIVE_PATH = ['docs', 'agents', 'history', 'TASKS-ARCHIVE.md']
const archiveCache = new Map()

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

export function laneTaskIssues({ openRuns = [], records = [], agents = [], briefs = [] } = {}) {
  const titles = new Map()
  for (const brief of Array.isArray(briefs) ? briefs : []) {
    if (brief && typeof brief.id === 'string' && typeof brief.title === 'string') titles.set(brief.id, brief.title)
  }
  const issues = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const id = runNameOf(record)
    if (!id || issues.has(id)) continue
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
        status: record?.killed === true || record?.exitCode !== 0 ? 'blocked' : 'done',
        agents,
        titles,
      })
    )
  }
  for (const run of Array.isArray(openRuns) ? openRuns : []) {
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

export function readArchivedBriefs(folder = REPO_ROOT) {
  const file = join(folder, ...ARCHIVE_PATH)
  let stamp = ''
  try {
    const stat = statSync(file)
    stamp = `${stat.mtimeMs}:${stat.size}`
  } catch {
    return []
  }
  const cached = archiveCache.get(file)
  if (cached && cached.stamp === stamp) return cached.briefs
  try {
    const briefs = parseBriefs(readFileSync(file, 'utf8'))
    archiveCache.set(file, { stamp, briefs })
    return briefs
  } catch {
    return []
  }
}

function withArchivedBriefs(briefs, ids, folder) {
  const list = Array.isArray(briefs) ? briefs : []
  const known = new Set(list.map((brief) => text(brief?.id).toLowerCase()).filter(Boolean))
  const missing = ids.filter((id) => !known.has(id.toLowerCase()))
  if (missing.length === 0) return list
  const wanted = new Set(missing.map((id) => id.toLowerCase()))
  const archived = readArchivedBriefs(folder).filter((brief) => wanted.has(text(brief?.id).toLowerCase()))
  return archived.length > 0 ? [...list, ...archived] : list
}

export function laneTaskState(options = {}) {
  const briefs = withArchivedBriefs(options.briefs, wantedBriefIds(options), options.folder ?? REPO_ROOT)
  return {
    issues: laneTaskIssues({ ...options, briefs }),
    liveRuns: laneLiveRuns(options),
  }
}

export function readRecentLaneRecords(file, limit = LANE_TASK_RECORDS) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : LANE_TASK_RECORDS
  const records = readAllRunRecords(file).filter(
    (record) => record && typeof record === 'object' && !Array.isArray(record) && typeof record.lane === 'string'
  )
  return records.slice(-size).reverse()
}

export function readLaneBriefs(folder = REPO_ROOT) {
  try {
    return parseBriefs(readFileSync(join(folder, 'docs', 'agents', 'TASKS.md'), 'utf8'))
  } catch {
    return []
  }
}
