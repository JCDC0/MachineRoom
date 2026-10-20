import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runDoctor } from '../server/doctor.js'
import { PAPERCLIP_SURFACE } from '../server/surface.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(root, 'bin', 'machine-room.mjs')
const BACKUP_HINT = 'Make one from the room or with paperclipai db:backup.'
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function makeProject() {
  const folder = mkdtempSync(join(tmpdir(), 'machine-room-doctor-'))
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}

function completeSpec(routes = PAPERCLIP_SURFACE) {
  const paths = {}
  for (const route of routes) {
    if (route.socket) continue
    const item = (paths[route.path] ??= {})
    const properties = Object.fromEntries((route.body ?? []).map((key) => [key, { type: 'string' }]))
    item[route.method.toLowerCase()] = {
      responses: {
        200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: {} } } } },
      },
      ...(route.body?.length ? { requestBody: { content: { 'application/json': { schema: { type: 'object', properties } } } } } : {}),
    }
  }
  return { openapi: '3.0.0', info: { version: '1.0.0' }, paths }
}

function backupAt(ageHours, warnings = []) {
  return {
    enabled: true,
    status: warnings.length > 0 ? 'warning' : 'ok',
    maxAgeHours: 26,
    latestBackup: {
      name: 'paperclip-20261020-120000.sql.gz',
      mtime: new Date(Date.now() - ageHours * 3600000).toISOString(),
      ageHours,
      sizeBytes: 1024,
    },
    warnings: warnings.map((code) => ({ code, message: 'A warning.' })),
  }
}

function healthWith(databaseBackup) {
  return { ok: true, version: '2026.1012.0', databaseBackup }
}

function startFake({ health, spec = completeSpec(), companies = [{ id: 'company-1', name: 'One' }] }) {
  const seen = []
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(health))
      return
    }
    if (req.method === 'GET' && req.url === '/api/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(spec))
      return
    }
    if (req.method === 'GET' && req.url === '/api/companies') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(companies))
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolveFake) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      cleanups.push(() => new Promise((resolveClose) => server.close(() => resolveClose())))
      resolveFake({ url: `http://127.0.0.1:${port}`, seen })
    })
  })
}

function failures(lines) {
  return lines.filter((line) => line.startsWith('FAIL '))
}

function childEnv(extra = {}) {
  const env = { ...process.env }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  delete env.PROJECT_ROOT
  return { ...env, ...extra }
}

function runBin(args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    cleanups.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error(`the doctor bin did not exit. stderr: ${stderr}`))
    }, 15000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

