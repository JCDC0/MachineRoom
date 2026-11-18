import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

describe('Reviews rewind', () => {
  it('loads idle lanes only when expanded and shows refusals for lanes ahead', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const reviews = await client.reviews()
    const idle = { ...reviews[0], lane: 'idle', ahead: 0, dirty: false }
    const ahead = { ...reviews[0], lane: 'ahead', ahead: 1 }
    const requested = []
    const spy = {
      ...client,
      reviewDiff: async () => ({ files: [], patch: '' }),
      reviewRewind: async (lane) => {
        requested.push(lane)
        return { allowed: false, reason: lane === 'idle' ? 'No checkpoint.' : 'Lane is dirty.' }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client: spy, initialReviews: [idle, ahead] }))
      })
      await settle()
      expect(requested).toEqual(['ahead'])
      expect(container.textContent).toContain('Rewind unavailable: Lane is dirty.')
      expect(container.textContent).not.toContain('No checkpoint.')
      await click(root, buttonWithText(container, '1 lanes have nothing to review'))
      await click(root, container.querySelectorAll('.review-card')[1].querySelector('.review-expand-btn'))
      await settle()
      expect(requested).toEqual(['ahead', 'idle'])
      expect(container.textContent).toContain('Rewind unavailable: No checkpoint.')
      await click(root, container.querySelectorAll('.review-card')[1].querySelector('.review-expand-btn'))
      expect(container.textContent).not.toContain('No checkpoint.')
    })
  })

  it('previews the drop, sends the preview head and shows a refusal without a button', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const reviews = await client.reviews()
    const hermes = reviews.find((entry) => entry.lane === 'hermes')
    const sent = []
    const spy = {
      ...client,
      reviews: async () => reviews,
      rewindReview: async (lane, options) => {
        sent.push({ lane, options })
        return client.rewindReview(lane, options)
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client: spy, initialReviews: reviews }))
      })
      await settle()
      const open = buttonWithText(container, 'Rewind last run')
      expect(open).not.toBeNull()
      await click(root, open)
      const card = container.querySelector('[aria-label="Confirm rewind for hermes"]')
      expect(card.textContent).toContain('9f1c2a3 P5: take the tool name from the broken line')
      expect(card.textContent).toContain('src/control/client.js')
      expect(card.textContent).toContain('refs/machineroom/recovery/hermes-sample')
      await click(root, buttonWithText(card, 'Rewind'))
      await settle()
      expect(sent).toEqual([{ lane: 'hermes', options: { expectedHead: hermes.head } }])
      expect(container.textContent).toContain('git reset --keep refs/machineroom/recovery/hermes-sample')
      expect(container.textContent).toContain('Rewind unavailable: The lane has uncommitted changes, so it was not rewound.')
    })
  })
})
