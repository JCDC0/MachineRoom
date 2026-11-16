import { describe, expect, it } from 'vitest'
import { unmergedBranches } from '../server/index.js'
import { readTaskStateBlock, taskStateBlock } from '../src/briefs/taskState.js'

describe('taskStateBlock', () => {
  it('lists two running lanes and a review branch and says none for scopes', () => {
    const text = taskStateBlock({
      running: [
        { lane: 'codex', briefs: ['P1', 'P2'], branch: 'feat/p1' },
        { lane: 'agy', task: 'Fix the card\nmore', branch: 'feat/x' },
      ],
      reviews: [{ lane: 'claude', branch: 'feat/p490' }],
      scopes: [],
    })

    expect(text).toBe(
      'Running lanes:\n- codex, P1, P2, feat/p1\n- agy, Fix the card, feat/x\n\nWaiting for review:\n- claude, feat/p490\n\nSub scopes:\nnone'
    )
  })

  it('says unknown, not none, for a source that could not be read', async () => {
    const text = await readTaskStateBlock(() => {
      throw new Error('no')
    })

    expect(text).toBe('Running lanes:\nunknown\n\nWaiting for review:\nunknown\n\nSub scopes:\nunknown')
  })

  it('caps each list at 20 lines and masks', () => {
    const running = Array.from({ length: 25 }, (_, i) => ({ lane: `l${i}` }))
    const text = taskStateBlock({ running, reviews: [], scopes: [] }, (t) => t.replace('l0', '***'))

    expect(text.split('\n').filter((line) => line.startsWith('- ')).length).toBe(21)
    expect(text).toContain('- ***')
    expect(text).toContain('- and 5 more')
  })

  it('says unknown when the reader is slower than the limit', async () => {
    const text = await readTaskStateBlock(() => new Promise(() => {}), undefined, 20)

    expect(text).toBe('Running lanes:\nunknown\n\nWaiting for review:\nunknown\n\nSub scopes:\nunknown')
  })

  it('awaits an async reader', async () => {
    const text = await readTaskStateBlock(async () => ({ running: [], reviews: [{ lane: 'a', branch: 'b' }], scopes: [] }))

    expect(text).toContain('Waiting for review:\n- a, b')
  })
})

describe('unmergedBranches', () => {
  it('reads each unmerged branch with its worktree lane', async () => {
    const run = async () => ({ ok: true, stdout: 'feat/a|C:/p/.worktrees/codex\nfeat/b|\n' })

    expect(await unmergedBranches('x', run)).toEqual([
      { lane: 'codex', branch: 'feat/a' },
      { lane: '', branch: 'feat/b' },
    ])
  })

  it('answers null when git fails', async () => {
    expect(await unmergedBranches('x', async () => ({ ok: false, stdout: '' }))).toBeNull()
  })
})
