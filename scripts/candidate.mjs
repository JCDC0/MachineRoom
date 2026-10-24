#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { killTree as killProcessTree, treeSpawnOptions } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'

export const DEFAULT_PORT = 5175
export const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const BAD_BUILD_COMMAND = 'MACHINEROOM_BUILD_COMMAND needs a JSON array of the command and its arguments.'
const BAD_PORT = 'The port must be a whole number from 1 to 65535.'
const NPM_NOT_FOUND = 'npm was not found. Run this as npm run candidate.'
const GIT_TIMEOUT_MS = 10 * 1000
const SECRET_NAME = /(^|_)(KEY|TOKEN|SECRET|PASSWORD)$|API_?KEY/i

const USAGE = [
  'Usage: npm run candidate -- LANE [options]',
  '',
  "Build a lane's viewer and serve it beside the stable room.",
  '',
  'Options:',
  '  --port <n>         port for the candidate, default 5175',
  '  --root <folder>    pass a project folder to the candidate',
  '  --help             show this help',
].join('\n')

const OPTION_NAMES = {
  '--port': 'port',
  '--root': 'projectRoot',
}

function checkPort(port) {
  const number = Number(port)
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(BAD_PORT)
  return number
}

export function parseCandidateArgs(argv) {
  const options = {
    lane: '',
    port: DEFAULT_PORT,
    projectRoot: '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    const equals = arg.indexOf('=')
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    if (Object.hasOwn(OPTION_NAMES, flag)) {
      let value
      if (equals === -1) {
        index += 1
        value = argv[index]
      } else {
        value = arg.slice(equals + 1)
      }
      if (value === undefined || value === '') throw new Error(`Missing a value for ${flag}.`)
      options[OPTION_NAMES[flag]] = value
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${flag}.`)
    if (options.lane) throw new Error('Give one lane to try.')
    options.lane = arg
  }
  options.port = checkPort(options.port)
  if (!options.help && !options.lane) throw new Error('Give a lane to try, for example npm run candidate -- opencode.')
  return options
}

export function laneEnv(env = process.env) {
  const kept = {}
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME.test(name)) kept[name] = value
  }
  return kept
}

export function candidatePlan({ lanes, lane, port } = {}) {
  const known = lanes && typeof lanes === 'object' && typeof lane === 'string' && lane !== '' && Object.hasOwn(lanes, lane)
  if (!known) throw new Error(`The lane ${lane} is not in lanes.json.`)
  const info = lanes[lane]
  if (!info || typeof info !== 'object' || !Object.hasOwn(info, 'worktree') || typeof info.worktree !== 'string' || info.worktree === '') {
    throw new Error(`The lane ${lane} has no worktree.`)
  }
  return {
    lane,
    worktree: info.worktree,
    port: checkPort(port === undefined ? DEFAULT_PORT : port),
    dist: join(info.worktree, 'dist'),
    bin: join(info.worktree, 'bin', 'machine-room.mjs'),
  }
}

function npmCliPath(env, execPath) {
  const fromEnv = env.npm_execpath
  if (fromEnv && fromEnv.endsWith('.js') && existsSync(fromEnv)) return fromEnv
  const besideNode = join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(besideNode)) return besideNode
  return null
}

export function buildCommand(env = process.env, execPath = process.execPath) {
  const raw = env.MACHINEROOM_BUILD_COMMAND
  if (typeof raw === 'string' && raw.trim() !== '') {
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error(BAD_BUILD_COMMAND)
    }
    if (!Array.isArray(value) || value.length === 0) throw new Error(BAD_BUILD_COMMAND)
    const parts = value.map((part) => String(part))
    if (parts.some((part) => part.trim() === '')) throw new Error(BAD_BUILD_COMMAND)
    return { command: parts, shell: false }
  }
  const npmCli = npmCliPath(env, execPath)
  if (npmCli) return { command: [execPath, npmCli, 'run', 'build'], shell: false }
  throw new Error(NPM_NOT_FOUND)
}

function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  killProcessTree(child)
}

export function runBuild({ command, cwd, env = process.env, shell = false, timeoutMs = BUILD_TIMEOUT_MS }) {
  return new Promise((settle) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(),
    })
    const lines = []
    let timedOut = false
    let settled = false
    const collect = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line !== '') lines.push(line)
      }
      while (lines.length > 500) lines.shift()
    }
    const finish = (result) => {
      if (settled) return
      settled = true
      settle({ ...result, lines: lines.slice(-20) })
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, code: null, timedOut, error })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      finish({ ok: !timedOut && code === 0, code, timedOut, error: null })
    })
  })
}

function gitText(cwd, args, env) {
  return new Promise((settle, fail) => {
    execFile(
      gitPath(),
      args,
      {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          error.gitStderr = String(stderr ?? '')
          fail(error)
          return
        }
        settle(String(stdout))
      },
    )
  })
}

export async function worktreeState(worktree, env = process.env) {
  let branch
  let head
  let status
  try {
    const values = await Promise.all([
      gitText(worktree, ['branch', '--show-current'], env),
      gitText(worktree, ['rev-parse', 'HEAD'], env),
      gitText(worktree, ['status', '--porcelain'], env),
    ])
    branch = values[0]
    head = values[1]
    status = values[2]
  } catch (error) {
    if (/not a git repository/i.test(String(error?.gitStderr ?? ''))) throw new Error('That worktree is not a git repository.')
    throw new Error('The worktree could not be read.')
  }
  return { branch: branch.trim(), sha: head.trim().slice(0, 7), dirty: status.trim() !== '' }
}

export function portIsFree(port) {
  return new Promise((settle) => {
    const server = createServer()
    server.once('error', () => settle(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => settle(true))
    })
  })
}

export function readLanes(cwd = process.cwd()) {
  let text
  try {
    text = readFileSync(join(cwd, 'docs', 'agents', 'lanes.json'), 'utf8')
  } catch {
    throw new Error('The lane file is missing.')
  }
  let lanes
  try {
    lanes = JSON.parse(text)
  } catch {
    throw new Error('The lane file is not valid.')
  }
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) throw new Error('The lane file is not valid.')
  return lanes
}

export function candidateArgs(plan, options) {
  const args = [plan.bin, '--dist', plan.dist, '--port', String(plan.port)]
  if (options.projectRoot) args.push('--root', options.projectRoot)
  return args
}

export function candidateLine(plan, state) {
  return `Candidate from ${plan.lane} (${state.branch || 'detached'} at ${state.sha}) on http://127.0.0.1:${plan.port}/?live&bridge=http://127.0.0.1:${plan.port}. The stable room keeps its own port.`
}

function startCandidate({ plan, options, env, stdio }) {
  return spawn(process.execPath, candidateArgs(plan, options), {
    cwd: plan.worktree,
    env,
    windowsHide: true,
    stdio,
  })
}

function waitForChild(child) {
  return new Promise((settle, fail) => {
    child.once('error', fail)
    child.once('exit', (code, signal) => {
      settle(code ?? (signal ? 1 : 0))
    })
  })
}

export async function runCandidate({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  log = console.log,
  error = console.error,
  onChild = null,
  stdio = 'inherit',
} = {}) {
  const options = parseCandidateArgs(argv)
  if (options.help) {
    log(USAGE)
    return 0
  }
  if (!(await portIsFree(options.port))) throw new Error(`Port ${options.port} is in use. Pass --port.`)
  const lanes = readLanes(cwd)
  const plan = candidatePlan({ lanes, lane: options.lane, port: options.port })
  const state = await worktreeState(plan.worktree, env)
  if (state.dirty) throw new Error('The lane has uncommitted changes. Commit them first.')
  const build = buildCommand(env)
  const childEnv = laneEnv(env)
  const built = await runBuild({ command: build.command, cwd: plan.worktree, env: childEnv, shell: build.shell })
  if (!built.ok) {
    error(built.timedOut ? 'The build ran past 5 minutes.' : 'The build failed.')
    for (const line of built.lines) error(line)
    return 1
  }
  const child = startCandidate({ plan, options, env: childEnv, stdio })
  if (onChild) onChild(child)
  log(candidateLine(plan, state))
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT')
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    return await waitForChild(child)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCandidate()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
