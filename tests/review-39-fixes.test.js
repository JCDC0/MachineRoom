import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { boundMessages } from '../scripts/mr-agent.mjs'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { click, withDom } from './helpers/uiDom.js'

const AGENT_SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'review-39-') {
  const dir = makeTempDir(prefix)
  cleanups.push(async () => removeTempDir(dir))
  return dir
}

function baseEnvironment() {
  const env = {}
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'COMSPEC', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name]
  }
  return env
}

function chatAnswer({ text = '', calls = [] } = {}) {
  const message = { role: 'assistant', content: text === '' ? null : text }
  if (calls.length > 0) {
    message.tool_calls = calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: 'function',
      function: {
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      },
    }))
  }
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message, finish_reason: calls.length > 0 ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
}

function startFakeApi(handler) {
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const parsed = body === '' ? null : JSON.parse(body)
        calls.push({ method: req.method, url: req.url, headers: req.headers, body: parsed })
        const answer = await handler(parsed, calls.length - 1, calls)
        const status = Number.isInteger(answer?.status) ? answer.status : 200
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer?.body ?? answer))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(error?.message ?? error) }))
      }
    })
  })
  cleanups.push(
    () =>
      new Promise((done) => {
        server.close(() => done())
        server.closeAllConnections?.()
      }),
  )
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}/v1`, calls })
    })
  })
}

function startFakeBridge(handler) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    })
  })
  cleanups.push(
    () =>
      new Promise((done) => {
        server.close(() => done())
        server.closeAllConnections?.()
      }),
  )
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function runAgent({ folder, api, prompt = 'Do the task.', env = {}, seconds = 20 }) {
  return new Promise((done, fail) => {
    const childEnv = {
      ...baseEnvironment(),
      MACHINEROOM_API_URL: api.url,
      MACHINEROOM_API_KEY: 'test-key',
      ...env,
    }
    const args = [AGENT_SCRIPT, '--model', 'test/model', '--cwd', folder, prompt]
    const child = spawn(process.execPath, args, {
      cwd: folder,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error(`mr-agent did not exit. stderr: ${stderr}`))
    }, seconds * 1000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

function isDisabled(node) {
  return node?.disabled === true || node?.hasAttribute('disabled') === true
}

function modelTrigger(container) {
  return container.querySelector('.mr-picker-trigger')
}

async function pickModel(container, root, id) {
  await click(root, modelTrigger(container))
  const option = container
    .querySelectorAll('.mr-picker-pick')
    .find((button) => button.getAttribute('title') === id)
  expect(option).toBeTruthy()
  await click(root, option)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('review 39 fixes: R39-2 chat model picker', () => {
  it('disables the chat model picker while a save waits and lets a second choice save after it ends', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
    ]
    const pending = []
    const calls = []
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [], model: 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: (payload) => {
        calls.push(payload)
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)

      await pickModel(container, root, 'sonnet')
      expect(calls).toEqual([{ id: 'orchestrator', model: 'sonnet', confirmed: true }])
      expect(container.querySelector('.mr-picker-pop')).toBeNull()
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('sonnet')

      await pickModel(container, root, 'gpt')
      expect(calls).toEqual([
        { id: 'orchestrator', model: 'sonnet', confirmed: true },
        { id: 'orchestrator', model: 'gpt', confirmed: true },
      ])
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('gpt')
    })
  })

  it('re-enables the picker after a failed save on the same tab', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
    ]
    const pending = []
    const calls = []
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [], model: 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: (payload) => {
        calls.push(payload)
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )
      })

      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].reject(new Error('Save failed'))
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(container.textContent).toContain('Save failed')

      await pickModel(container, root, 'gpt')
      expect(calls).toHaveLength(2)
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('gpt')
    })
  })

  it('only lets a finished save re-enable the tab that started it', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
      { id: 'sub', name: 'Sub', harness: 'claude', model: 'gpt', effort: 'medium', state: 'idle' },
    ]
    const pending = []
    const client = {
      orchestrator: async (id) => ({ state: 'idle', messages: [], model: id === 'sub' ? 'gpt' : 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: () => {
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      const render = (selected) =>
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            selected,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )

      await act(async () => render('orchestrator'))
      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => render('sub'))
      expect(isDisabled(modelTrigger(container))).toBe(false)

      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('sonnet')
    })
  })
})

describe('review 39 fixes: R39-3 inbox context bound', () => {
  it('keeps the newest reply when an inbox batch is oversized', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(1000) },
      { role: 'user', content: 'Initial task to keep.' },
      { role: 'user', content: 'Messages for you while you work:\nolder: ' + 'x'.repeat(7500) + '\nnewer: Newest order to keep.' },
    ]
    boundMessages(messages, 8000)
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1].content).toBe('Initial task to keep.')
    expect(messages[2].content).toBe('Messages for you while you work:\nnewer: Newest order to keep.')
  })

  it('leaves a short inbox batch unchanged', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(1000) },
      { role: 'user', content: 'Initial task to keep.' },
      { role: 'user', content: 'Messages for you while you work:\nfirst: Hello.\nsecond: Continue.' },
    ]
    const original = structuredClone(messages)
    boundMessages(messages, 8000)
    expect(messages).toEqual(original)
  })

  it('keeps the end of a reply that is too large on its own', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(1000) },
      { role: 'user', content: 'Initial task to keep.' },
      { role: 'user', content: 'Messages for you while you work:\nnewer: ' + 'x'.repeat(7500) + ' end of reply' },
    ]
    boundMessages(messages, 8000)
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[2].content.startsWith('Messages for you while you work:\n')).toBe(true)
    expect(messages[2].content.endsWith('end of reply')).toBe(true)
  })

  async function runWithSixBatches(batchSize) {
    const folder = tempDir()
    const batchText = (number) => `batch-${number}: ${String(number).repeat(batchSize)}`
    let inbox = []
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ messages: inbox }))
    })
    const api = await startFakeApi((_body, index) => {
      if (index < 6) {
        const number = index + 1
        inbox = [
          {
            from: 'orchestrator',
            text: batchText(number),
            at: `2026-11-15T11:0${number}:00.000Z`,
          },
        ]
        return chatAnswer({ calls: [{ id: `call_${index}`, name: 'list_dir', arguments: { path: '.' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({
      folder,
      api,
      prompt: 'Initial task to keep.',
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: `ticket-bound-${batchSize}`,
        MR_AGENT_CONTEXT_CHARS: '8000',
      },
    })
    return { result, api, batchText }
  }

  it('drops oldest inbox batches under an 8000 character limit while keeping the task and newest batch', async () => {
    const { result, api, batchText } = await runWithSixBatches(2500)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(api.calls).toHaveLength(7)

    const messages = api.calls[6].body.messages
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1]).toEqual({ role: 'user', content: 'Initial task to keep.' })

    const inboxMessages = messages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('Messages for you while you work:'),
    )
    expect(inboxMessages.length).toBeGreaterThanOrEqual(1)
    expect(inboxMessages.some((message) => message.content.includes('batch-1:'))).toBe(false)
    expect(inboxMessages.at(-1).content).toContain(batchText(6))
  })

  it('stays under 8000 characters when all six inbox batches are close to 8000 characters', async () => {
    const { result, api } = await runWithSixBatches(7500)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(api.calls).toHaveLength(7)

    const messages = api.calls[6].body.messages
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1]).toEqual({ role: 'user', content: 'Initial task to keep.' })

    const inboxMessages = messages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('Messages for you while you work:'),
    )
    expect(inboxMessages).toHaveLength(1)
    expect(inboxMessages[0].content).toMatch(/6+$/)
    expect(inboxMessages[0].content).not.toContain('batch-1:')
  })

  it('keeps the sender and [start cut] on a cut inbox reply and starts at a word boundary', () => {
    const heading = 'Messages for you while you work:'
    const prefix = `${heading}\nnewer: [start cut] `
    const capacity = 2000 - prefix.length
    const lead = 'delete the backup. '
    const padWords = 'word '.repeat(Math.ceil(capacity / 5) + 10)
    const makeReply = (extra) => {
      const tail = lead + padWords.slice(0, capacity - lead.length + extra)
      return `${heading}\nnewer: ${'x'.repeat(5500)} Never ${tail}`
    }

    const exactMessages = [
      { role: 'system', content: 's'.repeat(1000) },
      { role: 'user', content: 'Initial task to keep.' },
      { role: 'user', content: makeReply(0) },
    ]
    boundMessages(exactMessages, 8000)
    expect(JSON.stringify(exactMessages).length).toBeLessThanOrEqual(8000)
    expect(exactMessages[2].content.length).toBeLessThanOrEqual(2000)
    expect(exactMessages[1].content).toBe('Initial task to keep.')
    expect(exactMessages[2].content.startsWith(`${prefix}delete the backup. `)).toBe(true)
    expect(exactMessages[2].content).not.toContain('Never')

    const shiftedMessages = [
      { role: 'system', content: 's'.repeat(1000) },
      { role: 'user', content: 'Initial task to keep.' },
      { role: 'user', content: makeReply(1) },
    ]
    boundMessages(shiftedMessages, 8000)
    expect(JSON.stringify(shiftedMessages).length).toBeLessThanOrEqual(8000)
    expect(shiftedMessages[2].content.length).toBeLessThanOrEqual(2000)
    expect(shiftedMessages[1].content).toBe('Initial task to keep.')
    expect(shiftedMessages[2].content.startsWith(`${prefix}the backup. `)).toBe(true)
    expect(shiftedMessages[2].content).not.toContain('Never')
    expect(shiftedMessages[2].content).not.toContain('elete')

    for (let extra = 0; extra <= 25; extra += 1) {
      const messages = [
        { role: 'system', content: 's'.repeat(1000) },
        { role: 'user', content: 'Initial task to keep.' },
        { role: 'user', content: makeReply(extra) },
      ]
      boundMessages(messages, 8000)
      expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
      expect(messages[2].content.length).toBeLessThanOrEqual(2000)
      expect(messages[1].content).toBe('Initial task to keep.')
      expect(messages[2].content.startsWith(prefix)).toBe(true)
      const kept = messages[2].content.slice(prefix.length)
      expect(kept).toMatch(/^(delete|the|backup\.|word)(?=\s|$)/)
    }
  })

  it('keeps a colon-named sender and fits a tighter message bound when cutting an inbox tail', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(6500) },
      { role: 'user', content: 'Initial task to keep.' },
      {
        role: 'user',
        content: 'Messages for you while you work:\nlane:opencode: ' + 'filler '.repeat(400) + 'keep this tail.',
      },
    ]
    boundMessages(messages, 8000)
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1].content).toBe('Initial task to keep.')
    const prefix = 'Messages for you while you work:\nlane:opencode: [start cut] '
    expect(messages[2].content.startsWith(prefix)).toBe(true)
    const kept = messages[2].content.slice(prefix.length)
    expect(kept).toMatch(/^(filler|keep|this|tail\.)(?=\s|$)/)
    expect(kept.endsWith('keep this tail.')).toBe(true)
  })

  it('keeps a sender name with spaces on a cut inbox reply', () => {
    const messages = [
      { role: 'system', content: 's'.repeat(6500) },
      { role: 'user', content: 'Initial task to keep.' },
      {
        role: 'user',
        content: 'Messages for you while you work:\nEye check agent: ' + 'filler '.repeat(400) + 'keep this tail.',
      },
    ]
    boundMessages(messages, 8000)
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1].content).toBe('Initial task to keep.')
    const prefix = 'Messages for you while you work:\nEye check agent: [start cut] '
    expect(messages[2].content.startsWith(prefix)).toBe(true)
    const kept = messages[2].content.slice(prefix.length)
    expect(kept).toMatch(/^(filler|keep|this|tail\.)(?=\s|$)/)
    expect(kept.endsWith('keep this tail.')).toBe(true)
  })

  it('keeps the bound and the task when a spaced-sender reply is cut', async () => {
    const folder = tempDir()
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          messages: [
            { from: 'Eye check agent', text: `${'filler '.repeat(1200)}keep this tail.`, at: '2026-11-16T10:00:00.000Z' },
          ],
        }),
      )
    })
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
        : chatAnswer({ text: 'Done.' }),
    )

    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: 'ticket-spaced-sender',
        MR_AGENT_CONTEXT_CHARS: '8000',
      },
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(api.calls).toHaveLength(2)
    const messages = api.calls[1].body.messages
    expect(JSON.stringify(messages).length).toBeLessThanOrEqual(8000)
    expect(messages[1]).toEqual({ role: 'user', content: 'Do the task.' })
    const inbox = messages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('Messages for you while you work:'),
    )
    expect(inbox).toHaveLength(1)
    expect(inbox[0].content.length).toBeLessThanOrEqual(2000)
    expect(inbox[0].content.startsWith('Messages for you while you work:\nEye check agent: [start cut] ')).toBe(true)
    expect(inbox[0].content.endsWith('keep this tail.')).toBe(true)
  })
})
