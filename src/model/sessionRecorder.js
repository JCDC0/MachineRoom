import { prepare } from './source.js'

export const RECORD_MINUTES_DEFAULT = 10
export const RECORD_MINUTES_MIN = 1
export const RECORD_MINUTES_MAX = 240

const MINUTE_MS = 60000
const RUN_FRAME = 'heartbeat.run.'
export const COMPACT_AFTER = 1024

function asNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return NaN
}

export function clampRecordMinutes(value) {
  const num = asNumber(value)
  if (!Number.isFinite(num)) return RECORD_MINUTES_DEFAULT
  return Math.min(RECORD_MINUTES_MAX, Math.max(RECORD_MINUTES_MIN, Math.floor(num)))
}

function timeOf(frame) {
  const time = Date.parse(frame?.createdAt)
  return Number.isFinite(time) ? time : null
}

function isActivity(frame) {
  if (!frame || typeof frame !== 'object') return false
  if (typeof frame.type === 'string' && frame.type.startsWith(RUN_FRAME)) return true
  const payload = frame.payload
  if (!payload || typeof payload !== 'object') return false
  return typeof payload.runId === 'string' || typeof payload.agentId === 'string'
}

export function createSessionRecorder({ minutes = RECORD_MINUTES_DEFAULT } = {}) {
  let limit = clampRecordMinutes(minutes)
  let active = false
  let newest = null
  let kept = []
  let head = 0

  function trim() {
    if (newest === null) return
    const from = newest - limit * MINUTE_MS
    while (head < kept.length && kept[head].time < from) head += 1
    if (head > COMPACT_AFTER) {
      kept = kept.slice(head)
      head = 0
    }
  }

  function push(frame) {
    const time = timeOf(frame)
    if (time === null) return false
    if (!active) {
      if (!isActivity(frame)) return false
      active = true
    }
    const last = kept.length > head ? kept[kept.length - 1].time : null
    if (last !== null && time < last) {
      if (head > 0) {
        kept = kept.slice(head)
        head = 0
      }
      kept.push({ time, frame })
      kept.sort((a, b) => a.time - b.time)
    } else {
      kept.push({ time, frame })
    }
    if (newest === null || time > newest) newest = time
    trim()
    return true
  }

  function frames() {
    return kept.slice(head).map((item) => item.frame)
  }

  function started() {
    return active
  }

  function clear() {
    active = false
    newest = null
    kept = []
    head = 0
  }

  function setMinutes(next) {
    limit = clampRecordMinutes(next)
    trim()
  }

  function span() {
    if (head >= kept.length) return 0
    return kept[kept.length - 1].time - kept[head].time
  }

  function stats() {
    return { kept: kept.length - head, slots: kept.length }
  }

  return { push, frames, started, clear, setMinutes, minutes: () => limit, span, stats }
}

function shiftFrame(frame, from) {
  const time = timeOf(frame)
  const createdAt = new Date(time - from).toISOString()
  const payload = frame.payload
  if (!payload || typeof payload !== 'object' || typeof payload.ts !== 'string') {
    return { ...frame, createdAt }
  }
  const at = Date.parse(payload.ts)
  if (!Number.isFinite(at)) return { ...frame, createdAt, payload: { ...payload } }
  return { ...frame, createdAt, payload: { ...payload, ts: new Date(at - from).toISOString() } }
}

export function recorderToReplay(recorder, { agentsFile, treeFile } = {}) {
  const frames = recorder && typeof recorder.frames === 'function' ? recorder.frames() : []
  if (frames.length === 0) return null
  const oldest = timeOf(frames[0])
  return prepare({
    frames: frames.map((frame) => shiftFrame(frame, oldest)),
    agentsFile,
    treeFile,
  })
}
