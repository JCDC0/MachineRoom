import { basename } from '../model/paths.js'
import { finiteNumber, summaryOf } from '../harnesses/common.js'
import { harnessByKey } from '../harnesses/index.js'
import { modesFor } from '../control/modes.js'
import { createSplitMasker, maskKeys } from './audit.js'
import { branchFor, briefFileList } from './briefs.js'
import { pathAllowed } from './plan.js'

export const UNATTENDED_NOTE = 'You are running unattended in a one-shot command started for the owner, who may be away. Nobody can answer a question. If something blocks you, stop, leave the branch as it is, and say why in your report.'

const OVERRIDES = [
  { key: 'mode', pattern: /^(?!-).+$/, problem: '--mode needs a permission mode.' },
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

function laneMessageNote(env) {
  const source = env && typeof env === 'object' ? env : {}
  const value = (name) => (typeof source[name] === 'string' ? source[name].trim() : '')
  if (value('MACHINEROOM_LANE_TICKET') === '' || value('MACHINEROOM_BRIDGE') === '') return ''
  return 'You may send your coordinator a short message while you work, for a question or a blocker: POST $MACHINEROOM_BRIDGE/api/orchestrator/messages with the header X-MachineRoom-Lane: $MACHINEROOM_LANE_TICKET and the JSON body {"text": "..."}. Read both values from your environment; never print the ticket. You get no reply during this run, so keep working on what you can, and send at most 4.'
}

export function unattendedPrompt(prompt, env = {}) {
  const note = laneMessageNote(env)
  return note === '' ? `${prompt}\n\n${UNATTENDED_NOTE}` : `${prompt}\n\n${note}\n\n${UNATTENDED_NOTE}`
}

export function laneCommandProblem(lane) {
  if (!lane || typeof lane !== 'object') return 'There is no lane to run.'
  const cli = lane.cli
  if (!cli) return `The lane ${lane.name ?? 'this one'} has no command line, so the runner cannot start it.`
  const harness = cli.harness
  if (!Object.hasOwn(harnessByKey, harness)) return `The runner does not know the ${harness} command line.`
  return ''
}

export function laneModeProblem(lane, laneKey) {
  const mode = lane?.cli?.mode
  if (mode === undefined) return ''
  const harness = lane?.cli?.harness
  const modes = modesFor(harness).map((item) => item.id)
  if (modes.length === 0) return `The ${laneKey} lane has no permission modes, so it cannot run in ${mode} mode.`
  if (!modes.includes(mode)) return `The ${mode} mode is not one ${laneKey}'s harness has. It has: ${modes.join(', ')}.`
  if (mode === 'ask') return 'A lane run has nobody to ask, so the ask mode is for orchestrators only.'
  if (harness === 'opencode' && (mode === 'plan' || mode === 'edits')) return `OpenCode lanes cannot use ${mode} mode because it needs a permission config.`
  return ''
}

export function commandFor({ lane, prompt, env = {}, usageFile, title, cwd, sessionId, mcpConfig } = {}) {
  if (!lane || typeof lane !== 'object') throw new Error('There is no lane to run.')
  const startProblem = laneCommandProblem(lane)
  if (startProblem !== '') throw new Error(startProblem)
  const cli = lane.cli
  const harness = cli.harness
  if (!Object.hasOwn(harnessByKey, harness)) throw new Error(`The runner does not know the ${harness} command line.`)
  const folder = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : lane.worktree
  if (typeof folder !== 'string' || folder.trim() === '') throw new Error(`The lane ${lane.name ?? 'this one'} has no worktree, so the runner cannot start it.`)
  const command = harnessByKey[harness].command({ cli, prompt, env, usageFile, title, folder, reasoning: lane.reasoning, mode: cli.mode, sessionId, mcpConfig })
  const endpoint = typeof cli.endpoint === 'string' ? cli.endpoint.trim() : ''
  if (harness !== 'machineroom' || endpoint === '') return command
  const args = [...command.args]
  const at = args.lastIndexOf(String(prompt))
  if (at === -1) args.push('--endpoint', endpoint)
  else args.splice(at, 0, '--endpoint', endpoint)
  return { ...command, args }
}

export const DEFAULT_MINUTES = 100
export const SINCE_PROBLEM = '--since needs a date like 2026-10-19.'
export const ORCHESTRATOR_LANE_PROBLEM = 'The orchestrator lane runs from the room, not from run-lane.'
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
  return { lane, model, runs: 0, finished: 0, killed: 0, failed: 0, minutes: [], costTotal: 0, costRuns: 0, peaks: [] }
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
  const peak = finiteNumber(record.peakTokens ?? record.peak)
  if (peak !== null && peak >= 0) bucket.peaks.push(peak)
}

