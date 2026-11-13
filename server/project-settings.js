import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkCommandProblem as runnerCheckCommandProblem } from '../src/briefs/run.js'
import { projectHash } from './active-lanes.js'

export const CHECK_COMMAND_LIMIT = 500
export const CHECK_COMMAND_PROBLEM = 'Write the check command as one line of 1 to 500 characters.'
export const CHECK_ORIGIN_PROBLEM = 'A request to save the check command needs a page Origin.'
export const CHECK_CONFIRM_PROBLEM = 'Confirm the check command first.'
export const METHOD_NOT_ALLOWED_PROBLEM = 'Method not allowed.'

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
  if (/[\r\n]/.test(text)) return CHECK_COMMAND_PROBLEM
  const runnerProblem = runnerCheckCommandProblem(text)
  if (runnerProblem) return runnerProblem
  return null
}

export function readProjectSettings(file) {
  try {
    if (!existsSync(file)) return { checkCommand: '' }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const value = parsed && typeof parsed === 'object' && typeof parsed.checkCommand === 'string'
      ? parsed.checkCommand.trim()
      : ''
    if (checkCommandProblem(value)) return { checkCommand: '' }
    return { checkCommand: value }
  } catch {
    return { checkCommand: '' }
  }
}

export function writeProjectSettings(file, checkCommand) {
  const text = typeof checkCommand === 'string' ? checkCommand.trim() : ''
  const content = `${JSON.stringify(text === '' ? {} : { checkCommand: text }, null, 2)}\n`
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
  const answer = () => ({
    checkCommand: readProjectSettings(file()).checkCommand,
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
    if (body.confirmed !== true) {
      sendJson(req, res, 400, { error: CHECK_CONFIRM_PROBLEM })
      return true
    }
    const problem = checkCommandProblem(body.checkCommand)
    if (problem) {
      sendJson(req, res, 400, { error: problem })
      return true
    }
    const checkCommand = typeof body.checkCommand === 'string' ? body.checkCommand.trim() : ''
    try {
      writeProjectSettings(file(), checkCommand)
    } catch {
      sendJson(req, res, 500, { error: 'The bridge could not save the check command.' })
      return true
    }
    notify({ topic: 'project-settings' })
    sendJson(req, res, 200, { checkCommand, hasTestScript: hasNpmTestScript(projectRoot) })
    return true
  }

  return { handle, file, read: answer }
}
