import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMcpApi, publicMcpServer, readMcpServers, upsertMcpServer } from '../server/mcp.js'
import { createRunsApi } from '../server/runs.js'
import { createReviewsApi } from '../server/reviews.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const dirs = []
const secret = 'OPENAI_API' + '_KEY=canary-value-123456'
const home = 'C:\\Users\\someone\\folder'
const sample = `${secret} ${home}`
const safe = (text) => {
  expect(text).not.toContain('canary-value-123456')
  expect(text).not.toContain('someone')
  expect(text).toContain('[key]')
  expect(text).toContain('%USERPROFILE%')
}
function temp() {
  const dir = makeTempDir('mr-public-mask-')
  dirs.push(dir)
  return dir
}
afterEach(() => {
  vi.unstubAllGlobals()
  while (dirs.length) removeTempDir(dirs.pop())
})

it('masks MCP displays and responses while retaining private settings on edits', async () => {
  const dir = temp()
  const server = { name: 'test', transport: 'http', url: `https://example.invalid/?${secret}`, args: [sample], enabled: true }
  expect(upsertMcpServer(dir, server).ok).toBe(true)
  const displayed = publicMcpServer(readMcpServers(dir)[0])
  safe(displayed.args[0])
  expect(displayed.url).not.toContain('canary-value-123456')
  expect(upsertMcpServer(dir, { ...displayed, enabled: false }).ok).toBe(true)
  expect(readMcpServers(dir)[0]).toMatchObject({ args: [sample], url: server.url })
  expect(upsertMcpServer(dir, { ...displayed, args: [`${displayed.args[0]} changed`] }).ok).toBe(false)
  expect(upsertMcpServer(dir, { ...server, enabled: true }).ok).toBe(true)
  let fail = false
  vi.stubGlobal('fetch', async (_url, init) => {
    const request = JSON.parse(init.body)
    if (!request.id) return new Response(null, { status: 202 })
    const result = request.method === 'tools/list' ? { tools: [{ name: 'echo', description: sample }] } : { content: [{ text: sample }] }
    return Response.json(fail && request.method !== 'initialize'
      ? { jsonrpc: '2.0', id: request.id, error: { message: sample } }
      : { jsonrpc: '2.0', id: request.id, result })
  })
  let answer
  const api = createMcpApi({ runsFolder: dir, sendJson: (_req, _res, _status, body) => { answer = body }, readJsonBody: async () => ({ confirmed: true, server: 'test', tool: 'echo' }) })
  const request = { method: 'POST', headers: { origin: 'http://localhost' } }
  await api.handle(request, {}, new URL('http://localhost/api/mcp/call'))
  safe(answer.result.content[0].text)
  await api.handle({ ...request, method: 'GET' }, {}, new URL('http://localhost/api/mcp/tools'))
  safe(answer.tools[0].description)
  fail = true
  await api.handle(request, {}, new URL('http://localhost/api/mcp/call'))
  safe(answer.problem)
})

it('masks public run records and attention without changing the disk record', async () => {
  const dir = temp()
  const record = { lane: 'test', project: dir, startedAt: '2026-01-01T00:00:00Z', exitCode: 1, task: sample, note: sample, errors: [sample], log: home }
  const file = join(dir, 'runs.jsonl')
  writeFileSync(file, `${JSON.stringify(record)}\n`)
  let answer
  const api = createRunsApi({ projectRoot: dir, runsFolder: dir, sendJson: (_req, _res, _status, body) => { answer = body } })
  try {
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs'))
    for (const row of [answer.recent[0], answer.last[0]]) {
      safe(row.task)
      safe(row.note)
      safe(row.errors[0])
      expect(row.log).not.toContain('someone')
    }
    safe(answer.attention[0].text)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record)
  } finally { api.stopAll() }
})

it('masks a review patch before truncation', async () => {
  const dir = temp()
  const agents = join(dir, 'agents')
  mkdirSync(agents)
  writeFileSync(join(agents, 'lanes.json'), JSON.stringify({ test: { name: 'Test', worktree: dir } }))
  let answer
  const api = createReviewsApi({ projectRoot: dir, briefsDir: agents, patchLimit: 80, sendJson: (_req, _res, status, body) => { answer = { status, body } }, gitRunner: async (_cwd, args) => {
    if (args[0] === 'branch') return 'feature'
    if (args[0] === 'rev-parse') return 'a'.repeat(40)
    if (args.includes('--numstat')) return '1\t0\tfile.txt\n'
    if (args[0] === 'diff') return `+${sample}\n${'x'.repeat(100)}`
    return 'main'
  } })
  await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/reviews/test/diff'))
  expect(answer.status).toBe(200)
  safe(answer.body.patch)
  expect(answer.body.truncated).toBe(true)
})
