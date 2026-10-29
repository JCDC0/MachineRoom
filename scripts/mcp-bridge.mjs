#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { killTree } from '../server/processTree.js'
import { mcpConfigForClaude, mcpConfigForOpencode } from '../src/briefs/run.js'

export { mcpConfigForClaude, mcpConfigForOpencode }

export const MCP_PROTOCOL_VERSION = '2024-11-05'
export const LIST_TIMEOUT_MS = 8000
export const CALL_TIMEOUT_MS = 15000
const CLOSE_WAIT_MS = 2000
const STDERR_LIMIT = 2000
const PAGE_LIMIT = 5

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

export function mcpRunsDir(env = process.env) {
  const givenDir = env?.MACHINEROOM_RUNS_DIR
  if (typeof givenDir === 'string' && givenDir.trim() !== '') return resolve(givenDir.trim())
  const given = env?.MACHINEROOM_RUNS
  if (typeof given === 'string' && given.trim() !== '') return resolve(given.trim())
  return join(env?.TEMP || tmpdir(), 'machineroom-runs')
}

function stringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function normalizeServer(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (name === '') return null
  const command = typeof entry.command === 'string' ? entry.command.trim() : ''
  const url = typeof entry.url === 'string' ? entry.url.trim() : ''
  const transport = entry.transport === 'http' || (entry.transport !== 'stdio' && url !== '' && command === '') ? 'http' : 'stdio'
  const enabled = entry.enabled !== false
  if (transport === 'http') {
    if (!/^https?:\/\//i.test(url)) return null
    return { name, transport, url, enabled }
  }
  if (command === '') return null
  return {
    name,
    transport,
    command,
    args: Array.isArray(entry.args) ? entry.args.map((item) => String(item)) : [],
    env: stringMap(entry.env),
    enabled,
  }
}

export function readMcpServers(runsDir = mcpRunsDir()) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(runsDir, 'mcp.json'), 'utf8'))
  } catch {
    return []
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.servers)
      ? parsed.servers
      : Array.isArray(parsed?.mcpServers)
        ? parsed.mcpServers
        : parsed?.mcpServers && typeof parsed.mcpServers === 'object'
          ? Object.entries(parsed.mcpServers).map(([name, value]) => ({ name, ...value }))
          : []
  return raw.map(normalizeServer).filter(Boolean)
}

export function enabledMcpServers(runsDir = mcpRunsDir()) {
  return readMcpServers(runsDir).filter((entry) => entry.enabled)
}

export function mcpServersForAcp(runsDir = mcpRunsDir(), servers = null) {
  const list = Array.isArray(servers) ? servers : enabledMcpServers(runsDir)
  return list.map((entry) => {
    if (entry.transport === 'http') return { name: entry.name, type: 'http', url: entry.url }
    return { name: entry.name, command: entry.command, args: [...entry.args], env: { ...entry.env } }
  })
}

function httpSession(server, { timeoutMs = LIST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let sessionId = ''

  async function send(message, limit) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    }
    if (sessionId !== '') headers['mcp-session-id'] = sessionId
    let response
    try {
      response = await fetchImpl(server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(limit),
      })
    } catch (error) {
      throw new Error(`The MCP server ${server.name} could not be reached: ${error?.message ?? error}`)
    }
    const answeredSession = response.headers?.get?.('mcp-session-id')
    if (answeredSession) sessionId = answeredSession
    if (!response.ok) throw new Error(`The MCP server ${server.name} answered ${response.status}.`)
    if (message.id === undefined) return null
    let body = ''
    try {
      body = await response.text()
    } catch {
      throw new Error(`The MCP server ${server.name} sent no answer to ${message.method}.`)
    }
    return answerOf(body, response.headers?.get?.('content-type') ?? '', message.id, server.name, message.method)
  }

  return {
    request(method, params = {}, limit = timeoutMs) {
      const id = 1
      return send({ jsonrpc: '2.0', id, method, params }, limit)
    },
    async notify(method, params = {}) {
      await send({ jsonrpc: '2.0', method, params }, timeoutMs)
    },
    async close() {},
  }
}

