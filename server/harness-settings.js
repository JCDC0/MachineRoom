import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { maskKeys } from '../src/briefs/audit.js'
import { maskProfilePaths } from '../src/model/paths.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { resolveHarnessProgram, runCommand } from './harness-models.js'

export const HARNESS_OFF_PROBLEM = 'That harness is turned off in Settings.'
const CHECK_TTL_MS = 10 * 60 * 1000
const cache = new Map()

export function readHarnessSettings(folder) {
  try {
    const data = JSON.parse(readFileSync(join(folder, 'harnesses.json'), 'utf8'))
    return {
      programs: data?.programs && typeof data.programs === 'object' && !Array.isArray(data.programs) ? data.programs : {},
      off: Array.isArray(data?.off) ? data.off.filter((key) => typeof key === 'string') : [],
    }
  } catch {
    return { programs: {}, off: [] }
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

export function updateHarnessSettings(folder, body) {
  const key = body?.key
  if (typeof key !== 'string' || !Object.hasOwn(harnessByKey, key)) return 'Choose a known harness.'
  const hasProgram = Object.hasOwn(body, 'program')
  const hasEnabled = Object.hasOwn(body, 'enabled')
  if (hasProgram === hasEnabled) return 'Choose a program or whether the harness is enabled.'
  const settings = readHarnessSettings(folder)
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
  if (key === 'machineroom') {
    return { enabled, ready: available, program: '', version: '', reason: available ? '' : 'No key or endpoint is saved.' }
  }
  const program = resolveHarnessProgram(key, { runsFolder, lanes, env, platform })
  if (!program) return { enabled, ready: false, program: '', version: '', reason: 'No program was found.' }
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
  }
}
