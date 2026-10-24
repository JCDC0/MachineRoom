import { basename } from '../model/paths.js'
import { createAgyParser } from '../model/parsers/agy.js'
import { createClaudeParser } from '../model/parsers/claude.js'
import { createHermesParser } from '../model/parsers/hermes.js'
import { createOpencodeParser } from '../model/parsers/opencode.js'
import { branchFor } from './briefs.js'

export const UNATTENDED_NOTE = 'You are running unattended in a one-shot command started for the owner, who may be away. Nobody can answer a question. If something blocks you, stop, leave the branch as it is, and say why in your report.'

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g
const REPORT_LINES = 20
const OVERRIDES = [
  { key: 'model', pattern: /^[A-Za-z0-9][\w./:@-]*$/, problem: '--model needs a model id, for example minimax/minimax-m3.1-flash:free.' },
  { key: 'reasoning', pattern: /^[a-z]+$/, problem: '--reasoning needs a level such as low, medium, high or xhigh.' },
]
const TOOL_PREVIEW = 72

const HERMES_LINES = {
  read_file: { emoji: '📖', verb: 'read' },
  write_file: { emoji: '✍️', verb: 'write' },
  patch: { emoji: '🔧', verb: 'patch' },
  terminal: { emoji: '💻', verb: '$' },
  search_files: { emoji: '🔎', verb: 'grep' },
}

export function unattendedPrompt(prompt) {
  return `${prompt}\n\n${UNATTENDED_NOTE}`
}

function expandBin(bin, env) {
  return String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') throw new Error(`The environment variable ${name} is not set.`)
    return value
  })
}

export function commandFor({ lane, prompt, env = {}, usageFile, title, cwd } = {}) {
  if (!lane || typeof lane !== 'object') throw new Error('There is no lane to run.')
  const cli = lane.cli
  if (!cli) throw new Error(`The lane ${lane.name ?? 'this one'} has no command line, so the runner cannot start it.`)
  const harness = cli.harness
  if (harness !== 'hermes' && harness !== 'opencode' && harness !== 'agy' && harness !== 'claude') throw new Error(`The runner does not know the ${harness} command line.`)
  const folder = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : lane.worktree
  if (typeof folder !== 'string' || folder.trim() === '') throw new Error(`The lane ${lane.name ?? 'this one'} has no worktree, so the runner cannot start it.`)
  const file = expandBin(cli.bin, env)
  const reasoning = lane.reasoning ? String(lane.reasoning) : ''
  if (harness === 'claude') {
    return { file, args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', cli.model, '--dangerously-skip-permissions'], cwd: folder }
  }
  if (harness === 'hermes') {
    const args = ['-z', prompt, '-m', cli.model, '--provider', cli.provider]
    if (cli.toolsets) args.push('-t', String(cli.toolsets))
    if (reasoning) args.push('--reasoning', reasoning)
    if (usageFile) args.push('--usage-file', usageFile)
    return { file, args, cwd: folder }
  }
  if (harness === 'agy') {
    const args = ['--print', prompt, '--output-format', 'stream-json']
    if (cli.model) args.push('--model', String(cli.model))
    args.push('--dangerously-skip-permissions')
    return { file, args, cwd: folder }
  }
  const model = reasoning ? `${cli.model}#${reasoning}` : cli.model
  return { file, args: ['run', '--format', 'json', '--model', model, '--auto', '--title', title, prompt], cwd: folder }
}

export const DEFAULT_MINUTES = 100
export const SINCE_PROBLEM = '--since needs a date like 2026-10-19.'
const MODEL_UNKNOWN = 'model unknown'
const ALL = 'all'

export function dayStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return time
}

