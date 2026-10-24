#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const SESSION = 'ses_fake_parent'
const CHILD = 'ses_fake_child'
const cwd = process.cwd()
const lines = createInterface({ input: process.stdin })
const waiting = new Map()
let nextId = 0
let promptStarted = false
let model = 'fake/model'
let effort = 'default'

function config() {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: [
        { value: 'fake/model', name: 'Fake Model' },
        { value: 'fake/other', name: 'Other Model' },
      ],
    },
    {
      id: 'effort',
      name: 'Effort',
      category: 'effort',
      type: 'select',
      currentValue: effort,
      options: [
        { value: 'default', name: 'Default' },
        { value: 'max', name: 'Max' },
      ],
    },
  ]
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function update(value, sessionId = SESSION) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: value } })
}

function childMeta() {
  return { 'opencode/child-session': { id: CHILD, parentID: SESSION, depth: 1, title: 'Read the test' } }
}

function askPermission(toolCallId, title) {
  return new Promise((done) => {
    const id = 900 + (nextId += 1)
    waiting.set(id, done)
    send({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId: SESSION,
        toolCall: { toolCallId, title, kind: 'edit' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
    })
  })
}

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function prompt(text) {
  if (promptStarted) return
  promptStarted = true
  if (process.env.FAKE_ACP_HANG === '1') return new Promise(() => {})
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_parent', content: { type: 'text', text: 'Working.' } })
  update({ sessionUpdate: 'tool_call', toolCallId: 'call_read', name: 'read', title: 'read src/a.js', kind: 'read', status: 'pending', locations: [], rawInput: {} })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_read', status: 'in_progress', kind: 'read', title: 'read src/a.js', locations: [{ path: join(cwd, 'src', 'a.js') }], rawInput: { path: 'src/a.js' } })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_read', status: 'completed', locations: [{ path: join(cwd, 'src', 'a.js') }], content: [{ type: 'content', content: { type: 'text', text: 'read src/a.js' } }] })

  const allowed = await askPermission('call_write', 'write docs/note.md')
  if (allowed !== 'allow') {
    update({ sessionUpdate: 'tool_call', toolCallId: 'call_write', name: 'write', title: 'write docs/note.md', kind: 'edit', status: 'failed', locations: [], rawInput: {} })
    return { stopReason: 'refusal' }
  }
  update({ sessionUpdate: 'tool_call', toolCallId: 'call_write', name: 'write', title: 'write docs/note.md', kind: 'edit', status: 'pending', locations: [], rawInput: {} })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_write', status: 'in_progress', kind: 'edit', title: 'write docs/note.md', locations: [{ path: join(cwd, 'docs', 'note.md') }], rawInput: { path: 'docs/note.md' } })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_write', status: 'completed', locations: [{ path: join(cwd, 'docs', 'note.md') }] })

  update({ sessionUpdate: 'tool_call', toolCallId: 'call_subagent', name: 'subagent', title: 'subagent', kind: 'think', status: 'pending', locations: [], rawInput: {} })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_subagent', status: 'in_progress', kind: 'think', title: 'subagent', locations: [], rawInput: { agent: 'explore', description: 'Read the test', prompt: 'Read test/a.test.js.' } })
  update({ sessionUpdate: 'tool_call', toolCallId: `${CHILD}:call_child`, name: 'read', title: 'Read the test: read', kind: 'read', status: 'pending', locations: [], rawInput: {}, _meta: childMeta() })
  update({ sessionUpdate: 'tool_call_update', toolCallId: `${CHILD}:call_child`, status: 'in_progress', kind: 'read', title: 'Read the test: read', locations: [{ path: join(cwd, 'test', 'a.test.js') }], rawInput: { path: join(cwd, 'test', 'a.test.js') }, _meta: childMeta() })
  update({ sessionUpdate: 'tool_call_update', toolCallId: `${CHILD}:call_child`, status: 'completed', locations: [{ path: join(cwd, 'test', 'a.test.js') }], _meta: childMeta() })
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_child', content: { type: 'text', text: 'child reply' }, _meta: childMeta() })
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_subagent', status: 'completed', locations: [], rawInput: { agent: 'explore', description: 'Read the test', prompt: 'Read test/a.test.js.' } })
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_final', content: { type: 'text', text: 'All ' } })
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_final', content: { type: 'text', text: 'done.' } })
  update({ sessionUpdate: 'usage_update', used: 24, size: 1000, cost: { amount: 0.000123, currency: 'USD' } })
  await delay(20)
  return {
    stopReason: 'end_turn',
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 24, thoughtTokens: 3, cachedReadTokens: 4 },
  }
}

lines.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }
  if (message.id !== undefined && waiting.has(message.id)) {
    const settle = waiting.get(message.id)
    waiting.delete(message.id)
    const outcome = message.result?.outcome
    settle(outcome?.outcome === 'selected' ? outcome.optionId : null)
    return
  }
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false, promptCapabilities: { image: false } },
      agentInfo: { name: 'Fake ACP agent', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'session/new') {
    respond(message.id, { sessionId: SESSION, configOptions: config() })
    return
  }
  if (message.method === 'session/set_config_option') {
    const value = String(message.params?.value ?? '')
    if (message.params?.configId === 'model') model = value
    else if (message.params?.configId === 'effort') effort = value
    else {
      respondError(message.id, -32602, `Unknown config option ${message.params?.configId}.`)
      return
    }
    respond(message.id, { configOptions: config() })
    return
  }
  if (message.method === 'session/prompt') {
    prompt(String(message.params?.prompt?.[0]?.text ?? ''))
      .then((result) => respond(message.id, result))
      .catch((failure) => respondError(message.id, -32000, failure?.message ?? String(failure)))
    return
  }
  if (message.method === 'session/cancel') return
  if (message.id !== undefined) respondError(message.id, -32601, `The fake agent does not answer ${message.method}.`)
})

lines.on('close', () => {
  process.exitCode = 0
})
