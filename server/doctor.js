import { spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTree } from './index.js'
import { lanesFolder, runsFolder } from './lanes-source.js'
import { programPath } from './programPath.js'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g

export const ALL_CHECKS_PASSED = 'All checks passed.'
export const NEXT_STEP = 'Start a lane with npm run run-lane -- opencode T2, or press C in the room for Dispatch.'
export const PROJECT_READ_LIMIT_MS = 10000
const PROJECT_READ_TIMEOUT = 'The folder did not answer in time.'
const PROJECT_READ_FAILED = 'The folder could not be listed.'
const PROJECT_READ_EMPTY = 'The read returned no file list.'

export function doctorSettings(options = {}, env = process.env, cwd = process.cwd()) {
  return {
    projectRoot: options.projectRoot ?? env.PROJECT_ROOT ?? cwd,
    runsFolder: options.runsFolder ?? runsFolder(env),
    lanesFile: options.lanesFile ?? join(lanesFolder(env), 'lanes.json'),
    dist: resolve(options.dist ?? join(REPO_ROOT, 'dist')),
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

function insideGitRepository(projectRoot) {
  let current = resolve(projectRoot)
  for (;;) {
    let dotGit = null
    try {
      dotGit = statSync(join(current, '.git'))
    } catch {}
    if (dotGit) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function gitLines(projectRoot, env) {
  const found = programPath('git', { env })
  if (!found) return [{ ok: false, text: 'Git is not on the PATH.' }]
  const lines = [{ ok: true, text: `Git is found at ${found}.` }]
  const folder = resolve(projectRoot)
  let folderExists = false
  try {
    folderExists = statSync(folder).isDirectory()
  } catch {}
  if (folderExists && !insideGitRepository(folder)) {
    lines.push({
      warn: true,
      text: 'This folder is not a git repository. Source control stays empty. Run git init here to fill it.',
    })
  }
  return lines
}

function viewerLine(dist) {
  const index = join(dist, 'index.html')
  if (isFile(index)) return { ok: true, text: `The built viewer is ready in ${dist}.` }
  return { ok: false, text: `The built viewer is missing ${index}. Run npm run build in ${REPO_ROOT}.` }
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
    if (result.warn) {
      lines.push(`warn ${result.text}`)
      return
    }
    if (!result.ok) ok = false
    lines.push(`${result.ok ? 'ok' : 'FAIL'} ${result.text}`)
  }

  const folder = folderLine(settings.projectRoot)
  add(folder)
  for (const line of gitLines(settings.projectRoot, env)) add(line)
  add(viewerLine(settings.dist))
  add(runsLine(settings.runsFolder))
  for (const line of laneLines(settings.lanesFile, env)) add(line)

  return { exitCode: ok ? 0 : 1, lines, folderOk: folder.ok }
}

export function projectCounts(files) {
  const folders = new Set()
  let count = 0
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file !== 'string' || file === '') continue
    count += 1
    const parts = file.split('/')
    if (parts.length === 1) folders.add('')
    for (let depth = 1; depth < parts.length; depth += 1) folders.add(parts.slice(0, depth).join('/'))
  }
  return { files: count, folders: folders.size }
}

export function projectLine(files) {
  const counts = projectCounts(files)
  const fileWord = counts.files === 1 ? 'file' : 'files'
  const folderWord = counts.folders === 1 ? 'folder' : 'folders'
  return { ok: true, text: `The project holds ${counts.files} ${fileWord} in ${counts.folders} ${folderWord}.` }
}

export async function readProjectLine(projectRoot, { read = readTree, limit = PROJECT_READ_LIMIT_MS } = {}) {
  let timer = null
  try {
    const tree = await Promise.race([
      Promise.resolve().then(() => read(projectRoot)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(PROJECT_READ_TIMEOUT)), limit)
      }),
    ])
    if (!tree || !Array.isArray(tree.files)) {
      return { ok: false, text: `The project could not be read: ${PROJECT_READ_EMPTY}`, tree: null }
    }
    return { ...projectLine(tree.files), tree }
  } catch (error) {
    const reason = error instanceof Error && error.message === PROJECT_READ_TIMEOUT ? PROJECT_READ_TIMEOUT : PROJECT_READ_FAILED
    return { ok: false, text: `The project could not be read: ${reason}`, tree: null }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

export async function runDoctorWithProject(options = {}) {
  const env = options.env ?? process.env
  const result = runDoctor(options)
  if (!result.folderOk) return { ...result, project: null, tree: null }
  const project = await readProjectLine(doctorSettings(options, env).projectRoot, {
    read: options.readProject ?? readTree,
    limit: options.projectReadLimitMs ?? PROJECT_READ_LIMIT_MS,
  })
  const lines = [...result.lines]
  lines.splice(1, 0, `${project.ok ? 'ok' : 'FAIL'} ${project.text}`)
  return {
    ...result,
    lines,
    project: { ok: project.ok, text: project.text },
    tree: project.ok ? project.tree : null,
    exitCode: project.ok ? result.exitCode : 1,
  }
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

export function upBlock(url, { pid = process.pid, port } = {}) {
  const actualPort = port ?? new URL(url).port
  return [
    'MachineRoom is running.',
    `machine-room: pid ${pid}, port ${actualPort}`,
    `machine-room: open ${url}`,
    'The room fills when a lane or a session works on the project.',
    NEXT_STEP,
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
