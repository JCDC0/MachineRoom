import { describe, expect, it } from 'vitest'
import { copilotHarness } from '../src/harnesses/copilot.js'
import { createCopilotParser } from '../src/model/parsers/copilot.js'

const ctx = {
  rootName: 'agent-sandbox',
  files: ['src/math.js', 'src/strings.js', 'package.json'],
  dirs: ['src'],
  agentKey: 'copilot',
}

const lines = (...items) => items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') + '\n'

describe('copilot harness command builder', () => {
  it('builds standard non-interactive copilot command with flags', () => {
    const cmd = copilotHarness.command({
      cli: { bin: 'copilot', model: 'claude-sonnet-4.5', effort: 'high' },
      prompt: 'Refactor math helpers',
      folder: 'C:\\sandbox',
    })
    expect(cmd.file).toBe('copilot')
    expect(cmd.cwd).toBe('C:\\sandbox')
    expect(cmd.args).toEqual([
      '-p',
      'Refactor math helpers',
      '--allow-all-tools',
      '--model',
      'claude-sonnet-4.5',
      '--effort',
      'high',
      '--output-format',
      'json',
    ])
  })

  it('uses reasoning parameter when passed', () => {
    const cmd = copilotHarness.command({
      cli: { bin: 'copilot', model: 'gpt-5' },
      prompt: 'Run suite',
      folder: 'C:\\sandbox',
      reasoning: 'medium',
    })
    expect(cmd.args).toContain('--effort')
    expect(cmd.args).toContain('medium')
  })

  it('expands environment variables in bin', () => {
    const cmd = copilotHarness.command({
      cli: { bin: '%TOOLS%\\copilot.exe' },
      prompt: 'Explain code',
      env: { TOOLS: 'C:\\Tools' },
      folder: 'C:\\sandbox',
    })
    expect(cmd.file).toBe('C:\\Tools\\copilot.exe')
  })
})

describe('copilot parser with JSON fixture lines', () => {
  it('parses tool execution start and complete events and reports run start and end', () => {
    const parser = createCopilotParser(ctx)
    const stream = lines(
      { type: 'session.start' },
      {
        type: 'tool.execution_start',
        toolCallId: 'call_1',
        toolName: 'shell',
        parameters: { command: 'npm test' },
      },
      {
        type: 'tool.execution_complete',
        toolCallId: 'call_1',
        status: 'success',
        exit_code: 0,
      },
      { type: 'session.completed' },
    )
    const activities = parser.push(stream, 1000)
    expect(activities).toHaveLength(4)
    expect(activities[0]).toMatchObject({ type: 'run.start', time: 1000 })
    expect(activities[1]).toMatchObject({
      type: 'tool.start',
      id: 'call_1',
      tool: 'shell',
      label: '$ npm test',
      agent: 'copilot',
    })
    expect(activities[2]).toMatchObject({
      type: 'tool.end',
      id: 'call_1',
      ok: true,
      agent: 'copilot',
    })
    expect(activities[3]).toMatchObject({ type: 'run.end', ok: true, time: 1000 })
  })

  it('parses file edit and web search in JSON stream', () => {
    const parser = createCopilotParser(ctx)
    const stream = lines(
      {
        type: 'tool_call',
        id: 'call_file',
        name: 'edit',
        arguments: { path: 'src/math.js' },
      },
      {
        type: 'tool_result',
        id: 'call_file',
        status: 'completed',
      },
      {
        type: 'tool_call',
        id: 'call_web',
        name: 'web_search',
        arguments: { query: 'vitest api' },
      },
      {
        type: 'tool_result',
        id: 'call_web',
        status: 'completed',
      },
    )
    const activities = parser.push(stream, 2000)
    const starts = activities.filter((a) => a.type === 'tool.start')
    expect(starts).toHaveLength(2)
    expect(starts[0]).toMatchObject({
      type: 'tool.start',
      id: 'call_file',
      tool: 'edit',
      label: 'edit src/math.js',
      touches: [{ path: 'src/math.js', mode: 'write', kind: 'file' }],
    })
    expect(starts[1]).toMatchObject({
      type: 'tool.start',
      id: 'call_web',
      tool: 'web',
      label: 'vitest api',
      touches: [],
    })
  })
})

