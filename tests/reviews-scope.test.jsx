import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { reviewRow } from '../src/ui/panels/reviews.js'

function makeReview(overrides = {}) {
  return {
    lane: 'claude',
    branch: 'feat/x',
    head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
    base: 'main',
    baseHead: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c',
    strategy: 'merge-commit',
    ahead: 1,
    dirty: false,
    files: 6,
    added: 100,
    deleted: 0,
    checks: 'passed',
    fileGroups: {
      server: { count: 2, paths: [] },
      ui: { count: 1, paths: [] },
      scripts: { count: 0, paths: [] },
      tests: { count: 3, paths: [] },
    },
    largeDiff: false,
    outsideBrief: [],
    ...overrides,
  }
}

const html = (review) =>
  renderToString(createElement(ReviewsPanel, { client: { reviews: async () => [review], subscribe: () => () => {} }, initialReviews: [review] }))

describe('Reviews scope line', () => {
  it('shows the group counts', () => {
    expect(reviewRow(makeReview()).scope.groupsText).toBe('server 2, ui 1, tests 3')
    expect(html(makeReview())).toContain('server 2, ui 1, tests 3')
  })

  it('lists files outside the brief', () => {
    const review = makeReview({ outsideBrief: ['server/z.js'] })
    expect(reviewRow(review).scope.outsideText).toBe('1 file outside the brief')
    expect(html(review)).toContain('server/z.js')
  })

  it('says Scope unknown when no brief was found', () => {
    const review = makeReview({ outsideBrief: null })
    expect(reviewRow(review).scope.outsideText).toBe('Scope unknown')
    expect(html(review)).toContain('Scope unknown')
  })

  it('warns on a large change and not on a small one', () => {
    const large = makeReview({ added: 300, deleted: 101, largeDiff: true })
    expect(reviewRow(large).scope.largeText).toBe('Large change: 401 lines')
    expect(html(large)).toContain('Large change: 401 lines')
    const small = makeReview({ added: 300, deleted: 100 })
    expect(reviewRow(small).scope.largeText).toBeNull()
    expect(html(small)).not.toContain('Large change')
  })
})
