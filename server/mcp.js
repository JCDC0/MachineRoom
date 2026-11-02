import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { killTree } from './processTree.js'

export const MCP_PROTOCOL_VERSION = '2024-11-05'
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/
export const MCP_LIST_TIMEOUT_MS = 8000
export const MCP_CALL_TIMEOUT_MS = 15000

export const MCP_NAME_PROBLEM = 'The MCP server name must be 1 to 40 letters, digits, dashes or underscores.'
export const MCP_TRANSPORT_PROBLEM = 'The MCP transport must be stdio or http.'
export const MCP_COMMAND_PROBLEM = 'A stdio MCP server needs a command.'
export const MCP_URL_PROBLEM = 'An http MCP server needs a full http or https URL.'
export const MCP_ARGS_PROBLEM = 'The MCP server arguments must be a list of text.'
export const MCP_ENV_PROBLEM = 'The MCP server environment must map names to text.'
export const MCP_ENABLED_PROBLEM = 'The MCP server switch must be on or off.'
export const MCP_SAVE_CONFIRM_PROBLEM = 'Confirm saving the MCP server first.'
export const MCP_DELETE_CONFIRM_PROBLEM = 'Confirm deleting the MCP server first.'
export const MCP_CALL_CONFIRM_PROBLEM = 'The owner must confirm the tool call first.'
export const OWNER_MCP_PROBLEM = 'Only the owner can use the MCP servers.'
export const MCP_NOT_FOUND_PROBLEM = 'The MCP server was not found.'
export const MCP_SERVER_PROBLEM = 'Choose an MCP server.'
export const MCP_OFF_PROBLEM = 'The MCP server is turned off.'
export const MCP_TOOL_PROBLEM = 'Choose an MCP tool.'
export const MCP_TOOL_ARGS_PROBLEM = 'The tool arguments must be a JSON object.'
export const MCP_START_PROBLEM = 'The MCP server could not be started.'
export const MCP_STOPPED_PROBLEM = 'The MCP server stopped before it answered.'
export const MCP_TIMEOUT_PROBLEM = 'The MCP server did not answer in time.'
export const MCP_HTTP_PROBLEM = 'The MCP server did not answer.'
export const MCP_HTTP_STATUS_PROBLEM = 'The MCP server refused the request.'
export const MCP_JSON_PROBLEM = 'The MCP server answer was not JSON.'
export const MCP_NO_ANSWER_PROBLEM = 'The MCP server did not answer the request.'
export const MCP_RPC_PROBLEM = 'The MCP server answered with an error:'
export const MCP_TOOLS_PROBLEM = 'The MCP server tools list was not a list.'

const MAX_DETAIL = 200

function pageRequest(req) {
  const headers = req.headers ?? {}
  if (headers.origin) return true
  if ((req.method ?? 'GET') !== 'GET') return false
  return headers['sec-fetch-site'] === 'same-origin'
}

class McpError extends Error {}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

export function mcpFile(runsDir) {
  return join(runsDir, 'mcp.json')
}

export function mcpServerProblem(draft) {
  if (!isPlainObject(draft)) return MCP_NAME_PROBLEM
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!MCP_SERVER_NAME_PATTERN.test(name)) return MCP_NAME_PROBLEM
  const transport = typeof draft.transport === 'string' ? draft.transport.trim() : ''
  if (transport !== 'stdio' && transport !== 'http') return MCP_TRANSPORT_PROBLEM
  if (draft.args !== undefined && !textList(draft.args)) return MCP_ARGS_PROBLEM
  if (draft.env !== undefined && (!isPlainObject(draft.env) || !Object.values(draft.env).every((value) => typeof value === 'string'))) {
    return MCP_ENV_PROBLEM
  }
  if (draft.enabled !== undefined && typeof draft.enabled !== 'boolean') return MCP_ENABLED_PROBLEM
  if (transport === 'stdio') {
    if (typeof draft.command !== 'string' || draft.command.trim() === '') return MCP_COMMAND_PROBLEM
    return null
  }
  if (!httpUrl(draft.url)) return MCP_URL_PROBLEM
  return null
}

export function cleanMcpServer(draft) {
  const transport = draft.transport.trim()
  return {
    name: draft.name.trim(),
    transport,
    command: transport === 'stdio' ? draft.command.trim() : '',
    args: Array.isArray(draft.args) ? draft.args.map((arg) => arg) : [],
    env: isPlainObject(draft.env) ? { ...draft.env } : {},
    url: transport === 'http' ? draft.url.trim() : '',
    enabled: draft.enabled !== false,
  }
}

