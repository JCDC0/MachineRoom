import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import ReviewsPanel, { MergeConfirmCard } from '../src/ui/panels/ReviewsPanel.jsx'
import {
  canMerge,
  defaultMergeMessage,
  isBehindDestination,
  mergeHead,
  patchLines,
  prepareMergeMessage,
  reviewRow,
} from '../src/ui/panels/reviews.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const MOVED_BRANCH_ERROR = 'The branch moved since you read the diff. Open it again.'

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

  it('isBehindDestination finds a branch with no commits ahead and another head', () => {
    const head = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    const baseHead = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c'
    expect(isBehindDestination({ ahead: 0, head, baseHead })).toBe(true)
    expect(isBehindDestination({ ahead: 0, head: baseHead, baseHead })).toBe(false)
    expect(isBehindDestination({ ahead: 1, head, baseHead })).toBe(false)
    expect(isBehindDestination({ error: 'That worktree is missing.', ahead: 0, head, baseHead })).toBe(false)
  })

  it('prepareMergeMessage carries the lane, branch, full head and destination', () => {
    const head = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    const text = prepareMergeMessage({
      lane: 'opencode',
      branch: 'feat/p215-ask-the-orchestrator',
      head,
      base: 'trunk',
    })
    expect(text).toContain('Lane: opencode')
    expect(text).toContain('Branch: feat/p215-ask-the-orchestrator')
    expect(text).toContain(`Head: ${head}`)
    expect(text).toContain('Destination: trunk')
    expect(text).toContain("In the lane's worktree, rebase or merge the branch onto trunk.")
    expect(text).toContain("Run the project's checks.")
    expect(text).toContain('Do not merge into trunk.')
    expect(text).toContain('Do not discard work.')
    expect(prepareMergeMessage(null)).toBe('')
    expect(prepareMergeMessage({ lane: 'opencode' })).toBe('')
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
      checks: 'unchecked',
      checksText: 'unchecked',
      lastRunText: 'no run yet',
      error: null,
      canMerge: true,
    })

    expect(reviewRow({ lane: 'hermes', branch: 'feat/p5', head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', ahead: 1, dirty: false, checks: 'passed' })).toMatchObject({
      checks: 'passed',
      checksText: 'checks passed',
      canMerge: true,
    })
    expect(reviewRow({ lane: 'agy', branch: 'feat/t7', head: '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f', ahead: 1, dirty: false, checks: 'failed' })).toMatchObject({
      checks: 'failed',
      checksText: 'checks failed',
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
      aheadText: '1 commit ahead',
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
      checks: null,
      checksText: null,
      lastRunText: null,
    })
  })

  it('mergeHead keeps the list head with no diff and when the diff is for another lane', () => {
    const row = reviewRow({
      lane: 'hermes',
      branch: 'feat/p5-recover-cut-tool-lines',
      head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      ahead: 2,
      dirty: false,
    })

    expect(mergeHead(row, null)).toEqual({ head: row.head })
    expect(mergeHead(row, undefined)).toEqual({ head: row.head })
    expect(
      mergeHead(row, {
        lane: 'opencode',
        head: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c',
      })
    ).toEqual({ head: row.head })
  })

  it('mergeHead answers the diff head when it matches and says so when the branch moved', () => {
    const row = reviewRow({
      lane: 'hermes',
      branch: 'feat/p5-recover-cut-tool-lines',
      head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      ahead: 2,
      dirty: false,
    })

    expect(
      mergeHead(row, {
        lane: 'hermes',
        head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      })
    ).toEqual({ head: row.head })

    expect(
      mergeHead(row, {
        lane: 'hermes',
        head: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c',
      })
    ).toEqual({ error: MOVED_BRANCH_ERROR })
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
  it('shows the sentence of a failed manual Refresh', async () => {
    let fail = false
    const client = {
      reviews: async () => {
        if (fail) throw new Error('The bridge is offline.')
        return []
      },
      subscribe: () => () => {},
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client }))
      })
      await settle()
      expect(container.textContent).toContain('No lanes to review.')

      fail = true
      const refresh = container
        .querySelectorAll('button')
        .find((button) => button.textContent.trim() === 'Refresh')
      expect(refresh).not.toBeNull()
      await act(async () => {
        refresh.click()
      })
      await settle()

      expect(container.textContent).toContain('The bridge is offline.')
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    })
  })

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

  it('renders the confirm card with the short head from the diff', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const reviews = await client.reviews()
    const review = reviews.find((item) => item.lane === 'hermes')
    const row = reviewRow(review)
    const diff = await client.reviewDiff('hermes')
    const picked = mergeHead(row, diff)

    expect(picked.head).toBe(diff.head)

    const html = renderToString(
      createElement(MergeConfirmCard, {
        target: {
          lane: row.lane,
          branch: row.branch,
          head: picked.head,
          headShort: picked.head.slice(0, 7),
        },
        message: defaultMergeMessage(review),
        messageValid: true,
        merging: false,
        mergedBanner: null,
        mergeError: null,
        conflictFiles: [],
        onMessageChange: () => {},
        onConfirm: () => {},
        onCancel: () => {},
      })
    )

    expect(html).toContain(`(${diff.head.slice(0, 7)})`)
    expect(html).toContain('Confirm merge for hermes')
  })

  it('marks a direction control in a patch line', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const initialReviews = await client.reviews()
    const baseDiff = await client.reviewDiff('hermes')
    const initialDiff = {
      ...baseDiff,
      patch: [
        'diff --git a/src/a.js b/src/a.js',
        '+++ b/src/a.js',
        '@@ -1 +1 @@',
        '+const label = "a\u202Eb"',
      ].join('\n'),
    }

    const html = renderToString(
      createElement(ReviewsPanel, {
        client,
        initialReviews,
        initialDiff,
      })
    )

    expect(html).toContain('[U+202E]')
    expect(html).not.toContain('\u202E')
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
    expect(html).toContain('checks passed')
    expect(html).toContain('unchecked')
    expect(html).toContain('checks failed')
    expect(html).toContain('12 min, $0.42, exit 0')
    expect(html).toContain('no run yet')
    expect(html).toContain('That worktree is missing.')
    expect(html).toContain('The patch was cut at 400 KB.')
    expect(html).toContain('review-patch-line is-added')
    expect(html).toContain('review-patch-line is-hunk')
  })

  it('carries baseHead and strategy in reviewRow and hides message input only for fast-forward', async () => {
    const laneHead = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    const baseHead = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c'
    const ffRow = reviewRow({
      lane: 'opencode',
      branch: 'feat/w3a',
      head: laneHead,
      base: 'trunk',
      baseHead,
      strategy: 'fast-forward',
      ahead: 1,
      dirty: false,
    })
    expect(ffRow.base).toBe('trunk')
    expect(ffRow.baseHead).toBe(baseHead)
    expect(ffRow.strategy).toBe('fast-forward')

    const mcRow = reviewRow({
      lane: 'hermes',
      branch: 'feat/p5',
      head: laneHead,
      base: 'main',
      baseHead,
      ahead: 1,
      dirty: false,
    })
    expect(mcRow.strategy).toBe('merge-commit')

    const ffHtml = renderToString(
      createElement(MergeConfirmCard, {
        target: {
          lane: ffRow.lane,
          branch: ffRow.branch,
          base: ffRow.base,
          baseHead: ffRow.baseHead,
          strategy: 'fast-forward',
          head: ffRow.head,
          headShort: ffRow.headShort,
        },
        message: '',
        messageValid: false,
        merging: false,
        mergedBanner: null,
        mergeError: null,
        conflictFiles: [],
        onMessageChange: () => {},
        onConfirm: () => {},
        onCancel: () => {},
      })
    )
    expect(ffHtml).toContain("Fast-forward merge. The lane&#x27;s commits are kept as they are.")
    expect(ffHtml).not.toContain('review-message-field')
    expect(ffHtml).not.toContain('<input')
    expect(ffHtml).not.toContain('disabled=""')

    const mcHtml = renderToString(
      createElement(MergeConfirmCard, {
        target: {
          lane: mcRow.lane,
          branch: mcRow.branch,
          base: mcRow.base,
          baseHead: mcRow.baseHead,
          strategy: 'merge-commit',
          head: mcRow.head,
          headShort: mcRow.headShort,
        },
        message: "Merge hermes's feat/p5",
        messageValid: true,
        merging: false,
        mergedBanner: null,
        mergeError: null,
        conflictFiles: [],
        onMessageChange: () => {},
        onConfirm: () => {},
        onCancel: () => {},
      })
    )
    expect(mcHtml).toContain('review-message-field')
    expect(mcHtml).toContain('id="merge-msg-hermes"')
    expect(mcHtml).not.toContain("Fast-forward merge. The lane&#x27;s commits are kept as they are.")

    const sent = []
    const ffReview = {
      lane: 'opencode',
      branch: 'feat/w3a',
      head: laneHead,
      base: 'trunk',
      baseHead,
      strategy: 'fast-forward',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
    }
    const mcReview = {
      lane: 'hermes',
      branch: 'feat/p5',
      head: laneHead,
      base: 'main',
      baseHead,
      strategy: 'merge-commit',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
    }
    const client = {
      reviews: async () => [ffReview, mcReview],
      mergeReview: async (lane, options) => {
        sent.push({ lane, options })
        return { ok: true, lane, commit: laneHead }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews: [ffReview, mcReview] }))
      })
      const mergeButtons = container.querySelectorAll('.review-merge-btn')
      expect(mergeButtons).toHaveLength(2)

      await click(root, mergeButtons[0])
      let card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('input')).toBeNull()
      expect(card.textContent).toContain("Fast-forward merge. The lane's commits are kept as they are.")
      await click(root, buttonWithText(card, 'Merge'))
      await settle()
      expect(sent[0]).toEqual({
        lane: 'opencode',
        options: { head: laneHead, base: 'trunk', baseHead },
      })
      expect(Object.hasOwn(sent[0].options, 'message')).toBe(false)

      await click(root, container.querySelectorAll('.review-merge-btn')[1])
      card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('#merge-msg-hermes')).not.toBeNull()
      await click(root, buttonWithText(card, 'Merge'))
      await settle()
      expect(sent[1]).toEqual({
        lane: 'hermes',
        options: {
          head: laneHead,
          base: 'main',
          baseHead,
          message: "Merge hermes's feat/p5",
        },
      })
    })
  })

  it('shows passed, failed and unchecked beside Merge and in the confirm card, keeping Merge enabled', async () => {
    const laneHead = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
    const baseHead = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c'
    const makeReview = (lane, checks) => ({
      lane,
      branch: `feat/${lane}`,
      head: laneHead,
      base: 'trunk',
      baseHead,
      strategy: 'fast-forward',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
      checks,
    })
    const initialReviews = [
      makeReview('hermes', 'passed'),
      makeReview('opencode', 'unchecked'),
      makeReview('agy', 'failed'),
    ]
    const mergedLanes = []
    const client = {
      reviews: async () => initialReviews,
      mergeReview: async (lane) => {
        if (lane === 'agy') throw new Error('Checks failed on this head, so the lane was not merged.')
        mergedLanes.push(lane)
        return { ok: true, lane, commit: laneHead }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews }))
      })

      const checkBadges = container.querySelectorAll('.review-checks')
      expect(checkBadges.map((el) => el.textContent.trim())).toEqual([
        'checks passed',
        'unchecked',
        'checks failed',
      ])
      const mergeButtons = container.querySelectorAll('.review-merge-btn')
      expect(mergeButtons).toHaveLength(3)

      await click(root, mergeButtons[2])
      let card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe('Checks failed for this head.')
      await click(root, buttonWithText(card, 'Merge'))
      await settle()
      expect(card.querySelector('[role="alert"]')?.textContent).toBe(
        'Checks failed on this head, so the lane was not merged.'
      )

      await click(root, container.querySelectorAll('.review-merge-btn')[1])
      card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe(
        'Warning: checks are unchecked for this head.'
      )
      await click(root, buttonWithText(card, 'Merge'))
      await settle()
      expect(mergedLanes).toEqual(['opencode'])

      await click(root, container.querySelectorAll('.review-merge-btn')[0])
      card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe('Checks passed for this head.')
      await click(root, buttonWithText(card, 'Merge'))
      await settle()
      expect(mergedLanes).toEqual(['opencode', 'hermes'])
    })
  })
})

