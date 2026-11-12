import { describe, expect, it } from 'vitest'
import { codexHarness } from '../src/harnesses/codex.js'
import { createCodexParser } from '../src/model/parsers/codex.js'

const ctx = {
  rootName: 'agent-sandbox',
  files: ['src/math.js', 'src/strings.js', 'package.json'],
  dirs: ['src'],
  agentKey: 'codex',
}

const lines = (...items) => items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') + '\n'

describe('codex harness command builder', () => {
  it('builds the standard codex exec command with model, effort and prompt', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
      prompt: 'Fix the bug in src/math.js',
      folder: 'C:\\sandbox',
    })
    expect(cmd.file).toBe('codex')
    expect(cmd.cwd).toBe('C:\\sandbox')
    expect(cmd.args).toEqual([
      'exec',
      '--json',
      '--model',
      'gpt-6.1-sol',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-c',
      'model_reasoning_effort=high',
      'Fix the bug in src/math.js',
    ])
  })

  it('uses reasoning parameter when passed to override cli effort', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', model: 'gpt-6-luna', effort: 'low' },
      prompt: 'Run tests',
      folder: 'C:\\sandbox',
      reasoning: 'medium',
    })
    expect(cmd.args).toContain('model_reasoning_effort=medium')
  })

  it('omits -c flag when no effort or reasoning is set', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', model: 'gpt-6-astra' },
      prompt: 'Audit project',
      folder: 'C:\\sandbox',
    })
    expect(cmd.args).toEqual([
      'exec',
      '--json',
      '--model',
      'gpt-6-astra',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      'Audit project',
    ])
  })

  it('expands environment variables in bin path', () => {
    const cmd = codexHarness.command({
      cli: { bin: '%TOOLS%\\codex.exe', model: 'gpt-6.1-sol' },
      prompt: 'Hello',
      env: { TOOLS: 'C:\\Tools' },
      folder: 'C:\\sandbox',
    })
    expect(cmd.file).toBe('C:\\Tools\\codex.exe')
  })

  it('adds one --add-dir pair per folder before the prompt', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', addDirs: ['C:\\GitHub\\MachineRoom\\.git', 'C:\\scratch\\shared'] },
      prompt: 'Fix the bug',
      folder: 'C:\\sandbox',
    })
    expect(cmd.args).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--add-dir',
      'C:\\GitHub\\MachineRoom\\.git',
      '--add-dir',
      'C:\\scratch\\shared',
      'Fix the bug',
    ])
  })

  it('adds the folders after the effort and before the prompt', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', model: 'gpt-6.1-sol', effort: 'high', addDirs: ['C:\\one'] },
      prompt: 'Audit',
      folder: 'C:\\sandbox',
    })
    expect(cmd.args.slice(-4)).toEqual(['model_reasoning_effort=high', '--add-dir', 'C:\\one', 'Audit'])
    expect(cmd.args.indexOf('--add-dir')).toBeGreaterThan(cmd.args.indexOf('model_reasoning_effort=high'))
    expect(cmd.args.at(-1)).toBe('Audit')
  })

  it('expands environment variables in an addDirs entry', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', addDirs: ['%LOCALAPPDATA%\\MachineRoom\\.git'] },
      prompt: 'Go',
      env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
      folder: 'C:\\sandbox',
    })
    expect(cmd.args).toContain('--add-dir')
    expect(cmd.args).toContain('C:\\Users\\tester\\AppData\\Local\\MachineRoom\\.git')
    expect(cmd.args.join(' ')).not.toContain('%LOCALAPPDATA%')
  })

  it('leaves the arguments alone when the lane names no addDirs', () => {
    const none = codexHarness.command({ cli: { bin: 'codex' }, prompt: 'Hello', folder: 'C:\\sandbox' })
    expect(none.args).toEqual(['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', 'Hello'])
    expect(none.args).not.toContain('--add-dir')
  })

  it('skips an addDirs entry that is not a string', () => {
    const cmd = codexHarness.command({
      cli: { bin: 'codex', addDirs: [null, 'C:\\one', 42] },
      prompt: 'Hello',
      folder: 'C:\\sandbox',
    })
    expect(cmd.args.filter((arg) => arg === '--add-dir')).toHaveLength(1)
    expect(cmd.args.at(-1)).toBe('Hello')
  })
})

