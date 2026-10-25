import { describe, expect, it } from 'vitest'
import { AGENT_ORDER, HARNESSES, OWNER_ORDER, harnessByAdapter, harnessByKey } from '../src/harnesses/index.js'
import { parseBriefs } from '../src/briefs/briefs.js'
import { createRunLineReader } from '../src/briefs/recording.js'
import { createParser } from '../src/model/parsers/index.js'

const ctx = { rootName: '', files: [], dirs: [] }

function lines(...items) {
  return items.map((item) => JSON.stringify(item)).join('\n')
}

const claudeLine = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.js' } }] },
})
const opencodeLine = JSON.stringify({
  type: 'tool_use',
  part: { id: 't1', tool: 'read', state: { status: 'completed', input: { path: 'src/a.js' } } },
})
const agyLine = JSON.stringify({
  event: 'step_update',
  step_update: {
    conversation_id: 'c1',
    step_index: 1,
    state: 'DONE',
    step_type: 'tool',
    tool_name: 'read_file',
    tool_info: { parameters: { Path: 'src/a.js' } },
  },
})

describe('harness registry', () => {
  it('lists one descriptor per harness, in agent order', () => {
    expect(HARNESSES.map((harness) => harness.key)).toEqual(['claude', 'hermes', 'opencode', 'agy', 'acp', 'machineroom', 'codex', 'copilot'])
    expect(AGENT_ORDER).toEqual(['claude', 'hermes', 'opencode', 'agy', 'acp', 'machineroom', 'codex', 'copilot'])
    expect(Object.keys(harnessByKey)).toEqual(AGENT_ORDER)
    for (const harness of HARNESSES) expect(harnessByKey[harness.key]).toBe(harness)
  })

  it('maps each adapter type to its harness', () => {
    expect(Object.keys(harnessByAdapter).sort()).toEqual(['acp_local', 'claude_local', 'codex_local', 'copilot_local', 'hermes_local', 'machineroom_local', 'opencode_local', 'process'])
    expect(harnessByAdapter.claude_local).toBe(harnessByKey.claude)
    expect(harnessByAdapter.hermes_local).toBe(harnessByKey.hermes)
    expect(harnessByAdapter.opencode_local).toBe(harnessByKey.opencode)
    expect(harnessByAdapter.process).toBe(harnessByKey.agy)
    expect(harnessByAdapter.acp_local).toBe(harnessByKey.acp)
    expect(harnessByAdapter.machineroom_local).toBe(harnessByKey.machineroom)
    expect(harnessByAdapter.codex_local).toBe(harnessByKey.codex)
    expect(harnessByAdapter.copilot_local).toBe(harnessByKey.copilot)
  })

  it('keeps the brief owner order the room has always used', () => {
    expect(OWNER_ORDER).toEqual(['hermes', 'opencode', 'agy', 'claude'])
    const [brief] = parseBriefs('**C6. A brief (Claude, OpenCode).** Text.')
    expect(brief.owners).toEqual(['opencode', 'claude'])
  })

  it('gives every descriptor the browser-safe contract', () => {
    for (const harness of HARNESSES) {
      expect(typeof harness.key, harness.name).toBe('string')
      expect(typeof harness.name, harness.key).toBe('string')
      expect(typeof harness.adapterType, harness.key).toBe('string')
      for (const field of ['createParser', 'command', 'readLine', 'report', 'reply', 'usage']) {
        expect(typeof harness[field], `${harness.key} ${field}`).toBe('function')
      }
    }
  })

  it('builds a command from the lane cli block and the folder', () => {
    for (const harness of HARNESSES) {
      const command = harness.command({
        cli: { bin: harness.key, model: 'model', provider: 'provider', args: ['serve'] },
        prompt: 'Do it.',
        env: {},
        folder: 'C:\\work',
        title: 'run-1',
      })
      if (harness.key === 'machineroom') expect(command.file).toBe(process.execPath)
      else expect(command.file, harness.key).toBe(harness.key)
      expect(command.cwd, harness.key).toBe('C:\\work')
      if (harness.key === 'acp') expect(command.args, harness.key).toEqual(['serve'])
      else expect(command.args, harness.key).toContain('Do it.')
    }
  })

  it('reads an environment variable in the command line', () => {
    const bin = '%TOOLS%\\hermes.exe'
    const cli = { bin, model: 'model', provider: 'provider' }
    const command = harnessByKey.hermes.command({ cli, prompt: 'Do it.', env: { TOOLS: 'C:\\tools' }, folder: 'C:\\work' })
    expect(command.file).toBe('C:\\tools\\hermes.exe')
    expect(() => harnessByKey.hermes.command({ cli, prompt: 'Do it.', env: {}, folder: 'C:\\work' })).toThrow('The environment variable TOOLS is not set.')
  })
})

