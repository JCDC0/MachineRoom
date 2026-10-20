#!/usr/bin/env node
import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridge } from '../server/index.js'

const USAGE = [
  'Usage: machine-room [options]',
  '',
  '  --paperclip <url>   Paperclip address (PAPERCLIP_URL)',
  '  --company <id>      Paperclip company id (PAPERCLIP_COMPANY_ID)',
  '  --root <folder>     project folder (PROJECT_ROOT)',
  '  --port <n>          port to listen on (PORT)',
  '  --dist <folder>     built viewer folder (default: dist beside bin)',
  '  --help              show this help',
].join('\n')

const OPTION_NAMES = {
  '--paperclip': 'paperclipUrl',
  '--company': 'companyId',
  '--root': 'projectRoot',
  '--port': 'port',
  '--dist': 'dist',
}

function parseArgs(argv) {
  const options = { help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    const equals = arg.indexOf('=')
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    if (!Object.hasOwn(OPTION_NAMES, flag)) throw new Error(`Unknown option ${flag}.`)
    let value
    if (equals === -1) {
      index += 1
      value = argv[index]
    } else {
      value = arg.slice(equals + 1)
    }
    if (value === undefined || value === '') throw new Error(`Missing a value for ${flag}.`)
    options[OPTION_NAMES[flag]] = value
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

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  console.error(USAGE)
  process.exit(1)
}

if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

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

const bridge = createBridge({
  paperclipUrl: options.paperclipUrl,
  companyId: options.companyId,
  projectRoot: options.projectRoot,
  port: options.port,
  staticDir: dist,
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