export function readMcpServers(runsDir) {
  if (typeof runsDir !== 'string' || runsDir.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(mcpFile(runsDir), 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.servers) ? parsed.servers : []
  const servers = []
  const seen = new Set()
  for (const entry of list) {
    if (mcpServerProblem(entry) !== null) continue
    const server = cleanMcpServer(entry)
    if (seen.has(server.name)) continue
    seen.add(server.name)
    servers.push(server)
  }
  return servers
}

export function writeMcpServers(runsDir, servers, { rename = renameSync } = {}) {
  const file = mcpFile(runsDir)
  mkdirSync(dirname(file), { recursive: true })
  const list = Array.isArray(servers)
    ? servers.filter((entry) => mcpServerProblem(entry) === null).map((entry) => cleanMcpServer(entry))
    : []
  const content = `${JSON.stringify({ servers: list }, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function upsertMcpServer(runsDir, entry) {
  const problem = mcpServerProblem(entry)
  if (problem !== null) return { ok: false, problem }
  const server = cleanMcpServer(entry)
  const servers = readMcpServers(runsDir)
  const index = servers.findIndex((item) => item.name === server.name)
  if (index === -1) servers.push(server)
  else servers[index] = server
  writeMcpServers(runsDir, servers)
  return { ok: true, server, servers }
}

export function removeMcpServer(runsDir, name) {
  const wanted = typeof name === 'string' ? name.trim() : ''
  const servers = readMcpServers(runsDir)
  const index = servers.findIndex((entry) => entry.name === wanted)
  if (index === -1) return { ok: false, missing: true, problem: MCP_NOT_FOUND_PROBLEM }
  const [server] = servers.splice(index, 1)
  writeMcpServers(runsDir, servers)
  return { ok: true, server, servers }
}

function timeoutValue(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function timeoutProblem() {
  return new McpError(MCP_TIMEOUT_PROBLEM)
}

function isAbort(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
}

function rpcDetail(error) {
  const message = typeof error?.message === 'string' ? error.message.replace(/\s+/g, ' ').trim() : ''
  if (message === '') return 'It gave no reason.'
  return message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL)}...` : message
}

function answerFrom(messages, id) {
  const all = []
  for (const message of Array.isArray(messages) ? messages : [messages]) {
    if (Array.isArray(message)) all.push(...message)
    else all.push(message)
  }
  const answer = all.find((item) => isPlainObject(item) && item.id === id)
  if (!answer) throw new McpError(MCP_NO_ANSWER_PROBLEM)
  if (answer.error) throw new McpError(`${MCP_RPC_PROBLEM} ${rpcDetail(answer.error)}`)
  return answer.result ?? null
}

function sseMessages(text) {
  const messages = []
  let data = []
  const flush = () => {
    if (data.length === 0) return
    const raw = data.join('\n')
    data = []
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new McpError(MCP_JSON_PROBLEM)
    }
    messages.push(parsed)
  }
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  flush()
  return messages
}

function closeChild(child) {
  if (!child) return
  try {
    child.stdin?.end()
  } catch {}
  try {
    if (!killTree(child)) child.kill?.()
  } catch {}
}