describe('harness line readers', () => {
  it('reads a Hermes tool line', () => {
    const read = createRunLineReader('hermes')
    expect(read('┊ 📖 read  src/a.js  1.2s', 1000)).toEqual({ chunk: '┊ 📖 read  src/a.js  1.2s\n', at: 1000, read: true })
    expect(read('plain words', 1000)).toEqual({ chunk: 'plain words\n', at: 1000, read: false })
    expect(read('  ', 1000)).toBeNull()
  })

  it('reads a Claude Code tool_use line', () => {
    const read = createRunLineReader('claude')
    expect(read(claudeLine, 1000)).toEqual({ chunk: `${claudeLine}\n`, at: 1000, read: true })
  })

  it('reads a MachineRoom tool_use line', () => {
    const read = createRunLineReader('machineroom')
    expect(read(claudeLine, 1000)).toEqual({ chunk: `${claudeLine}\n`, at: 1000, read: true })
  })

  it('reads an OpenCode tool_use line', () => {
    const read = createRunLineReader('opencode')
    expect(read(opencodeLine, 1000)).toEqual({ chunk: `${opencodeLine}\n`, at: 1000, read: true })
  })

  it('reads an AGY step_update line', () => {
    const read = createRunLineReader('agy')
    expect(read(agyLine, 1000)).toEqual({ chunk: `${agyLine}\n`, at: 1000, read: true })
  })

  it('reads a Codex command_execution line', () => {
    const codexLine = JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } })
    const read = createRunLineReader('codex')
    expect(read(codexLine, 1000)).toEqual({ chunk: `${codexLine}\n`, at: 1000, read: true })
  })

  it('reads a Copilot tool execution line', () => {
    const copilotLine = JSON.stringify({ type: 'tool.execution_start', toolName: 'shell', parameters: { command: 'npm test' } })
    const read = createRunLineReader('copilot')
    expect(read(copilotLine, 1000)).toEqual({ chunk: `${copilotLine}\n`, at: 1000, read: true })
  })

  it('takes the time from a JSON line when the caller gives none', () => {
    const line = JSON.stringify({ ...JSON.parse(opencodeLine), timestamp: 1234 })
    expect(createRunLineReader('opencode')(line).at).toBe(1234)
  })
})

describe('harness parser picker', () => {
  it('picks the parser the agent names', () => {
    const parser = createParser({ parser: 'opencode' }, ctx)
    expect(parser.push(`${opencodeLine}\n`, 1000)[0]).toMatchObject({ type: 'tool.start', tool: 'read' })
  })

  it('picks the parser by adapter type when the agent names none', () => {
    const parser = createParser({ adapterType: 'claude_local' }, ctx)
    expect(parser.push(`${claudeLine}\n`, 1000)[0]).toMatchObject({ type: 'tool.start', tool: 'read' })
  })

  it('keeps the generic process adapter off the AGY parser', () => {
    expect(createParser({ adapterType: 'process' }, ctx).push(`${agyLine}\n`, 1000)).toEqual([])
    expect(createParser({ parser: 'agy' }, ctx).push(`${agyLine}\n`, 1000)).not.toEqual([])
  })
})

