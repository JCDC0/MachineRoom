import { describe, expect, it } from 'vitest'
import { lensClock, lensProject, lensStatus } from '../src/ui/lens.js'

describe('lens labels', () => {
  it('writes the project name with one leading slash', () => {
    expect(lensProject('agent-sandbox')).toBe('/agent-sandbox')
    expect(lensProject('/agent-sandbox')).toBe('/agent-sandbox')
    expect(lensProject('  ')).toBe('/')
    expect(lensProject(null)).toBe('/')
  })

  it('shows the replay time in hours, minutes and seconds', () => {
    expect(lensClock(false, 0)).toBe('00:00:00')
    expect(lensClock(false, 83_000)).toBe('00:01:23')
    expect(lensClock(false, 3_723_000)).toBe('01:02:03')
    expect(lensClock(false, -5000)).toBe('00:00:00')
    expect(lensClock(false, null)).toBe('00:00:00')
  })

  it('shows the feed clock in local time when live', () => {
    const now = new Date(2026, 9, 25, 9, 5, 7).getTime()
    expect(lensClock(true, 0, now)).toBe('09:05:07')
  })
})

describe('lensStatus', () => {
  it('counts the working lanes out of every lane', () => {
    const agents = [
      { key: 'orchestrator', status: 'working', depth: 0 },
      { key: 'opencode', status: 'working', depth: 0 },
      { key: 'claude', status: 'done', depth: 0 },
      { key: 'opencode~1', status: 'working', depth: 1 },
    ]
    const status = lensStatus(agents, [])
    expect(status.working).toBe(1)
    expect(status.total).toBe(2)
    expect(status.share).toBeCloseTo(1 / 2)
  })

  it('leaves the main and sub orchestrators out of the count', () => {
    const agents = [
      { key: 'orchestrator', name: 'Orchestrator', status: 'working', depth: 0 },
      { key: 'sub-frontend', name: 'Frontend', status: 'working', depth: 0, subOrchestrator: true },
      { key: 'sub-backend', status: 'working', depth: 0 },
      { key: 'opencode', status: 'idle', depth: 0 },
    ]
    expect(lensStatus(agents, [])).toMatchObject({ working: 0, total: 1, share: 0 })
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
