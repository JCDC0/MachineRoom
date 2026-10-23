import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureLeak, fixtureNames, sandboxFiles, scrubFrames } from '../scripts/build-fixtures.mjs'
import { replayFiles } from '../src/model/replay.js'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/build-fixtures.mjs', import.meta.url))
const REFUSED_OUT = fileURLToPath(new URL('../public/fixtures/mr-test-refused-run.jsonl', import.meta.url))
const SPLIT_OUT = fileURLToPath(new URL('../public/fixtures/mr-test-split-refused-run.jsonl', import.meta.url))
const SCENARIO_G = fileURLToPath(new URL('../public/fixtures/scenario-g-run.jsonl', import.meta.url))
const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-fixtures-no-git-config')
const cleanups = []

const SHAPES = [
  ['an OpenRouter key', 'sk-' + 'or-v1-' + 'q'.repeat(40)],
  ['an Anthropic key', 'sk-' + 'ant-' + 'q'.repeat(40)],
  ['an OpenAI project key', 'sk-' + 'proj-' + 'q'.repeat(40)],
  ['a GitHub OAuth token', 'gho_' + 'q'.repeat(30)],
  ['a GitHub fine grained token', 'github_pat_' + 'q'.repeat(30)],
  ['an AWS access key', 'AKIA' + 'Q'.repeat(16)],
  ['an OpenRouter key setting', 'OPENROUTER_API_KEY=' + 'q'.repeat(32)],
]

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir() {
  const dir = makeTempDir('mr-fixtures-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function frame(text) {
  return JSON.stringify({ type: 'heartbeat.run.log', payload: { chunk: text } })
}

function logFrame(chunk, seq) {
  return { type: 'heartbeat.run.log', payload: { runId: 'run-1', stream: 'stdout', seq, chunk, truncated: false } }
}

function deltaFrame(text, seq) {
  const event = { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 1, state: 'ACTIVE', text_delta: text } }
  return logFrame(JSON.stringify(event) + '\n', seq)
}