describe('copilot parser with plain text lines', () => {
  it('parses plain tool execution lines and always reports run start and end', () => {
    const parser = createCopilotParser(ctx)
    const stream = [
      'Running command: npm test',
      'Editing file: src/math.js',
      'Searching web: vitest related',
    ].join('\n') + '\n'

    const activities = parser.push(stream, 3000)
    expect(activities[0]).toMatchObject({ type: 'run.start' })

    const toolStarts = activities.filter((a) => a.type === 'tool.start')
    expect(toolStarts).toHaveLength(3)
    expect(toolStarts[0]).toMatchObject({ tool: 'shell', label: '$ npm test' })
    expect(toolStarts[1]).toMatchObject({ tool: 'edit', label: 'edit src/math.js' })
    expect(toolStarts[2]).toMatchObject({ tool: 'web', label: 'vitest related' })

    const flushed = parser.flush(4000)
    expect(flushed.some((a) => a.type === 'run.end')).toBe(true)
  })

  it('handles explicit plain session start and completed markers', () => {
    const parser = createCopilotParser(ctx)
    const stream = [
      'Session started',
      'Running command: git status',
      'Session completed',
    ].join('\n') + '\n'

    const activities = parser.push(stream, 5000)
    expect(activities[0]).toMatchObject({ type: 'run.start' })
    expect(activities[activities.length - 1]).toMatchObject({ type: 'run.end', ok: true })
  })
})

describe('copilot harness report and usage', () => {
  it('reads reply and report from JSON assistant message', () => {
    const log = lines(
      { type: 'assistant.message', data: { content: 'Changes completed.\nReady for review.' } },
    )
    expect(copilotHarness.reply(log)).toBe('Changes completed.\nReady for review.')
    expect(copilotHarness.report(log)).toEqual(['Changes completed.', 'Ready for review.'])
  })

  it('reads reply from plain text excluding tool lines', () => {
    const log = [
      'Session started',
      'Running command: npm test',
      'Everything looks good.',
      'Session completed',
    ].join('\n')
    expect(copilotHarness.reply(log)).toBe('Everything looks good.')
    expect(copilotHarness.report(log)).toEqual(['Everything looks good.'])
  })

  it('keeps tool output and terminal codes out of a plain-text reply', () => {
    const log = [
      '\u001B[32mSession started\u001B[0m',
      'Running command: npm run build',
      '> machine-room@0.1.401 build',
      'dist/index.js  1.2 kB',
      '\u001B[31mSession completed\u001B[0m',
      '\u001B[32mThe turn is done.\u001B[0m',
    ].join('\n')
    expect(copilotHarness.reply(log)).toBe('The turn is done.')
  })

  it('keeps both answer paragraphs after two tool lines', () => {
    const log = [
      'I will check the files.',
      'Running command: git status',
      'I will update the helper.',
      'Editing file: src/math.js',
      '\u001B[32mThe helper now handles empty input.\u001B[0m',
      '',
      'The existing callers keep their behavior.',
    ].join('\r\n')
    expect(copilotHarness.reply(log)).toBe('The helper now handles empty input.\n\nThe existing callers keep their behavior.')
    expect(copilotHarness.report(log)).toEqual([
      'The helper now handles empty input.',
      '',
      'The existing callers keep their behavior.',
    ])
  })

  it('keeps an answer line starting with Run the migration', () => {
    const log = [
      'Running command: git status',
      'Run the migration before deploying.',
      '',
      'Then restart the service.',
    ].join('\n')
    expect(copilotHarness.reply(log)).toBe('Run the migration before deploying.\n\nThen restart the service.')
  })

  it('keeps the whole text when there are no tool lines', () => {
    const log = 'Run the migration before deploying.\n\nCopilot can then check the result.\nSession notes stay here.'
    expect(copilotHarness.reply(log)).toBe(log)
  })

  it('keeps prose lines starting with Running, Reading, Writing or Editing', () => {
    const log = [
      'The fix is ready.',
      '',
      'Running the tests requires Node 24.',
      'Keep the lockfile.',
    ].join('\n')
    expect(copilotHarness.reply(log)).toBe(log)
    expect(copilotHarness.report(log)).toEqual([
      'The fix is ready.',
      '',
      'Running the tests requires Node 24.',
      'Keep the lockfile.',
    ])
  })

  it('cuts progress at tool lines recognized by the parser', () => {
    const log = [
      'I will inspect the helper.',
      'read: src/math.js',
      'I will check the reference.',
      'Fetching URL: https://example.com',
      'The helper matches the reference.',
      '',
      'No changes are needed.',
    ].join('\n')
    expect(copilotHarness.reply(log)).toBe('The helper matches the reference.\n\nNo changes are needed.')
  })

  it('extracts token counts from usage or tokens field', () => {
    const log = lines({
      type: 'session.completed',
      usage: {
        input_tokens: 120,
        output_tokens: 45,
      },
    })
    expect(copilotHarness.usage(log)).toEqual({
      costUsd: null,
      inputTokens: 120,
      outputTokens: 45,
    })
  })
})
