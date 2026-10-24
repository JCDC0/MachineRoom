#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { briefProblems, commandFor, filterRunsSince, formatOutcomes, formatStats, formatSummary, laneStats, laneWithOverrides, parseRunArgs, projectProblems, runListLine, runRecord, sessionToolLines, summarizeRun, unattendedPrompt } from '../src/briefs/run.js'
import { outcomeTable } from '../server/outcomes.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { releaseLaneLock, takeLaneLock } from './lane-lock.mjs'
import { writeRecording } from './recording-files.mjs'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const docs = join(root, 'docs', 'agents')
const read = (name) => readFileSync(join(docs, name), 'utf8')

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function runsFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'runs.jsonl')
}

function outcomesFile() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs', 'outcomes.jsonl')
}

function gitStatus(cwd) {
  const result = spawnSync(gitPath(), ['status', '--porcelain'], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error(`git status did not run in ${cwd}.`)
  if (result.status !== 0) throw new Error(`git status failed in ${cwd}: ${String(result.stderr ?? '').trim()}`)
  return result.stdout ?? ''
}

function gitCheckout(cwd) {
  let git
  try {
    git = gitPath()
  } catch {
    return false
  }
  const result = spawnSync(git, ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return false
  return String(result.stdout ?? '').trim() === 'true'
}

function projectFolder(value) {
  const folder = resolve(String(value ?? ''))
  let stat
  try {
    stat = statSync(folder)
  } catch {
    throw new Error(`The project folder ${folder} does not exist.`)
  }
  if (!stat.isDirectory()) throw new Error(`The project folder ${folder} is not a folder.`)
  return folder
}

function readTask(options) {
  if (options.taskFile) {
    const path = resolve(options.taskFile)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      throw new Error(`The task file ${path} could not be read.`)
    }
    if (!text.trim()) throw new Error('The task file is empty.')
    return text
  }
  const text = String(options.task ?? '')
  if (!text.trim()) throw new Error('The task is empty.')
  return text
}

function printCommand(command, prompt) {
  const shown = command.args.map((arg) => (arg === prompt ? `<prompt: ${prompt.length} characters>` : arg))
  console.log(`file: ${command.file}`)
  console.log(`args: ${JSON.stringify(shown)}`)
  console.log(`cwd: ${command.cwd}`)
}

function gitRead(cwd, args) {
  let git
  try {
    git = gitPath()
  } catch {
    return null
  }
  const result = spawnSync(git, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '').trim()
}

let mainCheckoutPath = null

function mainCheckout() {
  if (mainCheckoutPath) return mainCheckoutPath
  const common = gitRead(root, ['rev-parse', '--git-common-dir']) ?? ''
  mainCheckoutPath = common ? dirname(resolve(root, common)) : root
  return mainCheckoutPath
}

function branchExists(name) {
  return gitRead(mainCheckout(), ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null
}

function readUsage(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function totalCost(report) {
  const total = report?.total_including_auxiliary?.estimated_cost_usd ?? report?.estimated_cost_usd
  return typeof total === 'number' && Number.isFinite(total) ? total : null
}

function readLog(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function captureToolLines(file, sessionId, logPath) {
  if (!sessionId) return { count: 0, session: '' }
  const result = spawnSync(file, ['sessions', 'export', '--session-id', String(sessionId), '--format', 'jsonl', '-'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return { count: 0, session: '' }
  const session = String(result.stdout ?? '')
  const lines = sessionToolLines(session)
  if (lines.length === 0) return { count: 0, session }
  appendFileSync(logPath, `\n${lines.join('\n')}\n`)
  return { count: lines.length, session }
}

function printUsage(path) {
  if (!existsSync(path)) {
    console.log('usage: no file was written')
    return
  }
  const report = readUsage(path)
  if (!report) {
    console.log('usage: the file could not be read')
    return
  }
  const count = (value) => (typeof value === 'number' ? String(value) : 'not reported')
  const cost = totalCost(report)
  console.log(`estimated cost: ${cost === null ? 'not reported' : `${cost.toFixed(4)} USD`}`)
  console.log(`tokens in: ${count(report.input_tokens)}`)
  console.log(`tokens out: ${count(report.output_tokens)}`)
  console.log(`tokens cached read: ${count(report.cache_read_tokens)}`)
  console.log(`tokens cached write: ${count(report.cache_write_tokens)}`)
  console.log(`tokens reasoning: ${count(report.reasoning_tokens)}`)
  console.log(`tokens total: ${count(report.total_tokens)}`)
}

function readRecords() {
  const path = runsFile()
  const records = []
  if (!existsSync(path)) return records
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return records
}

function readOutcomes() {
  const path = outcomesFile()
  const records = []
  if (!existsSync(path)) return records
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return records
}

function listRuns() {
  const records = readRecords()
  if (records.length === 0) {
    console.log('no runs recorded yet')
    return 0
  }
  records.slice(-10).reverse().forEach((record) => console.log(runListLine(record)))
  return 0
}

function statsRuns(options) {
  formatStats(laneStats(readRecords(), { since: options.since })).forEach((line) => console.log(line))
  return 0
}

function outcomeRuns(options) {
  const runs = filterRunsSince(readRecords(), options.since)
  formatOutcomes(outcomeTable(runs, readOutcomes())).forEach((line) => console.log(line))
  return 0
}

async function main() {
  const options = parseRunArgs(process.argv.slice(2))
  if (options.list) return listRuns()
  if (options.stats) return statsRuns(options)
  if (options.outcomes) return outcomeRuns(options)
  const lanes = JSON.parse(read('lanes.json'))
  if (!Object.hasOwn(lanes, options.lane)) throw new Error(`There is no lane named ${options.lane}.`)
  const lane = laneWithOverrides(lanes[options.lane], options)
  lanes[options.lane] = lane
  if (lane.retired === true && options.force !== true) {
    console.log(`The ${options.lane} lane is retired.`)
    return 1
  }
  if (options.project) {
    const project = projectFolder(options.project)
    const dirty = gitCheckout(project) ? gitStatus(project).trim() !== '' : false
    const problems = projectProblems({
      project,
      root,
      mainCheckout: mainCheckout(),
      lanes,
      dirty,
      allowDirty: options.allowDirty === true,
    })
    if (problems.length > 0) {
      problems.forEach((sentence) => console.log(sentence))
      return 1
    }
    const task = readTask(options)
    const prompt = unattendedPrompt(task)
    const name = `${options.lane}-project-${stamp()}`
    const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')
    const logPath = join(folder, `${name}.log`)
    const usageFile = join(folder, `${name}.usage.json`)

    if (options.dryRun) {
      printCommand(commandFor({ lane, prompt, env: process.env, usageFile, title: name, cwd: project }), prompt)
      return 0
    }

    mkdirSync(folder, { recursive: true })
    const lock = takeLaneLock(folder, options.lane)
    try {
      return await startLane({ options, lane, lanes, wanted: [], prompt, logPath, usageFile, name, project, task })
    } finally {
      releaseLaneLock(lock)
    }
  }

  const briefs = parseBriefs(read('TASKS.md'))
  const problems = briefProblems({
    briefs,
    ids: options.briefs,
    laneKey: options.lane,
    branchExists,
    force: options.force === true,
  })
  if (problems.length > 0) {
    problems.forEach((sentence) => console.log(sentence))
    return 1
  }
  const wanted = options.briefs.map((id) => briefs.find((item) => item.id.toUpperCase() === id.toUpperCase()))
  const rules = parseRules(read('HOUSE-RULES.md'))
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const prompt = unattendedPrompt(buildPrompt({ briefs: wanted, laneKey: options.lane, lanes, rules, version }))
  const name = `${options.lane}-${wanted.map((brief) => brief.id).join('-')}-${stamp()}`
  const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')
  const logPath = join(folder, `${name}.log`)
  const usageFile = join(folder, `${name}.usage.json`)

  if (options.dryRun) {
    printCommand(commandFor({ lane, prompt, env: process.env, usageFile, title: name }), prompt)
    return 0
  }

  mkdirSync(folder, { recursive: true })
  const lock = takeLaneLock(folder, options.lane)
  try {
    return await startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name })
  } finally {
    releaseLaneLock(lock)
  }
}

async function startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name, project = '', task = '' }) {
  if (!project) {
    const status = gitStatus(lane.worktree)
    if (status.trim() !== '') throw new Error(`The worktree ${lane.worktree} is not clean. Commit or discard its changes first.`)
  }

  const command = commandFor({ lane, prompt, env: process.env, usageFile, title: name, ...(project ? { cwd: project } : {}) })
  if (project) writeFileSync(join(dirname(logPath), `${name}.meta.json`), `${JSON.stringify({ lane: options.lane, project })}\n`)
  const log = createWriteStream(logPath)
  const startedAt = Date.now()
  const child = spawn(command.file, command.args, { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })

  let killed = false
  const timer = setTimeout(() => {
    if (!child.pid) return
    killed = true
    killTree(child)
  }, options.minutes * 60 * 1000)

  const result = await new Promise((done) => {
    child.on('error', (error) => done({ code: null, error }))
    child.on('close', (code) => done({ code }))
  })
  clearTimeout(timer)
  await new Promise((done) => log.end(done))
  const minutes = Math.round(((Date.now() - startedAt) / 60000) * 10) / 10
  const harness = lane.cli.harness

  if (result.error) console.log(`start failed: ${result.error.message}`)
  console.log(`exit code: ${result.code === null ? 'none' : result.code}${killed ? ' (killed after the time limit)' : ''}`)
  console.log(`minutes: ${minutes}`)
  console.log(`log: ${logPath}`)
  const report = harness === 'hermes' ? readUsage(usageFile) : null
  let toolLines = { count: 0, session: '' }
  if (harness === 'hermes') {
    printUsage(usageFile)
    toolLines = captureToolLines(command.file, report?.session_id, logPath)
    console.log(`tool lines: ${toolLines.count}`)
  }

  const worktree = project || lane.worktree
  const summary = summarizeRun({ harness, log: readLog(logPath), worktree })
  formatSummary(summary).forEach((line) => console.log(line))

  const branch = project ? '' : gitRead(lane.worktree, ['branch', '--show-current']) ?? ''
  const commitsText = project ? '' : gitRead(lane.worktree, ['log', '--oneline', 'refs/heads/main..HEAD']) ?? ''
  const record = runRecord({
    lane: options.lane,
    briefs: project ? [] : wanted.map((brief) => brief.id),
    model: lane.cli.model,
    reasoning: lane.reasoning ?? null,
    startedAt,
    minutes,
    exitCode: result.code,
    killed,
    costUsd: harness === 'opencode' ? summary.costUsd : totalCost(report),
    log: logPath,
    branch,
    commits: commitsText ? commitsText.split(/\r?\n/).filter(Boolean) : [],
    ...(project ? { project, task } : {}),
  })
  appendFileSync(runsFile(), `${JSON.stringify(record)}\n`)
  console.log(`record: ${runsFile()}`)
  if (project) return result.code ?? 1
  try {
    const written = writeRecording({ record, lanes, root, env: process.env, session: toolLines.session })
    console.log(`room: /?recording=${written.name}`)
    if (written.indexError) console.log(`index: not updated (${written.indexError})`)
  } catch (error) {
    console.log(`room: not recorded (${String(error?.message ?? error)})`)
  }
  return result.code ?? 1
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
})
