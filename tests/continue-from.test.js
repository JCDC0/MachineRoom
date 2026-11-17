import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

it.each([
  [{ lane: 'other', briefs: ['P1'], branch: 'saved' }, 'lane'],
  [{ lane: 'lane', briefs: ['P2'], branch: 'saved' }, 'brief ids'],
  [{ lane: 'lane', briefs: ['P1'], branch: 'saved', project: 'project' }, 'project kind'],
  [{ lane: 'lane', briefs: ['P1'], branch: 'saved' }, 'branch'],
])('refuses a continuation with different %s before opening a log', async (saved, reason) => {
  const root = makeTempDir('mr-continue-')
  try {
    writeFileSync(join(root, 'runs.jsonl'), JSON.stringify({ ...saved, log: 'old.log' }) + '\n')
    const logPath = join(root, 'new.log')
    await expect(startLane({ options: { lane: 'lane', continueFrom: 'old', runs: root }, lane: { worktree: root, cli: {} }, lanes: {}, wanted: [{ id: 'P1' }], prompt: '', logPath, name: 'new' })).rejects.toThrow(reason)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(join(root, 'new.meta.json'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