function textOf(frames) {
  return frames.map((item) => item.payload.chunk).join('')
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

describe('sandboxFiles', () => {
  it('lists every file as it is written and marks the files after the first commit', () => {
    const dir = tempDir()
    git(dir, ['init', '-b', 'main'])
    git(dir, ['config', 'user.name', 'MachineRoom Test'])
    git(dir, ['config', 'user.email', 'test@example.invalid'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    git(dir, ['config', 'core.autocrlf', 'false'])
    mkdirSync(join(dir, 'données'), { recursive: true })
    writeFileSync(join(dir, 'a.md'), 'a\n')
    writeFileSync(join(dir, 'données', 'été.md'), 'e\n')
    git(dir, ['add', 'a.md', 'données'])
    git(dir, ['commit', '-m', 'first'])
    writeFileSync(join(dir, 'b.md'), 'b\n')
    git(dir, ['add', 'b.md'])
    git(dir, ['commit', '-m', 'second'])
    writeFileSync(join(dir, 'c.md'), 'c\n')

    const result = sandboxFiles(dir)

    expect(result.files).toEqual(['a.md', 'b.md', 'c.md', 'données/été.md'])
    expect(result.created).toEqual(['b.md', 'c.md'])
  })
})

describe('fixtureNames', () => {
  it('puts the default agent list where the default replay reads it', () => {
    const names = fixtureNames()
    expect(names.agents).toBe('agents.json')
    expect(replayFiles()).toEqual({
      run: `fixtures/${names.run}`,
      agents: `fixtures/${names.agents}`,
      tree: `fixtures/${names.tree}`,
    })
  })

  it('keeps a named agent list beside its run and its tree', () => {
    expect(fixtureNames('scenario-z')).toEqual({
      run: 'scenario-z-run.jsonl',
      agents: 'scenario-z-agents.json',
      tree: 'scenario-z-tree.json',
    })
    expect(fixtureNames('my set').agents).toBe('my-set-agents.json')
  })
})

describe('fixtureLeak', () => {
  for (const [name, value] of SHAPES) {
    it(`refuses ${name}`, () => {
      expect(fixtureLeak([frame('read src/math.js'), frame(`token ${value}`)])).toBe(2)
    })
  }

  it('passes a clean frame', () => {
    expect(fixtureLeak([frame('read src/math.js'), frame('OPENROUTER_API_KEY=')])).toBe(0)
  })

  it('finds a key split across two chunks', () => {
    const key = 'sk-' + 'or-v1-' + 'q'.repeat(40)
    const first = JSON.stringify(logFrame(`token ${key.slice(0, 16)}`, 1))
    const second = JSON.stringify(logFrame(key.slice(16), 2))
    expect(fixtureLeak([first, second])).toBe(1)
  })

  it('finds a key split across two text deltas', () => {
    const key = 'sk-' + 'or-v1-' + 'q'.repeat(40)
    const frames = [deltaFrame(`token ${key.slice(0, 16)}`, 1), deltaFrame(key.slice(16), 2)]
    expect(fixtureLeak(frames.map((item) => JSON.stringify(item)))).toBe(1)
  })
})

describe('scrubFrames', () => {
  const ACCOUNT = userInfo().username
  const ESCAPED = ACCOUNT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  it('masks a profile path split at every position across two chunks', () => {
    const text = `see C:/Users/${ACCOUNT}/AppData/Local/Temp now`
    const expected = text.replace(new RegExp(ESCAPED, 'gi'), 'user')
    for (let cut = 0; cut <= text.length; cut += 1) {
      const frames = [logFrame(text.slice(0, cut), 1), logFrame(text.slice(cut), 2)]
      expect(textOf(scrubFrames(frames))).toBe(expected)
    }
  })

  it('masks an e-mail address split at every position across two chunks', () => {
    const text = 'mail worker@example.test now'
    const expected = text.replace(new RegExp(ESCAPED, 'gi'), 'user').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g, 'user')
    for (let cut = 0; cut <= text.length; cut += 1) {
      const frames = [logFrame(text.slice(0, cut), 1), logFrame(text.slice(cut), 2)]
      expect(textOf(scrubFrames(frames))).toBe(expected)
    }
    expect(expected).not.toContain('@')
  })

  it('masks a profile name split across two text deltas of one step', () => {
    const cut = Math.max(1, Math.floor(ACCOUNT.length / 2))
    const frames = [deltaFrame(`see C:/Users/${ACCOUNT.slice(0, cut)}`, 1), deltaFrame(`${ACCOUNT.slice(cut)}/AppData`, 2)]
    const joined = textOf(scrubFrames(frames))
    const deltas = joined
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).step_update.text_delta)
      .join('')
    expect(joined).not.toContain(ACCOUNT)
    expect(deltas).toBe('see C:/Users/user/AppData')
  })

  it('rebuilds scenario-g from its own run file without a change', () => {
    const text = readFileSync(SCENARIO_G, 'utf8')
    const frames = text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const rebuilt = scrubFrames(frames).map((item) => JSON.stringify(item)).join('\n') + '\n'
    expect(rebuilt).toBe(text)
  })
})

describe('the fixture builder refusal', () => {
  it('names the frame and not the key, and exits 2', () => {
    const dir = tempDir()
    const key = 'sk-' + 'or-v1-' + 'q'.repeat(40)
    const raw = join(dir, 'frames.jsonl')
    writeFileSync(raw, [frame('read src/math.js'), frame(`token ${key}`)].join('\n') + '\n')
    cleanups.push(() => rmSync(REFUSED_OUT, { force: true }))
    const result = spawnSync(process.execPath, [SCRIPT, raw, join(dir, 'sandbox'), join(dir, 'ids.json'), 'mr-test-refused'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(result.status).toBe(2)
    expect(result.stderr.trim()).toBe('possible key in frame 2; fixture not written')
    expect(result.stderr).not.toContain(key)
    expect(existsSync(REFUSED_OUT)).toBe(false)
  })

  it('refuses a key split across two chunks before writing', () => {
    const dir = tempDir()
    const key = 'sk-' + 'or-v1-' + 'q'.repeat(40)
    const raw = join(dir, 'frames.jsonl')
    const frames = [logFrame(`token ${key.slice(0, 16)}`, 1), logFrame(key.slice(16), 2)]
    writeFileSync(raw, frames.map((item) => JSON.stringify(item)).join('\n') + '\n')
    cleanups.push(() => rmSync(SPLIT_OUT, { force: true }))
    const result = spawnSync(process.execPath, [SCRIPT, raw, join(dir, 'sandbox'), join(dir, 'ids.json'), 'mr-test-split-refused'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(result.status).toBe(2)
    expect(result.stderr.trim()).toBe('possible key in frame 1; fixture not written')
    expect(result.stderr).not.toContain(key)
    expect(existsSync(SPLIT_OUT)).toBe(false)
  })
})