describe('machine-room doctor', () => {
  it('passes every check against a healthy Paperclip', async () => {
    const project = makeProject()
    const fake = await startFake({ health: healthWith(backupAt(1.5)) })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'company-1', projectRoot: project })

    expect(result.exitCode).toBe(0)
    expect(result.lines.every((line) => /^(ok|FAIL) /.test(line))).toBe(true)
    expect(failures(result.lines)).toEqual([])
    expect(result.lines).toHaveLength(5)
    expect(result.lines[0]).toContain('Paperclip answers at')
    expect(result.lines[0]).toContain('version 2026.1012.0')
    expect(result.lines[1]).toContain('every route the bridge uses')
    expect(result.lines[2]).toContain("Company company-1 is in Paperclip's company list.")
    expect(result.lines[3]).toContain('The project folder')
    expect(result.lines[4]).toContain('The newest database backup is 1.5 hours old.')
  })

  it('stops the checks that need Paperclip when it is down', async () => {
    const project = makeProject()
    const result = await runDoctor({ paperclipUrl: 'http://127.0.0.1:1', companyId: 'company-1', projectRoot: project })

    expect(result.exitCode).toBe(1)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toBe('FAIL Paperclip does not answer at http://127.0.0.1:1.')
    expect(result.lines[1]).toContain('The project folder')
    expect(result.lines.join('\n')).not.toContain('/api/openapi.json')
    expect(result.lines.join('\n')).not.toContain('database backup')
  })

  it('names a route the Paperclip spec dropped', async () => {
    const project = makeProject()
    const spec = completeSpec()
    delete spec.paths['/api/companies/{companyId}/costs/summary']
    const fake = await startFake({ health: healthWith(backupAt(1.5)), spec })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'company-1', projectRoot: project })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(failures(result.lines)[0]).toContain('GET /api/companies/{companyId}/costs/summary')
    expect(failures(result.lines)[0]).toContain('the spec does not list this route')
  })

  it('fails a company that Paperclip does not list', async () => {
    const project = makeProject()
    const fake = await startFake({
      health: healthWith(backupAt(1.5)),
      companies: [{ id: 'another-company', name: 'Another' }],
    })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'missing', projectRoot: project })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual(["FAIL Company missing is not in Paperclip's company list."])
  })

  it('fails and does not ask for companies when no company is given', async () => {
    const project = makeProject()
    const fake = await startFake({ health: healthWith(backupAt(1.5)) })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: '', projectRoot: project })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual(['FAIL No company id. Pass --company or set PAPERCLIP_COMPANY_ID.'])
    expect(fake.seen).not.toContain('GET /api/companies')
  })

  it('fails a project folder that does not exist', async () => {
    const project = makeProject()
    const fake = await startFake({ health: healthWith(backupAt(1.5)) })
    const result = await runDoctor({
      paperclipUrl: fake.url,
      companyId: 'company-1',
      projectRoot: join(project, 'missing'),
    })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(failures(result.lines)[0]).toContain('does not exist')
  })

  it('fails when automatic database backups are off', async () => {
    const project = makeProject()
    const fake = await startFake({ health: healthWith({ enabled: false }) })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'company-1', projectRoot: project })

    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toEqual([`FAIL Automatic database backups are off. ${BACKUP_HINT}`])
  })

  it('fails when Paperclip has no database backup', async () => {
    const project = makeProject()
    const fake = await startFake({
      health: healthWith({ enabled: true, latestBackup: null, warnings: [{ code: 'database_backup_missing' }] }),
    })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'company-1', projectRoot: project })

    const line = failures(result.lines)[0]
    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(line).toContain('No database backup found.')
    expect(line).toContain('database_backup_missing')
    expect(line.endsWith(BACKUP_HINT)).toBe(true)
  })

  it('fails a backup that is 25 hours old and lists the warning code', async () => {
    const project = makeProject()
    const fake = await startFake({
      health: healthWith(backupAt(25, ['database_backup_stale'])),
    })
    const result = await runDoctor({ paperclipUrl: fake.url, companyId: 'company-1', projectRoot: project })

    const line = failures(result.lines)[0]
    expect(result.exitCode).toBe(1)
    expect(failures(result.lines)).toHaveLength(1)
    expect(line).toContain('The newest database backup is 25 hours old.')
    expect(line).toContain('database_backup_stale')
    expect(line.endsWith(BACKUP_HINT)).toBe(true)
  })

  it('runs as a child process and exits 0 when every check passes', async () => {
    const project = makeProject()
    const fake = await startFake({ health: healthWith(backupAt(1.5)) })
    const env = childEnv({
      PAPERCLIP_URL: fake.url,
      PAPERCLIP_COMPANY_ID: 'company-1',
      PROJECT_ROOT: project,
    })
    const run = await runBin(['doctor'], env)

    expect(run.code).toBe(0)
    const lines = run.stdout.trim().split(/\r?\n/)
    expect(lines).toHaveLength(5)
    expect(lines.every((line) => line.startsWith('ok '))).toBe(true)
    expect(run.stderr).toBe('')
  })

  it('runs as a child process and exits 1 when a check fails', async () => {
    const project = makeProject()
    const fake = await startFake({
      health: healthWith(backupAt(1.5)),
      companies: [{ id: 'another-company', name: 'Another' }],
    })
    const run = await runBin(['doctor', '--paperclip', fake.url, '--company', 'missing', '--root', project], childEnv())

    expect(run.code).toBe(1)
    expect(run.stdout).toContain("FAIL Company missing is not in Paperclip's company list.")
  })
})