function bucketRow(bucket) {
  const minutesTotal = bucket.minutes.reduce((sum, value) => sum + value, 0)
  const peakMedian = Math.round(medianOf(bucket.peaks))
  const peakMax = bucket.peaks.length === 0 ? 0 : Math.max(...bucket.peaks)
  const peakOver450 = bucket.peaks.filter((value) => value >= 450000).length
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
    peakMedian,
    peakMax,
    peakOver450,
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
  const peakMedian = Number.isFinite(row.peakMedian) ? row.peakMedian : 0
  const peakMax = Number.isFinite(row.peakMax) ? row.peakMax : 0
  const peakOver = Number.isFinite(row.peakOver450) ? row.peakOver450 : 0
  return `${row.lane} | ${row.model} | ${runs(row.runs)} | ${row.finished} finished, ${row.killed} killed, ${row.failed} failed | ${minutes.toFixed(1)} min, median ${median.toFixed(1)} | ${cost.toFixed(4)} USD over ${runs(row.costRuns)} | peak median ${peakMedian}, max ${peakMax}, ${peakOver} at or over 450,000`
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not reported'
  return `$${value.toFixed(2)} a merge`
}

export function formatOutcomes(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return ['No runs yet.']
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return list.map((row) => {
    const lane = String(row?.lane ?? '')
    const model = String(row?.model ?? MODEL_UNKNOWN)
    return `${lane}  ${model}  runs ${count(row?.runs)}, merged ${count(row?.merged)} (${count(row?.ungraded)} not graded), rejected ${count(row?.rejected)}, pending ${count(row?.pending)}, merge rate ${outcomePercent(row?.mergeRate)}, fixes ${outcomeFixes(row?.averageFixes)}, ${outcomeCost(row?.costPerMerge)}`
  })
}

const FILE_ABSOLUTE = /^(?:[A-Za-z]:|[\\/])/

function fileProblem(entry, id, rules, laneKey) {
  if (FILE_ABSOLUTE.test(entry)) {
    return `Brief ${id} lists the absolute path ${entry}, and a brief names only paths inside the repository.`
  }
  if (entry.replace(/\\/g, '/').split('/').includes('..')) {
    return `Brief ${id} lists ${entry}, which holds .. and climbs out of the repository.`
  }
  if (rules.length > 0 && !pathAllowed(entry, rules)) {
    return `Brief ${id} lists ${entry}, which lanes.json forbids for ${laneKey}.`
  }
  return ''
}

export function briefProblems({ briefs, ids, laneKey, forbidden, branchExists, force } = {}) {
  const list = Array.isArray(briefs) ? briefs : []
  const lane = String(laneKey ?? '').trim().toLowerCase().replace(/\d+$/, '')
  if (lane === 'orchestrator') return [ORCHESTRATOR_LANE_PROBLEM]
  const exists = typeof branchExists === 'function' ? branchExists : () => false
  const rules = Array.isArray(forbidden) ? forbidden : []
  const who = String(laneKey ?? '').trim() || 'this lane'
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
  const files = []
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
    for (const entry of briefFileList(brief.text)) {
      const problem = fileProblem(entry, id, rules, who)
      if (problem) files.push(problem)
    }
  }
  return [...missing, ...repeated, ...done, ...owner, ...branch, ...files]
}

export function worktreeFor(project, lane) {
  const folder = String(project ?? '').trim().replace(/[\\/]+$/, '')
  const key = String(lane ?? '').trim()
  if (!folder || !key || /^[a-zA-Z]:$/.test(folder)) return ''
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return ''
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder}${sep}${WORKTREES_FOLDER}${sep}${key}`
}

export const WORKTREES_FOLDER = '.worktrees'

export function worktreeProblems({ worktree, project } = {}) {
  if (worktree !== true) return []
  if (!String(project ?? '').trim()) return ['--worktree needs --project <folder>.']
  return []
}

export const CHECK_SHELL_PROBLEM = 'The check command cannot use shell syntax; put it in an npm script.'
export const CHECK_QUOTE_PROBLEM = 'The check command has an unclosed quote.'
export const CHECK_COMMAND_COUNT = 4
export const CHECK_COMMAND_COUNT_PROBLEM = 'A check holds at most 4 commands, one per line.'

function quoteIsOpen(text) {
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\' && (text[index + 1] === '"' || text[index + 1] === '\\')) {
      index += 1
      continue
    }
    if (character === '"') quoted = !quoted
  }
  return quoted
}

export function checkCommandLines(command) {
  return String(command ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function checkCommandProblem(command) {
  const lines = checkCommandLines(command)
  if (lines.length > CHECK_COMMAND_COUNT) return CHECK_COMMAND_COUNT_PROBLEM
  for (const line of lines) {
    if (/[|&;<>`]|\$\(|%[^%\r\n]+%/.test(line)) return CHECK_SHELL_PROBLEM
    if (quoteIsOpen(line)) return CHECK_QUOTE_PROBLEM
  }
  return ''
}

