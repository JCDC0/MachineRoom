import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureLeak, sandboxFiles } from '../scripts/build-fixtures.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/build-fixtures.mjs', import.meta.url))
const REFUSED_OUT = fileURLToPath(new URL('../public/fixtures/mr-test-refused-run.jsonl', import.meta.url))
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
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function frame(text) {
  return JSON.stringify({ type: 'heartbeat.run.log', payload: { chunk: text } })
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

describe('fixtureLeak', () => {
  for (const [name, value] of SHAPES) {
    it(`refuses ${name}`, () => {
      expect(fixtureLeak([frame('read src/math.js'), frame(`token ${value}`)])).toBe(2)
    })
  }

  it('passes a clean frame', () => {
    expect(fixtureLeak([frame('read src/math.js'), frame('OPENROUTER_API_KEY=')])).toBe(0)
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
})
