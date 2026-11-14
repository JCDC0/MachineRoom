import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFor } from '../src/briefs/run.js'
import { agyHarness } from '../src/harnesses/agy.js'
import { codexHarness } from '../src/harnesses/codex.js'
import { machineroomHarness } from '../src/harnesses/machineroom.js'

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const env = { LOCALAPPDATA: 'C:\\Users\\<name>\\AppData\\Local', APPDATA: 'C:\\Users\\<name>\\AppData\\Roaming' }
const cli = { bin: 'agy', model: 'gemini-3.8-flash-high' }

describe('the harness permission modes', () => {
  it('runs Codex Plan in a read-only sandbox and Auto in a workspace sandbox', () => {
    for (const [mode, sandbox] of [['plan', 'read-only'], ['auto', 'workspace-write'], ['bypass', 'workspace-write']]) {
      const args = codexHarness.command({ cli: {}, prompt: 'Do it.', mode }).args
      expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', sandbox])
    }
  })

  it('passes the AGY mode in place of the skip flag and keeps a lane run unchanged', () => {
    for (const [mode, flag] of [['plan', 'plan'], ['edits', 'accept-edits'], ['auto', 'auto']]) {
      const command = agyHarness.command({ cli, prompt: 'Do it.', mode })
      expect(command.args.slice(-2)).toEqual(['--mode', flag])
      expect(command.args).not.toContain('--dangerously-skip-permissions')
    }
    for (const mode of ['bypass', undefined]) {
      const command = agyHarness.command({ cli, prompt: 'Do it.', ...(mode ? { mode } : {}) })
      expect(command.args).toContain('--dangerously-skip-permissions')
      expect(command.args).not.toContain('--mode')
    }

    const lane = commandFor({ lane: lanes.agy, prompt: 'Do the task.', env, title: 'agy-T1' })
    expect(lane.args).toContain('--dangerously-skip-permissions')
    expect(lane.args).not.toContain('--mode')
  })

  it('sets the MachineRoom permission mode in the command env', () => {
    const base = { cli: { model: 'work/alpha' }, prompt: 'Do it.', folder: '.' }
    expect(machineroomHarness.command(base).env).toBeUndefined()
    expect(machineroomHarness.command({ ...base, mode: 'plan' }).env).toEqual({ MACHINEROOM_PERMISSION_MODE: 'plan' })
    expect(machineroomHarness.command({ ...base, mode: 'bypass' }).env).toEqual({ MACHINEROOM_PERMISSION_MODE: 'bypass' })
  })
})
