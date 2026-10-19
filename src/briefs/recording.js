import { basename } from '../model/paths.js'
import { createOpencodeParser } from '../model/parsers/opencode.js'
import { sessionToolLines } from './run.js'

const ADAPTERS = { hermes: 'hermes_local', opencode: 'opencode_local' }
const RUNNING_DELAY = 1000
const END_PAD = 1000
const MS_FLOOR = 1e11

function msFrom(value) {
  if (value === null || value === undefined || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

function iso(ms) {
  return new Date(ms).toISOString()
}

function stamp(ms) {
  return iso(ms).replace(/[-:.]/g, '')
}

function idsFor(lane, startedAt) {
  const key = String(lane ?? '')
  if (!key) throw new Error('The recording needs the name of the lane.')
  const start = msFrom(startedAt)
  if (start === null) throw new Error('The recording needs the start time of the run.')
  const mark = stamp(start)
  return {
    runId: `run-${key}-${mark}`,
    agentId: `agent-${key}`,
    issueId: `issue-${key}-${mark}`,
    companyId: `company-${key}-${mark}`,
  }
}

function sessionTimes(exportText) {
  const times = []
  for (const raw of String(exportText ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    let session
    try {
      session = JSON.parse(raw)
    } catch {
      continue
    }
    const messages = Array.isArray(session?.messages) ? session.messages : []
    const results = new Map()
    for (const message of messages) {
      if (message?.role === 'tool' && message.tool_call_id) results.set(String(message.tool_call_id), message)
    }
    for (const message of messages) {
      if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
      for (const call of message.tool_calls) {
        const name = String(call?.function?.name ?? call?.name ?? '').trim()
        if (!name) continue
        const result = results.get(String(call.id ?? call.call_id ?? ''))
        const at = Number(result?.timestamp ?? message.timestamp)
        times.push(Number.isFinite(at) ? at : null)
      }
    }
  }
  return times
}

function hermesEntries(session) {
  const lines = sessionToolLines(session)
  const times = sessionTimes(session)
  return lines.map((line, index) => {
    const at = times[index]
    const ms = typeof at === 'number' ? (at > MS_FLOOR ? at : at * 1000) : null
    return { chunk: `${line}\n`, at: ms }
  })
}

function opencodeEntries(log) {
  const parser = createOpencodeParser({ rootName: '', files: [], dirs: [] })
  const entries = []
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let at = null
    try {
      const item = JSON.parse(line)
      if (typeof item?.timestamp === 'number' && Number.isFinite(item.timestamp)) at = item.timestamp
    } catch {
      at = null
    }
    const activities = parser.push(`${line}\n`, at ?? 0)
    if (activities.length === 0) continue
    entries.push({ chunk: `${line}\n`, at })
  }
  return entries
}

function failure(record) {
  if (record.killed === true) return 'killed'
  if (!Number.isInteger(record.exitCode)) return 'no exit code'
  return `exit ${record.exitCode}`
}

export function framesFromRun({ harness, log, session, record } = {}) {
  if (!record || typeof record !== 'object') throw new Error('There is no run record to turn into a recording.')
  if (harness !== 'hermes' && harness !== 'opencode') throw new Error(`The recording does not know the ${harness} log.`)
  const start = msFrom(record.startedAt)
  if (start === null) throw new Error('The run record has no start time.')
  const ids = idsFor(record.lane, record.startedAt)
  const entries = harness === 'hermes' ? hermesEntries(session) : opencodeEntries(log)
  const ok = record.exitCode === 0 && record.killed !== true
  const minutes = Number.isFinite(Number(record.minutes)) && Number(record.minutes) > 0 ? Number(record.minutes) : 0
  const lastLog = entries.reduce((max, entry) => (entry.at === null ? max : Math.max(max, entry.at)), start)
  const firstLog = entries.reduce((min, entry) => (entry.at === null ? min : Math.min(min, entry.at)), Infinity)
  const running = Number.isFinite(firstLog) ? Math.max(start, Math.min(start + RUNNING_DELAY, firstLog)) : start + RUNNING_DELAY
  const finish = Math.max(start + minutes * 60000, lastLog + END_PAD, running + END_PAD)
  const base = { runId: ids.runId, agentId: ids.agentId, issueId: ids.issueId }
  const items = [
    { time: start, type: 'heartbeat.run.queued', payload: { ...base } },
    {
      time: running,
      type: 'heartbeat.run.status',
      payload: { ...base, status: 'running', error: null, errorCode: null, startedAt: iso(running), finishedAt: null },
    },
  ]
  entries.forEach((entry, index) => {
    const time = entry.at === null ? start : Math.max(entry.at, running)
    items.push({
      time,
      type: 'heartbeat.run.log',
      payload: { ...base, ts: iso(time), seq: index + 1, stream: 'stdout', chunk: entry.chunk, truncated: false },
    })
  })
  items.push({
    time: finish,
    type: 'heartbeat.run.status',
    payload: {
      ...base,
      status: ok ? 'succeeded' : 'failed',
      error: ok ? null : failure(record),
      errorCode: null,
      startedAt: iso(running),
      finishedAt: iso(finish),
    },
  })
  return items
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((item, index) => ({
      id: index + 1,
      companyId: ids.companyId,
      type: item.type,
      createdAt: iso(item.time),
      payload: item.payload,
    }))
}

export function agentsFile(lane, lanes) {
  const key = String(lane ?? '')
  const entry = lanes && Object.hasOwn(lanes, key) ? lanes[key] : null
  if (!entry) throw new Error(`There is no lane named ${key}.`)
  const harness = entry.cli?.harness ?? key
  const adapterType = Object.hasOwn(ADAPTERS, harness) ? ADAPTERS[harness] : null
  if (!adapterType) throw new Error(`The recording does not know the ${harness} adapter.`)
  return {
    projectRoot: basename(entry.worktree ?? ''),
    agents: [
      {
        id: `agent-${key}`,
        key,
        name: entry.name ?? key,
        adapterType,
        parser: harness,
      },
    ],
  }
}

export function treeFile(root, files) {
  return {
    root: basename(root ?? ''),
    files: Array.isArray(files) ? files.map(String) : [],
  }
}
