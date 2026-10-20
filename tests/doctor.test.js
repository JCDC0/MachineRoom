import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PAPERCLIP_SURFACE, compareSurface, describeSurface } from '../server/surface.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'doctor.mjs')

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
  return { openapi: '3.0.0', info: { version: '2026.1012.0' }, paths }
}

function startFake(spec) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(spec))
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolveFake) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveFake({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      })
    })
  })
}

function runDoctor(url) {
  return new Promise((resolveRun) => {
    execFile(
      process.execPath,
      [script, '--url', url],
      { encoding: 'utf8', timeout: 15000 },
      (error, stdout, stderr) => {
        const status = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolveRun({ status, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    )
  })
}

describe('the Paperclip surface', () => {
  it('lists every route the bridge calls with its fields', () => {
    const paths = new Set(PAPERCLIP_SURFACE.filter((route) => !route.socket).map((route) => route.path))
    expect(paths.has('/api/companies/{companyId}/agents')).toBe(true)
    expect(paths.has('/api/companies/{companyId}/costs/quota-windows')).toBe(true)
    expect(paths.has('/api/heartbeat-runs/{runId}/log')).toBe(true)
    expect(paths.has('/api/health')).toBe(true)
    expect(paths.has('/api/instance/database-backups')).toBe(true)
    const socket = PAPERCLIP_SURFACE.find((route) => route.socket)
    expect(socket.path).toBe('/api/companies/{companyId}/events/ws')
    const hires = PAPERCLIP_SURFACE.find((route) => route.path === '/api/companies/{companyId}/agent-hires')
    expect(hires.fields).toContain('approval')
    expect(hires.body).toContain('metadata')
  })

  it('passes a spec that holds every route', () => {
    const result = compareSurface(completeSpec())
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.changed).toEqual([])
    expect(result.checked).toBe(PAPERCLIP_SURFACE.filter((route) => !route.socket).length)
    expect(result.sockets).toHaveLength(1)
  })

  it('names a route the fake spec drops', () => {
    const spec = completeSpec()
    delete spec.paths['/api/heartbeat-runs/{runId}/log']
    const result = compareSurface(spec)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([{ method: 'GET', path: '/api/heartbeat-runs/{runId}/log', reason: 'route' }])
    expect(describeSurface(result)).toContain('GET /api/heartbeat-runs/{runId}/log: the spec does not list this route.')
  })

  it('matches a route whose path parameter has another name', () => {
    const spec = completeSpec()
    spec.paths['/api/heartbeat-runs/{id}/log'] = spec.paths['/api/heartbeat-runs/{runId}/log']
    delete spec.paths['/api/heartbeat-runs/{runId}/log']
    expect(compareSurface(spec).ok).toBe(true)
  })

  it('lists the company list the browser reads on the proxy route', () => {
    expect(PAPERCLIP_SURFACE.some((route) => route.method === 'GET' && route.path === '/api/companies')).toBe(true)
  })

  it('names a method the fake spec drops', () => {
    const spec = completeSpec()
    delete spec.paths['/api/agents/{id}'].patch
    const result = compareSurface(spec)
    expect(result.missing).toEqual([{ method: 'PATCH', path: '/api/agents/{id}', reason: 'method' }])
    expect(describeSurface(result)).toContain('PATCH /api/agents/{id}: the spec does not list this method.')
  })

  it('names a request field the fake spec drops', () => {
    const spec = completeSpec()
    const body = spec.paths['/api/companies/{companyId}/agent-hires'].post.requestBody.content['application/json'].schema
    delete body.properties.metadata
    const result = compareSurface(spec)
    expect(result.changed).toEqual([
      {
        method: 'POST',
        path: '/api/companies/{companyId}/agent-hires',
        answerFields: [],
        bodyFields: ['metadata'],
      },
    ])
    expect(describeSurface(result)).toContain(
      'POST /api/companies/{companyId}/agent-hires: the spec does not list the request field `metadata`.'
    )
  })

  it('names an answer field the fake spec drops', () => {
    const spec = completeSpec()
    spec.paths['/api/companies/{companyId}/costs/by-agent'].get.responses[200].content['application/json'].schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          agentName: { type: 'string' },
          costCents: { type: 'integer' },
          outputTokens: { type: 'integer' },
        },
      },
    }
    const result = compareSurface(spec)
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0].answerFields).toEqual(['inputTokens'])
    expect(describeSurface(result)).toContain(
      'GET /api/companies/{companyId}/costs/by-agent: the spec does not list the answer field `inputTokens`.'
    )
  })

  it('reads a field inside the items of an answer list', () => {
    const spec = completeSpec()
    spec.paths['/api/companies/{companyId}/costs/quota-windows'].get.responses[200].content['application/json'].schema = {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        ok: { type: 'boolean' },
        error: { type: 'string' },
        windows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              usedPercent: { type: 'number' },
              detail: { type: 'string' },
            },
          },
        },
      },
    }
    const result = compareSurface(spec)
    expect(result.changed[0].answerFields).toEqual(['windows[].resetsAt'])
  })

  it('runs the doctor against a fake spec that drops a route', async () => {
    const spec = completeSpec()
    delete spec.paths['/api/companies/{companyId}/costs/summary']
    const fake = await startFake(spec)
    try {
      const run = await runDoctor(fake.url)
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('GET /api/companies/{companyId}/costs/summary: the spec does not list this route.')
      expect(run.stdout).toContain('1 missing')
    } finally {
      await fake.close()
    }
  })

  it('runs the doctor against a fake spec that holds every route', async () => {
    const fake = await startFake(completeSpec())
    try {
      const run = await runDoctor(fake.url)
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('Every route the bridge uses is in the spec.')
      expect(run.stdout).toContain(`${PAPERCLIP_SURFACE.filter((route) => !route.socket).length} routes checked.`)
    } finally {
      await fake.close()
    }
  })

  it('stops with a plain sentence when Paperclip is not there', async () => {
    const run = await runDoctor('http://127.0.0.1:1')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('Could not reach Paperclip at http://127.0.0.1:1.')
  })
})
