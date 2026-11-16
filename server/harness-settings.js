import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { maskKeys } from '../src/briefs/audit.js'
import { maskProfilePaths } from '../src/model/paths.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { resolveHarnessProgram, runCommand } from './harness-models.js'

export const HARNESS_OFF_PROBLEM = 'That harness is turned off in Settings.'
const CHECK_TTL_MS = 10 * 60 * 1000
const cache = new Map()

export const LANE_REPLIES = ['next-turn', 'interrupt']
export const LANE_COUNT_WARNING_PROBLEM = 'Write the lane count warning as a whole number, 0 or more.'
export const WORKTREE_SETUP_PROBLEM = 'Write the worktree setup as one command line.'

function laneCountWarningOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

export function worktreeSetupOf(settings) {
  return typeof settings?.worktreeSetup === 'string' ? settings.worktreeSetup.trim() : ''
}

export function worktreeCopiesProblem(copies, project) {
  if (!Array.isArray(copies) || copies.length > 20 || copies.some((path) => typeof path !== 'string' || !path.trim() || /[\r\n]/.test(path))) return 'Choose at most 20 file paths.'
  for (const path of copies) {
    if (isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) return 'Use project-relative paths for worktree copies.'
    const parts = path.split(/[\\/]/)
    if (parts.includes('..')) return 'Worktree copy paths cannot contain .. components.'
    if (parts.some((part) => part.toLowerCase() === '.git')) return 'Worktree copy paths cannot be inside .git.'
    try {
      if (project && statSync(join(project, path)).isDirectory()) return 'Worktree copies must be files, not folders.'
    } catch {}
  }
  return ''
}

export function readHarnessSettings(folder) {
  try {
    const data = JSON.parse(readFileSync(join(folder, 'harnesses.json'), 'utf8'))
    const worktreeSetup = worktreeSetupOf(data)
    return {
      programs: data?.programs && typeof data.programs === 'object' && !Array.isArray(data.programs) ? data.programs : {},
      off: Array.isArray(data?.off) ? data.off.filter((key) => typeof key === 'string') : [],
      laneReplies: data?.laneReplies === 'interrupt' ? 'interrupt' : 'next-turn',
      laneCountWarning: laneCountWarningOf(data?.laneCountWarning),
      worktreeCopies: worktreeCopiesProblem(data?.worktreeCopies) ? [] : data.worktreeCopies,
      ...(worktreeSetup ? { worktreeSetup } : {}),
    }
  } catch {
    return { programs: {}, off: [], laneReplies: 'next-turn', laneCountWarning: 0, worktreeCopies: [] }
  }
}

export function saveHarnessSettings(folder, settings, { rename = renameSync } = {}) {
  mkdirSync(folder, { recursive: true })
  const file = join(folder, 'harnesses.json')
  const content = `${JSON.stringify(settings, null, 2)}\n`
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, content, 'utf8')
  try {
    rename(temp, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temp)
    } catch {}
  }
}

