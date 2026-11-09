#!/usr/bin/env node
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_NAME = 'machineroom-approve'
const WAIT_MS = 4.5 * 60 * 1000

function settings() {
  const bridge = String(process.env.MACHINEROOM_BRIDGE ?? '').trim().replace(/\/+$/, '')
  const id = String(process.env.MACHINEROOM_ORCHESTRATOR_ID ?? '').trim() || 'orchestrator'
  const token = String(process.env.MACHINEROOM_ORCHESTRATOR_TOKEN ?? '').trim()
  return { bridge, id, token }
}

function textResult(text) {
  return { content: [{ type: 'text', text }] }
}

function deny(message) {
  return textResult(JSON.stringify({ behavior: 'deny', message }))
}

async function approve(args) {
  const toolName = typeof args?.tool_name === 'string' ? args.tool_name.trim() : ''
  const input = args?.input && typeof args.input === 'object' && !Array.isArray(args.input) ? args.input : {}
  if (!toolName) return deny('The approval did not name a tool.')
  const { bridge, id, token } = settings()
  if (!bridge || !token) return deny('The approval bridge is not configured.')
  let response
  try {
    response = await fetch(`${bridge}/api/orchestrator/approvals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-MachineRoom-Orchestrator': token,
      },
      body: JSON.stringify({ id, tool: toolName, input }),
      signal: AbortSignal.timeout(WAIT_MS),
    })
  } catch (error) {
    return deny(`The approval bridge did not answer: ${String(error?.message ?? error)}`)
  }
  let answer = null
  try {
    answer = await response.json()
  } catch {
    answer = null
  }
  if (!response.ok) {
    const message = typeof answer?.error === 'string' && answer.error.trim() ? answer.error : 'The approval request failed.'
    return deny(message)
  }
  if (answer?.allow === true) {
    return textResult(JSON.stringify({ behavior: 'allow', updatedInput: input }))
  }
  const message = typeof answer?.message === 'string' && answer.message.trim() ? answer.message : 'The owner did not allow it.'
  return deny(message)
}

function toolList() {
  return {
    tools: [
      {
        name: 'approve',
        description: 'Ask the owner to allow one tool call.',
        inputSchema: {
          type: 'object',
          properties: {
            tool_name: { type: 'string' },
            input: { type: 'object' },
          },
          required: ['tool_name'],
        },
      },
    ],
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  if (!message || typeof message !== 'object') return
  const { id, method, params } = message
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: '1' },
      },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: toolList() })
    return
  }
  if (method === 'tools/call') {
    if (!params || params.name !== 'approve') {
      rpcError(id, -32602, 'Unknown tool.')
      return
    }
    const result = await approve(params.arguments ?? {})
    send({ jsonrpc: '2.0', id, result })
    return
  }
  if (id !== undefined) rpcError(id, -32601, 'Unknown method.')
}

const lines = createInterface({ input: process.stdin })
let queue = Promise.resolve()
lines.on('line', (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    rpcError(null, -32700, 'The message was not JSON.')
    return
  }
  queue = queue.then(() => handle(message)).catch((error) => {
    if (message?.id !== undefined) rpcError(message.id, -32603, String(error?.message ?? error))
  })
})
