import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONVERSATION_ENTRY_LIMIT, CONVERSATION_TEXT_LIMIT, conversationFromLog } from '../src/model/conversation.js'

const lines = (...items) => `${items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')}\n`

const claudeLog = lines(
  { type: 'system', subtype: 'init' },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'I will read the file.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/math.js' } },
      ],
    },
  },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: false }] } },
  {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] },
  },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok', is_error: false }] } },
  { type: 'result', result: 'Done.', is_error: false }
)

const codexLog = lines(
  {
    type: 'item.started',
    item: { id: 'item_cmd_1', type: 'command_execution', command: 'npm test', status: 'in_progress' },
  },
  {
    type: 'item.completed',
    item: { id: 'item_cmd_1', type: 'command_execution', command: 'npm test', status: 'completed', exit_code: 0 },
  },
  { type: 'item.completed', item: { type: 'agent_message', text: 'The tests pass.' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }
)

function opencodeLog() {
  const fixture = readFileSync(new URL('./fixtures/opencode-run-json.jsonl', import.meta.url), 'utf8')
  return `${fixture}${JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } })}\n`
}

describe('a conversation read from a lane log', () => {
  it('gives the prompt, the agent words and the Claude tool calls in order', () => {
    const entries = conversationFromLog('claude', claudeLog, 'Read the file and run the tests.')
    expect(entries[0]).toEqual({
      role: 'prompt',
      text: 'Read the file and run the tests.',
      tool: null,
      at: null,
    })
    expect(entries.filter((item) => item.role === 'agent').map((item) => item.text)).toEqual(['I will read the file.'])
    expect(entries.filter((item) => item.role === 'tool').map((item) => [item.tool, item.text])).toEqual([
      ['read', 'read src/math.js'],
      ['shell', '$ npm test'],
    ])
    expect(entries.at(-1)).toMatchObject({ role: 'result', text: 'Done.' })
  })

  it('gives the prompt, the agent words and the OpenCode tool calls in order', () => {
    const entries = conversationFromLog('opencode', opencodeLog(), 'List the files.')
    expect(entries[0]).toEqual({ role: 'prompt', text: 'List the files.', tool: null, at: null })
    expect(entries.filter((item) => item.role === 'tool').map((item) => [item.tool, item.text])).toEqual([
      ['read', 'read scratch'],
      ['search', 'glob scratch'],
    ])
    expect(entries.some((item) => item.role === 'agent' && item.text.includes('Stopping here'))).toBe(true)
    expect(entries.at(-1)).toMatchObject({ role: 'result', text: 'The run ended.' })
  })

  it('gives the prompt, the agent words and the Codex tool calls in order', () => {
    const entries = conversationFromLog('codex', codexLog, 'Run the tests.')
    expect(entries[0]).toEqual({ role: 'prompt', text: 'Run the tests.', tool: null, at: null })
    expect(entries.filter((item) => item.role === 'tool').map((item) => [item.tool, item.text])).toEqual([
      ['shell', '$ npm test'],
    ])
    expect(entries.filter((item) => item.role === 'agent').map((item) => item.text)).toEqual(['The tests pass.'])
    expect(entries.at(-1)).toMatchObject({ role: 'result', text: 'The run ended.' })
  })

  it('reads an AGY tool step and its result line', () => {
    const step = (state) => ({
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 1,
        state,
        step_type: 'tool',
        tool_name: 'view_file',
        tool_info: { parameters: { AbsolutePath: 'src/math.js' } },
      },
    })
    const entries = conversationFromLog(
      'agy',
      lines(step('ACTIVE'), step('DONE'), { event: 'result', result: { response: 'I read the file.' } }),
      'Read the file.'
    )
    expect(entries.filter((item) => item.role === 'tool').map((item) => [item.tool, item.text])).toEqual([
      ['read', 'read src/math.js'],
    ])
    expect(entries.at(-1)).toMatchObject({ role: 'result', text: 'I read the file.' })
  })

  it('masks a key and a home path and gives line entries for a harness it does not read', () => {
    const key = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`
    const text = `Reading C:\\Users\\tester\\MachineRoom\\src\\app.js\nOPENROUTER_API_KEY=${key}\n`
    const entries = conversationFromLog('hermes', text)
    expect(entries.map((item) => item.role)).toEqual(['line', 'line'])
    expect(entries[0].text).toContain('%USERPROFILE%')
    expect(entries[0].text).not.toContain('tester')
    expect(entries[1].text).toContain('[key]')
    for (const item of entries) expect(item.text).not.toContain(key)
  })

  it('masks a JSON line from a harness it does not read as data', () => {
    const text = lines({ type: 'item.completed', text: 'Reading C:\\Users\\NAME\\MachineRoom\\src\\app.js' })
    const entries = conversationFromLog('native', text)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toContain('%USERPROFILE%')
    expect(entries[0].text).not.toContain('NAME')
  })

  it('masks a JSON string line for a harness it reads and one it does not', () => {
    const text = lines(JSON.stringify('C:\\Users\\NAME\\project'))
    for (const harness of ['opencode', 'native']) {
      const entries = conversationFromLog(harness, text)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ role: 'line' })
      expect(entries[0].text).toContain('%USERPROFILE%')
      expect(entries[0].text).not.toContain('NAME')
    }
  })

  it('masks a named secret field in an unknown OpenCode event', () => {
    const value = 'opaque-value-12345'
    const entries = conversationFromLog('opencode', lines({ type: 'session.updated', env: { OPENAI_API_KEY: value } }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ role: 'line' })
    expect(entries[0].text).toContain('[key]')
    expect(entries[0].text).not.toContain(value)
  })

  it('masks a named secret field in an unknown Claude event', () => {
    const value = 'opaque-value-54321'
    const entries = conversationFromLog('claude', lines({ type: 'debug', env: { OPENAI_API_KEY: value } }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ role: 'line' })
    expect(entries[0].text).toContain('[key]')
    expect(entries[0].text).not.toContain(value)
  })

  it('keeps a number, a false and a null in a field named like a secret', () => {
    const entries = conversationFromLog(
      'opencode',
      lines({
        type: 'session.updated',
        usage: { input_tokens: 120 },
        secret_enabled: false,
        token_expiry: null,
      })
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ role: 'line' })
    expect(entries[0].text).toContain('"input_tokens":120')
    expect(entries[0].text).toContain('"secret_enabled":false')
    expect(entries[0].text).toContain('"token_expiry":null')
    expect(entries[0].text).not.toContain('[key]')
  })

  it('masks a secret field whose value is text', () => {
    const value = 'sk-abcdef123456'
    const entries = conversationFromLog('opencode', lines({ type: 'session.updated', api_key: value }))
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toContain('"api_key":"[key]"')
    expect(entries[0].text).not.toContain(value)
  })

  it('masks a nested token or password field whose value is text', () => {
    const entries = conversationFromLog(
      'opencode',
      lines({ type: 'session.updated', auth: { token: 'x' }, list: [{ password: 'y' }] })
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toContain('"auth":{"token":"[key]"}')
    expect(entries[0].text).toContain('"list":[{"password":"[key]"}]')
  })

  it('keeps the last 2000 entries and cuts each text to 4000 characters', () => {
    const many = Array.from({ length: CONVERSATION_ENTRY_LIMIT + 100 }, (_, index) => `line ${index + 1}`).join('\n')
    const kept = conversationFromLog('hermes', many)
    expect(kept).toHaveLength(CONVERSATION_ENTRY_LIMIT)
    expect(kept[0].text).toBe('line 101')
    expect(kept.at(-1).text).toBe(`line ${CONVERSATION_ENTRY_LIMIT + 100}`)
    expect(conversationFromLog('hermes', 'x'.repeat(CONVERSATION_TEXT_LIMIT + 500))[0].text).toHaveLength(
      CONVERSATION_TEXT_LIMIT
    )
  })
})
