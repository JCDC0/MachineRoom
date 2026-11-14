#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, constants, createWriteStream, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { finished } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { branchFor, briefFileList, buildPrompt, nextVersion, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { formatQueueSummary, parseQueue, parseQueueArgs, runQueue } from '../src/briefs/queue.js'
import { briefProblems, briefWorktreeProblems, checkCommandProblem, childEnvironment, commandFor, createLaneLog, DEFAULT_MINUTES, fallbackProblem, failoverKind, filterRunsSince, formatOutcomes, formatStats, formatSummary, laneCommandProblem, laneLockStartedAt, laneLockText, laneStats, laneStopProblem, laneWithOverrides, limitedFor, maskedQueueTasks, ORCHESTRATOR_LANE_PROBLEM, parseRunArgs, projectProblems, projectRunGit, readinessLine, retryStartProblem, runListLine, runRecord, sessionToolLines, splitCheckCommand, startFailureText, summarizeRun, unattendedPrompt, worktreeFor, WORKTREES_FOLDER } from '../src/briefs/run.js'
import { outcomeTable } from '../server/outcomes.js'
import { readMainSubjectsSync } from '../server/runs.js'
import { isLockHolderStale, killTree, descendantProcesses, leftoverProcesses, listProcesses } from '../server/processTree.js'
import { codexAppProgram } from '../server/agents-config.js'
import { codexHarness } from '../src/harnesses/codex.js'
import { gitPath, programPath } from '../server/programPath.js'
import { isWindowsPath, printedRunsFolder, realPath } from '../server/printed-path.js'
import { lanesFolder, readAllLanes, runsFolder } from '../server/lanes-source.js'
import { readEndpoints } from '../server/endpoints.js'
import { readAgentDepth } from '../server/agent-depth.js'
import { acpRunCommand } from './acp-run.mjs'
import { isHolderAlive, processAlive, readLaneLock, releaseLaneLock, takeLaneLock, writeLaneChild } from './lane-lock.mjs'
import { enabledMcpServers, mcpConfigForClaude, mcpConfigForOpencode } from './mcp-bridge.mjs'
import { writeRecording } from './recording-files.mjs'

const entry = fileURLToPath(import.meta.url)
const root = resolve(entry, '..', '..')
const docs = join(root, 'docs', 'agents')
const read = (name) => readFileSync(join(docs, name), 'utf8')

export { printedRunsFolder }

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function queueStamp(date = new Date()) {
  return `${stamp(date)}-${String(date.getMilliseconds()).padStart(3, '0')}`
}

function runsFile(env = process.env) {
  return join(runsFolder(env), 'runs.jsonl')
}

function outcomesFile() {
  return join(runsFolder(), 'outcomes.jsonl')
}

function errorCode(error) {
  if (typeof error?.code === 'string' && error.code) return error.code
  const message = String(error?.message ?? error).trim()
  return message || 'no error code'
}

let recordFailed = false

export function appendRunRecord(record, { env = process.env, print = console.log, file, write = appendFileSync } = {}) {
  const targetFile = file || runsFile(env)
  const folder = dirname(targetFile)
  try {
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true })
      print(`The runs folder was gone; made it again at ${printedRunsFolder(folder, env)}.`)
    }
    const line = typeof record === 'string' ? record : JSON.stringify(record)
    write(targetFile, `${line.endsWith('\n') ? line : `${line}\n`}`)
    return true
  } catch (error) {
    recordFailed = true
    process.exitCode = 1
    print(`The run record was not saved at ${printedRunsFolder(targetFile, env)} (${errorCode(error)}); the run still ended.`)
    return false
  }
}

function lanesFile() {
  return process.env.MACHINEROOM_LANES_FILE
    ? resolve(process.env.MACHINEROOM_LANES_FILE)
    : join(lanesFolder(), 'lanes.json')
}

function lanesInFile(path = lanesFile()) {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'))
    return Object.entries(json ?? {}).filter(([key]) => /^[A-Za-z0-9_-]+$/.test(key))
  } catch {
    return []
  }
}

function exampleLane(entries) {
  const usable = entries.find(([key, lane]) => key !== 'orchestrator' && lane?.retired !== true)
  if (usable) return usable[0]
  const live = entries.find(([, lane]) => lane?.retired !== true)
  return live ? live[0] : (entries[0]?.[0] ?? 'lane')
}

export function helpLines() {
  const entries = lanesInFile()
  const path = lanesFile()
  const names = entries.map(([key]) => key)
  const example = exampleLane(entries)
  return [
    'Usage: npm run run-lane -- <lane> <brief...> [options]',
    '',
    'Forms:',
    '  npm run run-lane -- <lane> <brief...>                            run a lane on one or more briefs',
    '  npm run run-lane -- <lane> --project <folder> --task <text>      run one task in that project',
    '  npm run run-lane -- <lane> --project <folder> --task-file <path> run the task in that file',
    '  npm run run-lane -- <lane> --queue <path> --project <folder>     run a queue of tasks in that project',
    '  npm run run-lane -- --list                                       print the last 10 runs',
    '  npm run run-lane -- --stats [--since YYYY-MM-DD]                 print runs, minutes and cost per lane',
    '  npm run run-lane -- --outcomes [--since YYYY-MM-DD]              print the merge table',
    '  npm run run-lane -- --stop <lane>                                stop that lane and its processes',
    '  npm run run-lane -- --stop <lane> --started-at <ISO>             stop only the run that started at that time',
    '',
    'Flags:',
    '  --dry-run            print the command and start nothing',
    '  --worktree           run a --project run in <project>/.worktrees/<lane>',
    '  --allow-dirty        let a --project run start with uncommitted changes',
    '  --model <id>         use this model for this run only',
    '  --reasoning <level>  use this reasoning level for this run only',
    '  --minutes <n>        stop the run after n minutes (100 by default)',
    '  --test <command>     run this check after each task, or npm test when the package has one',
    '  --started-by <id>    name the orchestrator that started the run',
    '  --force              run a retired lane or a brief marked done',
    '',
    `Lanes: ${names.length > 0 ? names.join(', ') : 'none'}`,
    `Lane file: ${printedRunsFolder(path)}`,
    `Example: npm run run-lane -- ${example} <brief> --dry-run`,
  ]
}

function printHelp(print) {
  helpLines().forEach((line) => print(line))
}

function missingLaneText(laneKey, lanes, path) {
  const names = Object.keys(lanes ?? {})
  const held = names.length === 0 ? 'no lanes' : names.join(', ')
  return `There is no lane named ${laneKey}. The lane file ${printedRunsFolder(path)} holds ${held}. Add a lane in the room's Agents tab.`
}

function stopProcess(pid, { kill = killTree, alive = processAlive } = {}) {
  if (kill({ pid })) return true
  return !alive(pid)
}

function stopLeftovers({ worktree, childPid = 0, label = 'leftover', excludePids = [], list = listProcesses, kill = killTree, alive = processAlive, processes = null } = {}) {
  const folder = String(worktree ?? '').trim()
  if (!folder && !(childPid > 0)) return { found: 0, stopped: 0, failed: 0 }
  const found = leftoverProcesses(Array.isArray(processes) ? processes : list(), { childPid, worktree: folder, ownPid: process.pid, excludePids })
  let stopped = 0
  let failed = 0
  for (const item of found) {
    if (stopProcess(item.pid, { kill, alive })) {
      console.log(`${label}: stopped ${item.pid}`)
      stopped += 1
    } else {
      console.log(`${label}: could not stop ${item.pid}`)
      failed += 1
    }
  }
  return { found: found.length, stopped, failed }
}

function harnessDescendants(childPid, { excludePids = [], processes = null } = {}) {
  if (!Number.isInteger(childPid) || childPid <= 0) return []
  return descendantProcesses(processes ?? listProcesses(), { rootPid: childPid, ownPid: process.pid, excludePids })
    .map((item) => ({ ...item }))
}

function descendantState(item, currentByPid) {
  if (currentByPid.size === 0) return 'kill'
  const current = currentByPid.get(item.pid)
  if (!current) return 'gone'
  if (typeof item.created === 'number' && Number.isFinite(item.created) && current.created !== item.created) {
    return 'reused'
  }
  return 'kill'
}

