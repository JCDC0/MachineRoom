import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pathsInTreeEvent, runScaleLive } from '../scripts/scale-live.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const ROWS = [
  'build checkout',
  'first tree read',
  'bridge RSS after first read',
  'GET /api/tree, folder shape, gzip',
  'one new file, write to tree event',
  'burst out/, tree reads started',
  'burst out/, last write to tree event',
  'burst out/, bridge CPU share',
  'burst dist/, tree events naming it',
  'burst dist/, bridge CPU share',
]

describe('the live scale probe', () => {
  it('runs the bridge on a real checkout and sends no ignored file', async () => {
    const root = makeTempDir('mr-scale-live-')
    const result = await runScaleLive({
      files: 2000,
      folders: 200,
      seed: 11,
      root,
      burst: 200,
      burstMs: 500,
      cpuWindowMs: 200,
    })

    expect(result.rows.map((entry) => entry.stage)).toEqual(ROWS)
    expect(result.newFileSeen).toBe(true)
    expect(result.sentPaths).toContain('new-file.js')
    expect(result.ignoredSeen).toEqual([])
    expect(result.sentPaths.some((path) => path === 'dist' || path.startsWith('dist/'))).toBe(false)
    expect(pathsInTreeEvent(result.folderTree).some((path) => path === 'dist' || path.startsWith('dist/'))).toBe(false)
    expect(result.rows.find((entry) => entry.stage === 'burst dist/, tree events naming it').ms).toBe(0)
    expect(result.tree.files.length).toBe(2001)
    expect(result.folderTree.shape).toBe('folders')
    expect(existsSync(result.checkout)).toBe(false)
  }, 30000)
})
