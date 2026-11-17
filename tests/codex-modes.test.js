import { describe, expect, it } from 'vitest'
import { laneModeProblem } from '../src/briefs/run.js'
import { modesFor } from '../src/control/modes.js'
import { codexHarness } from '../src/harnesses/codex.js'

const cli = { bin: 'codex', model: 'gpt-6.1-terra' }
const prompt = 'Do the task.'
const folder = 'C:\\work'

function commandArgs(mode) {
  return codexHarness.command({ cli, prompt, folder, mode }).args
}

function editsLine(harness) {
  return modesFor(harness).find((mode) => mode.id === 'edits').line
}

describe('the Codex permission modes', () => {
  it('offers Plan, Edits, Auto and Bypass in that order', () => {
    expect(modesFor('codex').map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto', 'bypass'])
    expect(modesFor('codex').map((mode) => mode.label)).toEqual(['Plan', 'Edits', 'Auto', 'Bypass'])
  })

  it('says Edits can run commands inside its workspace sandbox', () => {
    expect(editsLine('codex')).toBe('Edits and runs commands in its sandbox.')
  })

  it('keeps Claude Code on the shared Edits line', () => {
    expect(editsLine('claude')).toBe('Edits in the project. No commands.')
    expect(editsLine('codex')).not.toBe(editsLine('claude'))
  })

  it('runs Edits in the workspace sandbox with no bypass flag', () => {
    expect(laneModeProblem({ cli: { harness: 'codex', mode: 'edits' } }, 'codex')).toBe('')
    const args = commandArgs('edits')
    expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'workspace-write'])
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).not.toContain('--full-auto')
    expect(args.at(-1)).toBe(prompt)
  })

  it('runs Bypass with --dangerously-bypass-approvals-and-sandbox and no sandbox', () => {
    expect(laneModeProblem({ cli: { harness: 'codex', mode: 'bypass' } }, 'codex')).toBe('')
    const args = commandArgs('bypass')
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).not.toContain('--sandbox')
    expect(args.at(-1)).toBe(prompt)
  })

  it('keeps the Plan and Auto command lines as they were', () => {
    expect(commandArgs('plan')).toEqual([
      'exec', '--json', '--model', 'gpt-6.1-terra', '--sandbox', 'read-only', '--skip-git-repo-check', prompt,
    ])
    expect(commandArgs('auto')).toEqual([
      'exec', '--json', '--model', 'gpt-6.1-terra', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt,
    ])
  })
})
