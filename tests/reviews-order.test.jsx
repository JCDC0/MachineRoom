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
      await act(async () => pending[1]([{ lane: 'newer', ahead: 0 }]))
      await act(async () => pending[0]([{ lane: 'older', ahead: 0 }]))
      expect(container.textContent).toContain('newer')
      expect(container.textContent).not.toContain('older')
      expect(container.textContent).not.toContain('Loading reviews')
    })
  })
})
