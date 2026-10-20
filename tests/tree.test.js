import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTree } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-tree-no-git-config')

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_SYSTEM: NO_GIT_CONFIG, GIT_CONFIG_GLOBAL: NO_GIT_CONFIG, GIT_CONFIG_NOSYSTEM: '1' },
  })
}

function entry(name, kind) {
  return { name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file' }
}

describe('readTree without git', () => {
  it('skips a folder it cannot read and keeps the rest', () => {
    const dir = makeTempDir('mr-tree-')
    try {
      mkdirSync(join(dir, 'open'), { recursive: true })
      mkdirSync(join(dir, 'locked'), { recursive: true })
      mkdirSync(join(dir, 'gone'), { recursive: true })
      writeFileSync(join(dir, 'top.txt'), 'x')
      writeFileSync(join(dir, 'open', 'a.js'), 'x')
      writeFileSync(join(dir, 'locked', 'b.js'), 'x')
      const listDir = (folder, options) => {
        if (folder.endsWith('locked')) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        if (folder.endsWith('gone')) throw Object.assign(new Error('no such folder'), { code: 'ENOENT' })
        return readdirSync(folder, options)
      }
      expect(readTree(dir, { listDir }).files).toEqual(['open/a.js', 'top.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('answers an empty list when the root itself cannot be read', () => {
    const dir = makeTempDir('mr-tree-')
    try {
      const listDir = () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      expect(readTree(dir, { listDir }).files).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps every letter of a path when the root is a drive or the file system root', () => {
    const root = resolve('/')
    const listDir = (folder) => {
      if (folder === root) return [entry('src', 'dir'), entry('readme.md', 'file')]
      if (folder === join(root, 'src')) return [entry('main.js', 'file')]
      return []
    }
    expect(readTree(root, { listDir }).files).toEqual(['readme.md', 'src/main.js'])
  })
})

describe('readTree with git', () => {
  it('keeps ignored files out of a list longer than one megabyte', () => {
    const dir = makeTempDir('mr-tree-')
    try {
      git(dir, ['init', '-b', 'main'])
      writeFileSync(join(dir, '.gitignore'), 'ignored/\n')
      mkdirSync(join(dir, 'ignored'))
      writeFileSync(join(dir, 'ignored', 'skip.txt'), 'x')
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: '', encoding: 'utf8' }).trim()
      const count = 4000
      const stem = `${'d'.repeat(120)}/${'n'.repeat(160)}`
      const lines = []
      for (let index = 0; index < count; index += 1) lines.push(`100644 ${blob}\t${stem}${String(index).padStart(5, '0')}.txt`)
      execFileSync('git', ['update-index', '--index-info'], { cwd: dir, input: `${lines.join('\n')}\n` })
      const { files } = readTree(dir)
      expect(files).toHaveLength(count + 1)
      expect(files).toContain('.gitignore')
      expect(files).not.toContain('ignored/skip.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
