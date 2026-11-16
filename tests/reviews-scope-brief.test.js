import { describe, expect, it } from 'vitest'
import { groupFiles, LARGE_DIFF_LINES, outsideBriefFor } from '../server/reviews.js'

const TASKS = [
  '## Open',
  '',
  '**P1. A brief (Claude).** Read it. Files: server/a.js, tests/a.test.js, docs/agents/CHANGELOG.md.',
  '',
  '**P2. No list (Claude).** Read it and think.',
  '',
].join('\n')

describe('review scope', () => {
  it('counts files per group from the branch paths', () => {
    const groups = groupFiles([
      { path: 'server/a.js' },
      { path: 'server/b.js' },
      { path: 'src/ui/x.jsx' },
      { path: 'tests/a.test.js' },
      { path: 'package.json' },
    ])
    expect(groups.server).toEqual({ count: 2, paths: ['server/a.js', 'server/b.js'] })
    expect(groups.ui.count).toBe(1)
    expect(groups.tests.count).toBe(1)
    expect(groups.other.paths).toEqual(['package.json'])
    expect(groups.docs.count).toBe(0)
  })

  it('reports a file outside the Files list and not one inside', () => {
    const files = [{ path: 'server/a.js' }, { path: 'docs/agents/CHANGELOG.md' }, { path: 'server/z.js' }]
    expect(outsideBriefFor(files, ['P1'], TASKS)).toEqual(['server/z.js'])
  })

  it('answers null with no brief, no ids or no Files list', () => {
    const files = [{ path: 'server/a.js' }]
    expect(outsideBriefFor(files, [], TASKS)).toBeNull()
    expect(outsideBriefFor(files, ['P9'], TASKS)).toBeNull()
    expect(outsideBriefFor(files, ['P2'], TASKS)).toBeNull()
    expect(outsideBriefFor(files, ['P1'], undefined)).toBeNull()
  })

  it('names the large diff line count as a constant', () => {
    expect(LARGE_DIFF_LINES).toBe(400)
  })
})