export function updateHarnessSettings(folder, body, project) {
  const settings = readHarnessSettings(folder)
  if (Object.hasOwn(body ?? {}, 'worktreeSetup') || Object.hasOwn(body ?? {}, 'worktreeCopies')) {
    if (Object.hasOwn(body, 'program') || Object.hasOwn(body, 'enabled') || Object.hasOwn(body, 'laneReplies') || Object.hasOwn(body, 'laneCountWarning')) {
      return 'Change one setting at a time.'
    }
    if (Object.hasOwn(body, 'worktreeSetup')) {
      if (typeof body.worktreeSetup !== 'string' || /[\r\n]/.test(body.worktreeSetup)) return WORKTREE_SETUP_PROBLEM
      const command = body.worktreeSetup.trim()
      if (command) settings.worktreeSetup = command
      else delete settings.worktreeSetup
    }
    if (Object.hasOwn(body, 'worktreeCopies')) {
      const problem = worktreeCopiesProblem(body.worktreeCopies, project)
      if (problem) return problem
      settings.worktreeCopies = body.worktreeCopies
    }
    saveHarnessSettings(folder, settings)
    return ''
  }
  if (Object.hasOwn(body ?? {}, 'laneCountWarning')) {
    if (Object.hasOwn(body, 'program') || Object.hasOwn(body, 'enabled') || Object.hasOwn(body, 'laneReplies')) {
      return 'Change one setting at a time.'
    }
    if (!Number.isInteger(body.laneCountWarning) || body.laneCountWarning < 0) return LANE_COUNT_WARNING_PROBLEM
    settings.laneCountWarning = body.laneCountWarning
    saveHarnessSettings(folder, settings)
    return ''
  }
  if (Object.hasOwn(body ?? {}, 'laneReplies')) {
    if (Object.hasOwn(body, 'program') || Object.hasOwn(body, 'enabled')) return 'Change one setting at a time.'
    if (!LANE_REPLIES.includes(body.laneReplies)) return "Choose whether a reply waits for the lane's next turn or interrupts it at once."
    settings.laneReplies = body.laneReplies
    saveHarnessSettings(folder, settings)
    return ''
  }
  const key = body?.key
  if (typeof key !== 'string' || !Object.hasOwn(harnessByKey, key)) return 'Choose a known harness.'
  const hasProgram = Object.hasOwn(body, 'program')
  const hasEnabled = Object.hasOwn(body, 'enabled')
  if (hasProgram === hasEnabled) return 'Choose a program or whether the harness is enabled.'
  if (hasProgram) {
    const program = body.program
    if (typeof program !== 'string' || (program !== '' && (!isAbsolute(program) || !isFile(program)))) {
      return 'Choose an absolute path to a program file.'
    }
    if (program) settings.programs[key] = program
    else delete settings.programs[key]
  } else {
    if (typeof body.enabled !== 'boolean') return 'Choose whether the harness is enabled.'
    settings.off = settings.off.filter((item) => item !== key)
    if (!body.enabled) settings.off.push(key)
  }
  saveHarnessSettings(folder, settings)
  clearHarnessChecks(folder)
  return ''
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function versionLine(stdout) {
  const line = String(stdout ?? '').split(/\r?\n/)[0]
  return maskKeys(maskProfilePaths(line)).text.slice(0, 80)
}

export function clearHarnessChecks(folder) {
  cache.delete(folder)
}

export async function harnessStatus(key, { runsFolder, lanes, env, platform, available }) {
  const settings = readHarnessSettings(runsFolder)
  const enabled = !settings.off.includes(key)
  const laneCountWarning = settings.laneCountWarning
  const worktreeSetup = worktreeSetupOf(settings)
  const worktreeCopies = settings.worktreeCopies
  if (key === 'machineroom') {
    return {
      enabled,
      ready: available,
      program: '',
      version: '',
      reason: available ? '' : 'No key or endpoint is saved.',
      laneCountWarning,
      worktreeSetup,
      worktreeCopies,
    }
  }
  const program = resolveHarnessProgram(key, { runsFolder, lanes, env, platform })
  if (!program) return { enabled, ready: false, program: '', version: '', reason: 'No program was found.', laneCountWarning, worktreeSetup, worktreeCopies }
  let checks = cache.get(runsFolder)
  if (!checks) {
    checks = new Map()
    cache.set(runsFolder, checks)
  }
  let entry = checks.get(key)
  if (!entry || entry.program !== program || Date.now() - entry.at >= CHECK_TTL_MS) {
    entry = { program, at: Date.now(), result: runCommand(program, ['--version'], { env, platform, timeoutMs: 5000 }) }
    checks.set(key, entry)
  }
  const result = await entry.result
  const ready = result.ok
  return {
    enabled,
    ready,
    program: maskProfilePaths(program),
    version: ready ? versionLine(result.stdout) : '',
    reason: ready ? '' : 'The program did not answer a version check.',
    laneCountWarning,
    worktreeSetup,
    worktreeCopies,
  }
}
