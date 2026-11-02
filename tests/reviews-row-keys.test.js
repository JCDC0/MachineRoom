import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { click, withDom } from './helpers/uiDom.js'

function buttonWithText(scope, text) {
  return scope.querySelectorAll('button').find((button) => button.textContent.trim() === text) ?? null
}

function insideRole(button, role) {
  let current = button?.parentNode ?? null
  while (current) {
    if (current.getAttribute?.('role') === role) return true
    current = current.parentNode
  }
  return false
}

async function mountPanel(root, client) {
  const initialReviews = await client.reviews()
  const initialDiff = await client.reviewDiff('hermes')
  await act(async () => {
    root.render(createElement(ReviewsPanel, { client, initialReviews, initialDiff }))
  })
  return { initialReviews, initialDiff }
}

describe('the review row', () => {
  it('keeps the expand action and Merge as separate buttons', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root }) => {
      await mountPanel(root, client)
      const merge = buttonWithText(container, 'Merge')
      const expand = buttonWithText(container, 'Hide')
      expect(merge).not.toBeNull()
      expect(expand).not.toBeNull()
      expect(insideRole(merge, 'button')).toBe(false)
      expect(insideRole(expand, 'button')).toBe(false)
      expect(expand.getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('does not toggle the diff from a key on Merge', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root }) => {
      await mountPanel(root, client)
      expect(container.querySelector('.review-diff-view')).not.toBeNull()
      const merge = buttonWithText(container, 'Merge')
      await act(async () => {
        merge.dispatchEvent({ type: 'keydown', key: ' ', bubbles: true, cancelable: true })
        merge.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.review-diff-view')).not.toBeNull()
    })
  })

  it('opens and closes the diff from its own button and keeps it open on Merge', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root }) => {
      await mountPanel(root, client)
      const hide = buttonWithText(container, 'Hide')
      await click(root, hide)
      expect(container.querySelector('.review-diff-view')).toBeNull()
      const show = buttonWithText(container, 'Diff')
      expect(show.getAttribute('aria-expanded')).toBe('false')
      await click(root, show)
      expect(container.querySelector('.review-diff-view')).not.toBeNull()

      const merge = buttonWithText(container, 'Merge')
      await click(root, merge)
      expect(container.querySelector('.review-confirm-card')).not.toBeNull()
      expect(container.querySelector('.review-diff-view')).not.toBeNull()
    })
  })
})
