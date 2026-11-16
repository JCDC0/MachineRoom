import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi, groupFiles, LARGE_DIFF_LINES, outsideBriefFor } from '../server/reviews.js'
import { makeTempDir } from './helpers/tempRoot.js'

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

describe('review scope brief source', () => {
  it('reads TASKS.md from the base ref and ignores the worktree copy', async () => {
    const dir = makeTempDir('mr-scope-brief-')
    try {
      const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }
      const git = (cwd, ...args) => execFileSync(gitPath(), args, { cwd, env, encoding: 'utf8', windowsHide: true })
      const repo = join(dir, 'repo')
      mkdirSync(join(repo, 'docs', 'agents'), { recursive: true })
      git(repo, 'init', '-q', '-b', 'main')
      writeFileSync(join(repo, 'docs', 'agents', 'TASKS.md'), TASKS)
      git(repo, 'add', '.')
      git(repo, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base')
      const worktree = join(dir, 'wt')
      git(repo, 'worktree', 'add', '-q', '-b', 'feat/x', worktree)
      writeFileSync(join(worktree, 'docs', 'agents', 'TASKS.md'), TASKS.replace('server/a.js,', 'server/a.js, server/z.js,'))
      mkdirSync(join(worktree, 'server'))
      writeFileSync(join(worktree, 'server', 'z.js'), 'x')
      git(worktree, 'add', '.')
      git(worktree, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work')
      const agents = join(dir, 'agents')
      mkdirSync(agents)
      writeFileSync(join(agents, 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode', worktree } }))
      const answers = []
      const api = createReviewsApi({
        projectRoot: repo,
        briefsDir: agents,
        runsFolder: join(dir, 'runs'),
        sendJson: (req, res, status, body) => answers.push({ status, body }),
        readJsonBody: async () => null,
        orchestrators: () => null,
        readRuns: () => [{ lane: 'opencode', project: worktree, briefs: ['P1'], startedAt: '2026-01-01T00:00:00Z' }],
      })
      await api.handle({ method: 'GET', headers: { origin: 'http://localhost:5173' } }, {}, new URL('http://127.0.0.1/api/control/reviews'))
      const entry = answers[0].body.lanes[0]
      expect(entry.outsideBrief).toEqual(expect.arrayContaining(['server/z.js']))
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
