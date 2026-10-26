#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { formatQueueSummary, parseQueue, parseQueueArgs, runQueue } from '../src/briefs/queue.js'
import { briefProblems, childEnvironment, commandFor, createLaneLog, DEFAULT_MINUTES, filterRunsSince, formatOutcomes, formatStats, formatSummary, laneStats, laneWithOverrides, ORCHESTRATOR_LANE_PROBLEM, parseRunArgs, projectProblems, runListLine, runRecord, sessionToolLines, summarizeRun, unattendedPrompt, worktreeFor, WORKTREES_FOLDER } from '../src/briefs/run.js'
import { outcomeTable } from '../server/outcomes.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { readAllLanes } from '../server/lanes-source.js'
import { acpRunCommand } from './acp-run.mjs'
import { releaseLaneLock, takeLaneLock } from './lane-lock.mjs'
import { writeRecording } from './recording-files.mjs'

const entry = fileURLToPath(import.meta.url)
const root = resolve(entry, '..', '..')
const docs = join(root, 'docs', 'agents')
const read = (name) => readFileSync(join(docs, name), 'utf8')

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function runsFolder() {
  const given = process.env.MACHINEROOM_RUNS
  return given ? resolve(given) : join(process.env.TEMP || tmpdir(), 'machineroom-runs')
}

function runsFile() {
  return join(runsFolder(), 'runs.jsonl')
}

function outcomesFile() {
  return join(runsFolder(), 'outcomes.jsonl')
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

function realPath(value) {
  const folder = resolve(String(value ?? ''))
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

function projectFolder(value) {
  const folder = realPath(String(value ?? ''))
  let stat
  try {
    stat = statSync(folder)
  } catch {
    throw new Error(`The project folder ${folder} does not exist.`)
  }
  if (!stat.isDirectory()) throw new Error(`The project folder ${folder} is not a folder.`)
  return folder
}

function worktreeChanges(worktree) {
  return gitStatus(worktree).split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false
    const name = line.slice(3).trim().replace(/^"|"$/g, '')
    return !(name === 'node_modules' || name.startsWith('node_modules/') || name.startsWith('node_modules\\'))
  })
}

export function worktreePlan(project, lane) {
  const path = worktreeFor(project, lane)
  if (!path) throw new Error('--worktree needs a project folder and a lane.')
  const projectGit = gitFolder(project)
  if (!projectGit.checkout) throw new Error(`The project folder ${project} is not a git folder. --worktree needs one.`)
  if (!existsSync(path)) return { path, made: true }
  const stat = statSync(path)
  if (!stat.isDirectory()) throw new Error(`The worktree ${path} is not a folder.`)
  const worktreeGit = gitFolder(path)
  if (!worktreeGit.checkout) throw new Error(`The worktree ${path} is not a git worktree of the project.`)
  if (worktreeGit.commonDir !== projectGit.commonDir) throw new Error(`The worktree ${path} belongs to another project.`)
  if (worktreeChanges(path).length > 0) throw new Error(`The worktree ${path} has uncommitted changes. Commit or discard them first.`)
  return { path, made: false }
}

function linkNodeModules(project, worktree) {
  const source = join(project, 'node_modules')
  if (!existsSync(source)) return
  const target = join(worktree, 'node_modules')
  let present = false
  try {
    present = lstatSync(target) !== null
  } catch {
    present = false
  }
  if (present) return
  try {
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    throw new Error(`The node_modules link in ${worktree} could not be made: ${String(error?.message ?? error)}`)
  }
}