export function splitCheckCommand(command) {
  const text = String(command ?? '').trim()
  if (text === '') return []
  const parts = []
  let current = ''
  let started = false
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\' && (text[index + 1] === '"' || text[index + 1] === '\\')) {
      current += text[index + 1]
      started = true
      index += 1
      continue
    }
    if (character === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(character)) {
      if (started) {
        parts.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (quoted) throw new Error(CHECK_QUOTE_PROBLEM)
  if (started) parts.push(current)
  return parts
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
  let worktree = false
  let startedBy = ''
  let startedAt = ''
  const testLines = []
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
    if (arg === '--worktree') {
      worktree = true
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
    if (arg === '--started-by' || arg.startsWith('--started-by=')) {
      const value = arg === '--started-by' ? args[index + 1] : arg.slice('--started-by='.length)
      if (arg === '--started-by') index += 1
      if (typeof value !== 'string' || !/^[a-z0-9-]{1,24}$/.test(value)) throw new Error('--started-by needs an orchestrator id.')
      startedBy = value
      continue
    }
    if (arg === '--started-at' || arg.startsWith('--started-at=')) {
      const value = arg === '--started-at' ? args[index + 1] : arg.slice('--started-at='.length)
      if (arg === '--started-at') index += 1
      if (typeof value !== 'string' || value.trim() === '') throw new Error('--started-at needs a start time.')
      startedAt = value.trim()
      continue
    }
    if (arg === '--test' || arg.startsWith('--test=')) {
      const value = arg === '--test' ? args[index + 1] : arg.slice('--test='.length)
      if (arg === '--test') index += 1
      if (typeof value !== 'string' || value.trim() === '') throw new Error('--test needs a command.')
      const problem = checkCommandProblem(value)
      if (problem !== '') throw new Error(problem)
      testLines.push(...checkCommandLines(value))
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg === '') continue
    if (!lane) lane = arg
    else briefs.push(arg)
  }
  const test = testLines.join('\n')
  if (test !== '') {
    const problem = checkCommandProblem(test)
    if (problem !== '') throw new Error(problem)
  }
  if (list) return { lane, briefs, dryRun, minutes, list, ...(since ? { since } : {}) }
  if (stats) return { lane, briefs, dryRun, minutes, list, stats, ...(since ? { since } : {}) }
  if (outcomes) return { lane, briefs, dryRun, minutes, list, outcomes, ...(since ? { since } : {}) }
  if (!lane) throw new Error('Name a lane to run, for example hermes.')
  if (project || task || taskFile || worktree) {
    const problems = worktreeProblems({ worktree, project })
    if (problems.length > 0) throw new Error(problems[0])
    if (!project) throw new Error('--project needs a folder.')
    if (briefs.length > 0) throw new Error('Name a brief id or a --project folder, not both.')
    if (task && taskFile) throw new Error('Use --task or --task-file, not both.')
    if (!task && !taskFile) throw new Error('Name the task with --task or --task-file.')
    return {
      lane, briefs: [], dryRun, minutes, list,
      ...(force ? { force: true } : {}),
      ...(worktree ? { worktree: true } : {}),
      ...overrides,
      ...(startedBy ? { startedBy } : {}),
      project,
      ...(task ? { task } : {}),
      ...(taskFile ? { taskFile } : {}),
      ...(test ? { test } : {}),
      ...(allowDirty ? { allowDirty: true } : {}),
      ...(startedAt ? { startedAt } : {}),
    }
  }
  if (test !== '') throw new Error('--test needs a --project task.')
  if (briefs.length === 0) throw new Error('Name at least one brief id.')
  return { lane, briefs, dryRun, minutes, list, ...(force ? { force: true } : {}), ...overrides, ...(startedBy ? { startedBy } : {}), ...(startedAt ? { startedAt } : {}) }
}

function lockLogName(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (name === '' || name === '.' || name === '..') return ''
  return name.includes('/') || name.includes('\\') ? '' : name
}

export function laneLockText({ pid, child, folder, projectRun, startedAt, log } = {}) {
  const own = Number.isInteger(pid) && pid > 0 ? pid : 0
  if (own === 0) return ''
  const entry = { pid: own }
  if (Number.isInteger(child) && child > 0) entry.child = child
  const name = typeof folder === 'string' ? folder.trim() : ''
  if (name !== '') entry.folder = name
  if (projectRun === true) entry.projectRun = true
  const start = isoTime(startedAt)
  if (start !== null) entry.startedAt = start
  const logName = lockLogName(log)
  if (logName !== '') entry.log = logName
  return `${JSON.stringify(entry)}\n`
}

export function laneLockStartedAt(text) {
  const raw = String(text ?? '').trim()
  if (!raw.startsWith('{')) return ''
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return ''
  }
  const startedAt = typeof parsed?.startedAt === 'string' ? parsed.startedAt.trim() : ''
  return isoTime(startedAt) === null ? '' : startedAt
}

