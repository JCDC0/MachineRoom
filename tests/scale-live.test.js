import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pathsInTreeEvent, LIVE_USAGE, parseLiveArgs, runScaleLive } from '../scripts/scale-live.mjs'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

const ROWS = [
  'build checkout',
  'doctor project read',
  'first tree read',
  'bridge RSS after first read',
  'GET /api/tree, folder shape, gzip',
  'second GET /api/tree, folder shape, gzip',
  'GET /api/git, clean',
  'one new file, write to tree event',
  'burst out/, full tree lists',
  'burst out/, partial tree lists',
  'burst out/, last write to tree event',
  'burst out/, bridge CPU share',
  'GET /api/git, 2000 untracked',
  'burst dist/, tree events naming it',
  'burst dist/, bridge CPU share',
  'bridge used heap after the bursts',
  'GET /api/git, 1000 tracked files changed',
  'worktree add',
  'worktree reuse',
  'GET /api/control/reviews, one lane ahead',
  'GET /api/control/reviews/opencode/diff',
  'plain folder read',
]

describe('parseLiveArgs', () => {
  it('refuses --server with no folder or with a flag', () => {
    expect(() => parseLiveArgs(['--server'])).toThrow('--server needs a folder.')
    expect(() => parseLiveArgs(['--server', '--tree-only'])).toThrow('--server needs a folder.')
  })
})

describe('the live scale help', () => {
  it('prints the usage for --help and -h before it builds a tree', () => {
    const temp = makeTempDir('mr-scale-live-help-')
    try {
      for (const flag of ['--help', '-h']) {
        const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'scale-live.mjs'), flag], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: { ...process.env, TEMP: temp, TMP: temp },
          windowsHide: true,
        })
        expect(result.status, flag).toBe(0)
        expect(result.stdout.trim(), flag).toBe(LIVE_USAGE)
        expect(result.stderr, flag).toBe('')
      }
      expect(existsSync(join(temp, 'machineroom-scale'))).toBe(false)
    } finally {
      rmSync(temp, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})

describe('the live scale probe', () => {
  it('runs the bridge on a real checkout and sends no ignored file', async () => {
    const previousLanes = process.env.MACHINEROOM_LANES_DIR
    process.env.MACHINEROOM_LANES_DIR = join(REPO_ROOT, 'docs', 'agents')
    const root = makeTempDir('mr-scale-live-')
    const lines = []
    try {
      const result = await runScaleLive({
        files: 2000,
        folders: 200,
        seed: 11,
        root,
        burst: 200,
        burstMs: 500,
        cpuWindowMs: 200,
        keep: true,
        log: (line) => lines.push(line),
      })

      expect(result.rows.map((entry) => entry.stage)).toEqual(ROWS)
      expect(lines.length).toBe(ROWS.length + 1)
      expect(lines[0]).toMatch(/^free space: [0-9.]+ GB on /)
      expect(lines.slice(1).map((line) => line.trim().split(/\s{2,}/)[0])).toEqual(ROWS)
      expect(result.newFileSeen).toBe(true)
      expect(result.sentPaths).toContain('new-file.js')
      expect(result.ignoredSeen).toEqual([])
      expect(result.sentPaths.some((path) => path === 'dist' || path.startsWith('dist/'))).toBe(false)
      expect(pathsInTreeEvent(result.folderTree).some((path) => path === 'dist' || path.startsWith('dist/'))).toBe(false)
      expect(result.rows.find((entry) => entry.stage === 'burst dist/, tree events naming it').ms).toBe(0)
      expect(result.tree.files.length).toBe(2001)
      expect(result.folderTree.shape).toBe('folders')
      expect(result.stats.doctorOk).toBe(true)
      expect(result.stats.outReadsDuring).toBeGreaterThanOrEqual(0)
      expect(result.stats.outPartialReads).toBeGreaterThanOrEqual(0)
      expect(result.stats.outReadsDuring + result.stats.outPartialReads).toBeGreaterThan(0)
      expect(result.stats.doctorLine).toMatch(/^The project holds 2001 files/)
      expect(result.stats.gitCleanChanges).toBe(0)
      expect(result.stats.gitUntrackedChanges).toBeGreaterThanOrEqual(1)
      expect(result.stats.gitTrackedChanges).toBe(1000)
      expect(result.stats.trackedRestored).toBe(true)
      expect(result.stats.worktreeBytes).toBeGreaterThan(0)
      expect(result.stats.worktreeFiles).toBeGreaterThan(2000)
      expect(result.stats.reviewsAhead).toBe(1)
      expect(result.stats.reviewsFiles).toBe(1)
      expect(result.stats.diffBytes).toBeGreaterThan(0)
      expect(result.stats.plainReadFiles).toBe(2001)
      expect(existsSync(join(result.checkout, '.git'))).toBe(true)
      expect(existsSync(join(result.checkout, '.worktrees', 'opencode'))).toBe(false)
      const branch = spawnSync(gitPath(), ['-C', result.checkout, 'show-ref', '--verify', '--quiet', 'refs/heads/p19-review'], {
        windowsHide: true,
      })
      expect(branch.status).not.toBe(0)
    } finally {
      if (previousLanes === undefined) delete process.env.MACHINEROOM_LANES_DIR
      else process.env.MACHINEROOM_LANES_DIR = previousLanes
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    }
  }, 90000)
})
