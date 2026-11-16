import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import {
  CLAIMS_PREVIEW_LINES,
  formatEvidence,
  formatRunTotals,
  formatRuns,
  reviewRow,
} from '../src/ui/panels/reviews.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const HEAD = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
const HEAD_SHORT = '1a2b3c4'

function makeReview(overrides = {}) {
  return {
    lane: 'hermes',
    branch: 'feat/p463-evidence',
    head: HEAD,
    base: 'main',
    baseHead: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c',
    strategy: 'merge-commit',
    ahead: 1,
    dirty: false,
    files: 1,
    added: 1,
    deleted: 0,
    checks: 'passed',
    ...overrides,
  }
}

function makeClient(reviews) {
  return {
    reviews: async () => reviews,
    subscribe: () => () => {},
  }
}

function lineWithText(container, text) {
  return (
    container
      .querySelectorAll('.review-last-run')
      .find((node) => node.textContent.includes(text)) ?? null
  )
}

describe('Reviews evidence helpers', () => {
  it('names the head the checks ran on', () => {
    const row = reviewRow(
      makeReview({
        evidence: {
          checkedHead: HEAD,
          checks: [{ command: null, result: 'passed', at: null }],
          stale: false,
        },
      })
    )
    expect(row.evidenceText).toBe(`Checked on ${HEAD_SHORT}: passed`)

    const review = makeReview({
      evidence: { checkedHead: HEAD, checks: [{ result: 'passed' }], stale: false },
    })
    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).toContain(`Checked on ${HEAD_SHORT}: passed`)
  })

  it('names a failed result on the checked head', () => {
    const row = reviewRow(
      makeReview({
        checks: 'failed',
        evidence: {
          checkedHead: HEAD,
          checks: [{ command: null, result: 'failed', at: null }],
          stale: false,
        },
      })
    )
    expect(row.evidenceText).toBe(`Checked on ${HEAD_SHORT}: failed`)
  })

  it('says when this head was not checked', () => {
    const review = makeReview({
      evidence: { checkedHead: null, checks: [], stale: false },
    })
    const row = reviewRow(review)
    expect(row.evidenceText).toBe('Not checked on this head')
    expect(row.evidenceText).not.toContain('an older head was checked')

    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).toContain('Not checked on this head')
    expect(html).not.toContain('an older head was checked')
  })

  it('adds the note when an older head was checked', () => {
    const review = makeReview({
      evidence: { checkedHead: null, checks: [], stale: true },
    })
    expect(reviewRow(review).evidenceText).toBe(
      'Not checked on this head (an older head was checked)'
    )

    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).toContain('Not checked on this head (an older head was checked)')
  })

  it('leaves the evidence line out when the review carries none', () => {
    expect(formatEvidence(null)).toBeNull()
    expect(formatEvidence(undefined)).toBeNull()
    expect(reviewRow(makeReview()).evidenceText).toBeNull()
  })
})

describe('Reviews evidence rows', () => {
  it('shows what the agent said apart from the check line, three lines and More', async () => {
    const claims = [
      'The checks pass and the lane is safe to merge.',
      'I changed one file.',
      'I ran the tests twice.',
      'This fourth line stays behind More.',
    ].join('\n')
    const review = makeReview({
      checks: 'failed',
      claims,
      evidence: {
        checkedHead: HEAD,
        checks: [{ command: null, result: 'failed', at: null }],
        stale: false,
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] }))
      })

      const badge = container.querySelector('.review-checks')
      expect(badge.textContent).toBe('checks failed')
      expect(badge.textContent).not.toContain('The agent said:')

      let claimsLine = lineWithText(container, 'The agent said:')
      expect(claimsLine).not.toBeNull()
      expect(claimsLine.textContent).toContain('The checks pass and the lane is safe to merge.')
      expect(claimsLine.textContent).toContain('I ran the tests twice.')
      expect(claimsLine.textContent).not.toContain('This fourth line stays behind More.')
      expect(claimsLine.textContent).not.toContain('checks failed')

      await click(root, buttonWithText(claimsLine, 'More'))
      await settle()

      claimsLine = lineWithText(container, 'The agent said:')
      expect(claimsLine.textContent).toContain('This fourth line stays behind More.')
      await click(root, buttonWithText(claimsLine, 'Less'))
      await settle()

      claimsLine = lineWithText(container, 'The agent said:')
      expect(claimsLine.textContent).not.toContain('This fourth line stays behind More.')
      expect(CLAIMS_PREVIEW_LINES).toBe(3)
    })
  })

  it('shows no claims line when the agent said nothing new', () => {
    const review = makeReview({ claims: null, evidence: { checkedHead: null, checks: [], stale: false } })
    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).not.toContain('The agent said:')
  })

  it('lists two linked runs in order and a partial total with a question mark', () => {
    const runs = [
      { lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash', minutes: 12, costUsd: 0.42 },
      { lane: 'opencode', model: null, minutes: null, costUsd: null },
    ]
    const runTotals = {
      runs: 2,
      runMinutes: 12,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      partial: true,
    }
    const review = makeReview({ runs, runTotals })
    const row = reviewRow(review)

    expect(formatRuns(runs)).toBe(
      'hermes (deepseek/deepseek-v4.1-flash), 12 min then opencode (?), ? min'
    )
    expect(row.runsText).toBe(
      'hermes (deepseek/deepseek-v4.1-flash), 12 min then opencode (?), ? min'
    )
    expect(runTotals.costUsd).toBeNull()
    expect(formatRunTotals(runs, runTotals)).toBe(
      '2 runs, 12 run minutes, ? (some runs did not report)'
    )
    expect(row.runTotalsText).not.toContain('$0.00')
    expect(row.runTotalsText).not.toContain('0 min')

    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).toContain('hermes (deepseek/deepseek-v4.1-flash), 12 min then opencode (?), ? min')
    expect(html).toContain('2 runs, 12 run minutes, ? (some runs did not report)')
  })

  it('keeps a single run off the linked run line', () => {
    const runs = [{ lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash', minutes: 12, costUsd: 0.42 }]
    const review = makeReview({
      runs,
      runTotals: { runs: 1, runMinutes: 12, costUsd: 0.42, partial: false },
    })
    const row = reviewRow(review)
    expect(row.runsText).toBeNull()
    expect(row.runTotalsText).toBeNull()

    const html = renderToString(
      createElement(ReviewsPanel, { client: makeClient([review]), initialReviews: [review] })
    )
    expect(html).not.toContain(' then ')
    expect(html).not.toContain('run minutes')
  })
})
