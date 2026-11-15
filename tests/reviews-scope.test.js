import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi } from '../server/reviews.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'
import { makeTempDir, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(processTempRoot(), 'no-git-config')
const GIT_ENV = {
  GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
  GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.autocrlf',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const cleanups = []
const savedGitEnv = new Map()

for (const [key, value] of Object.entries(GIT_ENV)) {
  savedGitEnv.set(key, process.env[key])
  process.env[key] = value
}

let previousTemp
let previousRuns

beforeEach(() => {
  previousTemp = process.env.TEMP
  previousRuns = process.env.MACHINEROOM_RUNS
  const dir = freshDir()
  process.env.TEMP = dir
  process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
  cleanups.push(() => {
    if (previousTemp === undefined) delete process.env.TEMP
    else process.env.TEMP = previousTemp
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

afterAll(() => {
  for (const [key, value] of savedGitEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function freshDir(prefix = 'mr-reviews-scope-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function git(cwd, args) {
  return execFileSync(gitPath(), args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV },
  })
}

function makeRepo() {
  const base = freshDir()
  const repo = join(base, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'MachineRoom Test'])
  git(repo, ['config', 'user.email', 'test@example.invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'src', 'app.js'), 'export const app = 1\n')
  git(repo, ['add', 'src/app.js'])
  git(repo, ['commit', '-m', 'first'])
  const baseHead = git(repo, ['rev-parse', 'HEAD']).trim()

  const worktree = join(base, 'lane-worktree')
  git(repo, ['worktree', 'add', '-b', 'feat/x', worktree])
  writeFileSync(join(worktree, 'src', 'app.js'), 'export const app = 2\n')
  mkdirSync(join(worktree, 'docs'), { recursive: true })
  writeFileSync(join(worktree, 'docs', 'notes.md'), 'outside the scope\n')
  git(worktree, ['add', 'src/app.js', 'docs/notes.md'])
  git(worktree, ['commit', '-m', 'lane work'])
  const head = git(worktree, ['rev-parse', 'HEAD']).trim()
  return { base, repo, worktree, head, baseHead }
}

function scopeApi(repo, worktree, { restricted = true, scope = ['src/**'], head, baseHead } = {}) {
  const dir = freshDir()
  const agentsDir = join(dir, 'docs', 'agents')
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode', worktree } }))
  return makeScopeApi({
    projectRoot: repo,
    briefsDir: agentsDir,
    worktree,
    base: 'main',
    head,
    baseHead,
    restricted,
    scope,
  })
}

function makeProjectRepo() {
  const base = freshDir()
  const room = join(base, 'room')
  mkdirSync(join(room, 'docs', 'agents'), { recursive: true })
  git(room, ['init', '-b', 'main'])
  writeFileSync(join(room, 'docs', 'agents', 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode' } }))

  const project = join(base, 'project')
  mkdirSync(join(project, 'src'), { recursive: true })
  git(project, ['init', '-b', 'trunk'])
  git(project, ['config', 'user.name', 'MachineRoom Test'])
  git(project, ['config', 'user.email', 'test@example.invalid'])
  git(project, ['config', 'commit.gpgsign', 'false'])
  git(project, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(project, 'src', 'app.js'), 'export const app = 1\n')
  git(project, ['add', 'src/app.js'])
  git(project, ['commit', '-m', 'first'])
  const baseHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()

  const worktree = join(project, '.worktrees', 'opencode')
  git(project, ['worktree', 'add', '-b', 'feat/x', worktree])
  writeFileSync(join(worktree, 'src', 'app.js'), 'export const app = 2\n')
  mkdirSync(join(worktree, 'docs'), { recursive: true })
  writeFileSync(join(worktree, 'docs', 'notes.md'), 'outside the scope\n')
  git(worktree, ['add', 'src/app.js', 'docs/notes.md'])
  git(worktree, ['commit', '-m', 'lane work'])
  const head = git(worktree, ['rev-parse', 'HEAD']).trim()
  return { base, room, project, worktree, head, baseHead }
}

function makeScopeApi({
  projectRoot,
  briefsDir,
  worktree,
  base = 'main',
  head,
  baseHead,
  restricted = true,
  scope = ['src/**'],
}) {
  const dir = freshDir()
  const delivered = []
  const tokens = { 'main-token': 'orchestrator', 'sub-token': 'scout', 'other-token': 'other' }
  const registry = {
    idForToken: (value) => tokens[value] ?? null,
    getLadder: () => ({
      subs: [
        {
          id: 'scout',
          name: 'Scout',
          harness: 'opencode',
          model: '',
          lanes: ['opencode'],
          scope,
          restricted,
          setBy: 'owner',
        },
      ],
    }),
    find: (id) =>
      id === 'orchestrator'
        ? {
            deliver: (from, text) => {
              delivered.push({ from, text })
              return { id: `message-${delivered.length}` }
            },
          }
        : null,
  }
  const answers = []
  let body = null
  const api = createReviewsApi({
    projectRoot,
    briefsDir,
    runsFolder: join(dir, 'runs'),
    sendJson: (req, res, status, payload) => answers.push({ status, body: payload }),
    readJsonBody: async () => body,
    orchestrators: () => registry,
    readRuns: () => [],
  })
  const url = new URL('http://127.0.0.1/api/control/reviews/opencode/merge')

  async function merge({ allowOutside = false, headers = { origin: 'http://localhost:5173' } } = {}) {
    body = {
      confirmed: true,
      head: head ?? git(worktree, ['rev-parse', 'HEAD']).trim(),
      base,
      baseHead: baseHead ?? git(projectRoot, ['rev-parse', `refs/heads/${base}`]).trim(),
      message: 'Merge the lane',
      ...(allowOutside ? { allowOutside: true } : {}),
    }
    answers.length = 0
    const handled = await api.handle({ method: 'POST', headers }, {}, url)
    return { handled, status: answers[0]?.status, body: answers[0]?.body }
  }

  return { merge, delivered }
}

function mainHead(repo) {
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

describe('a restricted sub and an out-of-scope lane merge', { timeout: 30000 }, () => {
  it('answers 409 with the files outside the sub scope and leaves main alone', async () => {
    const { repo, worktree, baseHead } = makeRepo()
    const { merge } = scopeApi(repo, worktree)
    const answer = await merge()

    expect(answer.handled).toBe(true)
    expect(answer.status).toBe(409)
    expect(answer.body).toEqual({
      error: 'The lane changed files outside the scope of Scout, so it was not merged.',
      files: ['docs/notes.md'],
      outside: true,
    })
    expect(mainHead(repo)).toBe(baseHead)
    expect(git(repo, ['status', '--porcelain'])).toBe('')
  })

  it('merges when the owner page sends allowOutside', async () => {
    const { repo, worktree } = makeRepo()
    const { merge } = scopeApi(repo, worktree)
    const refused = await merge()
    expect(refused.status).toBe(409)
    expect(refused.body.files).toEqual(['docs/notes.md'])

    const answer = await merge({ allowOutside: true })

    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(git(repo, ['show', 'HEAD:docs/notes.md'])).toContain('outside the scope')
    expect(git(repo, ['status', '--porcelain'])).toBe('')
  })

  it('still refuses allowOutside from the sub token and from another orchestrator', async () => {
    const { repo, worktree, baseHead } = makeRepo()
    const { merge } = scopeApi(repo, worktree)

    const own = await merge({ allowOutside: true, headers: { 'x-machineroom-orchestrator': 'sub-token' } })
    expect(own.status).toBe(409)
    expect(own.body.files).toEqual(['docs/notes.md'])

    const other = await merge({ allowOutside: true, headers: { 'x-machineroom-orchestrator': 'other-token' } })
    expect(other.status).toBe(409)
    expect(other.body.files).toEqual(['docs/notes.md'])
    expect(mainHead(repo)).toBe(baseHead)
  })

  it('merges allowOutside from the parent token', async () => {
    const { repo, worktree } = makeRepo()
    const { merge } = scopeApi(repo, worktree)
    const refused = await merge()
    expect(refused.status).toBe(409)

    const answer = await merge({ allowOutside: true, headers: { 'x-machineroom-orchestrator': 'main-token' } })

    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(git(repo, ['show', 'HEAD:docs/notes.md'])).toContain('outside the scope')
  })

  it('posts one message to the parent for the first refusal at the same head', async () => {
    const { repo, worktree } = makeRepo()
    const { merge, delivered } = scopeApi(repo, worktree)

    await merge()
    await merge()

    expect(delivered).toHaveLength(1)
    expect(delivered[0].from).toBe('room')
    expect(delivered[0].text).toContain('Outside the scope, do not merge:')
    expect(delivered[0].text).toContain('- docs/notes.md')
    expect(delivered[0].text).toContain('Lane opencode')
    expect(delivered[0].text).toContain('Scout')
  })

  it('merges an unrestricted sub lane with files outside its scope', async () => {
    const { repo, worktree } = makeRepo()
    const { merge, delivered } = scopeApi(repo, worktree, { restricted: false })

    const answer = await merge()
    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(git(repo, ['show', 'HEAD:docs/notes.md'])).toContain('outside the scope')
    expect(delivered).toHaveLength(0)
  })

  it('applies the same gate on a project room fast forward', async () => {
    const { room, project, worktree, head } = makeProjectRepo()
    const { merge } = makeScopeApi({
      projectRoot: project,
      briefsDir: join(room, 'docs', 'agents'),
      worktree,
      base: 'trunk',
    })

    const refused = await merge()
    expect(refused.status).toBe(409)
    expect(refused.body.files).toEqual(['docs/notes.md'])
    expect(mainHead(project)).not.toBe(head)

    const answer = await merge({ allowOutside: true })
    expect(answer.status).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(mainHead(project)).toBe(head)
  })
})

describe('Reviews shows the files and merges anyway', () => {
  it('lists the 409 files under the lane and sends allowOutside after its own confirm', async () => {
    const head = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    const baseHead = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c'
    const review = {
      lane: 'opencode',
      branch: 'feat/x',
      head,
      base: 'main',
      baseHead,
      strategy: 'merge-commit',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
      checks: 'passed',
    }
    const calls = []
    const client = {
      reviews: async () => [review],
      mergeReview: async (lane, options) => {
        calls.push({ lane, options })
        if (!options.allowOutside) {
          const error = new Error('The lane changed files outside the scope of Scout, so it was not merged.')
          error.files = ['docs/notes.md']
          error.outside = true
          throw error
        }
        return { ok: true, lane, head: options.head, commit: options.head }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews: [review] }))
      })
      await click(root, container.querySelector('.review-merge-btn'))
      await click(root, buttonWithText(container.querySelector('.review-confirm-card'), 'Merge'))
      await settle()

      const refusal = container.querySelector('.review-scope-refusal')
      expect(refusal).not.toBeNull()
      expect(refusal.textContent).toContain('The lane changed files outside the scope of Scout')
      expect(refusal.textContent).toContain('docs/notes.md')
      expect(calls).toHaveLength(1)
      expect(calls[0].options.allowOutside).toBeUndefined()

      await click(root, buttonWithText(container, 'Merge anyway'))
      const card = container.querySelector('.review-outside-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('docs/notes.md')
      expect(calls).toHaveLength(1)

      await click(root, buttonWithText(card, 'Merge anyway'))
      await settle()

      expect(calls).toHaveLength(2)
      expect(calls[1].options.allowOutside).toBe(true)
      expect(container.querySelector('.review-scope-refusal')).toBeNull()
      expect(container.querySelector('.review-merged-banner')?.textContent).toContain(
        `Merged as ${head.slice(0, 7)}.`
      )
    })
  })
})
