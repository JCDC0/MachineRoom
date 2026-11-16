import { describe, expect, it } from 'vitest'
import { summarizeRun, runRecord } from '../src/briefs/run.js'
import { summaryOf } from '../src/harnesses/common.js'

function claude(count, input = (i) => ({ file_path: 'missing.txt' })) {
  return Array.from({ length: count }, (_, i) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `c${i}`, name: 'Read', input: input(i) }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `c${i}`, is_error: true }] } },
  ]).flat().map(JSON.stringify).join('\n') + '\n'
}
function codex(count, command = () => 'cat missing.txt') {
  return Array.from({ length: count }, (_, i) => JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', id: `c${i}`, command: command(i), exit_code: 1 } })).join('\n') + '\n'
}

describe('repeated failing calls', () => {
  it('flags five identical Claude calls and retains the record', () => {
    const summary = summarizeRun({ harness: 'claude', log: claude(5) })
    expect(summary.repeatedFailure).toEqual({ tool: 'Read', count: 5 })
    expect(runRecord({ repeatedFailure: summary.repeatedFailure }).repeatedFailure).toEqual(summary.repeatedFailure)
  })
  it('flags the longest run of identical Codex calls', () => {
    expect(summarizeRun({ harness: 'codex', log: codex(6) }).repeatedFailure).toEqual({ tool: 'command_execution', count: 6 })
  })
  it('does not flag four failures, different inputs, or no calls', () => {
    expect(summarizeRun({ harness: 'claude', log: claude(4) }).repeatedFailure).toBeUndefined()
    expect(summarizeRun({ harness: 'claude', log: claude(5, (i) => ({ file_path: `file${i}` })) }).repeatedFailure).toBeUndefined()
    expect(summarizeRun({ harness: 'codex', log: codex(5, (i) => `cat file${i}`) }).repeatedFailure).toBeUndefined()
    expect(summarizeRun({ harness: 'codex', log: '' }).repeatedFailure).toBeUndefined()
  })
  it('breaks a streak on success, another agent or a missing key', () => {
    const calls = Array.from({ length: 5 }, (_, i) => [
      { type: 'tool.start', id: i, agent: i === 2 ? 'child' : 'agent', callKey: 'same', callName: 'Read' },
      { type: 'tool.end', id: i, agent: i === 2 ? 'child' : 'agent', ok: false },
    ]).flat()
    expect(summaryOf('test', calls, []).repeatedFailure).toBeUndefined()
    calls[4].agent = calls[5].agent = 'agent'
    calls[5].ok = true
    expect(summaryOf('test', calls, []).repeatedFailure).toBeUndefined()
    calls[5].ok = false
    delete calls[4].callKey
    expect(summaryOf('test', calls, []).repeatedFailure).toBeUndefined()
  })
})
