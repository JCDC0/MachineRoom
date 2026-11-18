import { maskProfilePaths } from '../model/paths.js'
import { maskKeys } from './audit.js'

const TASK_LIMIT = 120
const REPEATED_FAILURE = 'repeated failure'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function startTime(record) {
  const value = record?.startedAt
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = text(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function firstTaskLine(value) {
  if (typeof value !== 'string') return ''
  for (const raw of value.split(/\r?\n/)) {
    const line = maskProfilePaths(maskKeys(raw).text).replace(/\s+/g, ' ').trim()
    if (!line) continue
    const clipped = line.length > TASK_LIMIT ? `${line.slice(0, TASK_LIMIT - 3)}...` : line
    return clipped.replace(/\.+$/, '')
  }
  return ''
}

function workLabel(record) {
  const briefs = Array.isArray(record?.briefs)
    ? record.briefs.map((item) => text(item)).filter(Boolean)
    : []
  if (briefs.length > 0) return briefs.join(' ')
  return firstTaskLine(record?.task)
}

export function backupRanLater(record, lane, records) {
  const failover = record?.failover
  if (!failover || typeof failover !== 'object' || Array.isArray(failover)) return false
  if (failover.refused === true) return false
  const to = text(failover.to)
  if (!to) return false
  const failedAt = startTime(record)
  for (const candidate of records) {
    if (!candidate || typeof candidate !== 'object') continue
    if (text(candidate.lane) !== to) continue
    const from = candidate.failoverFrom
    if (from && typeof from === 'object' && !Array.isArray(from) && text(from.lane) === lane) {
      const fromAt = startTime(from)
      if (fromAt === null || failedAt === null || fromAt === failedAt) return true
    }
    const candidateAt = startTime(candidate)
    if (failedAt !== null && candidateAt !== null && candidateAt > failedAt) return true
  }
  return false
}

function attentionText(record, lane) {
  if (record.killed === true) return ''
  const repeated = text(record.stopReason) === REPEATED_FAILURE ||
    (typeof record.repeatedFailure?.tool === 'string' && Number.isInteger(record.repeatedFailure.count) && record.repeatedFailure.count >= 5)
  if (!repeated && record.startFailed !== true && (typeof record.exitCode !== 'number' || !Number.isFinite(record.exitCode) || record.exitCode === 0)) return ''
  return `${lane} failed on ${workLabel(record) || 'unknown work'}`
}

export function succeededLater(record, records) {
  const failedAt = startTime(record)
  if (failedAt === null) return false
  const briefs = Array.isArray(record.briefs) ? record.briefs.map(text).filter(Boolean) : []
  const task = text(record.task)
  const successes = records.filter((candidate) => candidate && candidate.exitCode === 0 && !candidate.killed && !candidate.startFailed && startTime(candidate) !== null && startTime(candidate) > failedAt && text(candidate.stopReason) !== REPEATED_FAILURE && !(candidate.repeatedFailure?.count >= 5))
  if (briefs.length) return briefs.every((brief) => successes.some((candidate) => Array.isArray(candidate.briefs) && candidate.briefs.includes(brief)))
  return Boolean(task) && successes.some((candidate) => text(candidate.task) === task)
}

function newestByLane(records) {
  const latest = new Map()
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') return
    const lane = text(record.lane)
    if (!lane) return
    const time = startTime(record)
    const kept = latest.get(lane)
    if (!kept || kept.time === null || (time !== null && time >= kept.time)) {
      latest.set(lane, { lane, record, time, index })
    }
  })
  return [...latest.values()]
}

export function attentionItems(records) {
  const list = Array.isArray(records) ? records : []
  if (list.length === 0) return []
  const items = []
  for (const entry of newestByLane(list)) {
    const itemText = attentionText(entry.record, entry.lane)
    if (!itemText) continue
    if (backupRanLater(entry.record, entry.lane, list) || succeededLater(entry.record, list)) continue
    items.push({
      lane: entry.lane,
      startedAt: entry.record.startedAt ?? null,
      text: itemText,
      time: entry.time,
      index: entry.index,
    })
  }
  items.sort((left, right) => {
    if (left.time !== right.time) {
      if (left.time === null) return 1
      if (right.time === null) return -1
      return right.time - left.time
    }
    return right.index - left.index
  })
  return items.map(({ lane, startedAt, text: line }) => ({ lane, startedAt, text: line }))
}