describe('harness reports and usage', () => {
  it('reads the Claude Code result line', () => {
    const log = lines({ type: 'result', result: 'First.\nSecond.', total_cost_usd: 0.25, usage: { input_tokens: 10, output_tokens: 5 } })
    expect(harnessByKey.claude.report(log)).toEqual(['First.', 'Second.'])
    expect(harnessByKey.claude.reply(log)).toBe('First.\nSecond.')
    expect(harnessByKey.claude.usage(log)).toEqual({ costUsd: 0.25, inputTokens: 10, outputTokens: 5 })
  })

  it('reads the OpenCode text and step_finish lines', () => {
    const log = lines(
      { type: 'text', part: { text: 'All done.\nAgain.' } },
      { type: 'step_finish', part: { cost: 0.5, tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 2 } } } },
    )
    expect(harnessByKey.opencode.reply(log)).toBe('All done.\nAgain.')
    expect(harnessByKey.opencode.report(log)).toEqual(['All done.', 'Again.'])
    expect(harnessByKey.opencode.usage(log)).toEqual({ costUsd: 0.5, inputTokens: 112, outputTokens: 25 })
  })

  it('reads the AGY result line', () => {
    const log = lines({ event: 'result', result: { response: 'Ready.\nSet.', usage: { input_tokens: 7, output_tokens: 3, thinking_tokens: 2 } } })
    expect(harnessByKey.agy.report(log)).toEqual(['Ready.', 'Set.'])
    expect(harnessByKey.agy.reply(log)).toBe('Ready.\nSet.')
    expect(harnessByKey.agy.usage(log)).toEqual({ costUsd: null, inputTokens: 7, outputTokens: 5 })
  })

  it('reads the MachineRoom result line', () => {
    const log = lines(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } },
      { type: 'result', result: 'Done.\nNext.', total_cost_usd: 0.02, usage: { input_tokens: 12, output_tokens: 4 } },
    )
    expect(harnessByKey.machineroom.report(log)).toEqual(['Done.', 'Next.'])
    expect(harnessByKey.machineroom.reply(log)).toBe('Done.\nNext.')
    expect(harnessByKey.machineroom.usage(log)).toEqual({ costUsd: 0.02, inputTokens: 12, outputTokens: 4 })
  })

  it('takes the Hermes report from the lines before its first tool line', () => {
    const log = 'First line.\r\nSecond line.\r\n┊ 📖 read  src/a.js  1.2s\r\n'
    expect(harnessByKey.hermes.report(log)).toEqual(['First line.', 'Second line.'])
    expect(harnessByKey.hermes.reply(log)).toBe('First line.\nSecond line.')
    expect(harnessByKey.hermes.usage(log)).toEqual({ costUsd: null, inputTokens: null, outputTokens: null })
  })

  it('reads the Codex message and turn.completed usage lines', () => {
    const log = lines(
      { type: 'item.completed', item: { type: 'agent_message', text: 'Fixed.\nDone.' } },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 45 } },
    )
    expect(harnessByKey.codex.report(log)).toEqual(['Fixed.', 'Done.'])
    expect(harnessByKey.codex.reply(log)).toBe('Fixed.\nDone.')
    expect(harnessByKey.codex.usage(log)).toEqual({ costUsd: null, inputTokens: 120, outputTokens: 45 })
  })

  it('reads the Copilot message and usage lines', () => {
    const log = lines(
      { type: 'assistant.message', data: { content: 'Applied.\nFinished.' } },
      { type: 'session.completed', usage: { input_tokens: 80, output_tokens: 30 } },
    )
    expect(harnessByKey.copilot.report(log)).toEqual(['Applied.', 'Finished.'])
    expect(harnessByKey.copilot.reply(log)).toBe('Applied.\nFinished.')
    expect(harnessByKey.copilot.usage(log)).toEqual({ costUsd: null, inputTokens: 80, outputTokens: 30 })
  })

  it('gives an empty report for an empty log', () => {
    for (const harness of HARNESSES) expect(harness.report('')).toEqual([])
  })
})