describe('codex parser with fixture lines', () => {
  it('parses command_execution start and completed lifecycle', () => {
    const parser = createCodexParser(ctx)
    const stream = lines(
      {
        type: 'item.started',
        item: {
          id: 'item_cmd_1',
          type: 'command_execution',
          command: 'npm test',
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_cmd_1',
          type: 'command_execution',
          command: 'npm test',
          status: 'completed',
          exit_code: 0,
        },
      },
    )
    const activities = parser.push(stream, 1000)
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({
      time: 1000,
      type: 'tool.start',
      id: 'item_cmd_1',
      tool: 'shell',
      label: '$ npm test',
      agent: 'codex',
    })
    expect(activities[1]).toMatchObject({
      time: 1000,
      type: 'tool.end',
      id: 'item_cmd_1',
      ok: true,
      agent: 'codex',
    })
  })

  it('marks failed command executions with ok false', () => {
    const parser = createCodexParser(ctx)
    const stream = lines({
      type: 'item.completed',
      item: {
        id: 'item_fail',
        type: 'command_execution',
        command: 'node test.js',
        status: 'failed',
        exit_code: 1,
        output: 'FAIL test failed',
      },
    })
    const activities = parser.push(stream, 2000)
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({ type: 'tool.start', tool: 'shell' })
    expect(activities[1]).toMatchObject({ type: 'tool.end', ok: false })
  })

  it('parses file_change item with update and write kinds', () => {
    const parser = createCodexParser(ctx)
    const stream = lines(
      {
        type: 'item.started',
        item: {
          id: 'item_file_1',
          type: 'file_change',
          changes: [
            { path: 'src/math.js', kind: 'update' },
          ],
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_file_1',
          type: 'file_change',
          status: 'completed',
        },
      },
    )
    const activities = parser.push(stream, 3000)
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({
      type: 'tool.start',
      id: 'item_file_1',
      tool: 'edit',
      label: 'edit src/math.js',
      touches: [{ path: 'src/math.js', mode: 'write', kind: 'file' }],
    })
    expect(activities[1]).toMatchObject({
      type: 'tool.end',
      id: 'item_file_1',
      ok: true,
    })
  })

  it('parses web_search item with web tool kind and query label', () => {
    const parser = createCodexParser(ctx)
    const stream = lines(
      {
        type: 'item.started',
        item: {
          id: 'item_web_1',
          type: 'web_search',
          query: 'vitest run related',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_web_1',
          type: 'web_search',
          status: 'completed',
        },
      },
    )
    const activities = parser.push(stream, 4000)
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({
      type: 'tool.start',
      id: 'item_web_1',
      tool: 'web',
      label: 'vitest run related',
      touches: [],
    })
    expect(activities[1]).toMatchObject({
      type: 'tool.end',
      id: 'item_web_1',
      ok: true,
    })
  })

  it('ignores agent_message and reasoning items in tool activities', () => {
    const parser = createCodexParser(ctx)
    const stream = lines(
      {
        type: 'item.started',
        item: {
          id: 'item_msg_1',
          type: 'agent_message',
          text: 'Thinking through the problem...',
        },
      },
      {
        type: 'item.started',
        item: {
          id: 'item_reason_1',
          type: 'reasoning',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_msg_1',
          type: 'agent_message',
          text: 'Solution ready.',
        },
      },
    )
    const activities = parser.push(stream, 5000)
    expect(activities).toEqual([])
  })

  it('closes dangling calls on flush', () => {
    const parser = createCodexParser(ctx)
    const stream = lines({
      type: 'item.started',
      item: {
        id: 'item_open',
        type: 'command_execution',
        command: 'git status',
      },
    })
    parser.push(stream, 6000)
    const flushed = parser.flush(7000)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toMatchObject({
      type: 'tool.end',
      id: 'item_open',
      ok: true,
      time: 7000,
    })
  })
})

describe('codex harness report and usage', () => {
  it('reads reply and report from agent_message item', () => {
    const log = lines(
      { type: 'item.completed', item: { type: 'agent_message', text: 'All tests passed.\nCommit created.' } },
    )
    expect(codexHarness.reply(log)).toBe('All tests passed.\nCommit created.')
    expect(codexHarness.report(log)).toEqual(['All tests passed.', 'Commit created.'])
  })

  it('reads usage tokens from turn.completed line', () => {
    const log = lines(
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 1500,
          cached_input_tokens: 500,
          output_tokens: 320,
        },
      },
    )
    expect(codexHarness.usage(log)).toEqual({
      costUsd: null,
      inputTokens: 2000,
      outputTokens: 320,
    })
  })

  it('returns null tokens when no usage line exists', () => {
    expect(codexHarness.usage('')).toEqual({
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
    })
  })
})
