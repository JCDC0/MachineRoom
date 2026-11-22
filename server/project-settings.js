import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkCommandProblem as runnerCheckCommandProblem } from '../src/briefs/run.js'
import { projectHash } from './active-lanes.js'

const CHECK_COMMAND_LIMIT = 500
export const CHECK_COMMAND_PROBLEM = 'Write the check command as up to 4 commands, one per line, in 500 characters or fewer.'
export const PLAN_BY_DEFAULT_PROBLEM = 'Choose whether new runs start in Plan.'
const CHECK_ORIGIN_PROBLEM = 'A request to save the check command needs a page Origin.'
const CHECK_CONFIRM_PROBLEM = 'Confirm the check command first.'
const METHOD_NOT_ALLOWED_PROBLEM = 'Method not allowed.'

export function projectSettingsFileFor(projectRoot, runsFolder) {
  const hash = projectHash(projectRoot)
  return join(runsFolder, `project-settings-${hash}.json`)
}

export function checkCommandProblem(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return CHECK_COMMAND_PROBLEM
  const text = value.trim()
  if (text === '') return null
  if (text.length > CHECK_COMMAND_LIMIT) return CHECK_COMMAND_PROBLEM
  const runnerProblem = runnerCheckCommandProblem(text)
  if (runnerProblem) return runnerProblem
  return null
}

export function readProjectSettings(file) {
  try {
    if (!existsSync(file)) return { checkCommand: '', planByDefault: false }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const planByDefault = Boolean(parsed && typeof parsed === 'object' && parsed.planByDefault === true)
    const value = parsed && typeof parsed === 'object' && typeof parsed.checkCommand === 'string'
      ? parsed.checkCommand.trim()
      : ''
    if (checkCommandProblem(value)) return { checkCommand: '', planByDefault }
    return { checkCommand: value, planByDefault }
  } catch {
    return { checkCommand: '', planByDefault: false }
  }
}

export function writeProjectSettings(file, settings) {
  const isObject = settings !== null && typeof settings === 'object' && !Array.isArray(settings)
  const rawCommand = isObject ? settings.checkCommand : settings
  const text = typeof rawCommand === 'string' ? rawCommand.trim() : ''
  const planByDefault = isObject && settings.planByDefault === true
  const payload = {}
  if (text !== '') payload.checkCommand = text
  if (planByDefault) payload.planByDefault = true
  const content = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    renameSync(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function hasNpmTestScript(projectRoot) {
  if (!projectRoot) return false
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    const script = pkg?.scripts?.test
    return typeof script === 'string' && script.trim() !== ''
  } catch {
    return false
  }
}

export function readProjectCheckCommand(projectRoot, runsFolder) {
  return readProjectSettings(projectSettingsFileFor(projectRoot, runsFolder)).checkCommand
}

export function createProjectSettingsApi({
  projectRoot = '',
  runsFolder = '',
  sendJson,
  readJsonBody,
  notify = () => {},
} = {}) {
  const folder = () => (typeof runsFolder === 'function' ? runsFolder() : runsFolder)
  const file = () => projectSettingsFileFor(projectRoot, folder())
  const answer = (saved = readProjectSettings(file())) => ({
    checkCommand: saved.checkCommand,
    planByDefault: saved.planByDefault,
    hasTestScript: hasNpmTestScript(projectRoot),
  })

  async function handle(req, res, url) {
    if (url.pathname !== '/api/control/project-settings') return false
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      sendJson(req, res, 200, answer())
      return true
    }
    if (method !== 'POST') {
      sendJson(req, res, 405, { error: METHOD_NOT_ALLOWED_PROBLEM })
      return true
    }
    if (!req.headers.origin) {
      sendJson(req, res, 403, { error: CHECK_ORIGIN_PROBLEM })
      return true
    }
    const body = await readJsonBody(req, res)
    if (body === null) return true
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true) {
      sendJson(req, res, 400, { error: CHECK_CONFIRM_PROBLEM })
      return true
    }
    const hasCheckCommand = Object.hasOwn(body, 'checkCommand') && body.checkCommand !== undefined
    const hasPlanByDefault = Object.hasOwn(body, 'planByDefault') && body.planByDefault !== undefined
    if (hasCheckCommand) {
      const problem = checkCommandProblem(body.checkCommand)
      if (problem) {
        sendJson(req, res, 400, { error: problem })
        return true
      }
    }
    if (hasPlanByDefault && typeof body.planByDefault !== 'boolean') {
      sendJson(req, res, 400, { error: PLAN_BY_DEFAULT_PROBLEM })
      return true
    }
    const current = readProjectSettings(file())
    const next = {
      checkCommand: hasCheckCommand
        ? (typeof body.checkCommand === 'string' ? body.checkCommand.trim() : '')
        : current.checkCommand,
      planByDefault: hasPlanByDefault ? body.planByDefault : current.planByDefault,
    }
    try {
      writeProjectSettings(file(), next)
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not save the project settings.' })
      return true
    }
    notify({ topic: 'project-settings' })
    sendJson(req, res, 200, answer(next))
    return true
  }

  return { handle, file, read: answer }
}