function startTime(record) {
  const value = record?.startedAt
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roundTo(value, places) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function medianOf(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function emptyBucket(lane, model) {
  return { lane, model, runs: 0, finished: 0, killed: 0, failed: 0, minutes: [], costTotal: 0, costRuns: 0 }
}

function addToBucket(bucket, record) {
  bucket.runs += 1
  if (record.killed === true) bucket.killed += 1
  else if (record.exitCode === 0) bucket.finished += 1
  else bucket.failed += 1
  const minutes = finiteNumber(record.minutes)
  if (minutes !== null) bucket.minutes.push(minutes)
  const cost = finiteNumber(record.costUsd)
  if (cost !== null) {
    bucket.costTotal += cost
    bucket.costRuns += 1
  }
}

function bucketRow(bucket) {
  const minutesTotal = bucket.minutes.reduce((sum, value) => sum + value, 0)
  return {
    lane: bucket.lane,
    model: bucket.model,
    runs: bucket.runs,
    finished: bucket.finished,
    killed: bucket.killed,
    failed: bucket.failed,
    minutesTotal: roundTo(minutesTotal, 1),
    minutesMedian: roundTo(medianOf(bucket.minutes), 1),
    costTotal: roundTo(bucket.costTotal, 4),
    costRuns: bucket.costRuns,
  }
}

export function filterRunsSince(records, since) {
  const list = Array.isArray(records) ? records : []
  const from = since === undefined || since === null ? null : dayStart(since)
  return list.filter((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false
    if (from === null) return true
    const time = startTime(record)
    return time !== null && time >= from
  })
}

export function laneStats(records, { since } = {}) {
  const kept = filterRunsSince(records, since)
  const buckets = new Map()
  const total = emptyBucket(ALL, ALL)
  for (const record of kept) {
    if (typeof record.lane !== 'string' || record.lane.trim() === '') continue
    const lane = record.lane.trim()
    const model = typeof record.model === 'string' && record.model.trim() !== '' ? record.model.trim() : MODEL_UNKNOWN
    const key = `${lane}\u0000${model}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = emptyBucket(lane, model)
      buckets.set(key, bucket)
    }
    addToBucket(bucket, record)
    addToBucket(total, record)
  }
  const rows = [...buckets.values()]
    .sort((left, right) => {
      if (left.lane !== right.lane) return left.lane < right.lane ? -1 : 1
      if (left.model !== right.model) return left.model < right.model ? -1 : 1
      return 0
    })
    .map(bucketRow)
  return { rows, total: bucketRow(total) }
}

function statsLine(row) {
  const minutes = Number.isFinite(row.minutesTotal) ? row.minutesTotal : 0
  const median = Number.isFinite(row.minutesMedian) ? row.minutesMedian : 0
  const cost = Number.isFinite(row.costTotal) ? row.costTotal : 0
  const runs = (count) => `${count} ${count === 1 ? 'run' : 'runs'}`
  return `${row.lane} | ${row.model} | ${runs(row.runs)} | ${row.finished} finished, ${row.killed} killed, ${row.failed} failed | ${minutes.toFixed(1)} min, median ${median.toFixed(1)} | ${cost.toFixed(4)} USD over ${runs(row.costRuns)}`
}

export function formatStats(stats) {
  const rows = Array.isArray(stats?.rows) ? stats.rows : []
  if (rows.length === 0 || !stats?.total) return ['No runs recorded.']
  return [...rows.map(statsLine), statsLine(stats.total)]
}

function outcomePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '-'
}

function outcomeFixes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return String(Math.round(value * 10) / 10)
}

function outcomeCost(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '-'
}

export function formatOutcomes(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return ['No runs yet.']
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return list.map((row) => {
    const lane = String(row?.lane ?? '')
    const model = String(row?.model ?? MODEL_UNKNOWN)
    return `${lane}  ${model}  runs ${count(row?.runs)}, merged ${count(row?.merged)}, rejected ${count(row?.rejected)}, pending ${count(row?.pending)}, merge rate ${outcomePercent(row?.mergeRate)}, fixes ${outcomeFixes(row?.averageFixes)}, ${outcomeCost(row?.costPerMerge)} a merge`
  })
}

export function briefProblems({ briefs, ids, laneKey, branchExists, force } = {}) {
  const list = Array.isArray(briefs) ? briefs : []
  const lane = String(laneKey ?? '').trim().toLowerCase().replace(/\d+$/, '')
  const exists = typeof branchExists === 'function' ? branchExists : () => false
  const asked = []
  const seen = new Set()
  for (const value of Array.isArray(ids) ? ids : []) {
    const id = String(value ?? '').trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    asked.push(id)
  }
  const missing = []
  const repeated = []
  const done = []
  const owner = []
  const branch = []
  for (const askedId of asked) {
    const key = askedId.toLowerCase()
    const matches = list.filter((brief) => String(brief?.id ?? '').trim().toLowerCase() === key)
    if (matches.length === 0) {
      missing.push(`There is no brief named ${askedId}.`)
      continue
    }
    if (matches.length > 1) {
      const id = String(matches[0].id).trim()
      repeated.push(`Brief ${id} appears ${matches.length} times in TASKS.md. Give each brief its own id.`)
      continue
    }
    const brief = matches[0]
    const id = String(brief.id).trim()
    const owners = (Array.isArray(brief.owners) ? brief.owners : [])
      .filter((name) => typeof name === 'string' && name.trim() !== '')
      .map((name) => name.trim())
    if (force !== true && brief.done === true) {
      done.push(`Brief ${id} is marked ${String(brief.ownerText ?? '')}. Pick another brief, or pass --force to run it again.`)
    }
    if (force !== true && owners.length > 0 && !owners.some((name) => name.toLowerCase() === lane)) {
      owner.push(`Brief ${id} is for ${owners.join(' and ')}, not ${String(laneKey ?? '')}. Pass --force to run it anyway.`)
    }
    const name = branchFor(brief)
    if (exists(name) === true) branch.push(`The branch ${name} already exists. Rename or delete it first, or pick another brief.`)
  }
  return [...missing, ...repeated, ...done, ...owner, ...branch]
}

export function parseRunArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).map((value) => String(value))
  const briefs = []
  let lane = ''
  let dryRun = false
  let list = false
  let stats = false
  let outcomes = false
  let force = false
  let since = ''
  let minutes = DEFAULT_MINUTES
  let project = ''
  let task = ''
  let taskFile = ''
  let allowDirty = false
  const overrides = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const named = OVERRIDES.find((option) => arg === `--${option.key}` || arg.startsWith(`--${option.key}=`))
    if (named) {
      const value = arg === `--${named.key}` ? args[index + 1] : arg.slice(named.key.length + 3)
      if (arg === `--${named.key}`) index += 1
      if (!named.pattern.test(value ?? '')) throw new Error(named.problem)
      overrides[named.key] = value
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--allow-dirty') {
      allowDirty = true
      continue
    }
    if (arg === '--list') {
      list = true
      continue
    }
    if (arg === '--stats') {
      stats = true
      continue
    }
    if (arg === '--outcomes') {
      outcomes = true
      continue
    }
    if (arg === '--project' || arg.startsWith('--project=')) {
      const value = arg === '--project' ? args[index + 1] : arg.slice('--project='.length)
      if (arg === '--project') index += 1
      if (typeof value !== 'string' || value === '') throw new Error('--project needs a folder.')
      project = value
      continue
    }
    if (arg === '--task' || arg.startsWith('--task=')) {
      const value = arg === '--task' ? args[index + 1] : arg.slice('--task='.length)
      if (arg === '--task') index += 1
      if (typeof value !== 'string') throw new Error('--task needs text.')
      task = value
      continue
    }
    if (arg === '--task-file' || arg.startsWith('--task-file=')) {
      const value = arg === '--task-file' ? args[index + 1] : arg.slice('--task-file='.length)
      if (arg === '--task-file') index += 1
      if (typeof value !== 'string' || value === '') throw new Error('--task-file needs a path.')
      taskFile = value
      continue
    }
    if (arg === '--since' || arg.startsWith('--since=')) {
      const value = arg === '--since' ? args[index + 1] : arg.slice('--since='.length)
      if (arg === '--since') index += 1
      if (dayStart(value) === null) throw new Error(SINCE_PROBLEM)
      since = value
      continue
    }
    if (arg === '--minutes' || arg.startsWith('--minutes=')) {
      const value = arg === '--minutes' ? args[index + 1] : arg.slice('--minutes='.length)
      if (arg === '--minutes') index += 1
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1) throw new Error('--minutes needs a whole number of minutes, one or more.')
      minutes = Number(value)
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg === '') continue
    if (!lane) lane = arg
    else briefs.push(arg)
  }
  if (list) return { lane, briefs, dryRun, minutes, list, ...(since ? { since } : {}) }
  if (stats) return { lane, briefs, dryRun, minutes, list, stats, ...(since ? { since } : {}) }
  if (outcomes) return { lane, briefs, dryRun, minutes, list, outcomes, ...(since ? { since } : {}) }
  if (!lane) throw new Error('Name a lane to run, for example hermes.')
  if (project || task || taskFile) {
    if (!project) throw new Error('--project needs a folder.')
    if (briefs.length > 0) throw new Error('Name a brief id or a --project folder, not both.')
    if (task && taskFile) throw new Error('Use --task or --task-file, not both.')
    if (!task && !taskFile) throw new Error('Name the task with --task or --task-file.')
    return {
      lane, briefs: [], dryRun, minutes, list,
      ...(force ? { force: true } : {}),
      ...overrides,
      project,
      ...(task ? { task } : {}),
      ...(taskFile ? { taskFile } : {}),
      ...(allowDirty ? { allowDirty: true } : {}),
    }
  }
  if (briefs.length === 0) throw new Error('Name at least one brief id.')
  return { lane, briefs, dryRun, minutes, list, ...(force ? { force: true } : {}), ...overrides }
}

export function laneWithOverrides(lane, { model, reasoning } = {}) {
  if (!lane?.cli) return lane
  const next = { ...lane, cli: { ...lane.cli } }
  if (model) {
    next.cli.model = model
    next.model = model
    delete next.models
  }
  if (reasoning) next.reasoning = reasoning
  return next
}

function normalPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const raw = value.trim()
  let text = raw.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  if (!text && raw.startsWith('/')) text = '/'
  if (/^[a-zA-Z]:$/.test(text)) text = `${text}/`
  return process.platform === 'win32' ? text.toLowerCase() : text
}

export function pathInside(child, parent) {
  const one = normalPath(child)
  const two = normalPath(parent)
  if (!one || !two) return false
  if (one === two) return true
  return one.startsWith(two.endsWith('/') ? two : `${two}/`)
}

export function projectProblems({ project, root, mainCheckout, lanes, dirty, allowDirty } = {}) {
  const folder = String(project ?? '').trim()
  if (!folder) return ['--project needs a folder.']
  const problems = []
  const checkouts = [root, mainCheckout]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .filter((value, index, list) => list.findIndex((other) => pathInside(value, other) && pathInside(other, value)) === index)
  if (checkouts.some((checkout) => pathInside(folder, checkout))) {
    problems.push(`The project folder ${folder} is this checkout. Run on another project.`)
  } else if (checkouts.some((checkout) => pathInside(checkout, folder))) {
    problems.push(`The project folder ${folder} holds this checkout. Name one project folder, not a folder of projects.`)
  }
  if (problems.length === 0) {
    for (const [key, lane] of Object.entries(lanes ?? {})) {
      if (!lane || typeof lane !== 'object') continue
      if (typeof lane.worktree !== 'string' || lane.worktree.trim() === '') continue
      if (pathInside(folder, lane.worktree) || pathInside(lane.worktree, folder)) {
        problems.push(`The project folder ${folder} is the ${key} lane worktree. Run on another project.`)
        break
      }
    }
  }
  if (problems.length === 0 && dirty === true && allowDirty !== true) {
    problems.push(`The project folder ${folder} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`)
  }
  return problems
}

function unique(values) {
  return [...new Set(values)].sort()
}

function toolArguments(value) {
  if (value && typeof value === 'object') return value
  try {
    const parsed = JSON.parse(String(value ?? '{}'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function toolResult(result) {
  const content = result?.content
  if (content && typeof content === 'object') return content
  const text = String(content ?? '')
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return parsed && typeof parsed === 'object' ? parsed : { output: text }
}

function toolDetail(name, args) {
  const keys = name === 'terminal' ? ['command'] : ['path', 'pattern', 'query', 'file']
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim()
  }
  return name
}

function toolSuffix(name, result) {
  if (!result) return ''
  const data = toolResult(result)
  if (name === 'terminal') {
    const code = Number(data.exit_code)
    return Number.isFinite(code) && code !== 0 ? ` [exit ${code}]` : ''
  }
  const failed = data.success === false || Boolean(data.error) || String(data.output ?? '').startsWith('Error')
  return failed ? ' [error]' : ''
}

function toolSeconds(message, result) {
  const start = Number(message?.timestamp)
  const end = Number(result?.timestamp)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) * 10) / 10
}

function toolLine({ name, args, seconds, suffix }) {
  const known = HERMES_LINES[name]
  const emoji = known?.emoji ?? '⚡'
  const verb = name === 'search_files' && args.target === 'files' ? 'find' : known?.verb ?? name.slice(0, 9)
  const detail = toolDetail(name, args)
  const shown = detail.length > TOOL_PREVIEW ? `${detail.slice(0, TOOL_PREVIEW - 1)}~` : detail
  return `┊ ${emoji} ${verb.padEnd(9)} ${shown}  ${seconds.toFixed(1)}s${suffix}`
}

export function sessionToolLines(exportText) {
  const lines = []
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
        lines.push(toolLine({
          name,
          args: toolArguments(call?.function?.arguments ?? call?.arguments),
          seconds: toolSeconds(message, result),
          suffix: toolSuffix(name, result),
        }))
      }
    }
  }
  return lines
}

function headLines(text) {
  const report = String(text ?? '').replace(/\s+$/, '')
  if (!report) return []
  return report.split(/\r?\n/).slice(0, REPORT_LINES)
}

function reportHead(log) {
  const lines = String(log ?? '').split(/\r?\n/)
  const firstTool = lines.findIndex((line) => line.trimStart().startsWith('┊'))
  return headLines((firstTool === -1 ? lines : lines.slice(0, firstTool)).join('\n'))
}

function opencodeReport(log) {
  let words = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'text') continue
    const text = item?.part?.text
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return headLines(words ?? '')
}

function logCost(log) {
  let total = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.type !== 'step_finish') continue
    const cost = item?.part?.cost
    if (typeof cost !== 'number' || !Number.isFinite(cost)) continue
    total = (total ?? 0) + cost
  }
  return total === null ? null : Math.round(total * 1e6) / 1e6
}

function opencodeSummary(log, worktree) {
  const parser = createOpencodeParser({ rootName: basename(String(worktree ?? '')), files: [], dirs: [] })
  const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
  return summaryOf('opencode', activities, opencodeReport(log), logCost(log))
}

function agyReport(log) {
  let words = null
  for (const line of String(log ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item?.event !== 'result') continue
    const text = item?.result?.response
    if (typeof text !== 'string' || !text.trim()) continue
    words = text
  }
  return headLines(words ?? '')
}

function agySummary(log, worktree) {
  const parser = createAgyParser({ rootName: basename(String(worktree ?? '')), files: [], dirs: [] })
  const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
  return summaryOf('agy', activities, agyReport(log), null)
}

function summaryOf(harness, activities, head, costUsd) {
  const calls = activities.filter((activity) => activity.type === 'tool.start')
  const written = []
  const read = []
  for (const call of calls) {
    for (const touch of call.touches ?? []) {
      if (touch.kind !== 'file') continue
      if (touch.mode === 'write') written.push(touch.path)
      if (touch.mode === 'read') read.push(touch.path)
    }
  }
  return {
    harness,
    toolCalls: calls.length,
    failed: activities.filter((activity) => activity.type === 'tool.end' && activity.ok === false).length,
    written: unique(written),
    read: unique(read),
    head,
    costUsd,
  }
}

function hermesSummary(log, worktree) {
  const parser = createHermesParser({ rootName: basename(String(worktree ?? '')), files: [], dirs: [] })
  const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
  return summaryOf('hermes', activities, reportHead(log), null)
}

function claudeSummary(log, worktree) {
  const parser = createClaudeParser({ rootName: basename(String(worktree ?? '')), files: [], dirs: [] })
  const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
  return summaryOf('claude', activities, [], null)
}

export function summarizeRun({ harness, log, worktree } = {}) {
  if (harness === 'opencode') return opencodeSummary(log, worktree)
  if (harness === 'agy') return agySummary(log, worktree)
  if (harness === 'claude') return claudeSummary(log, worktree)
  if (harness !== 'hermes') throw new Error(`The summary does not know the ${harness} log.`)
  return hermesSummary(log, worktree)
}

function reportLines(head) {
  if (head.length === 0) return ['report: none']
  const count = head.length === 1 ? '1 line' : `${head.length} lines`
  return [`report: first ${count}`, ...head.map((line) => `  ${line}`)]
}

export function formatSummary(summary) {
  const list = (paths) => (paths.length ? paths.join(', ') : 'none')
  if (summary.harness === 'hermes') {
    return [
      `summary: ${summary.toolCalls} tool calls, ${summary.failed} failed`,
      `written: ${list(summary.written)}`,
      `read: ${list(summary.read)}`,
      ...reportLines(summary.head),
    ]
  }
  const cost = typeof summary.costUsd === 'number' ? `${summary.costUsd.toFixed(4)} USD` : 'not reported'
  return [
    `summary: ${summary.toolCalls} tool calls, ${summary.failed} failed`,
    `estimated cost: ${cost}`,
    `written: ${list(summary.written)}`,
    `read: ${list(summary.read)}`,
    ...reportLines(summary.head),
  ]
}

function isoTime(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function runRecord({ lane, briefs, model, reasoning, startedAt, minutes, exitCode, killed, costUsd, log, branch, commits, project, task } = {}) {
  const record = {
    lane: String(lane ?? ''),
    briefs: Array.isArray(briefs) ? briefs.map(String) : [],
    model: model ? String(model) : null,
    reasoning: reasoning ? String(reasoning) : null,
    startedAt: isoTime(startedAt),
    minutes: Number.isFinite(minutes) ? minutes : null,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    killed: killed === true,
    costUsd: typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : null,
    log: log ? String(log) : null,
    branch: branch ? String(branch) : '',
    commits: Array.isArray(commits) ? commits.map(String) : [],
  }
  if (typeof project === 'string' && project.trim() !== '') record.project = project
  if (typeof task === 'string' && task !== '') record.task = task.slice(0, 200)
  return record
}

export function runListLine(record) {
  const when = record.startedAt ?? 'time unknown'
  const model = record.model ? String(record.model) : 'model unknown'
  const briefs = record.briefs?.length ? record.briefs.join(' ') : 'none'
  const minutes = Number.isFinite(record.minutes) ? `${record.minutes} min` : 'minutes unknown'
  const exit = Number.isInteger(record.exitCode) ? `exit ${record.exitCode}` : 'exit none'
  const killed = record.killed ? ' (killed)' : ''
  const cost = typeof record.costUsd === 'number' ? `${record.costUsd.toFixed(4)} USD` : 'not reported'
  const branch = record.branch || 'no branch'
  return `${when} | ${record.lane} | ${model} | ${briefs} | ${minutes} | ${exit}${killed} | ${cost} | ${branch}`
}

const CRASH_STATUSES = [3221226505, -1073740791]
const TEST_TRIES = 3
const CRASH_NOTE = 'The test worker crashed inside Node (0xC0000409), not in a test.'
const CRASH_GAVE_UP = 'The test worker crashed inside Node three times. See Known limits in docs/agents/ARCHITECTURE.md.'

export function nextTestStep(status, tries) {
  const attempts = Number.isInteger(tries) && tries > 0 ? tries : 0
  if (!CRASH_STATUSES.includes(status)) return { action: 'done', code: Number.isInteger(status) ? status : 1 }
  if (attempts >= TEST_TRIES) return { action: 'done', code: 1, message: CRASH_GAVE_UP }
  return { action: 'retry', message: `${CRASH_NOTE} Running the tests again (try ${attempts + 1} of ${TEST_TRIES}).` }
}
