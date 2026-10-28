import { spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runsFolder } from './lanes-source.js'
import { programPath } from './programPath.js'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g

export function doctorSettings(options = {}, env = process.env, cwd = process.cwd()) {
  return {
    projectRoot: options.projectRoot ?? env.PROJECT_ROOT ?? cwd,
    runsFolder: options.runsFolder ?? runsFolder(env),
    lanesFile: options.lanesFile ?? join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
  }
}

function expand(bin, env) {
  let missing = ''
  const text = String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') {
      missing = name
      return whole
    }
    return value
  })
  return { text, missing }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function laneProgram(bin, env) {
  const expanded = expand(bin, env)
  if (expanded.missing) return { problem: `The environment variable ${expanded.missing} is not set.` }
  const path = expanded.text
  if (isAbsolute(path) || path.includes('/') || path.includes('\\')) {
    return isFile(path) ? { path } : { problem: null }
  }
  const endings = process.platform === 'win32' && !/\.(exe|com)$/i.test(path) ? [path, `${path}.exe`, `${path}.com`] : [path]
  for (const name of endings) {
    const found = programPath(name, { env })
    if (found) return { path: found }
  }
  return { problem: null }
}

function folderLine(projectRoot) {
  const folder = resolve(projectRoot)
  let stats
  try {
    stats = statSync(folder)
  } catch {
    return { ok: false, text: `The project folder ${folder} does not exist.` }
  }
  if (!stats.isDirectory()) return { ok: false, text: `The project folder ${folder} is not a folder.` }
  return { ok: true, text: `The project folder ${folder} exists.` }
}

function gitLine(env) {
  const found = programPath('git', { env })
  if (!found) return { ok: false, text: 'Git is not on the PATH.' }
  return { ok: true, text: `Git is found at ${found}.` }
}

function runsLine(folder) {
  const path = resolve(folder)
  try {
    const stats = statSync(path)
    if (!stats.isDirectory()) return { ok: false, text: `The runs folder ${path} is not a folder.` }
  } catch {
    try {
      mkdirSync(path, { recursive: true })
    } catch {
      return { ok: false, text: `The runs folder ${path} could not be made.` }
    }
  }
  try {
    accessSync(path, constants.W_OK)
  } catch {
    return { ok: false, text: `The runs folder ${path} cannot be written to.` }
  }
  return { ok: true, text: `The runs folder ${path} is ready.` }
}

function readLaneFile(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { problem: `The lane file ${file} could not be read.` }
  }
  let lanes
  try {
    lanes = JSON.parse(text)
  } catch {
    return { problem: `The lane file ${file} is not JSON.` }
  }
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) {
    return { problem: `The lane file ${file} is not a list of lanes.` }
  }
  return { lanes }
}

function laneLines(file, env) {
  const read = readLaneFile(file)
  if (read.problem) return [{ ok: false, text: read.problem }]
  const lines = []
  for (const [key, lane] of Object.entries(read.lanes)) {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) continue
    if (lane.retired === true) continue
    if (!lane.cli || typeof lane.cli !== 'object' || typeof lane.cli.bin !== 'string' || lane.cli.bin === '') continue
    const name = typeof lane.name === 'string' && lane.name ? lane.name : key
    const found = laneProgram(lane.cli.bin, env)
    if (found.path) {
      lines.push({ ok: true, text: `The ${name} lane starts from ${found.path}.` })
    } else if (found.problem) {
      lines.push({ ok: false, text: `The ${name} lane program cannot start. ${found.problem}` })
    } else {
      lines.push({ ok: false, text: `The ${name} lane program was not found: ${lane.cli.bin}.` })
    }
  }
  return lines
}

export function runDoctor(options = {}) {
  const env = options.env ?? process.env
  const settings = doctorSettings(options, env)
  const lines = []
  let ok = true

  function add(result) {
    if (!result.ok) ok = false
    lines.push(`${result.ok ? 'ok' : 'FAIL'} ${result.text}`)
  }

  add(folderLine(settings.projectRoot))
  add(gitLine(env))
  add(runsLine(settings.runsFolder))
  for (const line of laneLines(settings.lanesFile, env)) add(line)

  return { exitCode: ok ? 0 : 1, lines }
}

export function openProgramName(platform = process.platform) {
  if (platform === 'win32') return 'rundll32'
  if (platform === 'darwin') return 'open'
  return 'xdg-open'
}

export function openCommand(url, { platform = process.platform, env = process.env, check } = {}) {
  if (platform === 'win32') {
    const program = programPath('rundll32', { platform, env, check })
    if (!program) return null
    return { command: program, args: ['url.dll,FileProtocolHandler', url] }
  }
  if (platform === 'darwin') {
    const program = programPath('open', { platform, env, check })
    if (!program) return null
    return { command: program, args: [url] }
  }
  const program = programPath('xdg-open', { platform, env, check })
  if (!program) return null
  return { command: program, args: [url] }
}

export function openBrowser(url, options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const log = options.log ?? console.log
  const spawnImpl = options.spawn ?? spawn
  const target = openProgramName(platform)

  const plan = openCommand(url, { platform, env, check: options.check })
  if (!plan) {
    log(`The ${target} program was not found.`)
    return false
  }

  try {
    const child = spawnImpl(plan.command, plan.args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    })
    child.on?.('error', () => {
      log(`The ${target} program was not found.`)
    })
    child.unref?.()
    return true
  } catch {
    log(`The ${target} program was not found.`)
    return false
  }
}

export function upBlock(url) {
  return [
    'MachineRoom is running.',
    `machine-room: open ${url}`,
    'The room fills when a lane or a session works on the project.',
    'Press Ctrl+C in the terminal to stop the room.',
  ]
}

export function upArgs(args, cwd = process.cwd()) {
  const rest = [...args]
  const folder = rest[0] && !rest[0].startsWith('-') ? rest.shift() : cwd
  const root = resolve(cwd, folder)
  const open = !rest.includes('--no-open')
  const flags = rest.filter((arg) => arg !== '--no-open' && arg !== '--open')
  return { root, args: ['up', '--root', root, ...(open ? ['--open'] : []), ...flags] }
}
