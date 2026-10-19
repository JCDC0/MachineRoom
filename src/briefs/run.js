import { basename } from '../model/paths.js'
import { createHermesParser } from '../model/parsers/hermes.js'
import { createOpencodeParser } from '../model/parsers/opencode.js'

export const UNATTENDED_NOTE = 'You are running unattended in a one-shot command started for the owner, who may be away. Nobody can answer a question. If something blocks you, stop, leave the branch as it is, and say why in your report.'

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g
const REPORT_LINES = 20
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

export function commandFor({ lane, prompt, env = {}, usageFile, title }) {
  if (!lane || typeof lane !== 'object') throw new Error('There is no lane to run.')
  const cli = lane.cli
  if (!cli) throw new Error(`The lane ${lane.name ?? 'this one'} has no command line, so the runner cannot start it.`)
  const harness = cli.harness
  if (harness !== 'hermes' && harness !== 'opencode') throw new Error(`The runner does not know the ${harness} command line.`)
  const file = expandBin(cli.bin, env)
  const reasoning = lane.reasoning ? String(lane.reasoning) : ''
  if (harness === 'hermes') {
    const args = ['-z', prompt, '-m', cli.model, '--provider', cli.provider]
    if (cli.toolsets) args.push('-t', String(cli.toolsets))
    if (reasoning) args.push('--reasoning', reasoning)
    if (usageFile) args.push('--usage-file', usageFile)
    return { file, args, cwd: lane.worktree }
  }
  const model = reasoning ? `${cli.model}#${reasoning}` : cli.model
  return { file, args: ['run', '--format', 'json', '--model', model, '--auto', '--title', title, prompt], cwd: lane.worktree }
}

export const DEFAULT_MINUTES = 100

export function parseRunArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).map((value) => String(value))
  const briefs = []
  let lane = ''
  let dryRun = false
  let list = false
  let minutes = DEFAULT_MINUTES
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--list') {
      list = true
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
  if (list) return { lane, briefs, dryRun, minutes, list }
  if (!lane) throw new Error('Name a lane to run, for example hermes.')
  if (briefs.length === 0) throw new Error('Name at least one brief id.')
  return { lane, briefs, dryRun, minutes, list }
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

function reportHead(log) {
  const lines = String(log ?? '').split(/\r?\n/)
  const firstTool = lines.findIndex((line) => line.trimStart().startsWith('┊'))
  const report = (firstTool === -1 ? lines : lines.slice(0, firstTool)).join('\n').replace(/\s+$/, '')
  if (!report) return []
  return report.split(/\r?\n/).slice(0, REPORT_LINES)
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
  return summaryOf('opencode', activities, [], logCost(log))
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

export function summarizeRun({ harness, log, worktree } = {}) {
  if (harness === 'opencode') return opencodeSummary(log, worktree)
  if (harness !== 'hermes') throw new Error(`The summary does not know the ${harness} log.`)
  return hermesSummary(log, worktree)
}

export function formatSummary(summary) {
  const list = (paths) => (paths.length ? paths.join(', ') : 'none')
  if (summary.harness === 'hermes') {
    const lines = [
      `summary: ${summary.toolCalls} tool calls, ${summary.failed} failed`,
      `written: ${list(summary.written)}`,
      `read: ${list(summary.read)}`,
    ]
    if (summary.head.length === 0) return [...lines, 'report: none']
    const count = summary.head.length === 1 ? '1 line' : `${summary.head.length} lines`
    return [...lines, `report: first ${count}`, ...summary.head.map((line) => `  ${line}`)]
  }
  const cost = typeof summary.costUsd === 'number' ? `${summary.costUsd.toFixed(4)} USD` : 'not reported'
  return [
    `summary: ${summary.toolCalls} tool calls, ${summary.failed} failed`,
    `estimated cost: ${cost}`,
    `written: ${list(summary.written)}`,
    `read: ${list(summary.read)}`,
  ]
}

function isoTime(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function runRecord({ lane, briefs, model, reasoning, startedAt, minutes, exitCode, killed, costUsd, log, branch, commits } = {}) {
  return {
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
}

export function runListLine(record) {
  const when = record.startedAt ?? 'time unknown'
  const briefs = record.briefs?.length ? record.briefs.join(' ') : 'none'
  const minutes = Number.isFinite(record.minutes) ? `${record.minutes} min` : 'minutes unknown'
  const exit = Number.isInteger(record.exitCode) ? `exit ${record.exitCode}` : 'exit none'
  const killed = record.killed ? ' (killed)' : ''
  const cost = typeof record.costUsd === 'number' ? `${record.costUsd.toFixed(4)} USD` : 'not reported'
  const branch = record.branch || 'no branch'
  return `${when} | ${record.lane} | ${briefs} | ${minutes} | ${exit}${killed} | ${cost} | ${branch}`
}