export function laneLockLog(text) {
  const raw = String(text ?? '').trim()
  if (!raw.startsWith('{')) return ''
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return ''
  }
  return lockLogName(parsed?.log)
}

export function laneLockPids(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { pid: null, child: null, folder: '', projectRun: false }
  if (!raw.startsWith('{')) {
    const match = /^\s*(\d+)\s*$/.exec(raw)
    return { pid: match ? Number(match[1]) : null, child: null, folder: '', projectRun: false }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { pid: null, child: null, folder: '', projectRun: false }
  }
  const pid = Number.isInteger(parsed?.pid) && parsed.pid > 0 ? parsed.pid : null
  const child = Number.isInteger(parsed?.child) && parsed.child > 0 ? parsed.child : null
  const folder = typeof parsed?.folder === 'string' ? parsed.folder : ''
  return { pid, child, folder, projectRun: parsed?.projectRun === true }
}

export function laneStopProblem({ lane, pid, leftover = false } = {}) {
  const name = String(lane ?? '').trim()
  const holder = Number.isInteger(pid) && pid > 0 ? pid : 0
  if (!name || holder === 0) return ''
  const noun = leftover === true ? 'leftover process' : 'harness process'
  return `The ${name} lane still has ${noun} ${holder}; stop it with npm run run-lane -- --stop ${name}.`
}

export function fallbackProblem({ laneKey, fallback, lanes } = {}) {
  const name = typeof fallback === 'string' ? fallback.trim() : ''
  if (name === '') return ''
  const key = String(laneKey ?? '').trim()
  if (name === key) return `The lane ${key} cannot name itself as its backup lane.`
  if (name === 'orchestrator') return 'The orchestrator lane cannot be a backup lane.'
  if (!lanes || typeof lanes !== 'object' || !Object.hasOwn(lanes, name)) return `The backup lane ${name} is not in lanes.json.`
  if (lanes[name]?.retired === true) return `The backup lane ${name} is retired.`
  return ''
}

export function failoverKind({ exitCode, limited, startFailed, killed = false } = {}) {
  if (killed === true) return ''
  if (exitCode === 0 && startFailed !== true) return ''
  const kind = typeof limited === 'string' ? limited.trim() : ''
  if (kind !== '') return kind
  return startFailed === true ? 'start-failed' : ''
}

export function limitedFor(harness, log) {
  if (!Object.hasOwn(harnessByKey, harness)) return ''
  const descriptor = harnessByKey[harness]
  return typeof descriptor.limited === 'function' ? descriptor.limited(String(log ?? '')) : ''
}

export function laneWithOverrides(lane, { model, reasoning, mode } = {}) {
  if (!lane?.cli) return lane
  const next = { ...lane, cli: { ...lane.cli } }
  if (model) {
    next.cli.model = model
    next.model = model
    delete next.models
  }
  if (reasoning) next.reasoning = reasoning
  if (mode !== undefined) next.cli.mode = mode
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

export const LANE_ENV_NAMES = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS',
  'OS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TERM', 'HOME', 'SHELL',
  'CODEX_HOME',
]

export const HARNESS_KEY_NAMES = {
  hermes: ['OPENROUTER_API_KEY'],
  machineroom: ['MACHINEROOM_API_KEY', 'OPENROUTER_API_KEY', 'MACHINEROOM_API_URL', 'MR_AGENT_MAX_COST_USD', 'MR_AGENT_MINUTES'],
}

const LANE_ENV_SET = new Set(LANE_ENV_NAMES.map((name) => name.toLowerCase()))

