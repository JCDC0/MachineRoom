import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { codexHarness } from '../src/harnesses/codex.js'
import { realPath } from './printed-path.js'

const CODEX_ROLLOUT_TAIL_BYTES = 64 * 1024

function codexHome(env = process.env) {
  const value = typeof env?.CODEX_HOME === 'string' ? env.CODEX_HOME.trim() : ''
  return value || join(homedir(), '.codex')
}

export function codexThreadId(log) {
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.includes('"thread.started"')) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'thread.started') continue
    const threadId = typeof item.thread_id === 'string' ? item.thread_id.trim() : ''
    if (/^[A-Za-z0-9-]+$/.test(threadId)) return threadId
  }
  return ''
}

function codexMonthFolders({ env, startedAt, now }) {
  const sessions = join(codexHome(env), 'sessions')
  const folders = []
  const seen = new Set()
  for (const time of [startedAt, now]) {
    const date = new Date(time)
    if (Number.isNaN(date.getTime())) continue
    for (const [year, month] of [[date.getFullYear(), date.getMonth() + 1], [date.getUTCFullYear(), date.getUTCMonth() + 1]]) {
      const key = `${year}-${month}`
      if (seen.has(key)) continue
      seen.add(key)
      folders.push(join(sessions, String(year), String(month).padStart(2, '0')))
    }
  }
  return folders
}

export function findCodexRollout({ threadId, env, startedAt, now }) {
  if (!/^[A-Za-z0-9-]+$/.test(threadId)) return ''
  const suffix = `-${threadId}.jsonl`
  const sessions = realPath(join(codexHome(env), 'sessions'))
  for (const monthFolder of codexMonthFolders({ env, startedAt, now })) {
    let days
    try {
      days = readdirSync(monthFolder, { withFileTypes: true })
    } catch {
      continue
    }
    const names = days.filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name)).map((entry) => entry.name).sort().reverse()
    for (const day of names) {
      let files
      try {
        files = readdirSync(join(monthFolder, day))
      } catch {
        continue
      }
      const match = files.find((name) => name.startsWith('rollout-') && name.endsWith(suffix))
      if (!match) continue
      const candidate = join(monthFolder, day, match)
      let stat
      try {
        stat = lstatSync(candidate)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) continue
      const file = realPath(candidate)
      const inside = relative(sessions, file)
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) continue
      return file
    }
  }
  return ''
}

export function readCodexQuota(file, limit = CODEX_ROLLOUT_TAIL_BYTES) {
  let before
  try {
    before = lstatSync(file, { bigint: true })
  } catch {
    return null
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size <= 0n) return null
  const flags = constants?.O_NOFOLLOW ? (constants.O_RDONLY ?? 0) | constants.O_NOFOLLOW : 'r'
  let fd
  try {
    fd = openSync(file, flags)
  } catch {
    return null
  }
  try {
    const after = fstatSync(fd, { bigint: true })
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size <= 0n) return null
    const cap = Number.isFinite(limit) ? Math.trunc(limit) : limit === Infinity ? Infinity : 0
    if (cap <= 0) return null
    const length = cap !== Infinity && after.size >= BigInt(cap) ? cap : Number(after.size)
    if (!Number.isSafeInteger(length) || length <= 0) return null
    const buffer = Buffer.alloc(length)
    const got = readSync(fd, buffer, 0, length, after.size - BigInt(length))
    if (got <= 0) return null
    let text = buffer.subarray(0, got).toString('utf8')
    if (after.size > BigInt(length)) {
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    let newest = null
    let contextWindow = null
    let contextTokens = null
    for (const line of text.split(/\r?\n/)) {
      const reading = codexHarness.quotaFrom(line)
      if (reading) newest = reading
      try {
        const item = JSON.parse(line)
        if (item?.type !== 'event_msg' || item?.payload?.type !== 'token_count') continue
        const info = item.payload.info
        if (typeof info?.model_context_window === 'number' && Number.isFinite(info.model_context_window) && info.model_context_window > 0) contextWindow = info.model_context_window
        if (typeof info?.last_token_usage?.total_tokens === 'number' && Number.isFinite(info.last_token_usage.total_tokens) && info.last_token_usage.total_tokens >= 0) contextTokens = info.last_token_usage.total_tokens
      } catch {}
    }
    return newest || contextWindow !== null || contextTokens !== null ? { ...newest, ...(contextWindow !== null ? { contextWindow } : {}), ...(contextTokens !== null ? { contextTokens } : {}) } : null
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {}
  }
}

export function quotaForRun({ harness, log, env = process.env, startedAt = Date.now(), now = Date.now() } = {}) {
  if (harness !== 'codex') return null
  const threadId = codexThreadId(log)
  if (threadId === '') return null
  const file = findCodexRollout({ threadId, env, startedAt, now })
  if (file === '') return null
  const reading = readCodexQuota(file)
  if (!reading?.windows) return null
  return { windows: reading.windows, at: new Date(now).toISOString() }
}

