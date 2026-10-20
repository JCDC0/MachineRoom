import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { compareSurface, describeSurface, normalizePaperclipUrl, readSpec, shownPaperclipUrl } from './surface.js'

const CHECK_TIMEOUT_MS = 10000
const BACKUP_MAX_AGE_HOURS = 24
const BACKUP_HINT = 'Make one with paperclipai db:backup while Paperclip runs.'

export function doctorSettings(options = {}, env = process.env, cwd = process.cwd()) {
  return {
    paperclipUrl: options.paperclipUrl ?? env.PAPERCLIP_URL ?? 'http://127.0.0.1:3100',
    companyId: options.companyId ?? env.PAPERCLIP_COMPANY_ID ?? '',
    projectRoot: options.projectRoot ?? env.PROJECT_ROOT ?? cwd,
  }
}

function warningCodes(block) {
  const warnings = Array.isArray(block?.warnings) ? block.warnings : []
  return warnings.map((warning) => warning?.code).filter((code) => typeof code === 'string' && code !== '')
}

function ageHoursOf(latest, now) {
  if (Number.isFinite(latest?.ageHours)) return latest.ageHours
  if (typeof latest?.mtime !== 'string' || latest.mtime === '') return null
  const time = Date.parse(latest.mtime)
  if (!Number.isFinite(time)) return null
  return (now - time) / 3600000
}

function hoursText(hours) {
  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function backupLine(block, now) {
  if (!block || typeof block !== 'object') {
    return { ok: false, text: `Automatic database backups are off. ${BACKUP_HINT}` }
  }
  const codes = warningCodes(block)
  const warningText = codes.length > 0 ? ` Paperclip warns ${codes.join(', ')}.` : ''
  if (block.enabled !== true) {
    return { ok: false, text: `Automatic database backups are off.${warningText} ${BACKUP_HINT}` }
  }
  const latest = block.latestBackup
  if (!latest || typeof latest !== 'object') {
    return { ok: false, text: `No database backup found.${warningText} ${BACKUP_HINT}` }
  }
  const age = ageHoursOf(latest, now)
  if (!Number.isFinite(age) || age < 0) {
    return { ok: false, text: `The newest database backup has no readable age.${warningText} ${BACKUP_HINT}` }
  }
  const ageText = `The newest database backup is ${hoursText(age)} hours old.`
  if (age > BACKUP_MAX_AGE_HOURS) return { ok: false, text: `${ageText}${warningText} ${BACKUP_HINT}` }
  return { ok: true, text: `${ageText}${warningText}` }
}

async function readHealth(base, fetchImpl) {
  let response
  try {
    response = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
  } catch {
    return null
  }
  if (!response.ok && response.status !== 503) return null
  try {
    const body = await response.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

function unhealthyText(health) {
  const reason = typeof health?.error === 'string' && health.error ? ` (${health.error})` : ''
  return `Paperclip answers but says it is unhealthy${reason}. Check its database.`
}

async function routeLine(base, fetchImpl) {
  let spec
  try {
    spec = await readSpec(base, { fetchImpl, timeoutMs: CHECK_TIMEOUT_MS })
  } catch (error) {
    return { ok: false, text: `The Paperclip spec could not be read: ${error.message}` }
  }
  const result = compareSurface(spec)
  if (result.ok) {
    const word = result.checked === 1 ? 'route' : 'routes'
    return { ok: true, text: `Paperclip lists every route the bridge uses (${result.checked} ${word} checked).` }
  }
  return {
    ok: false,
    text: `The Paperclip spec does not match the routes the bridge uses. ${describeSurface(result).join(' ')}`,
  }
}

async function companyLine(base, companyId, fetchImpl) {
  let response
  try {
    response = await fetchImpl(`${base}/api/companies`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
  } catch {
    return { ok: false, text: 'Paperclip did not list its companies.' }
  }
  if (!response.ok) return { ok: false, text: 'Paperclip did not list its companies.' }
  let companies
  try {
    companies = await response.json()
  } catch {
    return { ok: false, text: 'Paperclip did not list its companies.' }
  }
  if (!Array.isArray(companies)) return { ok: false, text: 'Paperclip did not list its companies.' }
  if (!companies.some((company) => company && company.id === companyId)) {
    return { ok: false, text: `Company ${companyId} is not in Paperclip's company list.` }
  }
  return { ok: true, text: `Company ${companyId} is in Paperclip's company list.` }
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

export async function runDoctor(options = {}) {
  const settings = doctorSettings(options)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now()
  const lines = []
  let ok = true

  function add(result) {
    if (!result.ok) ok = false
    lines.push(`${result.ok ? 'ok' : 'FAIL'} ${result.text}`)
  }

  let base = null
  try {
    base = normalizePaperclipUrl(String(settings.paperclipUrl))
  } catch (error) {
    add({ ok: false, text: error.message })
  }

  let health = null
  let healthOk = false
  if (base) {
    const place = shownPaperclipUrl(base)
    health = await readHealth(base, fetchImpl)
    const version = typeof health?.version === 'string' ? health.version.trim() : ''
    if (!health || version === '') {
      add({ ok: false, text: `Paperclip does not answer at ${place}.` })
    } else if (health.status === 'unhealthy') {
      add({ ok: false, text: unhealthyText(health) })
    } else {
      healthOk = true
      add({ ok: true, text: `Paperclip answers at ${place} (version ${version}).` })
    }
  }

  if (healthOk) {
    add(await routeLine(base, fetchImpl))

    if (!settings.companyId) {
      add({ ok: false, text: 'No company id. Pass --company or set PAPERCLIP_COMPANY_ID.' })
    } else {
      add(await companyLine(base, settings.companyId, fetchImpl))
    }
  }

  add(folderLine(settings.projectRoot))

  if (healthOk) add(backupLine(health.databaseBackup, now))

  return { exitCode: ok ? 0 : 1, lines }
}