function stdioSession(server, timeoutMs, spawnImpl, work) {
  return new Promise((resolveSession) => {
    let child = null
    let settled = false
    let timer = null
    let nextId = 0
    let buffer = ''
    const pending = new Map()

    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending.clear()
      closeChild(child)
      resolveSession(value)
    }

    const fail = (problem) => finish({ ok: false, problem })

    const readLine = (line) => {
      if (settled) return
      const text = line.trim()
      if (text === '') return
      let message
      try {
        message = JSON.parse(text)
      } catch {
        return
      }
      if (!isPlainObject(message) || message.id === undefined || message.id === null) return
      const answer = pending.get(message.id)
      if (!answer) return
      pending.delete(message.id)
      answer(message)
    }

    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`)
      } catch {
        fail(MCP_START_PROBLEM)
      }
    }

    const request = (method, params) =>
      new Promise((resolveRequest, rejectRequest) => {
        if (settled) {
          rejectRequest(new McpError(MCP_STOPPED_PROBLEM))
          return
        }
        nextId += 1
        const id = nextId
        pending.set(id, (message) => {
          if (message.error) {
            rejectRequest(new McpError(`${MCP_RPC_PROBLEM} ${rpcDetail(message.error)}`))
            return
          }
          resolveRequest(message.result ?? null)
        })
        write({ jsonrpc: '2.0', id, method, params })
      })

    const notify = (method, params) => {
      write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    }

    try {
      child = spawnImpl(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch {
      fail(MCP_START_PROBLEM)
      return
    }

    if (!child || !child.stdin || !child.stdout) {
      fail(MCP_START_PROBLEM)
      return
    }

    child.stdout.on('data', (chunk) => {
      if (settled) return
      buffer += String(chunk)
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        readLine(line)
        if (settled) return
        cut = buffer.indexOf('\n')
      }
    })
    child.stderr?.on('data', () => {})
    child.on?.('error', () => fail(MCP_START_PROBLEM))
    child.on?.('exit', () => {
      if (!settled && pending.size > 0) fail(MCP_STOPPED_PROBLEM)
    })

    timer = setTimeout(() => fail(MCP_TIMEOUT_PROBLEM), timeoutMs)

    const start = async () => {
      await request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'machineroom', version: '1' },
      })
      notify('notifications/initialized')
      return work({ request, notify })
    }

    start().then(
      (value) => finish(value),
      (error) => fail(error instanceof McpError ? error.message : MCP_STOPPED_PROBLEM)
    )
  })
}

async function httpSession(server, timeoutMs, fetchImpl, work) {
  const deadline = Date.now() + timeoutMs
  let nextId = 0
  let sessionId = ''

  const post = async (message, { reply = true } = {}) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw timeoutProblem()
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    if (sessionId !== '') headers['mcp-session-id'] = sessionId
    let response
    try {
      response = await fetchImpl(server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(Math.max(1, remaining)),
      })
    } catch (error) {
      throw isAbort(error) ? timeoutProblem() : new McpError(MCP_HTTP_PROBLEM)
    }
    const nextSession = response?.headers?.get?.('mcp-session-id')
    if (typeof nextSession === 'string' && nextSession !== '') sessionId = nextSession
    if (!response?.ok) {
      const status = Number(response?.status)
      const detail = Number.isInteger(status) && status > 0 ? ` It answered ${status}.` : ''
      throw new McpError(`${MCP_HTTP_STATUS_PROBLEM}${detail}`)
    }
    if (!reply) {
      try {
        await response.body?.cancel()
      } catch {}
      return null
    }
    const status = Number(response.status)
    if (status === 202 || status === 204) return null
    const type = String(response.headers?.get?.('content-type') ?? '').toLowerCase()
    let text
    try {
      text = await response.text()
    } catch (error) {
      throw isAbort(error) ? timeoutProblem() : new McpError(MCP_HTTP_PROBLEM)
    }
    if (String(text).trim() === '') throw new McpError(MCP_NO_ANSWER_PROBLEM)
    if (type.includes('text/event-stream')) return sseMessages(text)
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new McpError(MCP_JSON_PROBLEM)
    }
    return parsed
  }

  const request = async (method, params) => {
    nextId += 1
    const id = nextId
    const messages = await post({ jsonrpc: '2.0', id, method, params })
    return answerFrom(messages, id)
  }

  const notify = (method, params) => post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, { reply: false })

  await request('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'machineroom', version: '1' },
  })
  await notify('notifications/initialized')
  return work({ request, notify })
}

async function runSession(serverConfig, { timeoutMs, spawnImpl, fetchImpl }, work) {
  const problem = mcpServerProblem(serverConfig)
  if (problem !== null) return { ok: false, problem }
  const server = cleanMcpServer(serverConfig)
  try {
    if (server.transport === 'http') return await httpSession(server, timeoutMs, fetchImpl ?? fetch, work)
    return await stdioSession(server, timeoutMs, spawnImpl ?? spawn, work)
  } catch (error) {
    return { ok: false, problem: error instanceof McpError ? error.message : MCP_STOPPED_PROBLEM }
  }
}

function readToolList(result) {
  if (!Array.isArray(result?.tools)) throw new McpError(MCP_TOOLS_PROBLEM)
  const tools = []
  for (const item of result.tools) {
    if (!isPlainObject(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (name === '') continue
    tools.push({
      name,
      description: typeof item.description === 'string' ? item.description : '',
      inputSchema: isPlainObject(item.inputSchema) ? item.inputSchema : { type: 'object', properties: {} },
    })
  }
  return tools
}

export async function listMcpServerTools(serverConfig, options = {}) {
  const timeoutMs = timeoutValue(options.timeoutMs, MCP_LIST_TIMEOUT_MS)
  return runSession(serverConfig, { timeoutMs, spawnImpl: options.spawnImpl, fetchImpl: options.fetchImpl }, async (session) => {
    const result = await session.request('tools/list', {})
    return { ok: true, tools: readToolList(result) }
  })
}

export async function callMcpServerTool(serverConfig, toolName, toolArgs = {}, options = {}) {
  const name = typeof toolName === 'string' ? toolName.trim() : ''
  if (name === '') return { ok: false, problem: MCP_TOOL_PROBLEM }
  const args = toolArgs === undefined || toolArgs === null ? {} : toolArgs
  if (!isPlainObject(args)) return { ok: false, problem: MCP_TOOL_ARGS_PROBLEM }
  const timeoutMs = timeoutValue(options.timeoutMs, MCP_CALL_TIMEOUT_MS)
  return runSession(serverConfig, { timeoutMs, spawnImpl: options.spawnImpl, fetchImpl: options.fetchImpl }, async (session) => {
    const result = await session.request('tools/call', { name, arguments: args })
    return { ok: true, result: result ?? null }
  })
}

export async function listAllMcpTools(runsDir, options = {}) {
  const enabled = readMcpServers(runsDir).filter((server) => server.enabled)
  const answers = await Promise.all(
    enabled.map(async (server) => ({ server, answer: await listMcpServerTools(server, options) }))
  )
  const tools = []
  const errors = []
  for (const { server, answer } of answers) {
    if (answer.ok) {
      for (const tool of answer.tools) {
        tools.push({ server: server.name, name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
      }
    } else {
      errors.push({ server: server.name, problem: answer.problem })
    }
  }
  return { ok: errors.length === 0, tools, errors }
}

export async function callMcpTool(runsDir, request = {}, options = {}) {
  const wanted = typeof request?.server === 'string' ? request.server.trim() : ''
  if (wanted === '') return { ok: false, problem: MCP_SERVER_PROBLEM }
  const server = readMcpServers(runsDir).find((entry) => entry.name === wanted) ?? null
  if (!server) return { ok: false, problem: MCP_NOT_FOUND_PROBLEM }
  if (!server.enabled) return { ok: false, problem: MCP_OFF_PROBLEM }
  const tool = typeof request?.tool === 'string' ? request.tool.trim() : ''
  if (tool === '') return { ok: false, problem: MCP_TOOL_PROBLEM }
  const args = request?.arguments === undefined || request?.arguments === null ? {} : request.arguments
  if (!isPlainObject(args)) return { ok: false, problem: MCP_TOOL_ARGS_PROBLEM }
  return callMcpServerTool(server, tool, args, options)
}

export function createMcpApi(options = {}) {
  const runsDir = options.runsFolder ?? ''
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const deleteMatch = /^\/api\/mcp\/servers\/([^/]+)\/delete$/.exec(path)
    const known = path === '/api/mcp/servers' || path === '/api/mcp/tools' || path === '/api/mcp/call' || Boolean(deleteMatch)
    if (!known) return false
    if (!pageRequest(req)) {
      sendJson(req, res, 403, { error: OWNER_MCP_PROBLEM })
      return true
    }

    if (path === '/api/mcp/servers') {
      if (method === 'GET') {
        sendJson(req, res, 200, { ok: true, servers: readMcpServers(runsDir) })
        return true
      }
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: MCP_SAVE_CONFIRM_PROBLEM })
        return true
      }
      const answer = upsertMcpServer(runsDir, body)
      if (!answer.ok) {
        sendJson(req, res, 400, { error: answer.problem })
        return true
      }
      if (typeof notify === 'function') notify({ topic: 'mcp' })
      sendJson(req, res, 200, { ok: true, server: answer.server, servers: answer.servers })
      return true
    }

    if (deleteMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: MCP_DELETE_CONFIRM_PROBLEM })
        return true
      }
      let name
      try {
        name = decodeURIComponent(deleteMatch[1])
      } catch {
        name = deleteMatch[1]
      }
      const answer = removeMcpServer(runsDir, name)
      if (!answer.ok) {
        sendJson(req, res, 404, { error: answer.problem })
        return true
      }
      if (typeof notify === 'function') notify({ topic: 'mcp' })
      sendJson(req, res, 200, { ok: true, deleted: answer.server.name, servers: answer.servers })
      return true
    }

    if (path === '/api/mcp/tools') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      sendJson(req, res, 200, await listAllMcpTools(runsDir))
      return true
    }

    if (path === '/api/mcp/call') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: MCP_CALL_CONFIRM_PROBLEM })
        return true
      }
      const answer = await callMcpTool(runsDir, body)
      sendJson(req, res, 200, { ok: answer.ok === true, result: answer.result ?? null, problem: answer.problem ?? null })
      return true
    }

    return false
  }

  return { handle }
}
