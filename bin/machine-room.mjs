#!/usr/bin/env node
import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDoctor } from '../server/doctor.js'
import { createBridge } from '../server/index.js'

const USAGE = [
  'Usage: machine-room [options]',
  '       machine-room up [options]',
  '       machine-room doctor [options]',
  '',
  'Commands:',
  '  up                  run the doctor checks, then serve the room whether they pass or not',
  '  doctor              check Paperclip, its routes, the company, the folder and the backups',
  '',
  'Options:',
  '  --paperclip <url>   Paperclip address (PAPERCLIP_URL)',
  '  --company <id>      Paperclip company id (PAPERCLIP_COMPANY_ID)',
  '  --root <folder>     project folder (PROJECT_ROOT)',
  '  --port <n>          port to listen on (PORT)',
  '  --dist <folder>     built viewer folder (default: dist beside bin)',
  '  --lanes             show lane runs live from the run-lane logs (MACHINEROOM_LANES=1)',
  '  --sessions          show Claude Code and OpenCode sessions on the project live (MACHINEROOM_SESSIONS=1)',
  '  --help              show this help',
].join('\n')

const OPTION_NAMES = {
  '--paperclip': 'paperclipUrl',
  '--company': 'companyId',
  '--root': 'projectRoot',
  '--port': 'port',
  '--dist': 'dist',
}

const DOCTOR_OPTION_NAMES = {
  '--paperclip': 'paperclipUrl',
  '--company': 'companyId',
  '--root': 'projectRoot',
}

const FLAGS = new Set(['--lanes', '--sessions'])

const SOME_CHECKS_FAILED = 'Some checks failed. The room opens anyway; features whose routes changed stay off.'
const PAPERCLIP_NOT_RUNNING = 'Paperclip is not running. Start it yourself with paperclipai run; machine-room never starts it.'
const PAPERCLIP_NOT_NEEDED = 'Paperclip is not running, and the lane and session sources do not need it.'

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
    if (FLAGS.has(flag)) {
      options[flag.slice(2)] = true
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
    console.error('Build the viewer first with npm run build.')
    process.exit(1)
  }

  return dist
}

async function startRoom(options, dist) {
  const bridge = createBridge({
    paperclipUrl: options.paperclipUrl,
    companyId: options.companyId,
    projectRoot: options.projectRoot,
    port: options.port,
    staticDir: dist,
    lanesSource: options.lanes === true,
    sessionsSource: options.sessions === true,
  })

  let info
  try {
    info = await bridge.start()
  } catch (error) {
    console.error(`machine-room could not start: ${error.message}`)
    process.exit(1)
  }

  console.log(`machine-room: open http://127.0.0.1:${info.port}/?live&bridge=http://127.0.0.1:${info.port}`)

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
  await startRoom(options, dist)
}

async function up(options) {
  const dist = prepare(options)
  const result = await runDoctor(options)
  const ownSources = options.lanes === true || options.sessions === true
  if (result.paperclipDown && ownSources) {
    for (const line of result.lines) if (!line.startsWith('FAIL Paperclip')) console.log(line)
    console.log(PAPERCLIP_NOT_NEEDED)
    await startRoom(options, dist)
    return
  }
  for (const line of result.lines) console.log(line)
  if (result.paperclipDown) {
    console.log(PAPERCLIP_NOT_RUNNING)
  } else if (result.exitCode !== 0) {
    console.log(SOME_CHECKS_FAILED)
  }
  await startRoom(options, dist)
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
  const result = await runDoctor(options)
  for (const line of result.lines) console.log(line)
  process.exitCode = result.exitCode
} else if (command === 'up') {
  await up(options)
} else {
  await serve(options)
}
