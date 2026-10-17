import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN_END = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])

export function runIdOf(entry) {
  return entry?.runId ?? entry?.id ?? null
}

export function selectRuns(payload, since) {
  const items = Array.isArray(payload) ? payload : (payload?.runs ?? payload?.items ?? [])
  const sinceMs = Date.parse(since)
  return items.filter((entry) => {
    const started = Date.parse(entry.startedAt ?? entry.createdAt ?? NaN)
    return Number.isFinite(started) && started >= sinceMs
  })
}

export function parseLog(content) {
  return String(content ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function buildRunFrames({ companyId, runId, run, log, events }) {
  const agentId = run.agentId ?? null
  const issueId = run.issueId ?? null
  const frames = []
  const add = (type, createdAt, payload) => {
    frames.push({
      id: null,
      companyId,
      type,
      createdAt,
      payload: { runId, agentId, issueId, ...payload },
    })
  }

  add('heartbeat.run.queued', run.createdAt ?? run.startedAt, {})
  if (run.startedAt) {
    add('heartbeat.run.status', run.startedAt, {
      status: 'running',
      error: null,
      errorCode: null,
      startedAt: run.startedAt,
      finishedAt: null,
    })
  }
  for (const entry of parseLog(log?.content)) {
    add('heartbeat.run.log', entry.ts ?? run.startedAt, {
      ts: entry.ts ?? null,
      seq: entry.seq ?? null,
      stream: entry.stream ?? 'stdout',
      chunk: entry.chunk ?? '',
      truncated: false,
    })
  }
  for (const entry of events ?? []) {
    if (entry.level !== 'error') continue
    add('heartbeat.run.event', entry.createdAt ?? run.startedAt, {
      seq: entry.seq ?? null,
      level: entry.level,
      message: entry.message ?? 'error',
    })
  }
  if (RUN_END.has(run.status)) {
    add('heartbeat.run.status', run.finishedAt ?? run.startedAt ?? run.createdAt, {
      status: run.status,
      error: run.error ?? null,
      errorCode: run.errorCode ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    })
  }
  return frames
}

export function sortAndNumber(frames) {
  return frames
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => {
      const at = Date.parse(a.frame.createdAt ?? NaN)
      const bt = Date.parse(b.frame.createdAt ?? NaN)
      return at - bt || a.index - b.index
    })
    .map(({ frame }, index) => ({ ...frame, id: index + 1 }))
}

function usage(message) {
  if (message) console.error(message)
  console.error('usage: node scripts/frames-from-runs.mjs --since <ISO time> --out <file> [--run <runId>]')
  console.error('env: PAPERCLIP_URL (default http://127.0.0.1:3100), PAPERCLIP_COMPANY_ID')
  process.exit(1)
}

async function main() {
  const argv = process.argv.slice(2)
  let since = null
  let out = null
  const runs = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--since') since = argv[(i += 1)]
    else if (arg === '--out') out = argv[(i += 1)]
    else if (arg === '--run') runs.push(argv[(i += 1)])
    else usage(`unknown argument ${arg}`)
  }
  if (!since || Number.isNaN(Date.parse(since))) usage('a valid --since <ISO time> is required')
  if (!out) usage('--out <file> is required')

  const base = (process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '')
  const companyId = process.env.PAPERCLIP_COMPANY_ID
  if (!companyId) usage('PAPERCLIP_COMPANY_ID is not set')

  const headers = {}
  if (process.env.PAPERCLIP_API_KEY) headers.authorization = `Bearer ${process.env.PAPERCLIP_API_KEY}`
  const get = async (path) => {
    const response = await fetch(`${base}${path}`, { headers })
    if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`)
    return response.json()
  }

  const list = await get(`/api/companies/${companyId}/heartbeat-runs?limit=50`)
  let found = selectRuns(list, since)
  if (runs.length) found = found.filter((entry) => runs.includes(runIdOf(entry)))

  const frames = []
  for (const entry of found) {
    const runId = runIdOf(entry)
    const [run, log, events] = await Promise.all([
      get(`/api/heartbeat-runs/${runId}`),
      get(`/api/heartbeat-runs/${runId}/log`),
      get(`/api/heartbeat-runs/${runId}/events`),
    ])
    const linked = await get(`/api/heartbeat-runs/${runId}/issues`)
    const issue = Array.isArray(linked) ? linked[0] : linked
    frames.push(...buildRunFrames({ companyId, runId, run: { ...run, issueId: run.issueId ?? run.nativeIssueId ?? issue?.issueId ?? null }, log, events }))
  }
  const ordered = sortAndNumber(frames)
  const text = ordered.map((frame) => JSON.stringify(frame)).join('\n')
  writeFileSync(out, text ? `${text}\n` : '')
  console.log(`runs: ${found.length}, frames: ${ordered.length} -> ${out}`)
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  await main()
}
