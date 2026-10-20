import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { gitPath, programPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-program-path-no-git-config')
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()()
})

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
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

describe('programPath', () => {
  it('finds a Windows program only in folders that are absolute, .com before .exe', () => {
    const asked = []
    const check = (path) => {
      asked.push(path)
      return path === 'C:\\Program Files\\Git\\cmd\\git.exe'
    }
    const env = { Path: 'C:\\Windows;.;;tools\\bin;C:relative;"C:\\Program Files\\Git\\cmd";D:\\later' }
    expect(programPath('git', { platform: 'win32', env, check })).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
    expect(asked).toEqual(['C:\\Windows\\git.com', 'C:\\Windows\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.com', 'C:\\Program Files\\Git\\cmd\\git.exe'])
  })

  it('skips empty and relative folders away from Windows', () => {
    const asked = []
    const check = (path) => {
      asked.push(path)
      return path === '/opt/bin/git'
    }
    expect(programPath('git', { platform: 'linux', env: { PATH: ':.:bin:/usr/bin:/opt/bin' }, check })).toBe('/opt/bin/git')
    expect(asked).toEqual(['/usr/bin/git', '/opt/bin/git'])
  })

  it('answers null when no folder has the program', () => {
    expect(programPath('git', { platform: 'win32', env: { PATH: '.;tools' }, check: () => true })).toBeNull()
    expect(programPath('git', { platform: 'linux', env: {}, check: () => true })).toBeNull()
  })

  it('finds the real git on this machine as an absolute path', () => {
    const path = gitPath()
    expect(isAbsolute(path)).toBe(true)
    expect(existsSync(path)).toBe(true)
  })
})

describe('the review list and a git planted in a lane worktree', () => {
  it('runs the git on the PATH, never one in the worktree', async () => {
    const base = makeTempDir('mr-planted-git-')
    cleanups.push(() => rmSync(base, { recursive: true, force: true }))
    const repo = join(base, 'repo')
    const worktree = join(base, 'lane')
    const marker = join(base, 'planted-git-ran.txt')
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-b', 'main'])
    git(repo, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(repo, 'notes.txt'), 'one\n')
    git(repo, ['add', 'notes.txt'])
    git(repo, ['commit', '-m', 'first'])
    git(repo, ['worktree', 'add', '-b', 'feat/planted', worktree])
    const plant = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`
    if (process.platform === 'win32') {
      copyFileSync(process.execPath, join(worktree, 'git.exe'))
      writeFileSync(join(worktree, 'branch'), plant)
    } else {
      writeFileSync(join(worktree, 'git'), `#!/bin/sh\n${JSON.stringify(process.execPath)} -e ${JSON.stringify(plant)}\n`)
      chmodSync(join(worktree, 'git'), 0o755)
    }
    const agents = join(base, 'docs', 'agents')
    mkdirSync(agents, { recursive: true })
    writeFileSync(join(agents, 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode', worktree } }))
    const previousPath = process.env.PATH
    process.env.PATH = `.${delimiter}${previousPath}`
    cleanups.push(() => {
      process.env.PATH = previousPath
    })
    const bridge = createBridge({ projectRoot: base, port: 0, paperclipUrl: 'http://127.0.0.1:1', companyId: 'company-1', reconnectMinMs: 60000, reconnectMaxMs: 60000 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    const { lanes } = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(lanes[0]).toMatchObject({ lane: 'opencode', branch: 'feat/planted' })
    expect(existsSync(marker)).toBe(false)
  }, 30000)
})