export function harnessKeyNames(harness, { model = '', endpoints = [] } = {}) {
  const key = typeof harness === 'string' ? harness : ''
  if (key === 'machineroom') {
    const list = Array.isArray(endpoints) ? endpoints : []
    const hasEndpoint = typeof model === 'string' && model.includes('/') && list.some((ep) => {
      const name = typeof ep === 'string' ? ep.trim() : typeof ep?.name === 'string' ? ep.name.trim() : ''
      return name !== '' && model.startsWith(`${name}/`)
    })
    if (hasEndpoint) return ['MR_AGENT_MAX_COST_USD', 'MR_AGENT_MINUTES']
  }
  return Object.hasOwn(HARNESS_KEY_NAMES, key) ? HARNESS_KEY_NAMES[key] : []
}

export function childEnvironment(env, cwd, { harness = '', names = [], extra = {}, model = '', endpoints = [] } = {}) {
  const allowed = new Set(LANE_ENV_SET)
  for (const name of harnessKeyNames(harness, { model, endpoints })) allowed.add(name.toLowerCase())
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name === 'string' && name !== '') allowed.add(name.toLowerCase())
  }
  const next = {}
  const source = env && typeof env === 'object' ? env : {}
  for (const [name, value] of Object.entries(source)) {
    if (!allowed.has(name.toLowerCase())) continue
    if (typeof value !== 'string') continue
    next[name] = value
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [name, value] of Object.entries(extra)) {
      if (typeof value === 'string') next[name] = value
    }
  }
  if (typeof cwd === 'string' && cwd.trim() !== '') next.PWD = cwd
  return next
}

function stringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

export function normalizeServer(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (name === '') return null
  const command = typeof entry.command === 'string' ? entry.command.trim() : ''
  const url = typeof entry.url === 'string' ? entry.url.trim() : ''
  const transport = entry.transport === 'http' || (entry.transport !== 'stdio' && url !== '' && command === '') ? 'http' : 'stdio'
  const enabled = entry.enabled !== false
  if (transport === 'http') {
    if (!/^https?:\/\//i.test(url)) return null
    return { name, transport, url, enabled }
  }
  if (command === '') return null
  return {
    name,
    transport,
    command,
    args: Array.isArray(entry.args) ? entry.args.map((item) => String(item)) : [],
    env: stringMap(entry.env),
    enabled,
  }
}

export function normalizeMcpServers(parsed) {
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.servers)
      ? parsed.servers
      : Array.isArray(parsed?.mcpServers)
        ? parsed.mcpServers
        : parsed?.mcpServers && typeof parsed.mcpServers === 'object'
          ? Object.entries(parsed.mcpServers).map(([name, value]) => ({ name, ...value }))
          : []
  return raw.map(normalizeServer).filter(Boolean)
}

export function mcpConfigForClaude(servers) {
  const mcpServers = {}
  for (const raw of Array.isArray(servers) ? servers : []) {
    const entry = normalizeServer(raw)
    if (!entry) continue
    if (entry.transport === 'http') {
      mcpServers[entry.name] = { type: 'http', url: entry.url }
    } else {
      mcpServers[entry.name] = {
        command: entry.command,
        args: entry.args,
        env: entry.env,
      }
    }
  }
  return { mcpServers }
}

export function mcpConfigForOpencode(servers) {
  const mcp = {}
  for (const raw of Array.isArray(servers) ? servers : []) {
    const entry = normalizeServer(raw)
    if (!entry) continue
    if (entry.transport === 'http') {
      mcp[entry.name] = { type: 'remote', url: entry.url, enabled: true }
    } else {
      mcp[entry.name] = {
        type: 'local',
        command: [entry.command, ...entry.args],
        environment: entry.env,
        enabled: true,
      }
    }
  }
  return { mcp }
}

export function createLaneLog({ write, runId = 'lane', holdMs } = {}) {
  if (typeof write !== 'function') throw new Error('The lane log needs a writer.')
  const masker = createSplitMasker(holdMs === undefined ? {} : { holdMs })
  const seqs = new Map()
  const timers = new Set()

  function emit(result) {
    for (const frame of result.frames) {
      const chunk = frame?.payload?.chunk
      if (typeof chunk === 'string' && chunk !== '') write(chunk)
    }
  }

  function due() {
    emit(masker.due(Date.now()))
  }

  function schedule() {
    const at = masker.nextDue()
    if (at === null) return
    const timer = setTimeout(() => {
      timers.delete(timer)
      due()
      schedule()
    }, Math.max(0, at - Date.now()))
    if (typeof timer.unref === 'function') timer.unref()
    timers.add(timer)
  }

  return {
    push(stream, chunk) {
      if (typeof chunk !== 'string' || chunk === '') return
      const key = `${runId}:${stream}`
      const seq = (seqs.get(key) ?? 0) + 1
      seqs.set(key, seq)
      const frame = { type: 'heartbeat.run.log', payload: { runId: key, stream, seq, chunk } }
      emit(masker.push(frame, Date.now()))
      schedule()
    },
    flush() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      emit(masker.flush())
    },
  }
}

