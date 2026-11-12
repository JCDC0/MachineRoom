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
  it('skips a folder it cannot read and keeps the rest', async () => {
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
      const { files } = await readTree(dir, { listDir })
      expect(files).toEqual(['open/a.js', 'top.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('answers an empty list when the root itself cannot be read', async () => {
    const dir = makeTempDir('mr-tree-')
    try {
      const listDir = () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      const { files } = await readTree(dir, { listDir })
      expect(files).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('keeps every letter of a path when the root is a drive or the file system root', async () => {
    const root = resolve('/')
    const listDir = (folder) => {
      if (folder === root) return [entry('src', 'dir'), entry('readme.md', 'file')]
      if (folder === join(root, 'src')) return [entry('main.js', 'file')]
      return []
    }
    const { files } = await readTree(root, { listDir })
    expect(files).toEqual(['readme.md', 'src/main.js'])
  })

  it('walks the disk without waiting when the list fails', async () => {
    const dir = makeTempDir('mr-tree-')
    try {
      writeFileSync(join(dir, 'kept.txt'), 'x')
      const startedAt = Date.now()
      const { files } = await readTree(dir, {
        gitList: () => Promise.resolve(null),
        gitDeleted: () => new Promise((settle) => setTimeout(() => settle([]), 500)),
      })
      const elapsed = Date.now() - startedAt
      expect(elapsed).toBeLessThan(100)
      expect(files).toEqual(['kept.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('readTree with git', () => {
  it('reads lists longer than one megabyte and leaves missing index files out', async () => {
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
      let walked = false
      const listDir = (folder, options) => {
        walked = true
        return readdirSync(folder, options)
      }
      const { files } = await readTree(dir, { listDir })
      expect(walked).toBe(false)
      expect(files).toEqual(['.gitignore'])
      expect(files).not.toContain('ignored/skip.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)

  it('keeps non-ASCII letters and spaces in tracked and untracked names', async () => {
    const dir = makeTempDir('mr-tree-')
    try {
      git(dir, ['init', '-b', 'main'])
      mkdirSync(join(dir, 'données'))
      writeFileSync(join(dir, 'données', 'été.md'), 'x')
      writeFileSync(join(dir, 'with space.txt'), 'x')
      git(dir, ['add', 'données'])
      const { files } = await readTree(dir)
      expect(files).toEqual(['données/été.md', 'with space.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
