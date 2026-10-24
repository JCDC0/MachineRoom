import { describe, expect, it } from 'vitest'
import { lensStatus } from '../src/ui/lens.js'

describe('lensStatus', () => {
  it('counts the working lanes out of every lane', () => {
    const agents = [
      { key: 'orchestrator', status: 'working', depth: 0 },
      { key: 'opencode', status: 'working', depth: 0 },
      { key: 'claude', status: 'done', depth: 0 },
      { key: 'opencode~1', status: 'working', depth: 1 },
    ]
    const status = lensStatus(agents, [])
    expect(status.working).toBe(2)
    expect(status.total).toBe(3)
    expect(status.share).toBeCloseTo(2 / 3)
  })

  it('has no share when there are no lanes', () => {
    expect(lensStatus([], [])).toMatchObject({ working: 0, total: 0, share: 0, activity: '' })
    expect(lensStatus()).toMatchObject({ working: 0, total: 0, share: 0, activity: '' })
  })

  it('reads the newest log line with its agent', () => {
    const log = [
      { agent: 'opencode', text: 'read a.js', tone: 'normal' },
      { agent: 'claude', text: 'write b.js', tone: 'done' },
    ]
    expect(lensStatus([], log)).toMatchObject({ activity: 'claude write b.js', tone: 'done' })
  })

  it('keeps a line with no agent as it is', () => {
    expect(lensStatus([], [{ text: '  bridge connected  ' }])).toMatchObject({
      activity: 'bridge connected',
      tone: 'normal',
    })
  })

  it('ignores a log that is not a list', () => {
    expect(lensStatus([], null)).toMatchObject({ activity: '', tone: 'normal' })
    expect(lensStatus([], [{ text: '   ' }])).toMatchObject({ activity: '' })
  })
})