function stopDescendants(descendants, options = 'leftover') {
  const {
    label = 'leftover',
    kill = killTree,
    alive = processAlive,
    list = listProcesses,
    processes = null,
  } = typeof options === 'string' ? { label: options } : options ?? {}
  const items = Array.isArray(descendants) ? descendants : []
  if (items.length === 0) return { stopped: 0, failed: 0, processes }
  const currentList = Array.isArray(processes) ? processes : list()
  const currentByPid = new Map(currentList.map((row) => [row.pid, row]))
  let stopped = 0
  let failed = 0
  let killed = false
  for (const item of items) {
    const state = descendantState(item, currentByPid)
    if (state === 'gone') {
      console.log(`${label}: stopped ${item.pid}`)
      stopped += 1
      continue
    }
    if (state === 'reused') {
      console.log(`stale: ${item.pid} was not this run`)
      stopped += 1
      continue
    }
    killed = true
    if (stopProcess(item.pid, { kill, alive })) {
      console.log(`${label}: stopped ${item.pid}`)
      stopped += 1
    } else {
      console.log(`${label}: could not stop ${item.pid}`)
      failed += 1
    }
  }
  return { stopped, failed, processes: killed ? null : currentList }
}

function refuseRunningLane(laneKey, worktree, folder = runsFolder()) {
  const lock = join(folder, `${laneKey}.lock`)
  const holder = readLaneLock(lock)
  if (isHolderAlive(holder.child, lock)) throw new Error(laneStopProblem({ lane: laneKey, pid: holder.child }))
  const folders = []
  for (const value of [worktree, holder.folder]) {
    const name = String(value ?? '').trim()
    if (name !== '' && !folders.includes(name)) folders.push(name)
  }
  for (const name of folders) {
    const found = leftoverProcesses(listProcesses(), { worktree: name, ownPid: process.pid })
    if (found.length > 0) throw new Error(laneStopProblem({ lane: laneKey, pid: found[0].pid, leftover: true }))
  }
}

function stopArgument(argv) {
  const index = argv.findIndex((arg) => arg === '--stop' || arg.startsWith('--stop='))
  if (index === -1) return ''
  const arg = argv[index]
  const value = arg === '--stop' ? argv[index + 1] : arg.slice('--stop='.length)
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) throw new Error('--stop needs a lane name.')
  const lane = value.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(lane)) throw new Error('--stop needs a lane name.')
  return lane
}

function stopStartedAt(argv) {
  const index = argv.findIndex((arg) => arg === '--started-at' || arg.startsWith('--started-at='))
  if (index === -1) return ''
  const arg = argv[index]
  const value = arg === '--started-at' ? argv[index + 1] : arg.slice('--started-at='.length)
  return typeof value === 'string' ? value.trim() : ''
}

function lockText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function laneStartTime(options) {
  const given = typeof options?.startedAt === 'string' ? Date.parse(options.startedAt) : options?.startedAt
  return Number.isFinite(given) && given > 0 ? given : Date.now()
}

function writeLockStart(path, startedAt, log = '') {
  const holder = readLaneLock(path)
  if (holder.pid !== process.pid) return false
  writeFileSync(path, laneLockText({ pid: holder.pid, child: holder.child, folder: holder.folder, projectRun: holder.projectRun, startedAt, log }))
  return true
}

function takeRunLock(folder, laneKey, options, startedAt, log = '') {
  const path = takeLaneLock(folder, laneKey, options)
  writeLockStart(path, startedAt, log)
  return path
}

function differentRunText(laneKey, path, startedAt) {
  if (startedAt === '') return ''
  const current = Date.parse(laneLockStartedAt(lockText(path)))
  if (Number.isFinite(current) && current === Date.parse(startedAt)) return ''
  return `The ${laneKey} lane is running a different run now, so nothing was stopped.`
}

export function stopLane(laneKey, { platform = process.platform, list = listProcesses, kill = killTree, stat = statSync, alive = processAlive, startedAt = '' } = {}) {
  const folder = runsFolder()
  const path = join(folder, `${laneKey}.lock`)
  const before = lockText(path)
  if (before.trim() === '') {
    console.log(`Nothing was running for the ${laneKey} lane.`)
    return 0
  }
  let lockMtime = null
  try {
    lockMtime = stat(path).mtimeMs
  } catch {
    lockMtime = null
  }
  const holder = readLaneLock(path)
  const worktree = holder.folder
  const processes = list()
  const byPid = new Map((Array.isArray(processes) ? processes : []).map((item) => [item.pid, item]))
  const rootPid = Number.isInteger(holder.child) && holder.child > 0 ? holder.child : holder.pid
  const isStranger = (pid) => isLockHolderStale(pid, lockMtime, { platform, processes: byPid })
  const descendants = isStranger(rootPid) ? [] : harnessDescendants(rootPid, { excludePids: [holder.pid ?? 0], processes })
  const differentRun = differentRunText(laneKey, path, startedAt)
  if (differentRun !== '') {
    console.log(differentRun)
    return 1
  }
  let stopped = 0
  let failed = 0
  let listStale = false
  for (const [pid, name] of [[holder.child, 'the harness'], [holder.pid, 'the run']]) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
    if (isStranger(pid)) {
      console.log(`stale: ${pid} was not this run`)
    } else if (platform !== 'win32' || processes.length === 0 || byPid.has(pid)) {
      listStale = true
      if (stopProcess(pid, { kill, alive })) {
        console.log(`stopped: ${pid} (${name})`)
        stopped += 1
      } else {
        console.log(`could not stop: ${pid} (${name})`)
        failed += 1
      }
    }
  }
  const descendantsResult = stopDescendants(descendants, {
    list,
    kill,
    alive,
    processes: listStale ? null : processes,
  })
  stopped += descendantsResult.stopped
  failed += descendantsResult.failed
  const afterKill = lockText(path)
  if (afterKill.trim() !== '' && afterKill !== before) {
    console.log(`kept the ${laneKey} lock: a newer run took it while the stop ran`)
    return 0
  }
  const byName = holder.projectRun !== true
  const leftovers = stopLeftovers({
    worktree: byName ? worktree : '',
    excludePids: [holder.pid ?? 0],
    list,
    kill,
    alive,
    processes: descendantsResult.processes,
  })
  stopped += leftovers.stopped
  failed += leftovers.failed
  if (stopped === 0 && leftovers.found === 0 && descendants.length === 0 && failed === 0) {
    console.log(`Nothing was running for the ${laneKey} lane.`)
  }
  if (lockText(path) !== before) {
    console.log(`kept the ${laneKey} lock: a newer run took it while the stop ran`)
    return 0
  }
  if (failed > 0) {
    console.log(`kept the ${laneKey} lock: ${failed} ${failed === 1 ? 'process' : 'processes'} could not be stopped, so the lane stays busy`)
    return 1
  }
  rmSync(path, { force: true })
  return 0
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
  const folder = realPath(String(value ?? ''))
  let stat
  try {
    stat = statSync(folder)
  } catch {
    throw new Error(`The project folder ${printedRunsFolder(folder)} does not exist.`)
  }
  if (!stat.isDirectory()) throw new Error(`The project folder ${printedRunsFolder(folder)} is not a folder.`)
  return folder
}

function worktreeChanges(worktree) {
  return gitStatus(worktree).split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false
    const name = line.slice(3).trim().replace(/^"|"$/g, '')
    return !(name === 'node_modules' || name.startsWith('node_modules/') || name.startsWith('node_modules\\'))
  })
}

function gitFailure(result) {
  const text = String(result.error?.message ?? result.stderr ?? '').trim()
  return text === '' ? 'git failed' : text.replace(/\s*\r?\n\s*/g, ' ')
}