function answerOf(body, contentType, id, serverName, method) {
  const text = String(body ?? '').trim()
  if (text === '') throw new Error(`The MCP server ${serverName} sent no answer to ${method}.`)
  const messages = []
  if (/event-stream/i.test(contentType)) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '') continue
      try {
        messages.push(JSON.parse(data))
      } catch {}
    }
  } else {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) messages.push(...parsed)
      else messages.push(parsed)
    } catch {}
  }
  const message = messages.find((item) => item && item.id === id) ?? messages.find((item) => item && (item.result || item.error))
  if (!message) throw new Error(`The MCP server ${serverName} sent no answer to ${method}.`)
  if (message.error) throw new Error(message.error.message ?? `The MCP server ${serverName} failed ${method}.`)
  return message.result ?? {}
}

function stdioSession(server, { timeoutMs = LIST_TIMEOUT_MS, spawnImpl = spawn } = {}) {
  const child = spawnImpl(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pending = new Map()
  const lines = createInterface({ input: child.stdout })
  let nextId = 0
  let closed = false
  let stderr = ''

  function failure(suffix) {
    const tail = stderr.trim()
    return new Error(`The MCP server ${server.name} stopped${suffix}${tail === '' ? '' : `: ${tail}`}`)
  }

  function settleAll(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT)
  })
  child.on('error', (error) => {
    closed = true
    settleAll(new Error(`The MCP server ${server.name} did not start: ${error?.message ?? error}`))
  })
  child.on('close', (code) => {
    closed = true
    settleAll(failure(` before it answered (exit code ${code === null ? 'none' : code}).`))
  })

  lines.on('line', (line) => {
    const text = line.trim()
    if (text === '') return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    const id = message?.id
    if (id === undefined || !pending.has(id)) return
    const entry = pending.get(id)
    pending.delete(id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(message.error.message ?? `The MCP server ${server.name} answered an error.`))
    else entry.resolve(message.result ?? {})
  })

  function write(message) {
    if (closed || !child.stdin?.writable) throw failure(' before the request was sent.')
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  return {
    request(method, params = {}, limit = timeoutMs) {
      const id = (nextId += 1)
      return new Promise((done, fail) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          fail(new Error(`The MCP server ${server.name} did not answer ${method} within ${Math.round(limit / 1000)} seconds.`))
        }, limit)
        pending.set(id, { resolve: done, reject: fail, timer })
        try {
          write({ jsonrpc: '2.0', id, method, params })
        } catch (error) {
          clearTimeout(timer)
          pending.delete(id)
          fail(error)
        }
      })
    },
    async notify(method, params = {}) {
      write({ jsonrpc: '2.0', method, params })
    },
    async close() {
      lines.close()
      if (closed) return
      try {
        child.stdin?.end()
      } catch {}
      try {
        killTree(child)
      } catch {}
      if (child.exitCode !== null || child.signalCode !== null) return
      await Promise.race([once(child, 'close'), delay(CLOSE_WAIT_MS)])
    },
  }
}

async function openSession(server, options) {
  const session = server.transport === 'http' ? httpSession(server, options) : stdioSession(server, options)
  const limit = options.timeoutMs ?? LIST_TIMEOUT_MS
  try {
    await session.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'machine-room', version: '0.1.388' },
      },
      limit,
    )
    await session.notify('notifications/initialized')
    return session
  } catch (error) {
    await session.close()
    throw error
  }
}

