import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxFiles } from '../scripts/build-fixtures.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-fixtures-no-git-config')
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir() {
  const dir = makeTempDir('mr-fixtures-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
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
