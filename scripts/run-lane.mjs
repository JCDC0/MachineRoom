#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { commandFor, parseRunArgs, unattendedPrompt } from '../src/briefs/run.js'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const docs = join(root, 'docs', 'agents')
const read = (name) => readFileSync(join(docs, name), 'utf8')

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function gitStatus(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error(`git status did not run in ${cwd}.`)
  if (result.status !== 0) throw new Error(`git status failed in ${cwd}: ${String(result.stderr ?? '').trim()}`)
  return result.stdout ?? ''
}

function printUsage(path) {
  if (!existsSync(path)) {
    console.log('usage: no file was written')
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    console.log('usage: the file could not be read')
    return
  }
  const count = (value) => (typeof value === 'number' ? String(value) : 'not reported')
  const cost = typeof report.estimated_cost_usd === 'number' ? `${report.estimated_cost_usd.toFixed(4)} USD` : 'not reported'
  console.log(`estimated cost: ${cost}`)
  console.log(`tokens in: ${count(report.input_tokens)}`)
  console.log(`tokens out: ${count(report.output_tokens)}`)
  console.log(`tokens cached read: ${count(report.cache_read_tokens)}`)
  console.log(`tokens cached write: ${count(report.cache_write_tokens)}`)
  console.log(`tokens reasoning: ${count(report.reasoning_tokens)}`)
  console.log(`tokens total: ${count(report.total_tokens)}`)
}

async function main() {
  const options = parseRunArgs(process.argv.slice(2))
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

  if (result.error) console.log(`start failed: ${result.error.message}`)
  console.log(`exit code: ${result.code === null ? 'none' : result.code}${killed ? ' (killed after the time limit)' : ''}`)
  console.log(`minutes: ${minutes}`)
  console.log(`log: ${logPath}`)
  if (lane.cli.harness === 'hermes') printUsage(usageFile)
  return result.code ?? 1
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
})
