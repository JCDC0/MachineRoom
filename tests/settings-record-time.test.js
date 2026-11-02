import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Settings from '../src/ui/Settings.jsx'
import { store } from '../src/storage.js'
import { loadSettings } from '../src/ui/settings.js'
import { type, withDom } from './helpers/uiDom.js'

describe('the record time field', () => {
  it('saves on Enter and on a close that unmounts it', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(Settings, { open: true, effects: {}, onClose: () => {} }))
      })
      const input = container.querySelector('[aria-label="Record time in minutes"]')
      await type(root, input, '12')
      await act(async () => {
        input.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true })
      })
      expect(loadSettings(store()).recordMinutes).toBe(12)

      await type(root, input, '7')
      await act(async () => {
        root.render(createElement('div'))
      })
      expect(loadSettings(store()).recordMinutes).toBe(7)
    })
  })
})