export async function listServerTools(server, { timeoutMs = LIST_TIMEOUT_MS, spawnImpl, fetchImpl } = {}) {
  const session = await openSession(server, { timeoutMs, spawnImpl, fetchImpl })
  const tools = []
  try {
    let cursor = ''
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const answer = await session.request('tools/list', cursor === '' ? {} : { cursor }, timeoutMs)
      for (const tool of Array.isArray(answer?.tools) ? answer.tools : []) {
        const name = typeof tool?.name === 'string' ? tool.name : ''
        if (name === '') continue
        tools.push({
          name,
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null,
        })
      }
      cursor = typeof answer?.nextCursor === 'string' ? answer.nextCursor : ''
      if (cursor === '') break
    }
    return tools
  } finally {
    await session.close()
  }
}

export async function callServerTool(server, tool, toolArgs = {}, { timeoutMs = CALL_TIMEOUT_MS, spawnImpl, fetchImpl } = {}) {
  const name = typeof tool === 'string' ? tool.trim() : ''
  if (name === '') throw new Error('The MCP tool name is missing.')
  const args = toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs) ? toolArgs : {}
  const session = await openSession(server, { timeoutMs, spawnImpl, fetchImpl })
  try {
    return await session.request('tools/call', { name, arguments: args }, timeoutMs)
  } finally {
    await session.close()
  }
}

export async function listAllMcpTools(runsDir = mcpRunsDir(), { server = '', timeoutMs = LIST_TIMEOUT_MS, spawnImpl, fetchImpl } = {}) {
  const filter = typeof server === 'string' ? server.trim() : ''
  const chosen = enabledMcpServers(runsDir).filter((entry) => filter === '' || entry.name === filter)
  if (filter !== '' && chosen.length === 0) {
    return { ok: false, tools: [], errors: [{ server: filter, error: `The MCP server ${filter} is not configured.` }] }
  }
  const answers = await Promise.all(
    chosen.map(async (entry) => {
      try {
        const found = await listServerTools(entry, { timeoutMs, spawnImpl, fetchImpl })
        return { tools: found.map((tool) => ({ server: entry.name, ...tool })), errors: [] }
      } catch (error) {
        return { tools: [], errors: [{ server: entry.name, error: String(error?.message ?? error) }] }
      }
    }),
  )
  const tools = answers.flatMap((answer) => answer.tools)
  const errors = answers.flatMap((answer) => answer.errors)
  return { ok: errors.length === 0, tools, errors }
}

export async function callMcpTool(runsDir = mcpRunsDir(), { server = '', tool = '', arguments: toolArgs = {} } = {}, options = {}) {
  const name = typeof server === 'string' ? server.trim() : ''
  if (name === '') return { ok: false, result: null, problem: 'mcp_call_tool needs a server name.' }
  const entry = enabledMcpServers(runsDir).find((item) => item.name === name)
  if (!entry) return { ok: false, result: null, problem: `The MCP server ${name} is not configured.` }
  try {
    const result = await callServerTool(entry, tool, toolArgs, options)
    return { ok: true, result, problem: '' }
  } catch (error) {
    return { ok: false, result: null, problem: String(error?.message ?? error) }
  }
}

export function mcpResultText(result) {
  const parts = []
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
      continue
    }
    if (item.type === 'image') {
      const bytes = typeof item.data === 'string' ? Math.floor((item.data.length * 3) / 4) : 0
      parts.push(`[image ${item.mimeType ?? 'unknown'} ${bytes} bytes]`)
      continue
    }
    if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
      if (typeof item.resource.text === 'string') parts.push(item.resource.text)
      else if (typeof item.resource.uri === 'string') parts.push(`[resource ${item.resource.uri}]`)
      else parts.push(JSON.stringify(item.resource))
      continue
    }
    if (typeof item.text === 'string') {
      parts.push(item.text)
      continue
    }
    parts.push(JSON.stringify(item))
  }
  if (parts.length > 0) return parts.join('\n')
  if (result?.structuredContent !== undefined) return JSON.stringify(result.structuredContent)
  if (result === undefined || result === null) return ''
  return JSON.stringify(result)
}
