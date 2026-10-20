import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import {
  canMerge,
  defaultMergeMessage,
  patchLines,
  reviewRow,
} from '../src/ui/panels/reviews.js'

describe('reviews helpers', () => {
  it('canMerge allows only a clean lane with commits ahead and no error', () => {
    expect(canMerge({ lane: 'hermes', branch: 'feat/p5', ahead: 2, dirty: false })).toBe(true)
    expect(canMerge({ lane: 'hermes', branch: 'feat/p5', ahead: 0, dirty: false })).toBe(false)
    expect(canMerge({ lane: 'opencode', branch: 'feat/w3a', ahead: 1, dirty: true })).toBe(false)
    expect(canMerge({ lane: 'agy', error: 'That worktree is missing.' })).toBe(false)
    expect(canMerge(null)).toBe(false)
  })

  it('defaultMergeMessage builds the one-line merge commit message', () => {
    expect(
      defaultMergeMessage({
        lane: 'hermes',
        branch: 'feat/p5-recover-cut-tool-lines',
      })
    ).toBe("Merge hermes's feat/p5-recover-cut-tool-lines")
    expect(defaultMergeMessage({})).toBe('')
    expect(defaultMergeMessage(null)).toBe('')
  })

  it('reviewRow formats ahead count, diff counts, dirty state, last run and errors', () => {
    const cleanRow = reviewRow({
      lane: 'hermes',
      branch: 'feat/p5-recover-cut-tool-lines',
      head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      ahead: 2,
      dirty: false,
      files: 1,
      added: 2,
      deleted: 0,
      lastRun: null,
    })
    expect(cleanRow).toMatchObject({
      lane: 'hermes',
      branch: 'feat/p5-recover-cut-tool-lines',
      headShort: '1a2b3c4',
      aheadText: '2 commits ahead',
      filesText: '1 file +2 -0',
      dirty: false,
      dirtyText: null,
      lastRunText: 'no run yet',
      error: null,
      canMerge: true,
    })

    const dirtyWithRun = reviewRow({
      lane: 'opencode',
      branch: 'feat/w3a-read-the-lane',
      head: '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
      ahead: 1,
      dirty: true,
      files: 3,
      added: 14,
      deleted: 5,
      lastRun: {
        minutes: 12,
        costUsd: 0.42,
        exitCode: 0,
      },
    })
    expect(dirtyWithRun).toMatchObject({
      lane: 'opencode',
      aheadText: '1 commits ahead',
      filesText: '3 files +14 -5',
      dirty: true,
      dirtyText: 'uncommitted changes',
      lastRunText: '12 min, $0.42, exit 0',
      canMerge: false,
    })

    const errorRow = reviewRow({
      lane: 'agy',
      worktree: 'C:\\GitHub\\MachineRoom-agy',
      error: 'That worktree is missing.',
    })
    expect(errorRow).toMatchObject({
      lane: 'agy',
      error: 'That worktree is missing.',
      canMerge: false,
      aheadText: null,
      lastRunText: null,
    })
  })

  it('patchLines tags file, hunk, added, removed and context lines', () => {
    const patch = [
      'diff --git a/src/a.js b/src/a.js',
      'index 1111111..2222222 100644',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,3 +1,3 @@',
      ' const x = 1',
      '-const y = 2',
      '+const y = 3',
    ].join('\n')

    expect(patchLines(patch)).toEqual([
      { kind: 'file', text: 'diff --git a/src/a.js b/src/a.js' },
      { kind: 'file', text: 'index 1111111..2222222 100644' },
      { kind: 'file', text: '--- a/src/a.js' },
      { kind: 'file', text: '+++ b/src/a.js' },
      { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
      { kind: 'context', text: ' const x = 1' },
      { kind: 'removed', text: '-const y = 2' },
      { kind: 'added', text: '+const y = 3' },
    ])
    expect(patchLines('')).toEqual([])
  })
})

describe('ReviewsPanel and ControlDrawer', () => {
  it('renders the Reviews tab and heading with renderToString and the mock client', () => {
    const client = createMockClient({ latencyMs: 0 })
    const drawerHtml = renderToString(
      createElement(ControlDrawer, {
        client,
        open: true,
        activeTab: 'reviews',
      })
    )
    expect(drawerHtml).toContain('id="tab-reviews"')
    expect(drawerHtml).toContain('<span>Reviews</span>')
    expect(drawerHtml).toContain('<span class="panel-count mono">Reviews</span>')
  })

  it('renders lane rows, diff lines, truncation notice and error rows', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const initialReviews = [
      ...(await client.reviews()),
      { lane: 'broken', worktree: 'C:\\missing', error: 'That worktree is missing.' },
    ]
    const initialDiff = {
      ...(await client.reviewDiff('hermes')),
      truncated: true,
    }

    const html = renderToString(
      createElement(ReviewsPanel, {
        client,
        initialReviews,
        initialDiff,
      })
    )

    expect(html).toContain('<span class="panel-count mono">Reviews</span>')
    expect(html).toContain('feat/p5-recover-cut-tool-lines')
    expect(html).toContain('2 commits ahead')
    expect(html).toContain('uncommitted changes')
    expect(html).toContain('12 min, $0.42, exit 0')
    expect(html).toContain('no run yet')
    expect(html).toContain('That worktree is missing.')
    expect(html).toContain('The patch was cut at 400 KB.')
    expect(html).toContain('review-patch-line is-added')
    expect(html).toContain('review-patch-line is-hunk')
  })
})
