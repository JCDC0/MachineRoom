#!/usr/bin/env node
import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CHECKS_PASSED, NEXT_STEP, openBrowser, runDoctorWithProject, upBlock } from '../server/doctor.js'
import { createBridge } from '../server/index.js'

const USAGE = [
  'Usage: machine-room [options]',
  '       machine-room up [options]',
  '       machine-room doctor [options]',
  '',
  'Commands:',
  '  up                  run the doctor checks, then serve the room with the lane and session sources on',
  '  doctor              check the folder, the project files, git, the runs folder and the lane programs',
  '',
  'Options:',
  '  --root <folder>     project folder (PROJECT_ROOT)',
  '  --port <n>          port to listen on (PORT)',
  '  --dist <folder>     built viewer folder (default: dist beside bin)',
  '  --lanes             show lane runs live from the run-lane logs (MACHINEROOM_LANES=1)',
  '  --sessions          show Claude Code and OpenCode sessions on the project live (MACHINEROOM_SESSIONS=1)',
  '  --no-sessions       keep the session source off when up runs it by default',
  '  --no-open           keep up from opening the browser',
  '  --open              open the room in the default browser',
  '  --help              show this help',
].join('\n')

const OPTION_NAMES = {
  '--root': 'projectRoot',
  '--port': 'port',
  '--dist': 'dist',
}

const DOCTOR_OPTION_NAMES = {
  '--root': 'projectRoot',
  '--dist': 'dist',
}

const FLAGS = {
  '--lanes': 'lanes',
  '--sessions': 'sessions',
  '--no-sessions': 'noSessions',
  '--no-open': 'noOpen',
  '--open': 'open',
}

const SOME_CHECKS_FAILED = 'Some checks failed. The room opens anyway.'

function parseArgs(argv, names = OPTION_NAMES) {
  const options = { help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    const equals = arg.indexOf('=')
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    if (Object.hasOwn(FLAGS, flag)) {
      options[FLAGS[flag]] = true
      continue
    }
    if (!Object.hasOwn(names, flag)) throw new Error(`Unknown option ${flag}.`)
    let value
    if (equals === -1) {
      index += 1
      value = argv[index]
    } else {
      value = arg.slice(equals + 1)
    }
    if (value === undefined || value === '') throw new Error(`Missing a value for ${flag}.`)
    options[names[flag]] = value
  }
  return options
}

function hasIndex(folder) {
  try {
    return statSync(join(folder, 'index.html')).isFile()
  } catch {
    return false
  }
}

function prepare(options) {
  if (options.port !== undefined) {
    const port = Number(options.port)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error('The port must be a whole number from 0 to 65535.')
      process.exit(1)
    }
    options.port = port
  }

  const binDir = dirname(fileURLToPath(import.meta.url))
  const dist = resolve(options.dist ?? join(binDir, '..', 'dist'))

  if (!hasIndex(dist)) {
    console.error(`Build the viewer first with npm run build. Run it in ${resolve(binDir, '..')}.`)
    process.exit(1)
  }

  return dist
}

async function startRoom(options, dist, { block = false } = {}) {
  let bridge
  let info
  let activePort = options.port
  let currentRoot = options.projectRoot

  function startOn(root) {
    bridge = createBridge({
      projectRoot: root,
      port: activePort,
      staticDir: dist,
      lanesSource: options.lanes === true,
      sessionsSource: options.sessions === true,
      onOpenProject,
    })
    return bridge.start()
  }

  async function onOpenProject(newPath) {
    if (bridge) {
      await bridge.stop()
    }
    const oldRoot = currentRoot
    activePort = info.port
    try {
      info = await startOn(newPath)
      currentRoot = newPath
      activePort = info.port
    } catch (error) {
      console.error(`machine-room could not open ${newPath}: ${error.message}`)
      try {
        info = await startOn(oldRoot)
        console.log(`MachineRoom stayed on ${oldRoot}.`)
      } catch (again) {
        console.error(`machine-room could not restart: ${again.message}`)
      }
      return
    }
    const newUrl = `http://127.0.0.1:${info.port}/?live&bridge=http://127.0.0.1:${info.port}`
    console.log(`MachineRoom moved to ${newPath}.`)
    console.log(`machine-room: open ${newUrl}`)
  }

  try {
    bridge = createBridge({
      projectRoot: currentRoot,
      port: activePort,
      staticDir: dist,
      lanesSource: options.lanes === true,
      sessionsSource: options.sessions === true,
      onOpenProject,
    })
    info = await bridge.start()
    activePort = info.port
  } catch (error) {
    console.error(`machine-room could not start: ${error.message}`)
    process.exit(1)
  }

  const url = `http://127.0.0.1:${info.port}/?live&bridge=http://127.0.0.1:${info.port}`
  if (block) {
    for (const line of upBlock(url, { pid: process.pid, port: info.port })) console.log(line)
  } else {
    console.log(`machine-room: open ${url}`)
  }

  if (options.open) {
    openBrowser(url)
  }

  let stopping = false
  async function shutdown() {
    if (stopping) return
    stopping = true
    try {
      await bridge.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => {
    shutdown()
  })
  process.on('SIGTERM', () => {
    shutdown()
  })
}

async function serve(options) {
  const dist = prepare(options)
  await startRoom(options, dist, { block: false })
}

async function up(options) {
  const dist = prepare(options)
  options.dist = dist
  if (options.noOpen === true) options.open = false
  options.lanes = true
  options.sessions = options.noSessions !== true
  const result = await runDoctorWithProject(options)
  for (const line of result.lines) console.log(line)
  if (!result.folderOk) process.exit(1)
  if (result.exitCode !== 0) console.log(SOME_CHECKS_FAILED)
  else console.log(ALL_CHECKS_PASSED)
  await startRoom(options, dist, { block: true })
}

const argv = process.argv.slice(2)
const command = argv[0] === 'doctor' || argv[0] === 'up' ? argv[0] : 'serve'

const names = command === 'doctor' ? DOCTOR_OPTION_NAMES : OPTION_NAMES

let options
try {
  options = parseArgs(command === 'serve' ? argv : argv.slice(1), names)
} catch (error) {
  console.error(error.message)
  console.error(USAGE)
  process.exit(1)
}

if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

if (command === 'doctor') {
  const result = await runDoctorWithProject(options)
  for (const line of result.lines) console.log(line)
  if (result.exitCode === 0) {
    console.log(ALL_CHECKS_PASSED)
    console.log(NEXT_STEP)
  }
  process.exitCode = result.exitCode
} else if (command === 'up') {
  await up(options)
} else {
  await serve(options)
}