function commitChanges(worktree) {
  const result = spawnSync(gitPath(), ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], {
    cwd: worktree,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw new Error(`git status did not run in ${worktree}.`)
  if (result.status !== 0) throw new Error(`git status failed in ${worktree}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))
    .filter((change) => {
      const name = change.path.replace(/\\/g, '/')
      return !(name === 'node_modules' || name.startsWith('node_modules/'))
    })
}

function slashPath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
}

function sameCommitPath(one, two) {
  return process.platform === 'win32' ? one.toLowerCase() === two.toLowerCase() : one === two
}

function blockedCommitPath(path) {
  const parts = slashPath(path).split('/')
  const name = (parts.pop() ?? '').toLowerCase()
  if (name === 'keys.json' || name.endsWith('.key') || name.startsWith('.env') || name.endsWith('.log')) return true
  return parts.some((part) => {
    const folder = part.toLowerCase()
    return folder === 'dist' || folder === 'build' || folder === 'out'
  })
}

function briefCommitPath(path, entry) {
  const target = slashPath(path)
  const allowed = String(entry ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!allowed) return false
  const folder = allowed.endsWith('/')
  const bare = allowed.replace(/\/+$/, '')
  if (!folder) return sameCommitPath(target, bare)
  const prefix = `${bare}/`
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(prefix.toLowerCase())
    : target.startsWith(prefix)
}

export function runnerCommitVersion(file = join(root, 'package.json')) {
  return nextVersion(JSON.parse(readFileSync(file, 'utf8')).version)
}

export function runnerCommit({ laneKey, worktree, briefs, version = runnerCommitVersion(), branchSuffix = '' } = {}) {
  const list = Array.isArray(briefs) ? briefs : []
  const title = String(list[0]?.title ?? '').trim()
  const result = { ok: true, committed: false, leftOut: [], error: '' }
  if (title === '') return result
  const changes = commitChanges(worktree)
  if (changes.length === 0) {
    console.log(`The ${laneKey} lane changed no file.`)
    return result
  }
  const files = list.flatMap((brief) => briefFileList(brief?.text))
  const selected = []
  const leftOut = []
  for (const change of changes) {
    if (blockedCommitPath(change.path) || !files.some((entry) => briefCommitPath(change.path, entry))) leftOut.push(change.path)
    else selected.push(change.path)
  }
  result.leftOut = leftOut
  for (const path of leftOut) console.log(`Left out of the commit: ${path}`)
  if (selected.length === 0) return result
  const run = (args) => spawnSync(gitPath(), args, { cwd: worktree, encoding: 'utf8', windowsHide: true })
  const fail = (failure) => {
    const error = gitFailure(failure)
    console.log(`The runner could not commit the ${laneKey} lane's work: ${error}`)
    return { ok: false, committed: false, leftOut, error }
  }
  const switched = run(['switch', '-c', `${branchFor(list[0])}${branchSuffix}`])
  if (switched.error || switched.status !== 0) return fail(switched)
  const added = run(['add', '-A', '--', ...selected])
  if (added.error || added.status !== 0) return fail(added)
  const subject = `${version}: ${title}`
  const body = `Written by the ${laneKey} lane in its sandbox; committed by the runner.`
  const committed = run(['commit', '--only', '-m', subject, '-m', body, '--', ...selected])
  if (committed.error || committed.status !== 0) return fail(committed)
  return { ok: true, committed: true, leftOut, error: '' }
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
    const current = spawnSync(gitPath(), ['branch', '--show-current'], { cwd: plan.path, encoding: 'utf8', windowsHide: true })
    if (current.status !== 0) throw new Error(`Could not read the worktree branch in ${plan.path}.`)
    const branch = String(current.stdout ?? '').trim()
    const counted = spawnSync(gitPath(), ['rev-list', '--count', `${sha}..HEAD`], { cwd: plan.path, encoding: 'utf8', windowsHide: true })
    const count = counted.status === 0 ? Number.parseInt(String(counted.stdout ?? '').trim(), 10) : null
    if (!Number.isInteger(count) || count < 0) throw new Error(`Could not read the commits in the worktree ${plan.path}.`)
    if (branch === '' && count > 0) {
      throw new Error(`The worktree ${plan.path} is detached with ${count} ${count === 1 ? 'commit' : 'commits'} that the project's HEAD does not have, so make a branch for them or remove the worktree first.`)
    }
    if (branch !== '' && count > 0) {
      throw new Error(`The ${lane} worktree is on ${branch} with ${count} ${count === 1 ? 'commit' : 'commits'} not in the project yet. Merge or remove it first.`)
    }
    const moved = spawnSync(gitPath(), ['switch', '--detach', sha], { cwd: plan.path, encoding: 'utf8', windowsHide: true })
    if (moved.status !== 0) throw new Error(`Could not move the worktree ${plan.path} to the project's HEAD: ${String(moved.stderr ?? '').trim()}`)
  }
  linkNodeModules(project, plan.path)
  return plan
}

function printWorktree(plan) {
  console.log(`worktree: ${printedRunsFolder(plan.path)}`)
  console.log(`worktree: ${plan.made ? 'would be made' : 'would be reused'}`)
}

export function sessionStartedBy(env = {}) {
  const claude = typeof env.CLAUDE_CODE_SESSION_ID === 'string' ? env.CLAUDE_CODE_SESSION_ID.trim() : ''
  if (claude) return { harness: 'claude', session: claude }
  const opencode = typeof env.OPENCODE_SESSION_ID === 'string' ? env.OPENCODE_SESSION_ID.trim() : ''
  if (opencode) return { harness: 'opencode', session: opencode }
  return null
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

function startedAtOption(argv) {
  const index = argv.findIndex((arg) => arg === '--started-at' || arg.startsWith('--started-at='))
  if (index === -1) return { args: argv, startedAt: '' }
  const arg = argv[index]
  const value = arg === '--started-at' ? argv[index + 1] : arg.slice('--started-at='.length)
  if (typeof value !== 'string' || value.trim() === '') throw new Error('--started-at needs a start time.')
  const args = [...argv.slice(0, index), ...(arg === '--started-at' ? argv.slice(index + 2) : argv.slice(index + 1))]
  return { args, startedAt: value.trim() }
}

function runOptions(argv) {
  const queued = argv.some((arg) => arg === '--queue' || arg.startsWith('--queue='))
  if (!queued) return parseRunArgs(argv)
  const started = startedByOption(argv)
  const timed = startedAtOption(started.args)
  const worktree = timed.args.includes('--worktree')
  const options = parseQueueArgs(timed.args.filter((arg) => arg !== '--worktree'))
  return {
    ...options,
    ...(started.startedBy ? { startedBy: started.startedBy } : {}),
    ...(timed.startedAt ? { startedAt: timed.startedAt } : {}),
    ...(worktree ? { worktree: true } : {}),
  }
}

function resolvedLanes(lanes) {
  return Object.fromEntries(Object.entries(lanes ?? {}).map(([key, lane]) => {
    if (!lane || typeof lane !== 'object' || typeof lane.worktree !== 'string' || lane.worktree.trim() === '') return [key, lane]
    return [key, { ...lane, worktree: realPath(lane.worktree) }]
  }))
}

function folderCheckFor(lanes) {
  return {
    mainCheckout: realPath(mainCheckout()),
    lanes: resolvedLanes(lanes),
    home: realPath(homedir()),
    temp: realPath(process.env.TEMP || tmpdir()),
    runs: realPath(runsFolder()),
  }
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
    throw new Error(`The package.json at ${printedRunsFolder(file)} could not be read, so the tests cannot run.`)
  }
}

function testCommandFor(project, given) {
  try {
    return projectTestCommand(project, given)
  } catch (error) {
    return String(error?.message ?? error)
  }
}

function checkSpawn(command) {
  const problem = checkCommandProblem(command)
  if (problem !== '') throw new Error(problem)
  const parts = splitCheckCommand(command)
  if (parts.length === 0) throw new Error('The check command is empty.')
  const program = parts[0]
  const args = parts.slice(1)
  if (process.platform !== 'win32' || !/^(npm|npx)$/i.test(program)) return { file: program, args }
  const cliName = program.toLowerCase() === 'npm' ? 'npm-cli.js' : 'npx-cli.js'
  const candidates = []
  const npmExecPath = typeof process.env.npm_execpath === 'string' ? process.env.npm_execpath.trim() : ''
  if (npmExecPath !== '' && basename(npmExecPath) === cliName) candidates.push(npmExecPath)
  const nodeFolder = dirname(process.execPath)
  candidates.push(join(nodeFolder, 'node_modules', 'npm', 'bin', cliName))
  candidates.push(join(nodeFolder, '..', 'lib', 'node_modules', 'npm', 'bin', cliName))
  const cli = candidates.find((candidate) => existsSync(candidate))
  return cli ? { file: process.execPath, args: [cli, ...args] } : { file: program, args }
}

