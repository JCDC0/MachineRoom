import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { buttonWithText, click, withDom } from './helpers/uiDom.js'

describe('Reviews read order', () => {
  it('keeps the newer list when an older initial read answers last', async () => {
    const pending = []
    const client = { reviews: () => new Promise((resolve) => pending.push(resolve)) }
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(ReviewsPanel, { client })))
      await click(root, buttonWithText(container, 'Refresh'))
      expect(pending).toHaveLength(2)
      await act(async () => pending[1]([{ lane: 'newer', ahead: 1 }]))
      await act(async () => pending[0]([{ lane: 'older', ahead: 1 }]))
      expect(container.textContent).toContain('newer')
      expect(container.textContent).not.toContain('older')
      expect(container.textContent).not.toContain('Loading reviews')
    })
  })
})

describe('Reviews visibility', () => {
  it('folds clean lanes and keeps ahead, dirty, and failed reads visible', async () => {
    const reviews = [
      { lane: 'ahead-lane', ahead: 1 },
      { lane: 'dirty-lane', ahead: 0, dirty: true },
      { lane: 'clean-lane', ahead: 0, dirty: false },
      { lane: 'error-lane', error: 'Read failed' },
    ]
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(ReviewsPanel, { client: {}, initialReviews: reviews })))
      expect(container.textContent).toContain('ahead-lane')
      expect(container.textContent).toContain('dirty-lane')
      expect(container.textContent).toContain('Read failed')
      expect(container.textContent).not.toContain('clean-lane')
      const toggle = buttonWithText(container, '1 lane has nothing to review')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await click(root, toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(container.textContent).toContain('clean-lane')
      await click(root, toggle)
      expect(container.textContent).not.toContain('clean-lane')
    })
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(ReviewsPanel, { client: {}, initialReviews: [reviews[2]] })))
      expect(container.textContent).toContain('Nothing to review.')
      expect(container.textContent).toContain('1 lane has nothing to review')
    })
  })

  it('says lanes have when two or more are folded', async () => {
    const reviews = [{ lane: 'a', ahead: 0 }, { lane: 'b', ahead: 0 }]
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(ReviewsPanel, { client: {}, initialReviews: reviews })))
      expect(container.textContent).toContain('2 lanes have nothing to review')
    })
  })
})
