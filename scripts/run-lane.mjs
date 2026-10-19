#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { commandFor, formatSummary, parseRunArgs, runListLine, runRecord, summarizeRun, unattendedPrompt } from '../src/briefs/run.js'

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

function gitStatus(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error(`git status did not run in ${cwd}.`)
  if (result.status !== 0) throw new Error(`git status failed in ${cwd}: ${String(result.stderr ?? '').trim()}`)
  return result.stdout ?? ''
}

function gitRead(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '').trim()
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

function listRuns() {
  const path = runsFile()
  const records = []
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        continue
      }
    }
  }
  if (records.length === 0) {
    console.log('no runs recorded yet')
    return 0
  }
  records.slice(-10).reverse().forEach((record) => console.log(runListLine(record)))
  return 0
}

async function main() {
  const options = parseRunArgs(process.argv.slice(2))
  if (options.list) return listRuns()
  const lanes = JSON.parse(read('lanes.json'))
  if (!Object.hasOwn(lanes, options.lane)) throw new Error(`There is no lane named ${options.lane}.`)
  const lane = lanes[options.lane]
  const briefs = parseBriefs(read('TASKS.md'))
  const wanted = options.briefs.map((id) => {
    const brief = briefs.find((item) => item.id.toUpperCase() === id.toUpperCase())
    if (!brief) throw new Error(`There is no brief named ${id}.`)
    return brief
  })
  const rules = parseRules(read('HOUSE-RULES.md'))
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const prompt = unattendedPrompt(buildPrompt({ briefs: wanted, laneKey: options.lane, lanes, rules, version }))
  const name = `${options.lane}-${wanted.map((brief) => brief.id).join('-')}-${stamp()}`
  const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')
  const logPath = join(folder, `${name}.log`)
  const usageFile = join(folder, `${name}.usage.json`)

  if (options.dryRun) {
    const command = commandFor({ lane, prompt, env: process.env, usageFile, title: name })
    const shown = command.args.map((arg) => (arg === prompt ? `<prompt: ${prompt.length} characters>` : arg))
    console.log(`file: ${command.file}`)
    console.log(`args: ${JSON.stringify(shown)}`)
    console.log(`cwd: ${command.cwd}`)
    return 0
  }

  const status = gitStatus(lane.worktree)
  if (status.trim() !== '') throw new Error(`The worktree ${lane.worktree} is not clean. Commit or discard its changes first.`)

  const command = commandFor({ lane, prompt, env: process.env, usageFile, title: name })
  mkdirSync(folder, { recursive: true })
  const log = createWriteStream(logPath)
  const startedAt = Date.now()
  const child = spawn(command.file, command.args, { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })

  let killed = false
  const timer = setTimeout(() => {
    if (!child.pid) return
    killed = true
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
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
  if (harness === 'hermes') printUsage(usageFile)

  const summary = summarizeRun({ harness, log: readLog(logPath), worktree: lane.worktree })
  formatSummary(summary).forEach((line) => console.log(line))

  const branch = gitRead(lane.worktree, ['branch', '--show-current']) ?? ''
  const commitsText = gitRead(lane.worktree, ['log', '--oneline', 'main..HEAD']) ?? ''
  const record = runRecord({
    lane: options.lane,
    briefs: wanted.map((brief) => brief.id),
    model: lane.cli.model,
    reasoning: lane.reasoning ?? null,
    startedAt,
    minutes,
    exitCode: result.code,
    killed,
    costUsd: totalCost(report),
    log: logPath,
    branch,
    commits: commitsText ? commitsText.split(/\r?\n/).filter(Boolean) : [],
  })
  appendFileSync(runsFile(), `${JSON.stringify(record)}\n`)
  console.log(`record: ${runsFile()}`)
  return result.code ?? 1
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
})
