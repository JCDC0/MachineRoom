import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

describe('Reviews rewind', () => {
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
