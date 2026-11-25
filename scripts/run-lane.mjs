#!/usr/bin/env node
import '../server/quiet-agy.js'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, constants, copyFileSync, createWriteStream, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, uptime } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { finished } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { branchFor, briefFileList, buildPrompt, nextVersion, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { commitAuthorFor, formatQueueSummary, parseQueue, parseQueueArgs, runQueue } from '../src/briefs/queue.js'
import { maskKeys } from '../src/briefs/audit.js'
import { briefProblems, briefWorktreeProblems, checkCommandLines, checkCommandProblem, childEnvironment, commandFor, continueFromProblem, createLaneLog, DEFAULT_MINUTES, fallbackProblem, failoverKind, filterRunsSince, formatOutcomes, formatStats, formatSummary, interruptSenderFrom, laneCommandProblem, laneLockLog, laneLockStartedAt, laneLockText, laneModeProblem, laneStats, laneStopProblem, laneWithOverrides, limitedFor, maskProfilePaths, maskedQueueTasks, ORCHESTRATOR_LANE_PROBLEM, parseRunArgs, projectProblems, projectRunGit, retryStartProblem, runListLine, runRecord, sessionToolLines, splitCheckCommand, startFailureText, summarizeRun, unattendedPrompt, worktreeFor, WORKTREES_FOLDER } from '../src/briefs/run.js'
import { outcomeTable } from '../server/outcomes.js'
import { claudeProjectSlug } from '../server/claude-sessions.js'
import { hermesHome } from '../server/hermes-sessions.js'
import { codexThreadId, findCodexRollout, quotaForRun, readCodexQuota } from '../server/codex-rollout.js'
export { quotaForRun, readCodexQuota } from '../server/codex-rollout.js'
import { readMainSubjectsSync } from '../server/runs.js'
import { isLockHolderStale, killTree, descendantProcesses, leftoverProcesses, listProcesses, sampleProcesses } from '../server/processTree.js'
import { codexProgramFor } from '../server/agents-config.js'
import { HARNESS_OFF_PROBLEM, readHarnessSettings, worktreeCopiesProblem, worktreeSetupOf } from '../server/harness-settings.js'
import { defaultMode, legacyMode } from '../src/control/modes.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { gitPath } from '../server/programPath.js'
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

export function appendRunRecord(record, { env = process.env, print = console.log, file, write = appendFileSync, bestEffort = false } = {}) {
  const targetFile = file || runsFile(env)
  const folder = dirname(targetFile)
  try {
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true })
      print(`The runs folder was gone; made it again at ${printedRunsFolder(folder, env)}.`)
    }
    let lock
    if (bestEffort) {
      lock = join(folder, '.runs-append.lock')
      writeFileSync(lock, laneLockText({ pid: process.pid }), { flag: 'wx' })
    } else {
      const deadline = Date.now() + 10000
      while (!lock) {
        try { lock = takeLaneLock(folder, '.runs-append') } catch (error) {
          if (Date.now() >= deadline) throw error
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
        }
      }
    }
    try {
      if (record?.stopReason === 'lost' && findRunRecordByName(readRecords(targetFile), runNameOfRecord(record))) return true
      const line = typeof record === 'string' ? record : JSON.stringify(record)
      let prefix = ''
      if (existsSync(targetFile)) {
        const fd = openSync(targetFile, 'r')
        try {
          const size = fstatSync(fd).size
          const last = Buffer.alloc(1)
          if (size && readSync(fd, last, 0, 1, size - 1) && last[0] !== 10) prefix = '\n'
        } finally { closeSync(fd) }
      }
      write(targetFile, `${prefix}${line.endsWith('\n') ? line : `${line}\n`}`)
    } finally { releaseLaneLock(lock) }
    return true
  } catch (error) {
    if (bestEffort) return false
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

function helpLines() {
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
    '  --mode <mode>        use this permission mode for this run only',
    '  --reasoning <level>  use this reasoning level for this run only',
    '  --minutes <n>        stop the run after n minutes (100 by default)',
    '  --test <command>     run this check after each task; repeat for more, or npm test when the package has one',
    '  --started-by <id>    name the orchestrator that started the run',
    '  --allowed-lanes <keys> keep a failover inside these lane keys, separated by commas',
    '  --continue-from <name> continue an interrupted run on its branch and worktree',
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

function killProcess({ pid }) {
  try {
    return process.kill(pid, 'SIGKILL')
  } catch {
    return false
  }
}

function spareAncestorPid(env = process.env, fallback = process.ppid) {
  const raw = typeof env?.MACHINEROOM_BRIDGE_PID === 'string' ? env.MACHINEROOM_BRIDGE_PID.trim() : ''
  if (/^\d+$/.test(raw)) {
    const pid = Number(raw)
    if (Number.isSafeInteger(pid) && pid > 1) return pid
  }
  return fallback
}

export function stopLeftovers({ worktree, worktrees = [], namedAfter = null, childPid = 0, childCreated, recorded = new Map(), label = 'leftover', excludePids = [], platform = process.platform, list = listProcesses, kill = killProcess, alive = processAlive, processes = null, current = null, snapshotOnly = false } = {}) {
  if (!worktree && !worktrees.some(Boolean) && !(childPid > 0) && recorded.size === 0) return { found: 0, stopped: 0, failed: 0 }
  const snapshot = processes ?? (snapshotOnly ? [] : list())
  if (snapshot.length === 0) {
    if (snapshotOnly) console.log(`${label}: no process snapshot, so nothing was stopped by worktree`)
    const failed = [...recorded.keys()].filter((pid) => alive(pid)).length
    if (failed > 0) console.log(`${label}: could not verify ${failed} recorded ${failed === 1 ? 'process' : 'processes'}`)
    return { found: 0, stopped: 0, failed }
  }
  const found = leftoverProcesses(snapshot, { childPid, childCreated, recorded, worktree, worktrees, namedAfter, ownPid: process.pid, excludePids, spareAncestor: spareAncestorPid(), platform })
  if (found.length === 0) return { found: 0, stopped: 0, failed: 0 }
  const currentByPid = snapshotOnly ? new Map((Array.isArray(current) ? current : list()).map((row) => [row.pid, row])) : null
  let stopped = 0
  let failed = 0
  for (const item of found) {
    if (currentByPid) {
      const now = currentByPid.get(item.pid)
      if (!now) {
        if (alive(item.pid)) {
          console.log(`${label}: could not verify ${item.pid}`)
          failed += 1
          continue
        }
        console.log(`${label}: ${item.pid} had already ended`)
        continue
      }
      if (typeof item.created === 'number' && Number.isFinite(item.created) && now.created !== item.created) {
        console.log(`stale: ${item.pid} was not this run`)
        continue
      }
    }
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

function laneProcessState(path, lock = lockText(path)) {
  try {
    const saved = JSON.parse(readFileSync(`${path}.processes`, 'utf8'))
    if (!lock || saved.log === laneLockLog(lock)) {
      const recorded = new Map(saved.recorded.filter(([pid, created]) => Number.isInteger(pid) && pid > 0 && Number.isFinite(created)))
      return { worktree: typeof saved.worktree === 'string' ? saved.worktree : '', recorded }
    }
  } catch {}
  return { worktree: '', recorded: new Map() }
}

function saveLaneProcessState(path, log, worktree, recorded, lock = lockText(path)) {
  if (!path || laneLockLog(lock) !== log) return
  const target = `${path}.processes`
  const pending = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(pending, JSON.stringify({ log, worktree, recorded: [...recorded] }))
    if (lockText(path) === lock) renameSync(pending, target)
  } catch {} finally {
    try {
      rmSync(pending, { force: true })
    } catch {}
  }
}

function configuredLaneWorktree(laneKey, folder) {
  const lanes = readAllLanes({ lanesJson: Object.fromEntries(lanesInFile()), runsFolder: folder })
  if (laneKey === 'orchestrator' || !Object.hasOwn(lanes, laneKey)) return ''
  const lane = lanes[laneKey]
  const worktree = lane?.worktree || (lane?.custom === true ? worktreeFor(mainCheckout(), laneKey) : '')
  if (!worktree || briefWorktreeProblems({ worktree: realPath(worktree), laneKey, ...folderCheckFor(lanes) }).length > 0) return ''
  return worktree
}

function harnessDescendants(childPid, { excludePids = [], processes = null } = {}) {
  if (!Number.isInteger(childPid) || childPid <= 0) return []
  return descendantProcesses(processes ?? listProcesses(), { rootPid: childPid, ownPid: process.pid, excludePids })
    .map((item) => ({ ...item }))
}

function descendantState(item, currentByPid) {
  if (currentByPid.size === 0) return 'unknown'
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
    if (state === 'unknown') {
      if (alive(item.pid)) {
        console.log(`${label}: could not verify ${item.pid}`)
        failed += 1
      }
      continue
    }
    if (state === 'gone') {
      console.log(`${label}: stopped ${item.pid}`)
      continue
    }
    if (state === 'reused') {
      console.log(`stale: ${item.pid} was not this run`)
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

export async function refuseRunningLane(
  laneKey,
  worktree,
  folder = runsFolder(),
  {
    list = listProcesses,
    wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  const lock = join(folder, `${laneKey}.lock`)
  const before = lockText(lock)
  const holder = readLaneLock(lock)
  const saved = laneProcessState(lock, before)
  const childCreated = saved.recorded.get(holder.child)
  const liveChild = childCreated === undefined
    ? isHolderAlive(holder.child, lock, { list })
    : list().some((row) => row.pid === holder.child && row.created === childCreated)
  if (liveChild) throw new Error(laneStopProblem({ lane: laneKey, pid: holder.child }))
  const worktrees = [worktree, holder.projectRun ? '' : holder.folder, saved.worktree]
  if (!worktrees.some(Boolean) && saved.recorded.size === 0) return
  const findLeftovers = (snapshot) => leftoverProcesses(snapshot, { worktrees, recorded: saved.recorded, ownPid: process.pid, spareAncestor: spareAncestorPid() })
  if (findLeftovers(list()).length === 0) return
  await wait(500)
  const current = list()
  const leftover = findLeftovers(current)[0]
  if (!leftover) return
  const stoppable = leftoverProcesses(current, { recorded: saved.recorded, ownPid: process.pid }).some((row) => row.pid === leftover.pid)
  const program = (() => {
    const text = String(leftover.command ?? '').trim()
    if (text === '') return ''
    if (text[0] === '"' || text[0] === "'") {
      const end = text.indexOf(text[0], 1)
      if (end !== -1) return text.slice(1, end).trim()
    }
    const match = /^\S+/.exec(text)
    return match ? match[0] : ''
  })()
  throw new Error(laneStopProblem({ lane: laneKey, pid: leftover.pid, leftover: true, program, stoppable }))
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
  if (!before && startedAt) {
    console.log(`Stopped 0 leftover processes for the ${laneKey} lane. Matched no names.`)
    console.log(`Nothing was running for the ${laneKey} lane.`)
    return 0
  }
  const saved = laneProcessState(path, before)
  let lockMtime = null
  try {
    lockMtime = stat(path).mtimeMs
  } catch {
    lockMtime = null
  }
  const holder = readLaneLock(path)
  const worktree = !before || holder.projectRun ? '' : holder.folder || configuredLaneWorktree(laneKey, folder)
  const processes = before || saved.recorded.size > 0 ? list() : []
  const byPid = new Map((Array.isArray(processes) ? processes : []).map((item) => [item.pid, item]))
  const rootPid = Number.isInteger(holder.child) && holder.child > 0 ? holder.child : holder.pid
  const isStranger = (pid) => (saved.recorded.has(pid) && byPid.has(pid) && saved.recorded.get(pid) !== byPid.get(pid).created)
    || isLockHolderStale(pid, lockMtime, { platform, processes: byPid })
  const descendants = isStranger(rootPid) ? [] : harnessDescendants(rootPid, { excludePids: [holder.pid ?? 0], processes })
  const differentRun = differentRunText(laneKey, path, startedAt)
  if (differentRun !== '') {
    console.log(differentRun)
    return 1
  }
  if (lockText(path) !== before) {
    console.log(`kept the ${laneKey} lock: a newer run took it while the stop ran`)
    return 0
  }
  let stopped = 0
  let failed = 0
  let listStale = false
  let unseen = false
  for (const [pid, name] of [[holder.child, 'the harness'], [holder.pid, 'the run']]) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
    if (isStranger(pid)) {
      console.log(`stale: ${pid} was not this run`)
    } else if (byPid.has(pid) || (!saved.recorded.has(pid) && (platform !== 'win32' || processes.length === 0))) {
      listStale = true
      if (stopProcess(pid, { kill, alive })) {
        console.log(`stopped: ${pid} (${name})`)
        stopped += 1
      } else {
        console.log(`could not stop: ${pid} (${name})`)
        failed += 1
      }
    } else if (alive(pid)) {
      unseen = true
    }
  }
  if (unseen) {
    console.log(`could not see the ${laneKey} run in the process list, so the lock stays`)
    failed += 1
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
  const current = before ? descendantsResult.processes : processes.length > 0 ? list() : processes
  if (!before && lockText(path) !== before) {
    console.log(`kept the ${laneKey} lock: a newer run took it while the stop ran`)
    return 0
  }
  const leftovers = stopLeftovers({
    worktrees: before ? [worktree, saved.worktree] : [],
    recorded: saved.recorded,
    excludePids: [holder.pid ?? 0, holder.child ?? 0, ...descendants.map((item) => item.pid)],
    platform,
    list,
    kill: kill === killTree ? killProcess : kill,
    alive,
    processes,
    current,
    snapshotOnly: true,
  })
  const leftoverCount = descendantsResult.stopped + leftovers.stopped
  if (!before) console.log(`Stopped ${leftoverCount} leftover ${leftoverCount === 1 ? 'process' : 'processes'} for the ${laneKey} lane. Matched no names.`)
  else if (leftoverCount > 0) console.log(`Stopped ${leftoverCount} leftover ${leftoverCount === 1 ? 'process' : 'processes'} for the ${laneKey} lane.`)
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
    const kept = before ? 'lock' : 'recorded process data'
    console.log(`kept the ${laneKey} ${kept}: ${failed} ${failed === 1 ? 'process' : 'processes'} could not be stopped, so the lane stays busy`)
    return 1
  }
  rmSync(`${path}.processes`, { force: true })
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

function runnerCommit({ laneKey, worktree, briefs, version = runnerCommitVersion(), branchSuffix = '', continueFrom = '' } = {}) {
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
  const targetBranch = `${branchFor(list[0])}${branchSuffix}`
  const currentBranch = String(run(['branch', '--show-current']).stdout ?? '').trim()
  if (currentBranch !== targetBranch) {
    const exists = continueFrom !== '' && run(['rev-parse', '--verify', '--quiet', `refs/heads/${targetBranch}`]).status === 0
    const switched = run(exists ? ['switch', targetBranch] : ['switch', '-c', targetBranch])
    if (switched.error || switched.status !== 0) return fail(switched)
  }
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

function excludeWorktrees(project) {
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

const WORKTREE_SETUP_LIMIT_MS = 5 * 60 * 1000

function worktreeSetupLine(command, startedAt, exitCode) {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  return `worktree setup: ${command} (${seconds} s, exit ${exitCode})`
}

function runWorktreeSetup(worktree, command) {
  const startedAt = Date.now()
  const result = spawnSync(command, {
    cwd: worktree,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: WORKTREE_SETUP_LIMIT_MS,
    maxBuffer: 16 * 1024 * 1024,
  })
  const exitCode = result.error && result.status === null ? 'none' : String(result.status)
  const line = worktreeSetupLine(command, startedAt, exitCode)
  if (result.error || result.status !== 0) throw new Error(line)
  return line
}

function copyWorktreeFiles(project, worktree, copies) {
  const problem = worktreeCopiesProblem(copies, project)
  if (problem) throw new Error(problem)
  const sourceRoot = realpathSync(project)
  const targetRoot = realpathSync(worktree)
  const inside = (root, path) => {
    const rel = relative(root, path)
    return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
  }
  for (const path of copies) {
    const source = join(project, path)
    let resolvedSource
    try { resolvedSource = realpathSync(source) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      console.log(`worktree copy: skipped ${path} (missing)`)
      continue
    }
    const gitDir = join(sourceRoot, '.git')
    if (!inside(sourceRoot, resolvedSource) || inside(gitDir, resolvedSource) || !statSync(resolvedSource).isFile()) throw new Error(`Worktree copy ${path} must resolve to a file inside the project.`)
    const target = join(worktree, path)
    let parent = dirname(target)
    while (!existsSync(parent)) parent = dirname(parent)
    if (!inside(targetRoot, realpathSync(parent))) throw new Error(`Worktree copy ${path} must resolve inside the worktree.`)
    try {
      lstatSync(target)
      try {
        if (!inside(targetRoot, realpathSync(target))) throw new Error(`Worktree copy ${path} must resolve inside the worktree.`)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      console.log(`worktree copy: skipped ${path} (exists)`)
      continue
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    mkdirSync(dirname(target), { recursive: true })
    if (!inside(targetRoot, realpathSync(dirname(target)))) throw new Error(`Worktree copy ${path} must resolve inside the worktree.`)
    copyFileSync(resolvedSource, target, constants.COPYFILE_EXCL)
    try {
      if (spawnSync(gitPath(), ['check-ignore', '-q', '--', path], { cwd: worktree, windowsHide: true }).status === 0) continue
      const found = spawnSync(gitPath(), ['rev-parse', '--git-common-dir'], { cwd: worktree, encoding: 'utf8', windowsHide: true })
      const common = String(found.stdout ?? '').trim()
      if (found.status !== 0 || !common) throw new Error('Could not find the worktree exclude file.')
      const exclude = join(isAbsolute(common) ? common : join(worktree, common), 'info', 'exclude')
      mkdirSync(dirname(exclude), { recursive: true })
      let text = ''
      try { text = readFileSync(exclude, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
      const pattern = '/' + relative(worktree, target).replace(/\\/g, '/').replace(/[\\*?\[\]#!]/g, '\\$&').replace(/ /g, '\\ ')
      appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`)
    } catch (error) {
      rmSync(target, { force: true })
      throw error
    }
  }
}

export function prepareWorktree(project, lane, { setup = '', copies = [] } = {}) {
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
  if (plan.made) copyWorktreeFiles(project, plan.path, copies)
  const command = plan.made ? String(setup ?? '').trim() : ''
  if (command !== '') plan.worktreeSetup = runWorktreeSetup(plan.path, command)
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

function allowedLanesOption(argv) {
  const index = argv.findIndex((arg) => arg === '--allowed-lanes' || arg.startsWith('--allowed-lanes='))
  if (index === -1) return { args: argv, allowedLanes: null }
  const arg = argv[index]
  const value = arg === '--allowed-lanes' ? argv[index + 1] : arg.slice('--allowed-lanes='.length)
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) throw new Error('--allowed-lanes needs one or more lane keys.')
  const lanes = value.split(',').map((key) => key.trim()).filter((key) => key !== '')
  if (lanes.length === 0 || lanes.some((key) => !/^[A-Za-z0-9_-]+$/.test(key))) throw new Error('--allowed-lanes needs lane keys separated by commas.')
  const args = [...argv.slice(0, index), ...(arg === '--allowed-lanes' ? argv.slice(index + 2) : argv.slice(index + 1))]
  return { args, allowedLanes: [...new Set(lanes)] }
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
  const allowed = allowedLanesOption(argv)
  const queued = allowed.args.some((arg) => arg === '--queue' || arg.startsWith('--queue='))
  if (!queued) {
    return {
      ...parseRunArgs(allowed.args),
      ...(allowed.allowedLanes ? { allowedLanes: allowed.allowedLanes } : {}),
    }
  }
  const started = startedByOption(allowed.args)
  const timed = startedAtOption(started.args)
  const worktree = timed.args.includes('--worktree')
  const queueArgs = timed.args.filter((arg) => arg !== '--worktree')
  let mode
  for (let index = 0; index < queueArgs.length; index += 1) {
    if (queueArgs[index] === '--mode' || queueArgs[index].startsWith('--mode=')) {
      const separate = queueArgs[index] === '--mode'
      mode = separate ? queueArgs[index + 1] : queueArgs[index].slice(7)
      if (!mode || mode.startsWith('-')) throw new Error('--mode needs a permission mode.')
      queueArgs.splice(index, separate ? 2 : 1)
      index -= 1
    }
  }
  const options = parseQueueArgs(queueArgs)
  return {
    ...options,
    ...(mode !== undefined ? { mode } : {}),
    ...(started.startedBy ? { startedBy: started.startedBy } : {}),
    ...(timed.startedAt ? { startedAt: timed.startedAt } : {}),
    ...(worktree ? { worktree: true } : {}),
    ...(allowed.allowedLanes ? { allowedLanes: allowed.allowedLanes } : {}),
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

function checkDisplay(command) {
  return checkCommandLines(command).join(', ')
}

function checkSummary(check) {
  const commands = Array.isArray(check?.commands) ? check.commands : []
  if (commands.length === 0) return String(check?.command ?? '')
  return commands.map((item) => `${item.command} ${item.ok ? 'passed' : 'failed'}`).join(', ')
}

async function projectCheck({ project, given, minutes }) {
  let command
  try {
    command = projectTestCommand(project, given)
  } catch (error) {
    const message = String(error?.message ?? error)
    console.error(message)
    return { command: message, commands: [], ok: false, ran: false }
  }
  if (command === '') return { command: '', commands: [], ok: true, ran: false }
  const lines = checkCommandLines(command)
  const commands = []
  for (const line of lines) {
    const outcome = await runTestCommand(line, project, minutes)
    const ok = outcome?.ok === true
    commands.push({ command: line, ok, outcome })
    console.log(`check ${commands.length} of ${lines.length} ${ok ? 'passed' : 'failed'}: ${line}`)
    if (!ok) break
  }
  const ok = commands.length === lines.length && commands.every((item) => item.ok)
  return { command, commands, ok, ran: true, outcome: commands.at(-1)?.outcome }
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
    currentBranch: () => String(run(['branch', '--show-current']).stdout ?? '').trim(),
    head: () => String(run(['rev-parse', 'HEAD']).stdout ?? '').trim(),
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

function writeProjectRecord({ record, folder, startHead, startBranch, tests = '', keepGit = false } = {}) {
  if (!record) return
  if (!keepGit) {
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
  }
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

const DEFAULT_CLOSE_TIMEOUT_MS = 30000

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

export function laneSpawn({ command, minutes = DEFAULT_MINUTES, model = '', effort = '', mode } = {}) {
  if (command?.transport !== 'acp') return { file: command?.file, args: command?.args ?? [], input: false }
  return { ...acpRunCommand({ command, minutes, model, effort, mode }), input: true }
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

function defaultProgramFor(harness) {
  const descriptor = Object.hasOwn(harnessByKey, harness) ? harnessByKey[harness] : null
  const program = descriptor?.defaultProgram
  return typeof program === 'string' && program !== '' ? program : harness
}

function usesDefaultProgram(lane) {
  const bin = lane?.cli?.bin
  if (typeof bin !== 'string' || bin.trim() === '') return true
  return bin === defaultProgramFor(lane?.cli?.harness)
}

function laneRunProgram(lane, { folder = runsFolder(), env = process.env } = {}) {
  const harness = lane?.cli?.harness
  let next = lane
  if (usesDefaultProgram(lane) && typeof harness === 'string') {
    const saved = readHarnessSettings(folder).programs[harness]
    if (typeof saved === 'string' && saved.trim() !== '') next = { ...lane, cli: { ...lane.cli, bin: saved } }
  }
  if (next?.cli?.harness !== 'codex') return { lane: next, program: null }
  const program = codexProgramFor('codex', next.cli.bin, { env })
  return program ? { lane: { ...next, cli: { ...next.cli, bin: program } }, program } : { lane: next, program: null }
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

const CHECKPOINT_FILE_LIMIT = 20

function gitText(cwd, args) {
  let git
  try {
    git = gitPath()
  } catch {
    return null
  }
  const result = spawnSync(git, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '')
}

export async function portOffsetFor(laneKey, folder = runsFolder(), { beforeStaleRemove } = {}) {
  mkdirSync(folder, { recursive: true })
  const lock = join(folder, '.port-offsets.lock')
  const candidate = join(folder, `.port-offsets.${randomUUID()}.tmp`)
  writeFileSync(candidate, laneLockText({ pid: process.pid }))
  const deadline = Date.now() + 10000
  try {
    while (true) {
      try {
        const guard = takeLaneLock(folder, '.port-offsets-takeover')
        try { linkSync(candidate, lock) } finally { releaseLaneLock(guard) }
        break
      } catch (error) {
        if (error.code && error.code !== 'EEXIST') throw error
        try {
          const guard = takeLaneLock(folder, '.port-offsets-takeover')
          try {
            const holder = readLaneLock(lock).pid
            if (!processAlive(holder) && Date.now() - statSync(lock).mtimeMs > 5000) {
              beforeStaleRemove?.()
              const claimed = `${lock}.${randomUUID()}.stale`
              renameSync(lock, claimed)
              if (readLaneLock(claimed).pid === holder && !processAlive(holder)) rmSync(claimed, { force: true })
              else if (!existsSync(lock)) renameSync(claimed, lock)
            }
          } finally { releaseLaneLock(guard) }
        } catch {}
        if (Date.now() >= deadline) throw new Error('Could not take the port offset lock. Check .port-offsets.lock in the runs folder.')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  } finally {
    rmSync(candidate, { force: true })
  }
  const path = join(folder, 'port-offsets.json')
  try {
    let offsets = {}
    try {
      offsets = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (Object.hasOwn(offsets, laneKey)) return offsets[laneKey]
    const used = new Set(Object.values(offsets))
    let offset = 0
    while (offset < 1000 && used.has(offset)) offset += 10
    if (offset === 1000) throw new Error('No free port offset is left; remove old lanes from port-offsets.json.')
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, `${JSON.stringify({ ...offsets, [laneKey]: offset }, null, 2)}\n`)
      renameSync(temp, path)
    } finally {
      rmSync(temp, { force: true })
    }
    return offset
  } finally {
    releaseLaneLock(lock)
  }
}

function checkpointFor(folder) {
  if (!folder) return null
  const head = (gitText(folder, ['rev-parse', 'HEAD']) ?? '').trim()
  if (head === '') return null
  const branch = (gitText(folder, ['branch', '--show-current']) ?? '').trim()
  const status = gitText(folder, ['status', '--porcelain'])
  if (status === null) return null
  const lines = status.split(/\r?\n/).filter((line) => line.trim() !== '')
  const paths = lines.map((line) => line.slice(3).trim()).filter((path) => path !== '')
  const untrackedCount = lines.filter((line) => line.slice(0, 2) === '??').length
  const trackedCount = lines.length - untrackedCount
  const recovery = trackedCount > 0 ? (gitText(folder, ['stash', 'create']) ?? '').trim() : ''
  return {
    head,
    branch,
    dirty: lines.length > 0,
    dirtyFiles: paths.slice(0, CHECKPOINT_FILE_LIMIT),
    dirtyCount: lines.length,
    untrackedCount,
    ...(recovery !== '' ? { recovery } : {}),
  }
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

const LANE_START_BRANCH = 'main'
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

function hermesSessionFor(cwd, env, startedAt) {
  const home = hermesHome({ env })
  let db
  try {
    const path = realpathSync.native(join(home, 'state.db'))
    if (dirname(path) !== realpathSync.native(home)) return ''
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    db = new DatabaseSync(path, { readOnly: true })
    const folder = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
    const collation = process.platform === 'win32' ? 'COLLATE NOCASE' : ''
    const row = db.prepare(`
      SELECT id FROM sessions
      WHERE replace(rtrim(cwd, char(47, 92)), char(92), '/') ${collation} = ?
        AND coalesce(parent_session_id, '') = ''
        AND started_at >= ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(folder, startedAt / 1000)
    return row?.id ?? ''
  } catch {
    return ''
  } finally {
    db?.close()
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


export function captureToolLines(file, sessionId, logPath, secrets = [], exportSession = spawnSync) {
  if (!sessionId) return { count: 0, session: '' }
  const result = exportSession(file, ['sessions', 'export', '--session-id', String(sessionId), '--format', 'jsonl', '-'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return { count: 0, session: '' }
  let session = maskKeys(String(result.stdout ?? '')).text
  for (const secret of secrets) if (secret) session = session.split(secret).join('[key]')
  session = session.replace(/(MACHINEROOM_API_KEY\s*[:=]\s*)[^\s'"\\]+/gi, '$1[key]')
  const lines = sessionToolLines(session).map((line) => maskKeys(line).text.replace(/(MACHINEROOM_API_KEY\s*[:=]\s*['"]?)[^\s'"]+/gi, '$1[key]'))
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

function readRecords(path = runsFile()) {
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

function uniqueRunName(folder, base) {
  if (!existsSync(join(folder, `${base}.log`)) && !existsSync(join(folder, `${base}.meta.json`))) {
    return base
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!existsSync(join(folder, `${candidate}.log`)) && !existsSync(join(folder, `${candidate}.meta.json`))) {
      return candidate
    }
  }
}

function runNameOfRecord(record) {
  const log = typeof record?.log === 'string' ? record.log.trim() : ''
  if (!log) return ''
  return basename(log).replace(/\.log$/i, '')
}

function findRunRecordByName(records, name) {
  const target = typeof name === 'string' ? name.trim() : ''
  if (!target) return null
  return records.findLast((record) => runNameOfRecord(record) === target) ?? null
}

function lostRunRecord(file, name, required = false) {
  const problem = continueFromProblem(name)
  if (problem) {
    if (required) throw new Error(problem)
    return null
  }
  const folder = dirname(file)
  const log = join(folder, `${name}.log`)
  const sidecar = join(folder, `${name}.meta.json`)
  const metaStat = lstatSync(sidecar, { throwIfNoEntry: false })
  if (!metaStat?.isFile() || !lstatSync(log, { throwIfNoEntry: false })?.isFile()) return null
  const meta = readUsage(sidecar)
  const lane = meta?.lane
  if (typeof lane !== 'string' || !/^[A-Za-z0-9_-]+$/.test(lane)) return null
  const legacyName = name.startsWith(`${lane}-`) ? name.slice(lane.length + 1) : ''
  const legacyBriefs = /^([A-Z]\d+[a-z]?(?:-[A-Z]\d+[a-z]?)*)-\d{8}-\d{6}(?:-\d+)?(?:-retry)?$/.exec(legacyName)
  const legacyProject = meta.project && /^(?:project-\d{8}-\d{6}|queue-\d{8}-\d{6}-\d{3}-\d+)(?:-\d+)?(?:-retry)?$/.test(legacyName)
  const briefs = meta.briefs ?? (legacyBriefs ? legacyBriefs[1].split('-') : legacyProject ? [] : null)
  if (!Array.isArray(briefs) || !briefs.every((id) => typeof id === 'string' && /^[A-Z]\d+[a-z]?$/.test(id))) return null

  const lock = join(folder, `${lane}.lock`)
  const holder = readLaneLock(lock)
  if (isHolderAlive(holder.pid, lock) || isHolderAlive(holder.child, lock) || (!holder.pid && existsSync(lock))) {
    if (required) throw new Error(`The ${lane} lane still holds its run lock. Wait for it to stop before continuing ${name}.`)
    return null
  }

  const record = runRecord({
    lane, briefs, log, startedAt: meta.startedAt ?? metaStat.mtimeMs,
    branch: meta.branch, base: meta.base, project: meta.project,
    model: meta.model, reasoning: meta.reasoning, mode: meta.mode,
    continues: meta.continues, failoverFrom: meta.failoverFrom,
    queue: meta.queue ? { branch: meta.queue, index: meta.index } : null,
    killed: true, stopReason: 'lost',
  })
  if (typeof meta.branch === 'string') record.branch = meta.branch
  return record
}

function continuationRecord(name, file = runsFile()) {
  const existing = findRunRecordByName(readRecords(file), name)
  if (existing) return existing
  const lost = lostRunRecord(file, name, true)
  if (!lost) throw new Error(`There is no run named ${name}.`)
  if (!appendRunRecord(lost, { file })) throw new Error(`The lost run ${name} could not be saved.`)
  return findRunRecordByName(readRecords(file), name)
}

function recoverLostRuns(file = runsFile()) {
  const records = readRecords(file)
  const recorded = new Set(records.map(runNameOfRecord))
  let entries
  try {
    entries = readdirSync(dirname(file))
  } catch (error) {
    if (error?.code === 'ENOENT') return records
    throw error
  }
  const recovered = []
  let unsaved = false
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue
    const name = entry.slice(0, -'.meta.json'.length)
    if (recorded.has(name)) continue
    const lost = lostRunRecord(file, name)
    if (!lost) continue
    if (!unsaved && !appendRunRecord(lost, { file, bestEffort: true })) unsaved = true
    recovered.push(lost)
  }
  if (recovered.length === 0) return records
  const latest = readRecords(file)
  const names = new Set(latest.map(runNameOfRecord))
  const inMemory = recovered.filter((record) => !names.has(runNameOfRecord(record)))
  if (inMemory.length > 0) console.log('The recovered runs were not all saved.')
  return latest.concat(inMemory)
}

function claudeResumeId(folder, name, worktree, briefHash) {
  try {
    const meta = JSON.parse(readFileSync(join(folder, `${name}.meta.json`), 'utf8'))
    if (meta?.briefHash !== briefHash) return ''
    const id = meta?.sessionId
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return ''
    const home = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || homedir()
    const slug = claudeProjectSlug(realPath(worktree))
    const file = join(home, '.claude', 'projects', slug, `${id}.jsonl`)
    return lstatSync(file, { throwIfNoEntry: false })?.isFile() ? id : ''
  } catch {
    return ''
  }
}

function interruptFileText(folder, name) {
  const target = typeof name === 'string' ? name.trim() : ''
  if (!target) return { text: '', sender: '' }
  const path = join(folder, `${target}.interrupt.txt`)
  if (!existsSync(path)) return { text: '', sender: '' }
  try {
    const text = readFileSync(path, 'utf8').trim()
    return { text, sender: interruptSenderFrom(text) }
  } catch {
    return { text: '', sender: '' }
  }
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
  const records = recoverLostRuns()
  if (records.length === 0) {
    console.log(`No runs recorded yet. The runs folder is ${printedRunsFolder(runsFolder())}.`)
    console.log('Start one with npm run run-lane -- <lane> <brief>. See --help for every form.')
    return 0
  }
  records.slice(-10).reverse().forEach((record) => console.log(runListLine(record)))
  return 0
}

function statsRuns(options) {
  formatStats(laneStats(recoverLostRuns(), { since: options.since })).forEach((line) => console.log(line))
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
  const continueFrom = typeof options.continueFrom === 'string' ? options.continueFrom.trim() : ''
  const prevRun = continueFrom ? continuationRecord(continueFrom) : null
  const project = projectFolder(options.project)
  if (!gitCheckout(project)) throw new Error(`The project folder ${printedRunsFolder(project)} is not a git folder. A queue needs one.`)
  let previousProject = typeof prevRun?.project === 'string' ? realPath(prevRun.project) : ''
  if (continueFrom && options.worktree && previousProject === project) {
    try {
      const meta = JSON.parse(readFileSync(join(runsFolder(), `${continueFrom}.meta.json`), 'utf8'))
      if (typeof meta?.project === 'string' && meta.project.trim()) previousProject = realPath(meta.project)
    } catch {}
  }
  const continuedBranch = prevRun?.failoverFrom ? prevRun.checkpoint?.branch || prevRun.branch : prevRun?.branch
  const continuedWorktree = options.worktree && previousProject && realPath(dirname(previousProject)) === realPath(join(project, '.worktrees')) ? previousProject : ''
  if (continueFrom && (options.worktree ? !continuedWorktree : previousProject !== project)) throw new Error('The interrupted run has a different project worktree.')
  if (continuedWorktree && !existsSync(continuedWorktree)) throw new Error('The interrupted run worktree no longer exists.')
  const problems = projectRefusals(project, lanes, (options.allowDirty === true && !options.queue) || Boolean(continueFrom))
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
    const plan = options.worktree
      ? (continueFrom ? { path: continuedWorktree, made: false } : worktreePlan(project, options.lane))
      : { path: project, made: false }
    const dryBranch = continueFrom ? (continuedBranch || prevRun.queue || branch) : branch
    const test = checkDisplay(testCommandFor(project, options.test))
    console.log(`lane: ${options.lane}`)
    console.log(`project: ${printedRunsFolder(project)}`)
    if (options.worktree) printWorktree(plan)
    console.log(`branch: ${dryBranch}`)
    console.log(`tests: ${test || 'none, the project has no tests'}`)
    tasks.forEach((task, index) => console.log(`${index + 1}. ${task}`))
    console.log('Dry run, nothing started.')
    return 0
  }
  const folder = runsFolder()
  mkdirSync(folder, { recursive: true })
  const laneProblem = laneCommandProblem(lane)
  if (laneProblem !== '') throw new Error(laneProblem)
  const worktreeSettings = options.worktree ? readHarnessSettings(folder) : {}
  const worktreeSetup = worktreeSetupOf(worktreeSettings)
  const lockTarget = options.worktree ? continuedWorktree || worktreeFor(project, options.lane) || project : project
  await refuseRunningLane(options.lane, options.worktree ? lockTarget : '', folder)
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
    let plan
    if (options.worktree) {
      const wtPath = continuedWorktree || worktreeFor(project, options.lane)
      if (continueFrom && wtPath && existsSync(wtPath)) {
        linkNodeModules(project, wtPath)
        plan = { path: wtPath, made: false }
      } else {
        plan = worktreePlan(project, options.lane)
      }
    } else {
      plan = { path: project, made: false }
    }
    const target = options.worktree && (!continueFrom || plan.made) ? prepareWorktree(project, options.lane, { setup: worktreeSetup, copies: worktreeSettings.worktreeCopies ?? [] }) : plan
    const currentWtBranch = gitRead(target.path, ['branch', '--show-current']) || ''
    if (continueFrom && continuedBranch && currentWtBranch !== continuedBranch) throw new Error('The interrupted run worktree is on a different branch.')
    const activeBranch = continueFrom
      ? (currentWtBranch || prevRun.queue || prevRun.branch || branch)
      : branch
    const startBranch = options.worktree
      ? (currentWtBranch || gitRead(project, ['branch', '--show-current']) || '')
      : currentWtBranch
    const startHead = gitRead(target.path, ['rev-parse', 'HEAD']) || ''
    let test = typeof options.test === 'string' && options.test.trim() !== '' ? options.test : ''
    const base = prevRun?.base || gitRead(target.path, ['rev-parse', 'HEAD']) || startHead
    const startIndex = options.queue && Number.isInteger(prevRun?.queueIndex) && prevRun.queueIndex >= 1
      ? prevRun.queueIndex
      : 1
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
      const authorForRecord = (record) => {
        const key = typeof record?.lane === 'string' ? record.lane : ''
        const used = key !== '' && lanes[key] ? lanes[key] : lane
        return commitAuthorFor(harnessByKey[used?.cli?.harness], record?.model ?? used?.cli?.model)
      }
      const result = await runQueue({
        tasks,
        git: queueGit(target.path, activeBranch, options.lane, { onSettled: finishPending }),
        author: commitAuthorFor(harnessByKey[lane?.cli?.harness], lane?.cli?.model),
        continueBranch: Boolean(continueFrom),
        startIndex,
        runTask: async (task, number) => {
          console.log(`task ${number} of ${tasks.length}`)
          const prompt = unattendedPrompt(task, process.env)
          const name = uniqueRunName(folder, `${options.lane}-queue-${queueId}-${number}`)
          const logPath = join(folder, `${name}.log`)
          const usageFile = join(folder, `${name}.usage.json`)
          const run = await startLane({
            options, lane, lanes, wanted: [], prompt, logPath, usageFile, name,
            project: target.path, task, queue: { branch: activeBranch, index: number, size: tasks.length }, lockPath: lock,
            projectBranch: startBranch, deferRecord: true, base,
            worktreeSetup: target.worktreeSetup ?? '',
          })
          pending = { record: run.record, folder: target.path, startHead: run.startHead ?? startHead, startBranch, tests: '', keepGit: run.keepGit === true }
          if (run.code !== 0 || run.killed) finishPending(run.killed ? 'stopped' : 'failed', true)
          const backupLane = run.record?.failoverFrom ? String(run.record?.lane ?? '').trim() : ''
          return { code: run.code, killed: run.killed, author: authorForRecord(run.record), backupLane }
        },
        runTests: async () => {
          const check = await projectCheck({ project: target.path, given: options.test, minutes: options.minutes })
          test = checkSummary(check)
          testsFailed = !check.ok
          if (pending) pending.tests = check.command === '' ? 'none' : (check.ok ? 'passed' : 'failed')
          return { ok: check.ok }
        },
      })
      const stoppedTask = result.results.find((item) => item.status.startsWith('failed'))
      if (pending && stoppedTask) finishPending(stoppedTask.status, true)
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
          mode: lane?.cli?.mode,
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
  '--started-at', '--model', '--reasoning', '--mode', '--queue', '--test',
  '--allowed-lanes', '--continue-from',
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
  const saved = lanes[options.lane]
  const choiceDefault = saved?.cli?.mode === 'choice' ? defaultMode(saved.cli.harness) : undefined
  const mode = options.mode ?? (choiceDefault ?? undefined)
  const lane = laneWithOverrides(saved, { ...options, ...(mode !== undefined ? { mode } : {}) })
  if (options.mode === undefined && choiceDefault === null && lane?.cli) delete lane.cli.mode
  lanes[options.lane] = lane
  if (typeof lane?.cli?.harness === 'string' && readHarnessSettings(runsFolder()).off.includes(lane.cli.harness)) {
    console.log(HARNESS_OFF_PROBLEM)
    return 1
  }
  const modeProblem = laneModeProblem(lane, options.lane)
  if (modeProblem) throw new Error(modeProblem)
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
    const problems = projectRefusals(project, lanes, options.allowDirty === true || Boolean(options.continueFrom))
    if (problems.length > 0) {
      printProjectRefusals(problems, project)
      return 1
    }
    const task = readTask(options)
    const prompt = unattendedPrompt(task, process.env)
    const folder = runsFolder()
    const name = uniqueRunName(folder, `${options.lane}-project-${stamp()}`)
    const logPath = join(folder, `${name}.log`)
    const usageFile = join(folder, `${name}.usage.json`)

    if (options.dryRun) {
      const { enabledServers, mcpConfigPath } = laneConfigPlan(lane, folder, name)
      const command = commandFor({ lane: laneRunProgram(lane, { folder }).lane, prompt, env: process.env, usageFile, title: name, cwd: project, mcpConfig: mcpConfigPath })
      const test = checkDisplay(testCommandFor(project, options.test))
      printCommand(command, prompt, { mcpConfig: mcpConfigPath, mcpServers: enabledServers })
      console.log(`tests: ${test || 'none, the project has no tests'}`)
      console.log('Dry run, nothing started.')
      return 0
    }

    mkdirSync(folder, { recursive: true })
    await refuseRunningLane(options.lane, '', folder)
    if (options.continueFrom) continuationRecord(options.continueFrom)
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
        console.log(`tests: ${check.command ? checkSummary(check) : 'none, the project has no tests'}`)
        if (!check.ok) {
          run.record.exitCode = 1
          code = 1
        }
      }
      writeProjectRecord({ record: run.record, folder: project, startHead: run.startHead, startBranch: run.startBranch, tests, keepGit: run.keepGit === true })
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
    branchExists: options.continueFrom ? () => false : branchExists,
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
  const promptFor = (laneKey, branchSuffix = '') => unattendedPrompt(buildPrompt({ briefs: wanted, laneKey, lanes, rules, version, agentDepth, branchSuffix }), process.env)
  const prompt = promptFor(options.lane)
  const folder = runsFolder()
  const name = uniqueRunName(folder, `${options.lane}-${wanted.map((brief) => brief.id).join('-')}-${stamp()}`)
  const logPath = join(folder, `${name}.log`)
  const usageFile = join(folder, `${name}.usage.json`)

  if (options.dryRun) {
    const start = !options.continueFrom && gitCheckout(lane.worktree) ? laneWorktreeStart({ worktree: lane.worktree }) : null
    const { enabledServers, mcpConfigPath } = laneConfigPlan(lane, folder, name)
    const codex = laneRunProgram(lane, { folder })
    const dryInterrupt = options.continueFrom ? interruptFileText(folder, options.continueFrom).text : ''
    const dryPrompt = dryInterrupt ? `${prompt}\n\n${dryInterrupt}` : prompt
    const command = commandFor({ lane: codex.lane, prompt: dryPrompt, env: process.env, usageFile, title: name, mcpConfig: mcpConfigPath })
    printCommand(command, dryPrompt, { mcpConfig: mcpConfigPath, mcpServers: enabledServers })
    if (start) {
      const from = start.from && start.from !== start.startBranch ? ` (the worktree was on ${start.from})` : ''
      console.log(`start branch: ${start.startBranch}${from}`)
    }
    console.log('Dry run, nothing started.')
    return 0
  }

  mkdirSync(folder, { recursive: true })
  await refuseRunningLane(options.lane, lane.worktree, folder)
  if (options.continueFrom) continuationRecord(options.continueFrom)
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

async function claimBackupTicket(ticket, lane, startedAt) {
  const bridge = typeof process.env.MACHINEROOM_BRIDGE === 'string' ? process.env.MACHINEROOM_BRIDGE.trim().replace(/\/+$/, '') : ''
  const held = typeof ticket === 'string' ? ticket.trim() : ''
  if (bridge === '' || held === '' || typeof fetch !== 'function') return false
  try {
    const answer = await fetch(`${bridge}/api/orchestrator/failover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': held },
      body: JSON.stringify({ lane, startedAt: new Date(startedAt).toISOString() }),
      signal: AbortSignal.timeout(2000),
    })
    return answer.ok
  } catch {
    return false
  }
}

async function startFailover({ laneKey, target, lanes, options, wanted, prompt, promptFor = null, folder, project, task, queue = null, base = '', deferRecord, openLog, failedRecord, failedStartBranch, onStart = null }) {
  const allowedLanes = Array.isArray(options?.allowedLanes) && options.allowedLanes.length > 0 ? options.allowedLanes : null
  if (allowedLanes && !allowedLanes.includes(target)) {
    console.log(`The backup lane ${target} is outside the sector that started this run.`)
    return null
  }
  const savedTarget = lanes?.[target]
  const targetMode = typeof savedTarget?.cli?.mode === 'string' ? savedTarget.cli.mode.trim() : ''
  const fixedTarget = targetMode !== '' && targetMode !== 'choice'
  const primaryRaw = options?.mode !== undefined ? options.mode : lanes?.[laneKey]?.cli?.mode
  const primaryMode = primaryRaw === 'choice'
    ? (defaultMode(lanes?.[laneKey]?.cli?.harness) ?? undefined)
    : (primaryRaw !== undefined && primaryRaw !== '' ? primaryRaw : undefined)
  const modeToCarry = fixedTarget
    ? undefined
    : (primaryMode ?? (targetMode === 'choice' ? (defaultMode(savedTarget?.cli?.harness) ?? undefined) : undefined))
  const refusedBypass = modeToCarry === 'bypass' && targetMode !== 'bypass'
  const targetDefault = defaultMode(savedTarget?.cli?.harness) ?? undefined
  const targetLegacyMode = legacyMode(savedTarget?.cli?.harness) ?? undefined
  const carriedMode = refusedBypass
    ? (targetDefault !== targetLegacyMode ? targetDefault : undefined)
    : modeToCarry
  const fallbackLane = laneWithOverrides(savedTarget, carriedMode !== undefined ? { mode: carriedMode } : {})
  if (!fallbackLane) return null
  if (!fixedTarget && carriedMode === undefined && fallbackLane.cli && (fallbackLane.cli.mode === '' || fallbackLane.cli.mode === 'choice')) {
    delete fallbackLane.cli.mode
  }
  if (readHarnessSettings(folder).off.includes(fallbackLane.cli?.harness)) {
    console.log(HARNESS_OFF_PROBLEM)
    return null
  }
  const modeProblem = laneModeProblem(fallbackLane, target)
  if (modeProblem) {
    console.log(modeProblem)
    return null
  }
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
    await refuseRunningLane(target, project ? '' : fallbackLane.worktree, folder)
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
    await claimBackupTicket(process.env.MACHINEROOM_LANE_TICKET, target, startedAt)
    return await startLane({
      options: { ...options, lane: target, failedOver: true, continueFrom: '' },
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
      laneTicket: process.env.MACHINEROOM_LANE_TICKET,
      openLog,
      startedAt,
      onStart,
    })
  } finally {
    releaseLaneLock(lock)
  }
}

export function laneConfigPlan(lane, folder, name) {
  const enabledServers = enabledMcpServers(folder)
  const harness = lane?.cli?.harness
  const mode = lane?.cli?.mode
  const needsMcp = enabledServers.length > 0 && (harness === 'claude' || harness === 'opencode')
  const needsOpencodeConfig = harness === 'opencode' && mode !== 'bypass'
  const mcpConfigPath = needsMcp || needsOpencodeConfig ? join(folder, `${name}.mcp.json`) : ''
  return { enabledServers, harness, mode, needsMcp, mcpConfigPath }
}

function opencodePermission(mode) {
  if (mode === 'bypass') return null
  const permission = { external_directory: 'deny' }
  if (mode === 'edits') permission.bash = 'deny'
  else if (mode === 'plan') {
    permission.edit = 'deny'
    permission.bash = 'deny'
  }
  return permission
}

export function laneConfigBody({ harness, mode, enabledServers, needsMcp }) {
  if (harness === 'claude') return mcpConfigForClaude(enabledServers)
  const config = needsMcp ? mcpConfigForOpencode(enabledServers) : {}
  const permission = opencodePermission(mode)
  if (permission) config.permission = permission
  return config
}

export async function startLane({ options, lane, lanes, wanted, prompt, logPath, usageFile, name, project = '', task = '', queue = null, lockPath = '', projectBranch = null, deferRecord = false, base = '', openLog = createWriteStream, branchSuffix = '', failoverFrom = null, promptFor = null, startedAt: givenStartedAt = null, onStart = null, laneTicket = '', worktreeSetup = '' }) {
  if (readHarnessSettings(runsFolder()).off.includes(lane?.cli?.harness)) throw new Error(HARNESS_OFF_PROBLEM)
  if (options?.failedOver !== true) {
    const problem = fallbackProblem({ laneKey: options?.lane, fallback: lane?.fallback, lanes })
    if (problem !== '') throw new Error(problem)
  }
  const runsDir = options?.runs || (logPath ? dirname(logPath) : runsFolder())
  const continueFrom = typeof options?.continueFrom === 'string' ? options.continueFrom.trim() : ''
  const briefHash = createHash('sha256').update(JSON.stringify(project ? task : wanted.map(({ title, text }) => [title, text]))).digest('hex')
  let fullPrompt = prompt
  let continuedBase = ''
  let continuedBranch = ''
  let interruptText = ''
  let interruptedBy = ''
  let resumedSessionId = ''
  if (continueFrom !== '') {
    const record = continuationRecord(continueFrom, join(runsDir, 'runs.jsonl'))
    if (record.lane !== options.lane) throw new Error('The interrupted run has a different lane.')
    if (Boolean(record.project) !== Boolean(project)) throw new Error('The interrupted run has a different project kind.')
    if (JSON.stringify(record.briefs ?? []) !== JSON.stringify(project ? [] : wanted.map((brief) => brief.id))) throw new Error('The interrupted run has different brief ids.')
    continuedBase = typeof record.base === 'string' ? record.base.trim() : ''
    continuedBranch = typeof record.branch === 'string' ? record.branch.trim() : ''
    const lost = record.stopReason === 'lost'
    if (lost && project && realPath(record.project) !== realPath(project)) throw new Error('The interrupted run has a different project worktree.')
    if (!project || (lost && continuedBranch)) {
      const worktree = project || lane.worktree
      const currentBranch = gitRead(worktree, ['branch', '--show-current'])
      const onBriefBranch = lost && !project && continuedBranch === '' && typeof wanted[0]?.title === 'string'
        && currentBranch === `${branchFor(wanted[0])}${branchSuffix}`
        && /^[a-f0-9]{40,64}$/i.test(continuedBase)
        && gitRead(worktree, ['merge-base', '--is-ancestor', continuedBase, 'HEAD']) !== null
      if (currentBranch !== continuedBranch && !onBriefBranch) throw new Error('The interrupted run worktree is on a different branch.')
      continuedBranch = currentBranch
    }
    const interrupt = interruptFileText(runsDir, continueFrom)
    interruptText = interrupt.text
    interruptedBy = interrupt.sender
    if (options?.retried !== true && interruptText !== '') {
      fullPrompt = `${prompt}\n\n${interruptText}`
    }
    if (lane.cli.harness === 'claude' && (!queue || queue.index === (record.queueIndex ?? 1))) {
      resumedSessionId = claudeResumeId(runsDir, continueFrom, project || lane.worktree, briefHash)
    }
  }
  let start = null
  if (!project && continueFrom === '') {
    const status = gitStatus(lane.worktree)
    if (status.trim() !== '') throw new Error(`The worktree ${lane.worktree} is not clean. Commit or discard its changes first.`)
    start = laneWorktreeStart({ worktree: lane.worktree, move: true })
  }
  const baseFolder = project || lane.worktree
  const runBase = typeof base === 'string' && base.trim() !== ''
    ? base.trim()
    : continuedBase || (baseFolder ? gitRead(baseFolder, ['rev-parse', 'HEAD']) || '' : '')
  const checkpoint = checkpointFor(baseFolder)

  const folder = runsFolder()
  const configPlan = laneConfigPlan(lane, folder, name)
  const { harness, mcpConfigPath } = configPlan
  if (mcpConfigPath) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(mcpConfigPath, `${JSON.stringify(laneConfigBody(configPlan), null, 2)}\n`, { mode: 0o600 })
  }

  try {
    const sessionId = resumedSessionId || randomUUID()
    const sessionIdFromLine = harnessByKey[harness]?.sessionIdFromLine
    const effectivePrompt = resumedSessionId ? (interruptText || 'Continue your brief from where you stopped.') : fullPrompt
    const codex = laneRunProgram(lane, { folder })
    const command = commandFor({
      lane: codex.lane,
      prompt: effectivePrompt,
      env: process.env,
      usageFile,
      title: name,
      sessionId: resumedSessionId ? undefined : sessionId,
      mcpConfig: mcpConfigPath,
      ...(project ? { cwd: project } : {}),
    })
    if (resumedSessionId) command.args.push('--resume', resumedSessionId)
    const startedBy = options.startedBy ? null : sessionStartedBy(process.env)
    const startedAt = Number.isFinite(Number(givenStartedAt)) && Number(givenStartedAt) > 0 ? Number(givenStartedAt) : Date.now()
    const meta = {
      lane: options.lane, briefHash, briefs: project ? [] : wanted.map((brief) => brief.id),
      ...(sessionIdFromLine ? {} : { sessionId }),
      startedAt: new Date(startedAt).toISOString(), branch: checkpoint?.branch ?? '',
      model: lane.cli.model, reasoning: lane.reasoning, mode: lane.cli.mode,
      ...(runBase ? { base: runBase } : {}),
      ...(continueFrom ? { continues: continueFrom } : {}),
      ...(failoverFrom ? { failoverFrom } : {}),
    }
    if (resumedSessionId) meta.resumed = true
    if (project) meta.project = project
    if (queue) {
      meta.queue = queue.branch
      meta.index = queue.index
    }
    if (startedBy) meta.startedBy = startedBy
    const metaPath = join(dirname(logPath), `${name}.meta.json`)
    writeFileSync(metaPath, `${JSON.stringify(meta)}\n`)
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
    const projectStart = project
      ? {
          branch: typeof projectBranch === 'string' ? projectBranch : gitRead(project, ['branch', '--show-current']) ?? '',
          head: gitRead(project, ['rev-parse', 'HEAD']) ?? '',
        }
      : null
    // OpenCode takes its folder from PWD, which a shell started elsewhere leaves pointing at that shell's folder.
    const spawnSpec = laneSpawn({ command, minutes: options.minutes, model: lane.cli.model, effort: lane.reasoning, mode: lane.cli.mode })
    const runnerNames = [
      'MACHINEROOM_RUNS',
      'MACHINEROOM_LANES_FILE',
      'MACHINEROOM_LANE_TICKET',
      'MACHINEROOM_LANE_REPLIES',
      'MACHINEROOM_BRIDGE',
      ...(harness === 'hermes' ? ['HERMES_HOME'] : []),
    ]
      .filter((name) => typeof process.env[name] === 'string' && process.env[name] !== '')
    const endpoints = readEndpoints(runsDir)
    const extra = { ...command.env, MACHINEROOM_PORT_OFFSET: String(await portOffsetFor(options.lane, runsDir)) }
    if (typeof laneTicket === 'string' && laneTicket.trim() !== '') extra.MACHINEROOM_LANE_TICKET = laneTicket.trim()
    if (lane.cli.harness === 'machineroom' && Number.isFinite(Number(options?.minutes))) {
      extra.MR_AGENT_MINUTES = String(options.minutes)
    }
    if (lane.cli.harness === 'machineroom' && Array.isArray(lane.providerOrder)) {
      const order = lane.providerOrder.filter((name) => typeof name === 'string' && name.trim() !== '')
      if (order.length > 0) extra.MR_AGENT_PROVIDER_ORDER = order.join(',')
    }
    const childEnv = childEnvironment(process.env, command.cwd, {
      harness: lane.cli.harness,
      names: runnerNames,
      extra,
      model: lane.cli.model,
      endpoints,
    })
    const secrets = Object.entries(childEnv).filter(([key]) => /key|ticket|token|secret/i.test(key)).map(([, value]) => String(value ?? '')).filter((value) => value.length >= 8)
    let sessionPoll = null
    const validSessionId = (id) => typeof id === 'string' && /^[\w-]{1,128}$/.test(id)
      && maskKeys(id).text === id && !secrets.some((secret) => id.includes(secret))
    const saveSessionId = (id) => {
      if (!validSessionId(id)) return false
      if (meta.sessionId === id) return true
      const temp = `${metaPath}.${process.pid}.tmp`
      try {
        writeFileSync(temp, `${JSON.stringify({ ...meta, sessionId: id })}\n`)
        renameSync(temp, metaPath)
        meta.sessionId = id
        clearInterval(sessionPoll)
        sessionPoll = null
        return true
      } catch {
        try {
          rmSync(temp, { force: true })
        } catch {}
        return false
      }
    }
    const sessionTails = {}
    let printedSessionId = ''
    const readSessionChunk = (stream, text) => {
      if (!sessionIdFromLine || printedSessionId) return
      const lines = ((sessionTails[stream] ?? '') + text).split(/\r\n?|\n/)
      sessionTails[stream] = lines.pop().slice(-8 * 1024 * 1024)
      for (const line of lines) {
        const id = sessionIdFromLine(line)
        if (!validSessionId(id)) continue
        printedSessionId = id
        if (!saveSessionId(id) && !settled) sessionPoll ??= setInterval(refreshSession, 500).unref()
        break
      }
    }
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
      secrets,
    })
    const setupLine = typeof worktreeSetup === 'string' ? worktreeSetup.trim() : ''
    if (setupLine !== '') laneLog.push('stdout', `${setupLine}\n`)
    const namedAfter = process.platform === 'linux' ? Math.ceil(uptime() * 100) : Date.now()
    const harnessStartedAt = Date.now()
    const child = spawn(spawnSpec.file, spawnSpec.args, { cwd: command.cwd, env: childEnv, stdio: spawnSpec.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const refreshSession = () => {
      if (printedSessionId) saveSessionId(printedSessionId)
      else if (harness === 'hermes' && !meta.sessionId) saveSessionId(hermesSessionFor(command.cwd, childEnv, harnessStartedAt))
    }
    if (typeof onStart === 'function') onStart()
    const lockStart = queue && lockPath ? laneLockStartedAt(lockText(lockPath)) || startedAt : startedAt
    if (lockPath) writeLaneChild(lockPath, child.pid)
    if (lockPath) writeLockStart(lockPath, lockStart, basename(logPath))
    const sweepWorktree = project ? (options.worktree ? project : '') : lane.worktree
    const recorded = new Map()
    let childCreated
    const remember = (processes) => {
      const root = processes.find((row) => row.pid === child.pid)
      let changed = false
      if (childCreated === undefined && root?.ppid === process.pid && Number.isFinite(root.created)) {
        childCreated = root.created
        recorded.set(root.pid, root.created)
        changed = true
      }
      const descendants = leftoverProcesses(processes, {
        childPid: childCreated === undefined ? 0 : child.pid,
        childCreated,
        recorded,
        ownPid: process.pid,
      })
      for (const { pid, created } of descendants) {
        if (!Number.isFinite(created) || recorded.get(pid) === created) continue
        recorded.set(pid, created)
        changed = true
      }
      if (changed) saveLaneProcessState(lockPath, basename(logPath), sweepWorktree, recorded)
    }
    const stopSampling = child.pid ? sampleProcesses(remember) : () => {}
    if (spawnSpec.input && child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(effectivePrompt)
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

    const sweep = (stopHarness = false) => {
      const processes = child.pid || sweepWorktree ? listProcesses() : []
      remember(processes)
      if (stopHarness) {
        let stoppedHarness = false
        if (processes.length > 0) {
          try {
            stoppedHarness = child.kill('SIGKILL')
          } catch {}
        }
        if (!stoppedHarness) killTree(child)
      }
      const root = processes.find((row) => row.pid === child.pid)
      const result = stopLeftovers({
        worktree: sweepWorktree,
        namedAfter,
        childPid: child.pid ?? 0,
        childCreated: childCreated ?? (root && root.ppid !== process.pid ? null : undefined),
        recorded,
        processes,
        snapshotOnly: stopHarness,
      })
      extraStopped += result.stopped
      return result
    }

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
      stopSampling()
      leftoversCleaned = true
      if (stopNote === '') stopNote = 'leftovers were stopped'
      sweep(child.exitCode === null && child.signalCode === null)
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
      readSessionChunk('stdout', text)
      laneLog.push('stdout', text)
      onChunk(text)
    })
    child.stderr?.on('data', (text) => {
      readSessionChunk('stderr', text)
      laneLog.push('stderr', text)
    })
    if (harness === 'hermes') sessionPoll = setInterval(refreshSession, 500).unref()

    let killed = false
    let stopNote = ''
    const stopChild = (note) => {
      if (!child.pid || settled) return
      killed = true
      if (stopNote === '') stopNote = note
      sweep(child.exitCode === null && child.signalCode === null)
    }
    const onInt = () => stopChild('stopped by SIGINT')
    const onTerm = () => stopChild('stopped by SIGTERM')
    const onHup = () => stopChild('stopped by SIGHUP')
    const onExit = () => {
      stopSampling()
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
        stopSampling()
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
    clearInterval(sessionPoll)
    readSessionChunk('stdout', '\n')
    readSessionChunk('stderr', '\n')
    refreshSession()
    if (closeTimer !== null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGHUP', onHup)
    process.removeListener('exit', onExit)
    const finalSweep = sweep()
    if (lockPath && laneLockLog(lockText(lockPath)) === basename(logPath)) {
      if (finalSweep.failed > 0) saveLaneProcessState(lockPath, basename(logPath), sweepWorktree, recorded)
      else rmSync(`${lockPath}.processes`, { force: true })
    }
    const totalStoppedLeftovers = extraStopped
    let commit = { ok: true, committed: false, leftOut: [], error: '' }
    if (!project && !killed && result.code === 0 && lane.cli?.commits === 'runner' && wanted.length > 0) {
      try {
        commit = runnerCommit({ laneKey: options.lane, worktree: lane.worktree, briefs: wanted, branchSuffix, continueFrom })
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
      if (!printedSessionId) saveSessionId(report?.session_id)
      printUsage(usageFile)
      toolLines = captureToolLines(command.file, report?.session_id, logPath, secrets)
      console.log(`tool lines: ${toolLines.count}`)
    }

    const worktree = project || lane.worktree
    const logText = readLog(logPath)
    const quota = quotaForRun({ harness, log: logText, env: process.env, startedAt, now: Date.now() })
    const rollout = harness === 'codex' ? findCodexRollout({ threadId: codexThreadId(logText), env: process.env, startedAt, now: Date.now() }) : ''
    const contextWindow = lane.cli.contextWindow || (rollout ? readCodexQuota(rollout)?.contextWindow : null)
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
          commits: (gitRead(lane.worktree, ['log', '--oneline', checkpoint?.head ? `${checkpoint.head}..HEAD` : 'refs/heads/main..HEAD']) ?? '')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => maskProfilePaths(maskKeys(line).text)),
        }
    if (project && continueFrom !== '' && git.branch === '' && continuedBranch !== '' && continuedBranch === (gitRead(project, ['branch', '--show-current']) ?? '')) {
      git.branch = continuedBranch
    }

    const startFailed = (Boolean(result.error) || result.code !== 0) && summary.toolCalls === 0 && minutes < 1
    const startFailure = startFailed
      ? (result.error ? `The harness did not start (${errorCode(result.error)}).` : startFailureText({ harness, log: logText }))
      : ''
    if (startFailure !== '' && !result.error) console.log(`start failed: ${startFailure}`)
    const stopReason = !killed && harness === 'machineroom' && result.code === 4 ? 'repeated failure' : undefined
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
        mode: lane.cli.mode,
        reasoning: lane.reasoning ?? null,
        startedAt,
        minutes,
        exitCode: result.code,
        killed,
        ...(stopReason ? { stopReason } : {}),
        costUsd: summary.costUsd ?? totalCost(report),
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheReadTokens: summary.cacheReadTokens,
        cacheWriteTokens: summary.cacheWriteTokens,
        cachedInputTokens: summary.cachedInputTokens,
        providers: summary.providers,
        peakTokens: summary.peakTokens,
        log: logPath,
        branch: git.branch,
        commits: git.commits,
        base: runBase,
        checkpoint,
        quota,
        contextWindow,
        retried: true,
        startFailed: startFailure !== '' ? true : undefined,
        ...(start ? { startBranch: start.startBranch } : {}),
        ...(options.startedBy ? { startedBy: options.startedBy } : {}),
        ...(project ? { project, task, head: gitRead(project, ['rev-parse', 'HEAD']) || undefined } : {}),
        ...(queue ? { queue } : {}),
        ...(failoverFrom ? { failoverFrom } : {}),
        ...(continueFrom !== '' ? { continues: continueFrom } : {}),
        ...(continueFrom !== '' && interruptedBy !== '' ? { interruptedBy } : {}),
      })
      if (startedBy) retryRecord.startedBy = startedBy
      if (appendRunRecord(retryRecord)) console.log(`record: ${printedRunsFolder(runsFile())}`)
      const retryName = `${name}-retry`
      return await startLane({
        options: { ...options, retried: true },
        lane, lanes, wanted, prompt: fullPrompt,
        logPath: join(dirname(logPath), `${retryName}.log`),
        usageFile: join(dirname(usageFile), `${retryName}.usage.json`),
        name: retryName, project, task, queue, lockPath, projectBranch, deferRecord, base: runBase, openLog, branchSuffix, failoverFrom, promptFor, onStart, laneTicket,
      })
    }
    const record = laneRunRecord({
      lane: options.lane,
      briefs: project ? [] : wanted.map((brief) => brief.id),
      model: lane.cli.model,
      mode: lane.cli.mode,
      reasoning: lane.reasoning ?? null,
      startedAt,
      minutes,
      exitCode: result.code,
      killed,
      ...(stopReason ? { stopReason } : {}),
      costUsd: summary.costUsd ?? totalCost(report),
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens,
      cachedInputTokens: summary.cachedInputTokens,
      providers: summary.providers,
      peakTokens: summary.peakTokens,
      repeatedFailure: summary.repeatedFailure,
      log: logPath,
      branch: git.branch,
      commits: git.commits,
      base: runBase,
      checkpoint,
      quota,
      contextWindow,
      stoppedLeftovers: totalStoppedLeftovers > 0 ? totalStoppedLeftovers : undefined,
      note: note || undefined,
      startFailed: startFailure !== '' ? true : undefined,
      ...(start ? { startBranch: start.startBranch } : {}),
      ...(options.startedBy ? { startedBy: options.startedBy } : {}),
      ...(project ? { project, task, ...(!deferRecord ? { head: gitRead(project, ['rev-parse', 'HEAD']) || undefined } : {}) } : {}),
      ...(queue ? { queue } : {}),
      ...(failoverFrom ? { failoverFrom } : {}),
      ...(continueFrom !== '' ? { continues: continueFrom } : {}),
      ...(continueFrom !== '' && interruptedBy !== '' ? { interruptedBy } : {}),
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
        if (failedHead !== '') record.head = failedHead
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
        return { code: result.code ?? 1, killed, record, startHead: projectStart.head, startBranch: projectStart.branch, keepGit: true }
      }
      if (fallbackRun) {
        if (deferredProject) {
          if (failedHead !== '') record.head = failedHead
          writeFailedRecord()
        }
        return fallbackRun
      }
      if (deferredProject) return { code: result.code ?? 1, killed, record, startHead: projectStart.head, startBranch: projectStart.branch, keepGit: true }
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