export function excludeWorktrees(project) {
  const found = spawnSync(gitPath(), ['rev-parse', '--git-common-dir'], { cwd: project, encoding: 'utf8', windowsHide: true })
  const common = String(found.stdout ?? '').trim()
  if (found.status !== 0 || !common) return
  const file = join(isAbsolute(common) ? common : join(project, common), 'info', 'exclude')
  const line = `/${WORKTREES_FOLDER}/`
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {}
  if (text.split(/\r?\n/).some((entry) => entry.trim() === line)) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`)
}

export function prepareWorktree(project, lane) {
  const plan = worktreePlan(project, lane)
  excludeWorktrees(project)
  if (plan.made) {
    mkdirSync(dirname(plan.path), { recursive: true })
    const result = spawnSync(gitPath(), ['worktree', 'add', '--detach', plan.path, 'HEAD'], {
      cwd: project,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.error) throw new Error(`git worktree add did not run in ${project}.`)
    if (result.status !== 0) throw new Error(`git worktree add failed in ${project}: ${String(result.stderr ?? '').trim()}`)
  } else {
    const head = spawnSync(gitPath(), ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', windowsHide: true })
    const sha = String(head.stdout ?? '').trim()
    if (head.status !== 0 || !sha) throw new Error(`Could not read the project's HEAD in ${project}.`)
    const moved = spawnSync(gitPath(), ['switch', '--detach', sha], { cwd: plan.path, encoding: 'utf8', windowsHide: true })
    if (moved.status !== 0) throw new Error(`Could not move the worktree ${plan.path} to the project's HEAD: ${String(moved.stderr ?? '').trim()}`)
  }
  linkNodeModules(project, plan.path)
  return plan
}

function printWorktree(plan) {
  console.log(`worktree: ${plan.path}`)
  console.log(`worktree: ${plan.made ? 'would be made' : 'would be reused'}`)
}

function startedByOption(argv) {
  const index = argv.findIndex((arg) => arg === '--started-by' || arg.startsWith('--started-by='))
  if (index === -1) return { args: argv, startedBy: '' }
  const arg = argv[index]
  const value = arg === '--started-by' ? argv[index + 1] : arg.slice('--started-by='.length)
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,24}$/.test(value)) throw new Error('--started-by needs an orchestrator id.')
  const args = [...argv.slice(0, index), ...(arg === '--started-by' ? argv.slice(index + 2) : argv.slice(index + 1))]
  return { args, startedBy: value }
}

function runOptions(argv) {
  const queued = argv.some((arg) => arg === '--queue' || arg.startsWith('--queue='))
  if (!queued) return parseRunArgs(argv)
  const started = startedByOption(argv)
  const worktree = started.args.includes('--worktree')
  const options = parseQueueArgs(started.args.filter((arg) => arg !== '--worktree'))
  return {
    ...options,
    ...(started.startedBy ? { startedBy: started.startedBy } : {}),
    ...(worktree ? { worktree: true } : {}),
  }
}

function resolvedLanes(lanes) {
  return Object.fromEntries(Object.entries(lanes ?? {}).map(([key, lane]) => {
    if (!lane || typeof lane !== 'object' || typeof lane.worktree !== 'string' || lane.worktree.trim() === '') return [key, lane]
    return [key, { ...lane, worktree: realPath(lane.worktree) }]
  }))
}

function projectTestCommand(project, given) {
  if (typeof given === 'string' && given.trim() !== '') return given
  const file = join(project, 'package.json')
  if (!existsSync(file)) return ''
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    const script = pkg?.scripts?.test
    return typeof script === 'string' && script.trim() !== '' ? 'npm test' : ''
  } catch {
    return ''
  }
}

function runTestCommand(command, cwd, minutes) {
  return new Promise((done) => {
    let child
    try {
      child = spawn(command, [], {
        cwd,
        shell: true,
        windowsHide: true,
        env: childEnvironment(process.env, cwd),
        stdio: ['ignore', 'inherit', 'inherit'],
      })
    } catch (error) {
      done({ ok: false, code: null, killed: false, error })
      return
    }
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      killTree(child)
    }, minutes * 60 * 1000)
    child.once('error', (error) => {
      clearTimeout(timer)
      done({ ok: false, code: null, killed, error })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ ok: !killed && code === 0, code, killed })
    })
  })
}