function knownPath(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function samePath(one, two) {
  return pathInside(one, two) && pathInside(two, one)
}

export function projectProblems({
  project, root, mainCheckout, lanes, dirty, allowDirty,
  home, temp, runs, commonDir, repoCommonDir,
} = {}) {
  const folder = String(project ?? '').trim()
  if (!folder) return ['--project needs a folder.']
  const problems = []
  const checkouts = [root, mainCheckout]
    .filter(knownPath)
    .filter((value, index, list) => list.findIndex((other) => samePath(value, other)) === index)
  if (checkouts.some((checkout) => pathInside(folder, checkout))) {
    problems.push(`The project folder ${folder} is this checkout. Run on another project.`)
  } else if (checkouts.some((checkout) => pathInside(checkout, folder))) {
    problems.push(`The project folder ${folder} holds this checkout. Name one project folder, not a folder of projects.`)
  } else if (knownPath(commonDir) && knownPath(repoCommonDir) && samePath(commonDir, repoCommonDir)) {
    problems.push(`The project folder ${folder} is a git checkout of this repository. Run on another project.`)
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
  if (problems.length === 0 && knownPath(home)) {
    if (samePath(folder, home)) {
      problems.push(`The project folder ${folder} is the user profile. Run on another project.`)
    } else if (pathInside(home, folder)) {
      problems.push(`The project folder ${folder} holds the user profile. Name one project folder, not a folder of profiles.`)
    }
  }
  if (problems.length === 0 && knownPath(temp) && samePath(folder, temp)) {
    problems.push(`The project folder ${folder} is the OS temp folder. Run on another project.`)
  }
  if (problems.length === 0 && knownPath(runs) && pathInside(folder, runs)) {
    problems.push(`The project folder ${folder} is the runs folder or inside it. Run on another project.`)
  }
  if (problems.length === 0 && dirty === true && allowDirty !== true) {
    problems.push(`The project folder ${folder} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`)
  }
  return problems
}

export function briefWorktreeProblems({ worktree, laneKey, mainCheckout, lanes, home, temp, runs } = {}) {
  const folder = String(worktree ?? '').trim()
  if (!folder) return []
  const key = String(laneKey ?? '').trim().toLowerCase()
  const checkout = knownPath(mainCheckout) ? String(mainCheckout).trim() : ''
  if (checkout && samePath(folder, checkout)) {
    return [`The lane worktree ${folder} is the main checkout, so the runner will not start there.`]
  }
  for (const [name, lane] of Object.entries(lanes ?? {})) {
    if (!lane || typeof lane !== 'object') continue
    if (String(name).trim().toLowerCase() === key) continue
    if (typeof lane.worktree !== 'string' || lane.worktree.trim() === '') continue
    if (samePath(folder, lane.worktree)) {
      return [`The lane worktree ${folder} is the ${name} lane worktree, not this lane's.`]
    }
  }
  if (knownPath(home) && samePath(folder, home)) {
    return [`The lane worktree ${folder} is the user profile, so the runner will not start there.`]
  }
  if (knownPath(temp) && samePath(folder, temp)) {
    return [`The lane worktree ${folder} is the OS temp folder, so the runner will not start there.`]
  }
  if (knownPath(runs) && pathInside(folder, runs)) {
    return [`The lane worktree ${folder} is the runs folder or inside it, so the runner will not start there.`]
  }
  const worktrees = checkout ? `${checkout.replace(/[\\/]+$/, '')}/.worktrees` : ''
  if (!worktrees || !pathInside(folder, worktrees) || samePath(folder, worktrees)) {
    return [`The lane worktree ${folder} is not under .worktrees of this repository.`]
  }
  return []
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

export function claudeReport(log) {
  return harnessByKey.claude.report(log)
}

export function replyText(harness, log) {
  const key = harness === 'opencode' ? 'opencode' : 'claude'
  return harnessByKey[key].reply(log).trim()
}

export function summarizeRun({ harness, log, worktree } = {}) {
  if (!Object.hasOwn(harnessByKey, harness)) throw new Error(`The summary does not know the ${harness} log.`)
  const descriptor = harnessByKey[harness]
  const parser = descriptor.createParser({ rootName: basename(String(worktree ?? '')), files: [], dirs: [] })
  const activities = [...parser.push(String(log ?? ''), 0), ...parser.flush(0)]
  return summaryOf(descriptor.key, activities, descriptor.report(log), descriptor.usage(log))
}

export const READINESS_FAILURE = /Standalone server exited before reporting readiness/i

export function readinessLine(log) {
  const line = String(log ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => READINESS_FAILURE.test(item))
  return line ?? ''
}

export function startFailureText({ harness, log } = {}) {
  const descriptor = Object.hasOwn(harnessByKey, harness) ? harnessByKey[harness] : null
  const said = typeof descriptor?.failure === 'function' ? descriptor.failure(String(log ?? '')) : ''
  if (typeof said === 'string' && said.trim() !== '') return said.trim()
  return readinessLine(log)
}

export function retryStartProblem({ exitCode, minutes, toolCalls, commits, log } = {}) {
  if (exitCode === 0) return 'the run ended well'
  if (!(toolCalls === 0)) return 'the run made a tool call'
  if (!(typeof minutes === 'number' && Number.isFinite(minutes) && minutes < 1)) return 'the run lasted a minute or more'
  if (Array.isArray(commits) && commits.length > 0) return 'the run made a commit'
  if (readinessLine(log) === '') return 'the log has no readiness sentence'
  return ''
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

function tokenField(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function quotaField(quota) {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null
  const at = isoTime(quota.at)
  if (at === null || !Array.isArray(quota.windows)) return null
  const windows = []
  for (const window of quota.windows) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) continue
    const label = window.label === 'primary' || window.label === 'secondary' ? window.label : ''
    if (label === '' || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
    windows.push({ label, usedPercent: window.usedPercent, resetsAt: isoTime(window.resetsAt) })
  }
  return windows.length > 0 ? { windows, at } : null
}

const RECORD_TEXT_LIMIT = 200

const PROFILE_PATH_NAMES = [
  ['TEMP', '%TEMP%'],
  ['TMP', '%TEMP%'],
  ['LOCALAPPDATA', '%LOCALAPPDATA%'],
  ['APPDATA', '%APPDATA%'],
  ['USERPROFILE', '%USERPROFILE%'],
  ['XDG_STATE_HOME', '$XDG_STATE_HOME'],
  ['HOME', '~'],
]

const PROFILE_PATH_FALLBACKS = [
  { pattern: /[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>|]+[\\/]AppData[\\/]Local[\\/]Temp/gi, label: '%TEMP%' },
  { pattern: /[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>|]+[\\/]AppData[\\/]Local/gi, label: '%LOCALAPPDATA%' },
  { pattern: /[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>|]+[\\/]AppData[\\/]Roaming/gi, label: '%APPDATA%' },
  { pattern: /[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>|]+/gi, label: '%USERPROFILE%' },
  { pattern: /(?<![\w:/])\/(?:home|Users|root)\/[^/\r\n"'<>|]+/g, label: '~' },
]

function escapeProfilePath(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function profilePathPrefixes() {
  if (typeof process === 'undefined' || !process.env) return []
  const seen = new Set()
  const list = []
  for (const [name, label] of PROFILE_PATH_NAMES) {
    const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : ''
    const value = raw.length > 1 ? raw.replace(/[\\/]+$/, '') : raw
    if (value === '' || /^[\\/]+$/.test(value) || /^[A-Za-z]:$/.test(value) || seen.has(value)) continue
    seen.add(value)
    const windows = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
    list.push({ value, label: label === '~' && windows ? '%USERPROFILE%' : label, windows })
  }
  return list.sort((one, two) => two.value.length - one.value.length)
}

export function maskProfilePaths(text) {
  const source = typeof text === 'string' ? text : String(text ?? '')
  if (source === '' || !/[\\/]/.test(source)) return source
  let masked = source
  for (const { value, label, windows } of profilePathPrefixes()) {
    const pattern = new RegExp(`(?<![\\w:\\\\/.~-])${escapeProfilePath(value)}(?=$|[\\\\/])`, windows ? 'gi' : 'g')
    masked = masked.replace(pattern, label)
  }
  for (const { pattern, label } of PROFILE_PATH_FALLBACKS) {
    masked = masked.replace(pattern, label)
  }
  return masked
}

export function maskedQueueTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => maskProfilePaths(maskKeys(String(task ?? '')).text).slice(0, RECORD_TEXT_LIMIT))
}

export function runRecord({ lane, briefs, model, reasoning, mode, startedAt, minutes, exitCode, killed, costUsd, inputTokens, outputTokens, peakTokens, log, branch, commits, base, head, tests, project, task, startedBy, stoppedLeftovers, queue, startFailed, note, retried, failover, failoverFrom, quota } = {}) {
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
    inputTokens: tokenField(inputTokens),
    outputTokens: tokenField(outputTokens),
    peakTokens: tokenField(peakTokens),
    log: log ? String(log) : null,
    branch: branch ? String(branch) : '',
    commits: Array.isArray(commits) ? commits.map(String) : [],
  }
  if (mode !== undefined) record.mode = mode
  if (typeof base === 'string' && base.trim() !== '') record.base = base.trim()
  if (typeof head === 'string' && head.trim() !== '') record.head = head.trim()
  if (tests === 'passed' || tests === 'failed' || tests === 'none') record.tests = tests
  const queueBranch = typeof queue?.branch === 'string' ? queue.branch.trim() : ''
  if (queueBranch !== '') {
    record.branch = queueBranch
    record.queue = queueBranch
    if (Number.isInteger(queue?.index)) record.queueIndex = queue.index
    if (Number.isInteger(queue?.size) && queue.size > 0) record.queueSize = queue.size
    if (Array.isArray(queue?.remaining)) record.queueRemaining = maskedQueueTasks(queue.remaining)
  }
  if (Number.isInteger(stoppedLeftovers) && stoppedLeftovers > 0) record.stoppedLeftovers = stoppedLeftovers
  if (startFailed === true) record.startFailed = true
  if (retried === true) record.retried = true
  if (typeof note === 'string' && note.trim() !== '') record.note = note.trim().slice(0, 200)
  if (typeof startedBy === 'string' && startedBy.trim() !== '') record.startedBy = startedBy.trim()
  if (typeof project === 'string' && project.trim() !== '') record.project = project
  if (typeof task === 'string' && task !== '') record.task = maskKeys(task).text.slice(0, RECORD_TEXT_LIMIT)
  const reading = quotaField(quota)
  if (reading !== null) record.quota = reading
  if (failover && typeof failover === 'object' && !Array.isArray(failover)) {
    const kind = typeof failover.kind === 'string' ? failover.kind.trim() : ''
    const to = typeof failover.to === 'string' ? failover.to.trim() : ''
    if (kind !== '' && to !== '') record.failover = { kind, to }
  }
  if (failoverFrom && typeof failoverFrom === 'object' && !Array.isArray(failoverFrom)) {
    const lane = typeof failoverFrom.lane === 'string' ? failoverFrom.lane.trim() : ''
    if (lane !== '') record.failoverFrom = { lane, startedAt: isoTime(failoverFrom.startedAt) }
  }
  return record
}

export function projectRunGit({ branch, startBranch, commits } = {}) {
  const ended = typeof branch === 'string' ? branch.trim() : ''
  const started = typeof startBranch === 'string' ? startBranch.trim() : ''
  const lines = Array.isArray(commits) ? commits : String(commits ?? '').split(/\r?\n/)
  return {
    branch: ended !== '' && ended !== started ? ended : '',
    commits: lines.map((line) => maskProfilePaths(maskKeys(String(line ?? '').trim()).text)).filter(Boolean),
  }
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
  const peakTokens = record.peakTokens ?? record.peak
  const peak = typeof peakTokens === 'number' && Number.isFinite(peakTokens) ? ` | peak ${peakTokens}` : ''
  const move = record.failover
  const moveTo = typeof move?.to === 'string' ? move.to.trim() : ''
  const moveKind = typeof move?.kind === 'string' ? move.kind.trim() : ''
  const moved = moveTo !== '' && moveKind !== ''
    ? move.refused === true
      ? ` | backup ${moveTo} could not start (${moveKind})`
      : ` | moved to ${moveTo} (${moveKind})`
    : ''
  const from = record.failoverFrom
  const taken = typeof from?.lane === 'string' && from.lane.trim() !== ''
    ? ` | taken over from ${from.lane.trim()}`
    : ''
  return `${when} | ${record.lane} | ${model}${record.mode !== undefined ? ` | ${record.mode}` : ''} | ${briefs} | ${minutes} | ${exit}${killed} | ${cost} | ${branch}${peak}${moved}${taken}`
}

const CRASH_STATUSES = [3221226505, -1073740791]
const TEST_TRIES = 3
const CRASH_NOTE = 'The test worker crashed inside Node (0xC0000409), not in a test.'
const CRASH_GAVE_UP = 'The test worker crashed inside Node three times. See Known limits in docs/agents/architecture/LIMITS.md.'

export function nextTestStep(status, tries) {
  const attempts = Number.isInteger(tries) && tries > 0 ? tries : 0
  if (!CRASH_STATUSES.includes(status)) return { action: 'done', code: Number.isInteger(status) ? status : 1 }
  if (attempts >= TEST_TRIES) return { action: 'done', code: 1, message: CRASH_GAVE_UP }
  return { action: 'retry', message: `${CRASH_NOTE} Running the tests again (try ${attempts + 1} of ${TEST_TRIES}).` }
}
