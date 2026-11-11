#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelFor, parseBriefs } from '../src/briefs/briefs.js'
import { briefProblems, runRecord } from '../src/briefs/run.js'
import { readAllRunRecords, runsFile } from '../server/runs.js'
import { lanesFolder } from '../server/lanes-source.js'
import { gitPath } from '../server/programPath.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs', 'agents')
const MINUTES_PROBLEM = '--minutes needs a number from 1 to 600.'
const MAIN_PROBLEM = 'The worktree is on main. Pass --branch.'
const OPTIONS = ['minutes', 'model', 'branch', 'exit']

function failure(sentence) {
  return { code: 1, lines: [sentence] }
}

export function parseHandArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).map((value) => String(value))
  const options = { lane: '', id: '', minutes: null, model: null, branch: null, exit: null }
  const positionals = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const named = OPTIONS.find((key) => arg === `--${key}` || arg.startsWith(`--${key}=`))
    if (named) {
      if (arg === `--${named}`) {
        const value = args[index + 1]
        options[named] = value === undefined ? '' : value
        index += 1
      } else {
        options[named] = arg.slice(named.length + 3)
      }
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg.trim() !== '') positionals.push(arg.trim())
  }
  if (positionals.length > 2) throw new Error('Use one lane and one brief id.')
  options.lane = positionals[0] ?? ''
  options.id = positionals[1] ?? ''
  if (!options.lane) throw new Error('Name a lane, for example agy.')
  if (!options.id) throw new Error('Name a brief id, for example C3e.')
  return options
}

function minutesNumber(text) {
  if (typeof text !== 'string') return null
  const value = text.trim()
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null
  const minutes = Number(value)
  return minutes >= 1 && minutes <= 600 ? minutes : null
}

function exitNumber(text) {
  if (text === null) return 0
  if (typeof text !== 'string' || !/^-?\d+$/.test(text.trim())) return null
  const code = Number(text)
  return Number.isSafeInteger(code) ? code : null
}

function gitRead(cwd, args) {
  let git
  try {
    git = gitPath()
  } catch {
    return null
  }
  const result = spawnSync(git, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '').trim()
}

function currentBranch(worktree) {
  return gitRead(worktree, ['branch', '--show-current']) ?? ''
}

function commitsOf(worktree) {
  const text = gitRead(worktree, ['log', '--oneline', 'refs/heads/main..HEAD']) ?? ''
  return text ? text.split(/\r?\n/).filter(Boolean) : []
}

export function handRun({ argv = [], lanes, briefs, runsPath = runsFile(), now = Date.now() } = {}) {
  let options
  try {
    options = parseHandArgs(argv)
  } catch (error) {
    return failure(String(error?.message ?? error))
  }
  const laneKey = options.lane
  const known = Array.isArray(briefs) ? briefs : []
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes) || !Object.hasOwn(lanes, laneKey) || !lanes[laneKey] || typeof lanes[laneKey] !== 'object') {
    return failure(`There is no lane named ${laneKey}.`)
  }
  const lane = lanes[laneKey]
  if (lane.cli) {
    return failure(`The ${laneKey} lane runs through npm run run-lane, which records it already.`)
  }
  const problems = briefProblems({ briefs: known, ids: [options.id], laneKey, branchExists: () => false, force: false })
  if (problems.length > 0) return { code: 1, lines: problems }
  if (options.model === '') return failure('--model needs a model name.')
  const minutes = minutesNumber(options.minutes)
  if (minutes === null) return failure(MINUTES_PROBLEM)
  const exitCode = exitNumber(options.exit)
  if (exitCode === null) return failure('--exit needs a whole number.')
  const worktree = typeof lane.worktree === 'string' ? lane.worktree.trim() : ''
  if (!worktree) return failure(`The ${laneKey} lane has no worktree.`)
  const askedBranch = options.branch === null ? null : options.branch.trim()
  if (askedBranch === '') return failure('--branch needs a branch name.')
  const branch = askedBranch === null ? currentBranch(worktree) : askedBranch
  if (!branch) return failure(`The worktree at ${worktree} is not on a branch. Pass --branch.`)
  if (branch === 'main') return failure(MAIN_PROBLEM)
  const records = readAllRunRecords(runsPath)
  if (records.some((record) => record && typeof record === 'object' && record.branch === branch)) {
    return failure(`A run record for ${branch} exists already.`)
  }
  const brief = known.find((item) => String(item.id).toLowerCase() === options.id.toLowerCase())
  const model = options.model === null ? modelFor(lane, brief.id) : options.model.trim()
  if (!model) return failure('--model needs a model name.')
  const record = {
    ...runRecord({
      lane: laneKey,
      briefs: [brief.id],
      model,
      reasoning: null,
      startedAt: now - minutes * 60000,
      minutes,
      exitCode,
      killed: false,
      costUsd: null,
      log: null,
      branch,
      commits: commitsOf(worktree),
    }),
    source: 'hand',
  }
  if (typeof runsPath === 'string' && runsPath) {
    mkdirSync(dirname(runsPath), { recursive: true })
    appendFileSync(runsPath, `${JSON.stringify(record)}\n`)
  }
  return {
    code: 0,
    lines: [`Recorded ${laneKey} ${brief.id} on ${branch}. Record the review with npm run outcome -- ${branch} merged or rejected.`],
    record,
  }
}

function main(argv) {
  let lanes
  let briefs
  try {
    lanes = JSON.parse(readFileSync(join(lanesFolder(), 'lanes.json'), 'utf8'))
    briefs = parseBriefs(readFileSync(join(docs, 'TASKS.md'), 'utf8'))
  } catch {
    console.log('The lane file or the briefs file could not be read.')
    return 1
  }
  const result = handRun({ argv, lanes, briefs, runsPath: runsFile() })
  result.lines.forEach((line) => console.log(line))
  return result.code
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invoked) process.exitCode = main(process.argv.slice(2))