function queueGit(project, branch, lane) {
  const run = (args, allowFailure = false) => {
    const result = spawnSync(gitPath(), args, {
      cwd: project,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.error) throw new Error(`git did not run in ${project}.`)
    if (!allowFailure && result.status !== 0) {
      throw new Error(`git ${args[0]} failed in ${project}: ${String(result.stderr ?? '').trim()}`)
    }
    return result
  }
  return {
    branch,
    lane,
    exists: (name) => run(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], true).status === 0,
    create: (name) => {
      run(['switch', '-c', name])
    },
    status: () => String(run(['status', '--porcelain']).stdout ?? ''),
    add: () => {
      run(['add', '-A'])
    },
    commit: (message) => {
      run(['commit', '-m', message])
      return String(run(['rev-parse', '--short', 'HEAD']).stdout ?? '').trim()
    },
  }
}

function projectHash(project) {
  const folder = realPath(project)
  const key = process.platform === 'win32' ? folder.toLowerCase() : folder
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

export function projectLockName(project) {
  return `project-${projectHash(project)}`
}

export function takeProjectLock(folder, project) {
  const name = projectLockName(project)
  const path = join(folder, `${name}.lock`)
  try {
    return takeLaneLock(folder, name)
  } catch (error) {
    const message = String(error?.message ?? error)
    if (message.includes('stopped half way')) {
      throw new Error(`Another start on ${project} stopped half way. Start it again.`)
    }
    if (message.includes('already running')) {
      throw new Error(`Another run is already going on ${project}; wait for it to end, or delete ${path} if no run is going.`)
    }
    throw error
  }
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

export function laneSpawn({ command, minutes = DEFAULT_MINUTES, model = '', effort = '' } = {}) {
  if (command?.transport !== 'acp') return { file: command?.file, args: command?.args ?? [], input: false }
  return { ...acpRunCommand({ command, minutes, model, effort }), input: true }
}

function printCommand(command, prompt) {
  const shown = command.args.map((arg) => (arg === prompt ? `<prompt: ${prompt.length} characters>` : arg))
  console.log(`file: ${command.file}`)
  console.log(`args: ${JSON.stringify(shown)}`)
  console.log(`cwd: ${command.cwd}`)
  if (!command.args.includes(prompt)) console.log(`prompt: <prompt: ${prompt.length} characters>`)
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

function gitFolder(cwd) {
  const text = gitRead(cwd, ['rev-parse', '--is-inside-work-tree', '--git-common-dir'])
  if (!text) return { checkout: false, commonDir: '' }
  const [inside = '', common = ''] = text.split(/\r?\n/)
  return {
    checkout: inside.trim() === 'true',
    commonDir: common ? realPath(resolve(cwd, common)) : '',
  }
}

function gitCommonDir(cwd) {
  return gitFolder(cwd).commonDir
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

function projectRefusals(project, lanes, allowDirty) {
  const dirty = gitCheckout(project) ? gitStatus(project).trim() !== '' : false
  return projectProblems({
    project,
    root: realPath(root),
    mainCheckout: realPath(mainCheckout()),
    lanes: resolvedLanes(lanes),
    home: realPath(homedir()),
    temp: realPath(process.env.TEMP || tmpdir()),
    runs: realPath(runsFolder()),
    commonDir: gitCommonDir(project),
    repoCommonDir: gitCommonDir(root),
    dirty,
    allowDirty,
  })
}

async function runQueueProject({ options, lane, lanes }) {
  const project = projectFolder(options.project)
  if (!gitCheckout(project)) throw new Error(`The project folder ${project} is not a git folder. A queue needs one.`)
  const problems = projectRefusals(project, lanes, false)
  if (problems.length > 0) {
    problems.forEach((sentence) => console.log(sentence))
    return 1
  }
  const file = resolve(options.queue)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`The queue file ${file} could not be read.`)
  }
  const tasks = parseQueue(text)
  if (tasks.length === 0) throw new Error('The queue file has no tasks.')
  const queueStamp = stamp()
  const branch = `machineroom/queue-${options.lane}-${queueStamp}`
  if (options.dryRun) {
    const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
    const test = projectTestCommand(plan.made ? project : plan.path, options.test)
    console.log(`lane: ${options.lane}`)
    console.log(`project: ${project}`)
    if (options.worktree) printWorktree(plan)
    console.log(`branch: ${branch}`)
    console.log(`tests: ${test || 'none, the project has no tests'}`)
    tasks.forEach((task, index) => console.log(`${index + 1}. ${task}`))
    return 0
  }
  const folder = runsFolder()
  mkdirSync(folder, { recursive: true })
  const lockTarget = options.worktree ? worktreeFor(project, options.lane) || project : project
  const projectLock = takeProjectLock(folder, lockTarget)
  let lock
  try {
    lock = takeLaneLock(folder, options.lane)
  } catch (error) {
    releaseLaneLock(projectLock)
    throw error
  }
  try {
    const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
    const test = projectTestCommand(plan.made ? project : plan.path, options.test)
    const target = options.worktree ? prepareWorktree(project, options.lane) : plan
    const result = await runQueue({
      tasks,
      git: queueGit(target.path, branch, options.lane),
      runTask: async (task, number) => {
        console.log(`task ${number} of ${tasks.length}`)
        const prompt = unattendedPrompt(task)
        const name = `${options.lane}-queue-${queueStamp}-${number}`
        const logPath = join(folder, `${name}.log`)
        const usageFile = join(folder, `${name}.usage.json`)
        const run = await startLane({
          options, lane, lanes, wanted: [], prompt, logPath, usageFile, name,
          project: target.path, task, queue: { branch, index: number },
        })
        return { code: run.code, killed: run.killed }
      },
      runTests: test ? async () => runTestCommand(test, target.path, options.minutes) : null,
    })
    formatQueueSummary({ branch: result.branch, results: result.results, tests: test }).forEach((line) => console.log(line))
    return result.results.some((item) => item.status.startsWith('failed')) ? 1 : 0
  } finally {
    releaseLaneLock(lock)
    releaseLaneLock(projectLock)
  }
}

async function main() {
  const options = runOptions(process.argv.slice(2))
  if (options.list) return listRuns()
  if (options.stats) return statsRuns(options)
  if (options.outcomes) return outcomeRuns(options)
  const lanesPath = process.env.MACHINEROOM_LANES_FILE
    ? resolve(process.env.MACHINEROOM_LANES_FILE)
    : join(docs, 'lanes.json')
  const lanesJson = JSON.parse(readFileSync(lanesPath, 'utf8'))
  const lanes = readAllLanes({ lanesJson, runsFolder: runsFolder() })
  if (!Object.hasOwn(lanes, options.lane)) throw new Error(`There is no lane named ${options.lane}.`)
  const lane = laneWithOverrides(lanes[options.lane], options)
  lanes[options.lane] = lane
  if (options.lane === 'orchestrator') {
    console.log(ORCHESTRATOR_LANE_PROBLEM)
    return 1
  }
  if (lane.retired === true && options.force !== true) {
    console.log(`The ${options.lane} lane is retired.`)
    return 1
  }
  if (options.queue) return await runQueueProject({ options, lane, lanes })
  if (options.project) {
    const project = projectFolder(options.project)
    const problems = projectRefusals(project, lanes, options.allowDirty === true)
    if (problems.length > 0) {
      problems.forEach((sentence) => console.log(sentence))
      return 1
    }
    const task = readTask(options)
    const prompt = unattendedPrompt(task)
    const name = `${options.lane}-project-${stamp()}`
    const folder = runsFolder()
    const logPath = join(folder, `${name}.log`)
    const usageFile = join(folder, `${name}.usage.json`)

    if (options.dryRun) {
      const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
      if (options.worktree) printWorktree(plan)
      printCommand(commandFor({ lane, prompt, env: process.env, usageFile, title: name, cwd: plan.path }), prompt)
      return 0
    }

    mkdirSync(folder, { recursive: true })
    const lockTarget = options.worktree ? worktreeFor(project, options.lane) || project : project
    const projectLock = takeProjectLock(folder, lockTarget)
    let lock
    try {
      lock = takeLaneLock(folder, options.lane)
    } catch (error) {
      releaseLaneLock(projectLock)
      throw error
    }
    try {
      const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
      const target = options.worktree ? prepareWorktree(project, options.lane) : plan
      const run = await startLane({ options, lane, lanes, wanted: [], prompt, logPath, usageFile, name, project: target.path, task })
      return run.code
    } finally {
      releaseLaneLock(lock)
      releaseLaneLock(projectLock)
    }
  }

  if (!Object.hasOwn(lanesJson, options.lane)) {
    console.log(`The lane ${options.lane} is not in lanes.json.`)
    return 1
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
  const folder = runsFolder()
  const logPath = join(folder, `${name}.log`)
  const usageFile = join(folder, `${name}.usage.json`)

  if (options.dryRun) {
    printCommand(commandFor({ lane, prompt, env: process.env, usageFile, title: name }), prompt)
    return 0
  }

  mkdirSync(folder, { recursive: true })
  const lock = takeLaneLock(folder, options.lane)
  try {
    const run = await startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name })
    return run.code
  } finally {
    releaseLaneLock(lock)
  }
}

async function startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name, project = '', task = '', queue = null }) {
  if (!project) {
    const status = gitStatus(lane.worktree)
    if (status.trim() !== '') throw new Error(`The worktree ${lane.worktree} is not clean. Commit or discard its changes first.`)
  }

  const sessionId = randomUUID()
  const command = commandFor({ lane, prompt, env: process.env, usageFile, title: name, sessionId, ...(project ? { cwd: project } : {}) })
  if (project) {
    const meta = { lane: options.lane, project, sessionId }
    if (queue) {
      meta.queue = queue.branch
      meta.index = queue.index
    }
    writeFileSync(join(dirname(logPath), `${name}.meta.json`), `${JSON.stringify(meta)}\n`)
  }
  const log = createWriteStream(logPath)
  const laneLog = createLaneLog({ write: (text) => log.write(text), runId: name })
  const startedAt = Date.now()
  // OpenCode takes its folder from PWD, which a shell started elsewhere leaves pointing at that shell's folder.
  const spawnSpec = laneSpawn({ command, minutes: options.minutes, model: lane.cli.model, effort: lane.reasoning })
  const runnerNames = ['MACHINEROOM_RUNS', 'MACHINEROOM_LANES_FILE']
    .filter((name) => typeof process.env[name] === 'string' && process.env[name] !== '')
  const child = spawn(spawnSpec.file, spawnSpec.args, { cwd: command.cwd, env: childEnvironment(process.env, command.cwd, { harness: lane.cli.harness, names: runnerNames }), stdio: spawnSpec.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], windowsHide: true })
  if (spawnSpec.input && child.stdin) {
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (text) => laneLog.push('stdout', text))
  child.stderr?.on('data', (text) => laneLog.push('stderr', text))

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
  laneLog.flush()
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
    costUsd: harness === 'opencode' || harness === 'claude' || harness === 'acp' ? summary.costUsd : totalCost(report),
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    log: logPath,
    branch,
    commits: commitsText ? commitsText.split(/\r?\n/).filter(Boolean) : [],
    ...(options.startedBy ? { startedBy: options.startedBy } : {}),
    ...(project ? { project, task } : {}),
  })
  if (queue) {
    record.queue = queue.branch
    record.queueIndex = queue.index
  }
  appendFileSync(runsFile(), `${JSON.stringify(record)}\n`)
  console.log(`record: ${runsFile()}`)
  if (project) return { code: result.code ?? 1, killed }
  try {
    const written = writeRecording({ record, lanes, root, env: process.env, session: toolLines.session })
    console.log(`room: /?recording=${written.name}`)
    if (written.indexError) console.log(`index: not updated (${written.indexError})`)
  } catch (error) {
    console.log(`room: not recorded (${String(error?.message ?? error)})`)
  }
  return { code: result.code ?? 1, killed }
}

const sameFile = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && sameFile(resolve(process.argv[1]), resolve(entry))) {
  main().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
}