describe('ReviewsPanel Ask to prepare', () => {
  const destinationHead = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c'
  const aheadHead = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d'
  const behindHead = 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e'
  const refusedHead = 'c1d2e3f40516273849a5b6c7d8e9f0a1b2c3d4e5'

  function makeReview(lane, branch, head, ahead) {
    return {
      lane,
      branch,
      head,
      base: 'trunk',
      baseHead: destinationHead,
      strategy: 'fast-forward',
      ahead,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
      checks: 'passed',
    }
  }

  function reviewCard(container, lane) {
    return container
      .querySelectorAll('.review-card')
      .find((card) => card.querySelector('.review-lane')?.textContent.trim() === lane)
  }

  it('offers Ask to prepare only on a behind or refused row', async () => {
    const reviews = [
      makeReview('ahead', 'feat/ahead', aheadHead, 2),
      makeReview('behind', 'feat/behind', behindHead, 0),
      makeReview('refused', 'feat/refused', refusedHead, 1),
    ]
    const client = {
      reviews: async () => reviews,
      mergeReview: async () => {
        throw new Error('The lane is not a fast forward of trunk. Rebase it onto trunk and read it again.')
      },
      sendOrchestrator: async () => ({ ok: true }),
      orchestrator: async () => ({}),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews: reviews }))
      })

      expect(container.querySelectorAll('.review-prepare-btn')).toHaveLength(1)
      expect(reviewCard(container, 'ahead').querySelector('.review-prepare-btn')).toBeNull()
      expect(reviewCard(container, 'behind').querySelector('.review-prepare-btn')).not.toBeNull()
      expect(reviewCard(container, 'refused').querySelector('.review-prepare-btn')).toBeNull()

      await click(root, reviewCard(container, 'refused').querySelector('.review-merge-btn'))
      const mergeCard = reviewCard(container, 'refused').querySelector('.review-confirm-card')
      await click(root, buttonWithText(mergeCard, 'Merge'))
      await settle()

      expect(reviewCard(container, 'refused').querySelector('.review-prepare-btn')).not.toBeNull()
      expect(container.querySelectorAll('.review-prepare-btn')).toHaveLength(2)
    })
  })

  it('names the lane and short head in the card and sends the full head and destination', async () => {
    const sent = []
    const reviews = [makeReview('behind', 'feat/behind', behindHead, 0)]
    const client = {
      reviews: async () => reviews,
      sendOrchestrator: async (text) => {
        sent.push(text)
        return { ok: true }
      },
      orchestrator: async () => ({}),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews: reviews }))
      })

      const rowCard = reviewCard(container, 'behind')
      await click(root, buttonWithText(rowCard, 'Ask to prepare'))
      const confirm = rowCard.querySelector('.review-prepare-card')
      expect(confirm).not.toBeNull()
      expect(confirm.textContent).toContain("behind's feat/behind")
      expect(confirm.textContent).toContain(`(${behindHead.slice(0, 7)})`)
      expect(confirm.textContent).toContain('into trunk')
      expect(confirm.textContent).not.toContain(behindHead)
      expect(sent).toEqual([])

      await click(root, buttonWithText(confirm, 'Send'))
      await settle()

      expect(sent).toHaveLength(1)
      expect(sent[0]).toContain('Lane: behind')
      expect(sent[0]).toContain('Branch: feat/behind')
      expect(sent[0]).toContain(`Head: ${behindHead}`)
      expect(sent[0]).toContain('Destination: trunk')
      expect(rowCard.querySelector('.review-prepare-card')).toBeNull()
      expect(rowCard.querySelector('[role="status"]')?.textContent).toBe('Sent to Main.')
    })
  })

  it('shows the client error under the row and keeps the card open', async () => {
    const reviews = [makeReview('behind', 'feat/behind', behindHead, 0)]
    const client = {
      reviews: async () => reviews,
      sendOrchestrator: async () => {
        throw new Error('Main is not connected.')
      },
      orchestrator: async () => ({}),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client, initialReviews: reviews }))
      })

      const rowCard = reviewCard(container, 'behind')
      await click(root, buttonWithText(rowCard, 'Ask to prepare'))
      await click(root, buttonWithText(rowCard.querySelector('.review-prepare-card'), 'Send'))
      await settle()

      const alerts = rowCard.querySelectorAll('[role="alert"]').map((node) => node.textContent)
      expect(alerts).toContain('Main is not connected.')
      expect(rowCard.textContent).not.toContain('Sent to Main.')
      expect(rowCard.querySelector('.review-prepare-card')).not.toBeNull()
    })
  })

  it('offers nothing without sendOrchestrator or a readable orchestrator', () => {
    const reviews = [makeReview('behind', 'feat/behind', behindHead, 0)]
    const base = { reviews: async () => reviews, subscribe: () => () => {} }

    const withoutSend = renderToString(
      createElement(ReviewsPanel, { client: base, initialReviews: reviews })
    )
    expect(withoutSend).not.toContain('Ask to prepare')

    const withoutRead = renderToString(
      createElement(ReviewsPanel, {
        client: { ...base, sendOrchestrator: async () => ({ ok: true }) },
        initialReviews: reviews,
      })
    )
    expect(withoutRead).not.toContain('Ask to prepare')

    const ready = renderToString(
      createElement(ReviewsPanel, {
        client: {
          ...base,
          sendOrchestrator: async () => ({ ok: true }),
          orchestrator: async () => ({}),
        },
        initialReviews: reviews,
      })
    )
    expect(ready).toContain('Ask to prepare')
  })
})
