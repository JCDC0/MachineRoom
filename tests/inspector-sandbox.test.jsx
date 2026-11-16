import { describe, expect, it } from 'vitest'
import { sandboxSummary } from '../src/control/modes.js'

describe('sandboxSummary', () => {
  it('describes each Codex effective mode without overclaiming', () => {
    expect(sandboxSummary('codex', 'plan')).toBe('Read-only OS sandbox')
    expect(sandboxSummary('codex', 'edits')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'auto')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'bypass')).toBe('No sandbox')
    expect(sandboxSummary('codex')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex', 'choice')).toBe('OS sandbox, writes stay in the worktree')
    expect(sandboxSummary('codex_local', 'plan')).toBe('Read-only OS sandbox')
  })

  it('describes Claude Code permission checks and Bypass', () => {
    expect(sandboxSummary('claude', 'bypass')).toBe('No permission checks')
    expect(sandboxSummary('claude')).toBe('No permission checks')
    expect(sandboxSummary('claude', 'plan')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'ask')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'edits')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'auto')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
    expect(sandboxSummary('claude', 'choice')).toBe('Permission checks, file edits stay in the project; shell commands are not sandboxed')
  })

  it('describes OpenCode permission rules and Bypass', () => {
    expect(sandboxSummary('opencode', 'bypass')).toBe('No permission rules')
    expect(sandboxSummary('opencode', 'plan')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'edits')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'auto')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
    expect(sandboxSummary('opencode', 'choice')).toBe('Permission rules, file edits stay in the project; no OS sandbox')
  })

  it('describes native, AGY, ACP and unknown harnesses', () => {
    for (const mode of [undefined, 'plan', 'ask', 'edits', 'auto', 'bypass']) {
      expect(sandboxSummary('machineroom', mode)).toBe('File tools stay in the project; shell commands are not sandboxed')
      expect(sandboxSummary('agy', mode)).toBe('No permission checks')
      expect(sandboxSummary('acp', mode)).toBe('Approves every request the agent asks for')
    }
    expect(sandboxSummary('hermes')).toBe('Unknown')
    expect(sandboxSummary('copilot', 'auto')).toBe('Unknown')
    expect(sandboxSummary('other')).toBe('Unknown')
    expect(sandboxSummary('')).toBe('Unknown')
    expect(sandboxSummary(null)).toBe('Unknown')
  })
})
