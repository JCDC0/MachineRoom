import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFor, parseRunArgs, UNATTENDED_NOTE, unattendedPrompt } from '../src/briefs/run.js'

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }
const prompt = 'Do the task.'
const usageFile = 'C:\\Temp\\machineroom-runs\\hermes-T2.usage.json'
const title = 'hermes-T2-20261019-120000'

describe('commandFor', () => {
  it('builds the Hermes command from the lane and the environment', () => {
    expect(commandFor({ lane: lanes.hermes, prompt, env, usageFile, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Local\\hermes\\bin\\hermes.exe',
      args: ['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter', '--reasoning', 'xhigh', '--usage-file', usageFile],
      cwd: lanes.hermes.worktree,
    })
  })

  it('builds the OpenCode command with the reasoning as the model variant', () => {
    expect(commandFor({ lane: lanes.opencode, prompt, env, usageFile, title })).toEqual({
      file: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
      args: ['run', '--model', 'opencode-go/mimo-v2.6-pro#max', '--auto', '--title', title, prompt],
      cwd: lanes.opencode.worktree,
    })
  })

  it('leaves out the usage file and the reasoning when the lane has none', () => {
    const lane = { ...lanes.hermes, reasoning: undefined }
    const command = commandFor({ lane, prompt, env, title })
    expect(command.args).toEqual(['-z', prompt, '-m', 'deepseek/deepseek-v4.1-flash-1017', '--provider', 'openrouter'])
    expect(commandFor({ lane: { ...lanes.opencode, reasoning: undefined }, prompt, env, title }).args).toEqual([
      'run', '--model', 'opencode-go/mimo-v2.6-pro', '--auto', '--title', title, prompt,
    ])
  })

  it('names the environment variable that is missing', () => {
    expect(() => commandFor({ lane: lanes.hermes, prompt, env: {}, title })).toThrow(/LOCALAPPDATA/)
    expect(() => commandFor({ lane: lanes.opencode, prompt, env: { APPDATA: '' }, title })).toThrow(/APPDATA/)
  })

  it('refuses a lane with no command line', () => {
    expect(() => commandFor({ lane: lanes.agy, prompt, env, title })).toThrow(/no command line/)
  })
})

describe('unattendedPrompt', () => {
  it('adds the note after two newlines', () => {
    expect(unattendedPrompt('Do it.')).toBe(`Do it.\n\n${UNATTENDED_NOTE}`)
    expect(UNATTENDED_NOTE).toMatch(/^You are running unattended/)
    expect(UNATTENDED_NOTE).toMatch(/Nobody can answer a question\./)
  })
})

describe('parseRunArgs', () => {
  it('reads a lane and one or more briefs', () => {
    expect(parseRunArgs(['hermes', 'T2'])).toEqual({ lane: 'hermes', briefs: ['T2'], dryRun: false, minutes: 100 })
    expect(parseRunArgs(['opencode', 'T2', 'G7', '--dry-run', '--minutes', '45'])).toEqual({
      lane: 'opencode', briefs: ['T2', 'G7'], dryRun: true, minutes: 45,
    })
    expect(parseRunArgs(['--dry-run', 'hermes', 'T2', '--minutes=5'])).toMatchObject({ lane: 'hermes', dryRun: true, minutes: 5 })
  })

  it('refuses input that names no lane, no brief or a bad time', () => {
    expect(() => parseRunArgs([])).toThrow(/lane/)
    expect(() => parseRunArgs(['hermes'])).toThrow(/brief/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', 'soon'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--minutes', '0'])).toThrow(/minutes/)
    expect(() => parseRunArgs(['hermes', 'T2', '--fast'])).toThrow(/Unknown option/)
  })
})