function runTestCommand(command, cwd, minutes) {
  return new Promise((done) => {
    let child
    try {
      const spawnSpec = checkSpawn(command)
      child = spawn(spawnSpec.file, spawnSpec.args, {
        cwd,
        shell: false,
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

async function projectCheck({ project, given, minutes }) {
  let command
  try {
    command = projectTestCommand(project, given)
  } catch (error) {
    const message = String(error?.message ?? error)
    console.error(message)
    return { command: message, ok: false, ran: false }
  }
  if (command === '') return { command: '', ok: true, ran: false }
  const outcome = await runTestCommand(command, project, minutes)
  return { command, ok: outcome?.ok === true, ran: true, outcome }
}

function queueGit(project, branch, lane, { onSettled } = {}) {
  const settle = typeof onSettled === 'function' ? onSettled : () => {}
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
    status: () => {
      const text = String(run(['status', '--porcelain']).stdout ?? '')
      if (text.trim() === '') settle()
      return text
    },
    add: () => {
      run(['add', '-A'])
    },
    commit: (message) => {
      run(['commit', '-m', message])
      const sha = String(run(['rev-parse', '--short', 'HEAD']).stdout ?? '').trim()
      settle()
      return sha
    },
  }
}

function writeProjectRecord({ record, folder, startHead, startBranch, tests = '' } = {}) {
  if (!record) return
  const git = projectRunGit({
    branch: gitRead(folder, ['branch', '--show-current']) ?? '',
    startBranch,
    commits: startHead ? gitRead(folder, ['log', '--oneline', `${startHead}..HEAD`]) ?? '' : '',
  })
  if (git.branch !== '') record.branch = git.branch
  record.commits = git.commits
  const head = gitRead(folder, ['rev-parse', 'HEAD']) ?? ''
  const testedDiffers = (tests === 'failed' || tests === 'passed') && gitRead(folder, ['status', '--porcelain']) !== ''
  if (head !== '' && !testedDiffers) record.head = head
  else if (testedDiffers) delete record.head
  if (tests === 'passed' || tests === 'failed' || tests === 'none') record.tests = tests
  if (appendRunRecord(record)) console.log(`record: ${printedRunsFolder(runsFile())}`)
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
      throw new Error(`Another start on ${printedRunsFolder(project)} stopped half way. Start it again.`)
    }
    if (message.includes('already running')) {
      throw new Error(`Another run is already going on ${printedRunsFolder(project)}; wait for it to end, or delete ${printedRunsFolder(path)} if no run is going.`)
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

export const DEFAULT_CLOSE_TIMEOUT_MS = 30000

export function isResultLine(line) {
  if (typeof line !== 'string' || !line.trim()) return false
  if (!line.includes('"result"')) return false
  try {
    const item = JSON.parse(line)
    if (item?.event === 'result') return true
    if (item?.type === 'result' && !item.parent_tool_use_id) return true
  } catch {}
  return false
}

export function laneSpawn({ command, minutes = DEFAULT_MINUTES, model = '', effort = '' } = {}) {
  if (command?.transport !== 'acp') return { file: command?.file, args: command?.args ?? [], input: false }
  return { ...acpRunCommand({ command, minutes, model, effort }), input: true }
}

export function printCommand(command, prompt, { mcpConfig = '', mcpServers = [] } = {}) {
  const printPath = (value) => (isAbsolute(value) || isWindowsPath(value) ? printedRunsFolder(value) : value)
  const shown = command.args.map((arg) => (arg === prompt ? `<prompt: ${prompt.length} characters>` : printPath(arg)))
  console.log(`file: ${printPath(command.file)}`)
  console.log(`args: ${JSON.stringify(shown)}`)
  if (!command.args.includes(prompt)) console.log(`prompt: <prompt: ${prompt.length} characters>`)
  console.log(`cwd: ${printPath(command.cwd)}`)
  if (mcpConfig && Array.isArray(mcpServers) && mcpServers.length > 0) {
    console.log(`mcp config: ${printedRunsFolder(mcpConfig)}`)
    console.log(`mcp servers: ${mcpServers.map((s) => s.name).join(', ')}`)
  }
}

function codexLaneProgram(lane, env = process.env) {
  const bin = lane?.cli?.bin
  if (lane?.cli?.harness !== 'codex' || (bin !== undefined && bin !== null && bin !== 'codex')) return { lane, program: null }
  if (programPath('codex', { env })) return { lane, program: null }
  const program = codexAppProgram({ env })
  return program ? { lane: { ...lane, cli: { ...lane.cli, bin: program } }, program } : { lane, program: null }
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

export const LANE_START_BRANCH = 'main'
const START_REF = 'refs/heads/main'

export function laneStartProblem({ worktree, branch, count, commits } = {}) {
  const ahead = Number.isInteger(count) && count > 0 ? count : 0
  if (ahead === 0) return ''
  const list = (Array.isArray(commits) ? commits : []).filter((commit) => String(commit ?? '').trim() !== '').join(', ')
  const where = typeof branch === 'string' && branch.trim() !== '' ? `the branch ${branch.trim()}` : 'a detached HEAD'
  const noun = ahead === 1 ? 'commit' : 'commits'
  const named = list ? ` (${list})` : ''
  return `The worktree ${worktree} is on ${where} with ${ahead} ${noun} that ${START_REF} does not have${named}, so merge it or move the worktree to ${START_REF} first.`
}

export function laneWorktreeStart({ worktree, move = false } = {}) {
  const folder = String(worktree ?? '').trim()
  if (!folder) throw new Error('The lane has no worktree to start from.')
  const branch = gitRead(folder, ['branch', '--show-current'])
  if (branch === null) throw new Error(`The branch of the worktree ${folder} could not be read.`)
  const counted = gitRead(folder, ['rev-list', '--count', `${START_REF}..HEAD`])
  const count = counted === null ? null : Number(counted)
  if (count === null || !Number.isInteger(count) || count < 0) {
    throw new Error(`The commits ahead of ${START_REF} in ${folder} could not be read.`)
  }
  let commits = []
  if (count > 0) {
    const listed = gitRead(folder, ['log', '--oneline', `${START_REF}..HEAD`])
    if (listed === null) throw new Error(`The commits ahead of ${START_REF} in ${folder} could not be read.`)
    commits = listed.split(/\r?\n/).filter(Boolean)
  }
  const problem = laneStartProblem({ worktree: folder, branch, count, commits })
  if (problem) throw new Error(problem)
  if (move) {
    const moved = spawnSync(gitPath(), ['checkout', '--detach', START_REF], { cwd: folder, encoding: 'utf8', windowsHide: true })
    if (moved.error) throw new Error(`git checkout did not run in ${folder}.`)
    if (moved.status !== 0) throw new Error(`The worktree ${folder} could not be moved to ${START_REF}: ${String(moved.stderr ?? '').trim()}`)
  }
  return { from: branch, startBranch: LANE_START_BRANCH, moved: branch !== '' }
}

export function laneRunRecord(input = {}) {
  const record = runRecord(input)
  const startBranch = typeof input?.startBranch === 'string' ? input.startBranch.trim() : ''
  if (startBranch !== '') record.startBranch = startBranch
  const note = typeof input?.note === 'string' ? input.note.trim() : ''
  if (note !== '') record.note = note
  return record
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

function findCodexRollout({ threadId, env, startedAt, now }) {
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
    for (const line of text.split(/\r?\n/)) {
      const reading = codexHarness.quotaFrom(line)
      if (reading) newest = reading
    }
    return newest
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
  if (!reading) return null
  return { windows: reading.windows, at: new Date(now).toISOString() }
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
    console.log(`No runs recorded yet. The runs folder is ${printedRunsFolder(runsFolder())}.`)
    console.log('Start one with npm run run-lane -- <lane> <brief>. See --help for every form.')
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
  formatOutcomes(outcomeTable(runs, readOutcomes(), readMainSubjectsSync())).forEach((line) => console.log(line))
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

function printProjectRefusals(problems, project) {
  const shown = printedRunsFolder(project)
  problems.forEach((sentence) => console.log(sentence.split(project).join(shown)))
}

async function runQueueProject({ options, lane, lanes }) {
  const givenTest = typeof options.test === 'string' ? options.test.trim() : ''
  if (givenTest !== '') {
    const problem = checkCommandProblem(givenTest)
    if (problem !== '') throw new Error(problem)
  }
  const project = projectFolder(options.project)
  if (!gitCheckout(project)) throw new Error(`The project folder ${printedRunsFolder(project)} is not a git folder. A queue needs one.`)
  const problems = projectRefusals(project, lanes, options.allowDirty === true && !options.queue)
  if (problems.length > 0) {
    printProjectRefusals(problems, project)
    return 1
  }
  let tasks
  if (options.queue) {
    const file = resolve(options.queue)
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      throw new Error(`The queue file ${file} could not be read.`)
    }
    tasks = parseQueue(text)
    if (tasks.length === 0) throw new Error('The queue file has no tasks.')
  } else {
    tasks = [readTask(options)]
  }
  const queueId = queueStamp()
  const branch = `machineroom/queue-${options.lane}-${queueId}`
  if (options.dryRun) {
    const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
    const test = testCommandFor(project, options.test)
    console.log(`lane: ${options.lane}`)
    console.log(`project: ${printedRunsFolder(project)}`)
    if (options.worktree) printWorktree(plan)
    console.log(`branch: ${branch}`)
    console.log(`tests: ${test || 'none, the project has no tests'}`)
    tasks.forEach((task, index) => console.log(`${index + 1}. ${task}`))
    console.log('Dry run, nothing started.')
    return 0
  }
  const folder = runsFolder()
  mkdirSync(folder, { recursive: true })
  const laneProblem = laneCommandProblem(lane)
  if (laneProblem !== '') throw new Error(laneProblem)
  const lockTarget = options.worktree ? worktreeFor(project, options.lane) || project : project
  refuseRunningLane(options.lane, options.worktree ? lockTarget : '', folder)
  const projectLock = takeProjectLock(folder, lockTarget)
  const startedAt = laneStartTime(options)
  let lock
  try {
    lock = takeRunLock(folder, options.lane, { worktree: lockTarget, projectRun: !options.worktree }, startedAt)
  } catch (error) {
    releaseLaneLock(projectLock)
    throw error
  }
  try {
    const plan = options.worktree ? worktreePlan(project, options.lane) : { path: project, made: false }
    const startBranch = options.worktree
      ? (gitRead(plan.path, ['branch', '--show-current']) || gitRead(project, ['branch', '--show-current']) || '')
      : (gitRead(project, ['branch', '--show-current']) || '')
    const startHead = gitRead(options.worktree && !plan.made ? plan.path : project, ['rev-parse', 'HEAD']) || ''
    let test = typeof options.test === 'string' && options.test.trim() !== '' ? options.test : ''
    const target = options.worktree ? prepareWorktree(project, options.lane) : plan
    const base = gitRead(target.path, ['rev-parse', 'HEAD']) || startHead
    let pending = null
    let testsFailed = false
    const queueStartedAt = Date.now()
    const finishPending = (status = '', stopped = false) => {
      if (!pending) return
      const item = pending
      pending = null
      const queueStatus = status || (testsFailed ? 'failed: tests' : '')
      if (queueStatus !== '') {
        item.record.queueStatus = queueStatus
        if (queueStatus === 'failed: tests') item.record.exitCode = 1
      }
      if (stopped || queueStatus !== '') {
        const number = Number.isInteger(item.record.queueIndex) ? item.record.queueIndex : 1
        item.record.queueRemaining = maskedQueueTasks(tasks.slice(number))
      }
      writeProjectRecord(item)
    }
    try {
      const result = await runQueue({
        tasks,
        git: queueGit(target.path, branch, options.lane, { onSettled: finishPending }),
        runTask: async (task, number) => {
          console.log(`task ${number} of ${tasks.length}`)
          const prompt = unattendedPrompt(task)
          const name = `${options.lane}-queue-${queueId}-${number}`
          const logPath = join(folder, `${name}.log`)
          const usageFile = join(folder, `${name}.usage.json`)
          const run = await startLane({
            options, lane, lanes, wanted: [], prompt, logPath, usageFile, name,
            project: target.path, task, queue: { branch, index: number, size: tasks.length }, lockPath: lock,
            projectBranch: startBranch, deferRecord: true, base,
          })
          pending = { record: run.record, folder: target.path, startHead: run.startHead ?? startHead, startBranch, tests: '' }
          if (run.code !== 0 || run.killed) finishPending(run.killed ? 'stopped' : 'failed', true)
          return { code: run.code, killed: run.killed }
        },
        runTests: async () => {
          const check = await projectCheck({ project: target.path, given: options.test, minutes: options.minutes })
          test = check.command
          testsFailed = !check.ok
          if (pending) pending.tests = check.command === '' ? 'none' : (check.ok ? 'passed' : 'failed')
          return { ok: check.ok }
        },
      })
      const usedBranch = gitRead(target.path, ['branch', '--show-current']) || result.branch
      formatQueueSummary({ branch: usedBranch, results: result.results, tests: test, worktree: options.worktree ? printedRunsFolder(target.path) : '' }).forEach((line) => console.log(line))
      return result.results.some((item) => item.status.startsWith('failed')) ? 1 : 0
    } catch (error) {
      if (pending) {
        finishPending('failed: the queue stopped')
      } else {
        const failedHead = gitRead(target.path, ['rev-parse', 'HEAD']) || base || ''
        const failedRecord = laneRunRecord({
          lane: options.lane,
          briefs: [],
          model: lane?.cli?.model || null,
          reasoning: lane?.reasoning ?? null,
          startedAt: queueStartedAt,
          minutes: 0,
          exitCode: 1,
          killed: false,
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
          peakTokens: null,
          log: null,
          branch,
          base,
          ...(failedHead ? { head: failedHead } : {}),
          queue: { branch, index: 1, size: tasks.length, remaining: tasks.slice(1) },
          project,
          task: tasks[0] || '',
          startedBy: options.startedBy || '',
          note: String(error?.message ?? error).slice(0, 200),
        })
        failedRecord.queueStatus = 'failed: the queue stopped'
        const session = options.startedBy ? null : sessionStartedBy(process.env)
        if (session) failedRecord.startedBy = session
        if (appendRunRecord(failedRecord)) console.log(`record: ${printedRunsFolder(runsFile())}`)
      }
      const back = startBranch
        ? gitRead(target.path, ['switch', startBranch])
        : (startHead ? gitRead(target.path, ['switch', '--detach', startHead]) : null)
      const where = back === null
        ? `The project stays on ${branch}, where the queue stopped.`
        : `The project is back on ${startBranch || startHead}; the queue branch ${branch} keeps what it made.`
      console.log(`queue: stopped. ${where}`)
      throw error
    } finally {
      finishPending()
    }
  } finally {
    releaseLaneLock(lock)
    releaseLaneLock(projectLock)
  }
}

const VALUE_FLAGS = new Set([
  '--project', '--task', '--task-file', '--since', '--minutes', '--started-by',
  '--started-at', '--model', '--reasoning', '--queue', '--test',
])

function helpRequested(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? '')
    if (VALUE_FLAGS.has(arg)) {
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') return true
  }
  return false
}

async function main() {
  const argv = process.argv.slice(2)
  if (helpRequested(argv)) {
    printHelp(console.log)
    return 0
  }
  const stop = stopArgument(argv)
  if (stop) return stopLane(stop, { startedAt: stopStartedAt(argv) })
  let options
  try {
    options = runOptions(argv)
  } catch (error) {
    if (!String(error?.message ?? error).startsWith('Name a lane to run')) throw error
    printHelp(console.error)
    return 1
  }
  if (options.list) return listRuns()
  if (options.stats) return statsRuns(options)
  if (options.outcomes) return outcomeRuns(options)
  const lanesPath = lanesFile()
  const lanesJson = JSON.parse(readFileSync(lanesPath, 'utf8'))
  const badKey = Object.keys(lanesJson ?? {}).find((key) => !/^[A-Za-z0-9_-]+$/.test(key))
  if (badKey !== undefined) throw new Error(`The lane name ${badKey} in ${lanesPath} needs only letters, digits, dashes and underscores, so it can name a worktree and a branch.`)
  const lanes = readAllLanes({ lanesJson, runsFolder: runsFolder() })
  for (const [key, item] of Object.entries(lanes)) {
    if (item?.custom !== true) continue
    const template = Object.values(lanes).find((other) => other !== item && other?.cli?.harness === item?.cli?.harness)
    if (typeof item.worktree !== 'string' || item.worktree.trim() === '') {
      item.worktree = worktreeFor(mainCheckout(), key)
    }
    if (!Array.isArray(item.forbidden)) {
      item.forbidden = Array.isArray(template?.forbidden) ? [...template.forbidden] : []
    }
    if (typeof item.role !== 'string') {
      item.role = typeof template?.role === 'string' ? template.role : ''
    }
  }
  if (!Object.hasOwn(lanes, options.lane)) throw new Error(missingLaneText(options.lane, lanesJson, lanesPath))
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
  const backupProblem = fallbackProblem({ laneKey: options.lane, fallback: lane.fallback, lanes })
  if (backupProblem !== '') {
    console.log(backupProblem)
    return 1
  }
  if (options.queue) return await runQueueProject({ options, lane, lanes })
  if (options.project && options.worktree) {
    return await runQueueProject({ options, lane, lanes })
  }

  if (options.project) {
    const project = projectFolder(options.project)
    const problems = projectRefusals(project, lanes, options.allowDirty === true)
    if (problems.length > 0) {
      printProjectRefusals(problems, project)
      return 1
    }
    const task = readTask(options)
    const prompt = unattendedPrompt(task)
    const name = `${options.lane}-project-${stamp()}`
    const folder = runsFolder()
    const logPath = join(folder, `${name}.log`)
    const usageFile = join(folder, `${name}.usage.json`)

    if (options.dryRun) {
      const enabledServers = enabledMcpServers(folder)
      const harness = lane.cli?.harness
      const needsMcp = enabledServers.length > 0 && (harness === 'claude' || harness === 'opencode')
      const mcpConfigPath = needsMcp ? join(folder, `${name}.mcp.json`) : ''
      const command = commandFor({ lane, prompt, env: process.env, usageFile, title: name, cwd: project, mcpConfig: mcpConfigPath })
      const test = testCommandFor(project, options.test)
      printCommand(command, prompt, { mcpConfig: mcpConfigPath, mcpServers: enabledServers })
      console.log(`tests: ${test || 'none, the project has no tests'}`)
      console.log('Dry run, nothing started.')
      return 0
    }

    mkdirSync(folder, { recursive: true })
    refuseRunningLane(options.lane, '', folder)
    const projectLock = takeProjectLock(folder, project)
    const startedAt = laneStartTime(options)
    let lock
    try {
      lock = takeRunLock(folder, options.lane, { worktree: project, projectRun: true }, startedAt, basename(logPath))
    } catch (error) {
      releaseLaneLock(projectLock)
      throw error
    }
    try {
      const run = await startLane({ options, lane, lanes, wanted: [], prompt, logPath, usageFile, name, project, task, lockPath: lock, deferRecord: true, startedAt })
      let code = run.code
      let tests = ''
      if (run.code === 0 && run.killed !== true) {
        const check = await projectCheck({ project, given: options.test, minutes: options.minutes })
        tests = check.command === '' ? 'none' : (check.ok ? 'passed' : 'failed')
        console.log(`tests: ${check.command || 'none, the project has no tests'}`)
        if (!check.ok) {
          run.record.exitCode = 1
          code = 1
        }
      }
      writeProjectRecord({ record: run.record, folder: project, startHead: run.startHead, startBranch: run.startBranch, tests })
      return code
    } finally {
      releaseLaneLock(lock)
      releaseLaneLock(projectLock)
    }
  }

  if (!Object.hasOwn(lanes, options.lane)) {
    console.log(`The lane ${options.lane} is not in lanes.json.`)
    return 1
  }

  const folderCheck = folderCheckFor(lanes)
  const folderProblems = briefWorktreeProblems({
    worktree: typeof lane.worktree === 'string' && lane.worktree.trim() !== '' ? realPath(lane.worktree) : '',
    laneKey: options.lane,
    ...folderCheck,
  })
  if (folderProblems.length > 0) {
    folderProblems.forEach((sentence) => console.log(sentence))
    return 1
  }
  options.folderCheck = folderCheck

  const briefs = parseBriefs(read('TASKS.md'))
  const problems = briefProblems({
    briefs,
    ids: options.briefs,
    laneKey: options.lane,
    forbidden: lane.forbidden,
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
  const agentDepth = readAgentDepth(runsFolder()).limit
  const promptFor = (laneKey, branchSuffix = '') => unattendedPrompt(buildPrompt({ briefs: wanted, laneKey, lanes, rules, version, agentDepth, branchSuffix }))
  const prompt = promptFor(options.lane)
  const name = `${options.lane}-${wanted.map((brief) => brief.id).join('-')}-${stamp()}`
  const folder = runsFolder()
  const logPath = join(folder, `${name}.log`)
  const usageFile = join(folder, `${name}.usage.json`)

  if (options.dryRun) {
    const start = gitCheckout(lane.worktree) ? laneWorktreeStart({ worktree: lane.worktree }) : null
    const enabledServers = enabledMcpServers(folder)
    const harness = lane.cli?.harness
    const needsMcp = enabledServers.length > 0 && (harness === 'claude' || harness === 'opencode')
    const mcpConfigPath = needsMcp ? join(folder, `${name}.mcp.json`) : ''
    const codex = codexLaneProgram(lane)
    const command = commandFor({ lane: codex.lane, prompt, env: process.env, usageFile, title: name, mcpConfig: mcpConfigPath })
    printCommand(command, prompt, { mcpConfig: mcpConfigPath, mcpServers: enabledServers })
    if (start) {
      const from = start.from && start.from !== start.startBranch ? ` (the worktree was on ${start.from})` : ''
      console.log(`start branch: ${start.startBranch}${from}`)
    }
    console.log('Dry run, nothing started.')
    return 0
  }

  mkdirSync(folder, { recursive: true })
  refuseRunningLane(options.lane, lane.worktree, folder)
  const startedAt = laneStartTime(options)
  const lock = takeRunLock(folder, options.lane, { worktree: lane.worktree }, startedAt, basename(logPath))
  try {
    const run = await startLane({ options, lane, lanes, wanted, prompt, promptFor, logPath, usageFile, name, lockPath: lock, startedAt })
    return run.code
  } finally {
    releaseLaneLock(lock)
  }
}

function recordRoom(record, toolLines, lanes) {
  try {
    const written = writeRecording({ record, lanes, root, env: process.env, session: toolLines.session })
    console.log(`room: /?recording=${written.name}`)
    if (written.indexError) console.log(`index: not updated (${written.indexError})`)
  } catch (error) {
    console.log(`room: not recorded (${String(error?.message ?? error)})`)
  }
}

async function startFailover({ laneKey, target, lanes, options, wanted, prompt, promptFor = null, folder, project, task, queue = null, base = '', deferRecord, openLog, failedRecord, failedStartBranch, onStart = null }) {
  const fallbackLane = lanes?.[target]
  if (!fallbackLane) return null
  if (!project) {
    const worktree = typeof fallbackLane.worktree === 'string' && fallbackLane.worktree.trim() !== '' ? realPath(fallbackLane.worktree) : ''
    const problems = briefWorktreeProblems({ worktree, laneKey: target, ...(options?.folderCheck ?? folderCheckFor(lanes)) })
    if (problems.length > 0) {
      problems.forEach((sentence) => console.log(sentence))
      return null
    }
  }
  const startedAt = Date.now()
  const fallbackName = project
    ? `${target}-project-${stamp()}`
    : `${target}-${wanted.map((brief) => brief.id).join('-')}-${stamp()}`
  let lock
  try {
    refuseRunningLane(target, project ? '' : fallbackLane.worktree, folder)
    lock = takeRunLock(folder, target, project ? { worktree: project, projectRun: true } : { worktree: fallbackLane.worktree }, startedAt, `${fallbackName}.log`)
  } catch {
    console.log(`The backup lane ${target} is busy, so the run stays failed.`)
    return null
  }
  let branchBefore = ''
  try {
    if (project) {
      branchBefore = String(failedRecord?.branch || failedStartBranch || '').trim()
      if (branchBefore === '') {
        console.log(`The backup lane ${target} has no branch to start from, so the run stays failed.`)
        return null
      }
      const branch = `${branchBefore}-on-${target}`
      if (gitRead(project, ['switch', '-c', branch]) === null) {
        console.log(`The backup lane ${target} could not take the branch ${branch}, so the run stays failed.`)
        return null
      }
    }
    return await startLane({
      options: { ...options, lane: target, failedOver: true },
      lane: fallbackLane,
      lanes,
      wanted,
      prompt: !project && typeof promptFor === 'function' ? promptFor(target, `-on-${target}`) : prompt,
      logPath: join(folder, `${fallbackName}.log`),
      usageFile: join(folder, `${fallbackName}.usage.json`),
      name: fallbackName,
      project,
      task,
      queue,
      lockPath: lock,
      projectBranch: project ? branchBefore : null,
      deferRecord,
      base,
      branchSuffix: `-on-${target}`,
      failoverFrom: { lane: laneKey, startedAt: failedRecord?.startedAt },
      openLog,
      startedAt,
      onStart,
    })
  } finally {
    releaseLaneLock(lock)
  }
}

export async function startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name, project = '', task = '', queue = null, lockPath = '', projectBranch = null, deferRecord = false, base = '', openLog = createWriteStream, branchSuffix = '', failoverFrom = null, promptFor = null, startedAt: givenStartedAt = null, onStart = null }) {
  if (options?.failedOver !== true) {
    const problem = fallbackProblem({ laneKey: options?.lane, fallback: lane?.fallback, lanes })
    if (problem !== '') throw new Error(problem)
  }
  let start = null
  if (!project) {
    const status = gitStatus(lane.worktree)
    if (status.trim() !== '') throw new Error(`The worktree ${lane.worktree} is not clean. Commit or discard its changes first.`)
    start = laneWorktreeStart({ worktree: lane.worktree, move: true })
  }
  const baseFolder = project || lane.worktree
  const runBase = typeof base === 'string' && base.trim() !== ''
    ? base.trim()
    : (baseFolder ? gitRead(baseFolder, ['rev-parse', 'HEAD']) || '' : '')

  const folder = runsFolder()
  const enabledServers = enabledMcpServers(folder)
  const harness = lane.cli?.harness
  const needsMcp = enabledServers.length > 0 && (harness === 'claude' || harness === 'opencode')
  const mcpConfigPath = needsMcp ? join(folder, `${name}.mcp.json`) : ''
  if (needsMcp) {
    const config = harness === 'claude' ? mcpConfigForClaude(enabledServers) : mcpConfigForOpencode(enabledServers)
    writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  }

  try {
    const sessionId = randomUUID()
    const codex = codexLaneProgram(lane)
    const command = commandFor({
      lane: codex.lane,
      prompt,
      env: process.env,
      usageFile,
      title: name,
      sessionId,
      mcpConfig: mcpConfigPath,
      ...(project ? { cwd: project } : {}),
    })
    const startedBy = options.startedBy ? null : sessionStartedBy(process.env)
    const meta = { lane: options.lane, sessionId, ...(runBase ? { base: runBase } : {}) }
    if (project) meta.project = project
    if (queue) {
      meta.queue = queue.branch
      meta.index = queue.index
    }
    if (startedBy) meta.startedBy = startedBy
    writeFileSync(join(dirname(logPath), `${name}.meta.json`), `${JSON.stringify(meta)}\n`)
    const log = openLog(logPath)
    let logBroken = false
    const logClosed = new Promise((done) => finished(log, () => done()))
    const onLogError = (error) => {
      if (logBroken) return
      logBroken = true
      console.log(`The lane log ${printedRunsFolder(logPath)} could not be written (${errorCode(error)}); the run goes on and its record is still saved.`)
      try {
        log.destroy()
      } catch {}
    }
    log.on('error', onLogError)
    const laneLog = createLaneLog({
      write: (text) => {
        if (logBroken) return
        try {
          log.write(text)
        } catch (error) {
          onLogError(error)
        }
      },
      runId: name,
    })
    const startedAt = Number.isFinite(Number(givenStartedAt)) && Number(givenStartedAt) > 0 ? Number(givenStartedAt) : Date.now()
    const projectStart = project
      ? {
          branch: typeof projectBranch === 'string' ? projectBranch : gitRead(project, ['branch', '--show-current']) ?? '',
          head: gitRead(project, ['rev-parse', 'HEAD']) ?? '',
        }
      : null
    // OpenCode takes its folder from PWD, which a shell started elsewhere leaves pointing at that shell's folder.
    const spawnSpec = laneSpawn({ command, minutes: options.minutes, model: lane.cli.model, effort: lane.reasoning })
    const runnerNames = ['MACHINEROOM_RUNS', 'MACHINEROOM_LANES_FILE']
      .filter((name) => typeof process.env[name] === 'string' && process.env[name] !== '')
    const runsDir = options?.runs || (logPath ? dirname(logPath) : runsFolder())
    const endpoints = readEndpoints(runsDir)
    const extra = { ...command.env }
    if (lane.cli.harness === 'machineroom' && Number.isFinite(Number(options?.minutes))) {
      extra.MR_AGENT_MINUTES = String(options.minutes)
    }
    const childEnv = childEnvironment(process.env, command.cwd, {
      harness: lane.cli.harness,
      names: runnerNames,
      extra,
      model: lane.cli.model,
      endpoints,
    })
    const child = spawn(spawnSpec.file, spawnSpec.args, { cwd: command.cwd, env: childEnv, stdio: spawnSpec.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], windowsHide: true })
    if (typeof onStart === 'function') onStart()
    const lockStart = queue && lockPath ? laneLockStartedAt(lockText(lockPath)) || startedAt : startedAt
    if (lockPath) writeLaneChild(lockPath, child.pid)
    if (lockPath) writeLockStart(lockPath, lockStart, basename(logPath))
    if (spawnSpec.input && child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    }
    const closeTimeoutMs = Number.isFinite(Number(options?.closeTimeoutMs ?? process.env.MACHINEROOM_CLOSE_TIMEOUT_MS))
      ? Number(options?.closeTimeoutMs ?? process.env.MACHINEROOM_CLOSE_TIMEOUT_MS)
      : DEFAULT_CLOSE_TIMEOUT_MS

    let resultSeen = false
    let lineBuffer = ''
    let closeTimer = null
    let harnessExited = false
    let harnessExitCode = null
    let leftoversCleaned = false
    let extraStopped = 0
    let settled = false
    let finish

    const armCloseTimer = () => {
      if (settled) return
      if (closeTimer !== null) clearTimeout(closeTimer)
      closeTimer = setTimeout(onCloseTimeout, closeTimeoutMs)
    }

    const checkLine = (line) => {
      if (resultSeen) return
      if (isResultLine(line)) {
        resultSeen = true
        armCloseTimer()
      }
    }

    const onChunk = (text) => {
      if (resultSeen) return
      lineBuffer += text
      let index
      while ((index = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, index).trim()
        lineBuffer = lineBuffer.slice(index + 1)
        checkLine(line)
        if (resultSeen) break
      }
    }

    const onCloseTimeout = () => {
      if (settled) return
      leftoversCleaned = true
      if (stopNote === '') stopNote = 'leftovers were stopped'
      let stopped = 0
      const folder = project ? (options.worktree ? project : '') : lane.worktree
      const processes = child.pid || folder ? listProcesses() : []
      const descendants = harnessDescendants(child.pid, { processes })
      let killedParent = false
      if (child.pid && (child.exitCode === null && child.signalCode === null)) {
        killedParent = true
        killTree(child)
      }
      const descendantsResult = stopDescendants(descendants, { processes: killedParent ? null : processes })
      stopped += descendantsResult.stopped
      // The worktree's name finds a harness child whose parent chain is already gone, such as an orphaned server.
      stopped += stopLeftovers({ worktree: folder, childPid: child.pid ?? 0, processes: descendantsResult.processes }).stopped
      extraStopped += stopped
      try {
        child.stdout?.destroy()
      } catch {}
      try {
        child.stderr?.destroy()
      } catch {}
      if (child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.destroy()
        } catch {}
      }
      const exitCode = harnessExitCode !== null ? harnessExitCode : (child.exitCode ?? 0)
      finish?.({ code: exitCode, leftoversStopped: true })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (text) => {
      laneLog.push('stdout', text)
      onChunk(text)
    })
    child.stderr?.on('data', (text) => laneLog.push('stderr', text))

    let killed = false
    let stopNote = ''
    const stopChild = (note) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
      killed = true
      if (stopNote === '') stopNote = note
      const descendants = harnessDescendants(child.pid)
      killTree(child)
      stopDescendants(descendants)
    }
    const onInt = () => stopChild('stopped by SIGINT')
    const onTerm = () => stopChild('stopped by SIGTERM')
    const onHup = () => stopChild('stopped by SIGHUP')
    const onExit = () => {
      if (child.exitCode === null && child.signalCode === null) killTree(child)
    }
    process.on('SIGINT', onInt)
    process.on('SIGTERM', onTerm)
    process.on('SIGHUP', onHup)
    process.on('exit', onExit)
    const timer = setTimeout(() => {
      stopChild('killed after the time limit')
    }, options.minutes * 60 * 1000)

    const result = await new Promise((done) => {
      finish = (value) => {
        if (settled) return
        settled = true
        if (closeTimer !== null) {
          clearTimeout(closeTimer)
          closeTimer = null
        }
        done(value)
      }

      child.on('error', (error) => finish({ code: null, error }))

      child.once('exit', (code) => {
        harnessExited = true
        harnessExitCode = code ?? 0
        if (!resultSeen && isResultLine(lineBuffer.trim())) {
          resultSeen = true
        }
        armCloseTimer()
      })

      child.on('close', (code) => {
        finish({ code: harnessExitCode !== null ? harnessExitCode : code })
      })
    })
    clearTimeout(timer)
    if (closeTimer !== null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGHUP', onHup)
    process.removeListener('exit', onExit)
    const stoppedLeftovers = stopLeftovers({ worktree: project ? (options.worktree ? project : '') : lane.worktree, childPid: child.pid ?? 0 }).stopped
    const totalStoppedLeftovers = stoppedLeftovers + extraStopped
    let commit = { ok: true, committed: false, leftOut: [], error: '' }
    if (!project && !killed && result.code === 0 && lane.cli?.commits === 'runner' && wanted.length > 0) {
      try {
        commit = runnerCommit({ laneKey: options.lane, worktree: lane.worktree, briefs: wanted, branchSuffix })
      } catch (error) {
        commit = { ok: false, committed: false, leftOut: [], error: String(error?.message ?? error) }
      }
    }
    const notes = []
    if (leftoversCleaned) notes.push('leftovers were stopped')
    if (commit.leftOut.length > 0) {
      for (const path of commit.leftOut) laneLog.push('stderr', `Left out of the commit: ${path}\n`)
      notes.push(commit.leftOut.map((path) => `Left out of the commit: ${path}`).join('; '))
    }
    if (!commit.ok) {
      const text = `The runner could not commit the ${options.lane} lane's work: ${commit.error}`
      laneLog.push('stderr', `${text}\n`)
      notes.push(text)
    }
    const note = notes.join('; ')
    laneLog.flush()
    if (!logBroken) log.end()
    await logClosed
    const minutes = Math.round(((Date.now() - startedAt) / 60000) * 10) / 10

    if (result.error) console.log(`start failed: ${result.error.message}`)
    if (start) {
      const from = start.from && start.from !== start.startBranch ? ` (the worktree was on ${start.from})` : ''
      console.log(`start branch: ${start.startBranch}${from}`)
    }
    console.log(`exit code: ${result.code === null ? 'none' : result.code}${stopNote ? ` (${stopNote})` : ''}`)
    console.log(`minutes: ${minutes}`)
    console.log(`log: ${printedRunsFolder(logPath)}`)
    const report = harness === 'hermes' ? readUsage(usageFile) : null
    let toolLines = { count: 0, session: '' }
    if (harness === 'hermes') {
      printUsage(usageFile)
      toolLines = captureToolLines(command.file, report?.session_id, logPath)
      console.log(`tool lines: ${toolLines.count}`)
    }

    const worktree = project || lane.worktree
    const logText = readLog(logPath)
    const quota = quotaForRun({ harness, log: logText, env: process.env, startedAt, now: Date.now() })
    const summary = summarizeRun({ harness, log: logText, worktree })
    const limited = limitedFor(harness, logText)
    formatSummary(summary).forEach((line) => console.log(line))

    const git = project
      ? projectRunGit({
          branch: gitRead(project, ['branch', '--show-current']) ?? '',
          startBranch: projectStart.branch,
          commits: projectStart.head ? gitRead(project, ['log', '--oneline', `${projectStart.head}..HEAD`]) ?? '' : '',
        })
      : {
          branch: gitRead(lane.worktree, ['branch', '--show-current']) ?? '',
          commits: (gitRead(lane.worktree, ['log', '--oneline', 'refs/heads/main..HEAD']) ?? '').split(/\r?\n/).filter(Boolean),
        }

    const startFailed = (Boolean(result.error) || result.code !== 0) && summary.toolCalls === 0 && minutes < 1
    const startFailure = startFailed
      ? (result.error ? `The harness did not start (${errorCode(result.error)}).` : startFailureText({ harness, log: logText }))
      : ''
    if (startFailure !== '' && !result.error) console.log(`start failed: ${startFailure}`)
    const retryProblem = retryStartProblem({
      exitCode: result.code,
      minutes,
      toolCalls: summary.toolCalls,
      commits: git.commits,
      log: logText,
    })
    if (retryProblem === '' && options?.retried !== true) {
      console.log('retrying this run once, because it made no tool call, no commit and printed the readiness sentence')
      const retryRecord = laneRunRecord({
        lane: options.lane,
        briefs: project ? [] : wanted.map((brief) => brief.id),
        model: lane.cli.model,
        reasoning: lane.reasoning ?? null,
        startedAt,
        minutes,
        exitCode: result.code,
        killed,
        costUsd: summary.costUsd ?? totalCost(report),
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        peakTokens: summary.peakTokens,
        log: logPath,
        branch: git.branch,
        commits: git.commits,
        base: runBase,
        quota,
        retried: true,
        startFailed: startFailure !== '' ? true : undefined,
        ...(start ? { startBranch: start.startBranch } : {}),
        ...(options.startedBy ? { startedBy: options.startedBy } : {}),
        ...(project ? { project, task, head: gitRead(project, ['rev-parse', 'HEAD']) || undefined } : {}),
        ...(queue ? { queue } : {}),
        ...(failoverFrom ? { failoverFrom } : {}),
      })
      if (startedBy) retryRecord.startedBy = startedBy
      if (appendRunRecord(retryRecord)) console.log(`record: ${printedRunsFolder(runsFile())}`)
      const retryName = `${name}-retry`
      return await startLane({
        options: { ...options, retried: true },
        lane, lanes, wanted, prompt,
        logPath: join(dirname(logPath), `${retryName}.log`),
        usageFile: join(dirname(usageFile), `${retryName}.usage.json`),
        name: retryName, project, task, queue, lockPath, projectBranch, deferRecord, base: runBase, openLog, branchSuffix, failoverFrom, promptFor, onStart,
      })
    }
    const record = laneRunRecord({
      lane: options.lane,
      briefs: project ? [] : wanted.map((brief) => brief.id),
      model: lane.cli.model,
      reasoning: lane.reasoning ?? null,
      startedAt,
      minutes,
      exitCode: result.code,
      killed,
      costUsd: summary.costUsd ?? totalCost(report),
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      peakTokens: summary.peakTokens,
      log: logPath,
      branch: git.branch,
      commits: git.commits,
      base: runBase,
      quota,
      stoppedLeftovers: totalStoppedLeftovers > 0 ? totalStoppedLeftovers : undefined,
      note: note || undefined,
      startFailed: startFailure !== '' ? true : undefined,
      ...(start ? { startBranch: start.startBranch } : {}),
      ...(options.startedBy ? { startedBy: options.startedBy } : {}),
      ...(project ? { project, task, ...(!deferRecord ? { head: gitRead(project, ['rev-parse', 'HEAD']) || undefined } : {}) } : {}),
      ...(queue ? { queue } : {}),
      ...(failoverFrom ? { failoverFrom } : {}),
    })
    if (startedBy) record.startedBy = startedBy
    const kind = failoverKind({ exitCode: result.code, limited, startFailed: startFailure !== '', killed })
    const target = kind !== '' && typeof lane.fallback === 'string' ? lane.fallback.trim() : ''
    if (target !== '' && options?.failedOver !== true) {
      const deferredProject = Boolean(project && deferRecord)
      const failedHead = deferredProject ? gitRead(project, ['rev-parse', 'HEAD']) || '' : ''
      const failedGit = deferredProject
        ? projectRunGit({
            branch: gitRead(project, ['branch', '--show-current']) ?? '',
            startBranch: projectStart.branch,
            commits: projectStart.head ? gitRead(project, ['log', '--oneline', `${projectStart.head}..HEAD`]) ?? '' : '',
          })
        : null
      if (failedGit) {
        if (failedGit.branch !== '') record.branch = failedGit.branch
        record.commits = failedGit.commits
      }
      record.failover = { kind, to: target, refused: true }
      let recordWritten = false
      const writeFailedRecord = () => {
        if (recordWritten) return
        recordWritten = true
        if (appendRunRecord(record)) console.log(`record: ${printedRunsFolder(runsFile())}`)
        if (!project) recordRoom(record, toolLines, lanes)
      }
      console.log(`moving the run to ${target} because ${kind}`)
      let fallbackRun = null
      try {
        fallbackRun = await startFailover({
          laneKey: options.lane,
          target,
          lanes,
          options,
          wanted,
          prompt,
          promptFor,
          folder,
          project,
          task,
          queue,
          base: runBase,
          deferRecord,
          openLog,
          failedRecord: record,
          failedStartBranch: projectStart?.branch ?? '',
          onStart: () => {
            record.failover = { kind, to: target }
            if (!deferredProject) writeFailedRecord()
          },
        })
      } catch (error) {
        if (!deferredProject) {
          writeFailedRecord()
          throw error
        }
        console.log(`The backup lane ${target} could not start (${errorCode(error)}), so the run stays failed.`)
        return { code: result.code ?? 1, killed, record, startHead: projectStart.head, startBranch: projectStart.branch }
      }
      if (fallbackRun) {
        if (deferredProject) {
          if (failedHead !== '') record.head = failedHead
          writeFailedRecord()
        }
        return fallbackRun
      }
      if (deferredProject) return { code: result.code ?? 1, killed, record, startHead: projectStart.head, startBranch: projectStart.branch }
      writeFailedRecord()
      return { code: result.code ?? 1, killed }
    }
    if (project && deferRecord) {
      return { code: result.code ?? 1, killed, record, startHead: projectStart.head, startBranch: projectStart.branch }
    }
    if (appendRunRecord(record)) console.log(`record: ${printedRunsFolder(runsFile())}`)
    if (project) return { code: result.code ?? 1, killed }
    recordRoom(record, toolLines, lanes)
    return { code: result.code ?? 1, killed }
  } finally {
    if (mcpConfigPath) {
      try {
        rmSync(mcpConfigPath, { force: true })
      } catch {}
    }
  }
}

const sameFile = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && sameFile(resolve(process.argv[1]), resolve(entry))) {
  main().then((code) => {
    process.exitCode = code || (recordFailed ? 1 : 0)
  }).catch((error) => {
    const folder = runsFolder()
    console.error(String(error?.message ?? error).split(folder).join(printedRunsFolder(folder)))
    process.exitCode = 1
  })
}
