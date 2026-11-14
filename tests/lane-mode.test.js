import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readAllLanes } from '../server/agents-config.js'
import { readLanes } from '../server/lanes-source.js'
import { commandFor, laneModeProblem, laneWithOverrides, parseRunArgs, runListLine, runRecord } from '../src/briefs/run.js'
import { MODES } from '../src/control/modes.js'
import { makeTempDir } from './helpers/tempRoot.js'

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }
const prompt = 'Do the task.'
const title = 'lane-T1'

function commandArgs(lane, cli) {
  return commandFor({ lane: { ...lane, cli }, prompt, env, title }).args
}

function writeLaneFile(folder, names) {
  const path = join(folder, 'lanes.json')
  const saved = {}
  for (const name of names) {
    saved[name] = {
      name,
      worktree: join(folder, '.worktrees', name),
      cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    }
  }
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`)
  return path
}

describe('a lane mode leaves the command line alone', () => {
  it('builds the Claude Code command with no mode', () => {
    expect(commandFor({ lane: lanes.claude, prompt, env, title })).toEqual({
      file: 'claude',
      args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--dangerously-skip-permissions'],
      cwd: lanes.claude.worktree,
    })
  })

  it('builds the OpenCode command with no mode', () => {
    expect(commandFor({ lane: lanes.opencode, prompt, env, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
      args: ['run', '--standalone', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash#max', '--auto', '--title', title, prompt],
      cwd: lanes.opencode.worktree,
    })
  })

  it('builds the Codex command with no mode', () => {
    expect(commandFor({ lane: lanes.codex, prompt, env, title })).toEqual({
      file: 'codex',
      args: ['exec', '--json', '--model', 'gpt-6.1-terra', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-c', 'model_reasoning_effort=high', prompt],
      cwd: lanes.codex.worktree,
    })
  })

  it('builds the AGY command with no mode', () => {
    expect(commandFor({ lane: lanes.agy, prompt, env, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe',
      args: ['--print', prompt, '--output-format', 'stream-json', '--model', 'gemini-4-hydrogen-xhigh', '--dangerously-skip-permissions'],
      cwd: lanes.agy.worktree,
    })
  })
})

describe('a lane mode reaches the harness', () => {
  it('gives a Claude lane the permission mode in place of the skip flag', () => {
    expect(commandArgs(lanes.claude, { ...lanes.claude.cli, mode: 'plan' })).toEqual([
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'plan',
    ])
    expect(commandArgs(lanes.claude, { ...lanes.claude.cli, mode: 'edits' })).toEqual([
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'acceptEdits',
    ])
    expect(commandArgs(lanes.claude, { ...lanes.claude.cli, mode: 'auto' })).toEqual([
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'auto',
    ])
  })

  it('keeps the skip flag for a Claude lane in bypass mode', () => {
    expect(commandArgs(lanes.claude, { ...lanes.claude.cli, mode: 'bypass' })).toEqual([
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--dangerously-skip-permissions',
    ])
  })

  it('gives a Codex lane in plan mode a read-only sandbox', () => {
    expect(commandArgs(lanes.codex, { ...lanes.codex.cli, mode: 'plan' })).toEqual([
      'exec', '--json', '--model', 'gpt-6.1-terra', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', 'model_reasoning_effort=high', prompt,
    ])
  })

  it('gives an AGY lane --mode plan', () => {
    expect(commandArgs(lanes.agy, { ...lanes.agy.cli, mode: 'plan' })).toEqual([
      '--print', prompt, '--output-format', 'stream-json', '--model', 'gemini-4-hydrogen-xhigh', '--mode', 'plan',
    ])
  })
})

describe('laneModeProblem', () => {
  it('refuses ask for a lane', () => {
    expect(laneModeProblem({ cli: { harness: 'claude', mode: 'ask' } }, 'claude')).toBe('A lane run has nobody to ask, so the ask mode is for orchestrators only.')
  })

  it('refuses a mode the harness does not have and names the lane and the list', () => {
    expect(laneModeProblem({ cli: { harness: 'claude', mode: 'nonsense' } }, 'claude')).toBe("The nonsense mode is not one claude's harness has. It has: plan, ask, edits, auto, bypass.")
    expect(laneModeProblem({ cli: { harness: 'codex', mode: 'edits' } }, 'codex')).toBe("The edits mode is not one codex's harness has. It has: plan, auto.")
  })

  it('refuses plan and edits for an OpenCode lane', () => {
    expect(laneModeProblem({ cli: { harness: 'opencode', mode: 'plan' } }, 'opencode')).toBe('OpenCode lanes cannot use plan mode because it needs a permission config.')
    expect(laneModeProblem({ cli: { harness: 'opencode', mode: 'edits' } }, 'opencode')).toBe('OpenCode lanes cannot use edits mode because it needs a permission config.')
  })

  it('refuses every mode for a harness with no list', () => {
    for (const mode of MODES) {
      expect(laneModeProblem({ cli: { harness: 'hermes', mode: mode.id } }, 'hermes')).toBe(`The hermes lane has no permission modes, so it cannot run in ${mode.id} mode.`)
    }
  })

  it('says nothing when the lane names no mode', () => {
    expect(laneModeProblem({ cli: { harness: 'claude' } }, 'claude')).toBe('')
  })
})

describe('a lane mode in the record', () => {
  it('lets --mode win over the lane cli.mode', () => {
    const lane = { ...lanes.claude, cli: { ...lanes.claude.cli, mode: 'plan' } }
    expect(parseRunArgs(['claude', 'T1', '--mode', 'auto']).mode).toBe('auto')
    expect(laneWithOverrides(lane, { mode: 'auto' }).cli.mode).toBe('auto')
    expect(laneWithOverrides(lane, {}).cli.mode).toBe('plan')
    expect(lane.cli.mode).toBe('plan')
  })

  it('keeps mode in the run record only when given', () => {
    const plain = runRecord({ lane: 'claude', briefs: ['T1'] })
    expect(Object.hasOwn(plain, 'mode')).toBe(false)
    const plan = runRecord({ lane: 'claude', briefs: ['T1'], mode: 'plan' })
    expect(plan.mode).toBe('plan')
  })

  it('shows the mode after the model in the run list', () => {
    const record = runRecord({ lane: 'hermes', briefs: ['T1'], model: 'deepseek/deepseek-v4.1-flash-1017', mode: 'plan', startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, exitCode: 0, branch: 'feat/t1' })
    expect(runListLine(record)).toBe('2026-10-19T12:00:00.000Z | hermes | deepseek/deepseek-v4.1-flash-1017 | plan | T1 | 3 min | exit 0 | not reported | feat/t1')
  })

  it('loads a lane file whose entry names a mode in cli', () => {
    const folder = makeTempDir('machine-room-lane-mode-')
    try {
      writeLaneFile(folder, ['opencode'])
      const path = join(folder, 'lanes.json')
      const file = JSON.parse(readFileSync(path, 'utf8'))
      file.opencode.cli.mode = 'auto'
      writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
      const all = readAllLanes({ lanesJson: readLanes(folder), runsFolder: join(folder, 'runs') })
      expect(all.opencode.cli.mode).toBe('auto')
      expect(laneModeProblem(all.opencode, 'opencode')).toBe('')
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('run-lane refuses a bad mode before it starts', () => {
  it('exits non-zero, prints the sentence and makes no folder, lock or worktree', () => {
    const folder = makeTempDir('machine-room-lane-mode-run-')
    try {
      const path = writeLaneFile(folder, ['opencode'])
      const result = spawnSync(process.execPath, [RUN_LANE_SCRIPT, 'opencode', 'T1', '--mode', 'nonsense', '--dry-run'], {
        env: { ...process.env, MACHINEROOM_LANES_FILE: path, MACHINEROOM_RUNS: join(folder, 'runs') },
        encoding: 'utf8',
        timeout: 60000,
      })
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain("The nonsense mode is not one opencode's harness has. It has: plan, edits, auto.")
      expect(result.stdout).not.toContain('Dry run, nothing started.')
      expect(existsSync(join(folder, '.worktrees'))).toBe(false)
      expect(existsSync(join(folder, 'runs'))).toBe(false)
      expect(existsSync(join(folder, 'runs', 'opencode.lock'))).toBe(false)
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
