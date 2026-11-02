import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Launcher from '../src/ui/Launcher.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

describe('the folder picker while it opens a folder', () => {
  it('keeps Close and Escape from cancelling the reload', async () => {
    const client = {
      projects: async () => ({
        current: { path: 'C:\\work\\one', name: 'one', git: false },
        folders: [{ path: 'C:\\work\\two', name: 'two', git: true }],
      }),
      openProject: () => new Promise(() => {}),
    }
    await withDom(async ({ container, root, dom }) => {
      await act(async () => {
        root.render(createElement(Launcher, { live: true, client }))
      })
      await settle()

      const row = container.querySelectorAll('.mr-launcher-row').filter((item) => !String(item.className).includes('is-current'))[0]
      expect(row).not.toBeNull()
      await act(async () => {
        row.click()
      })

      expect(container.textContent).toContain('Opening')
      const close = buttonWithText(container.querySelector('.mr-launcher'), 'Close')
      expect(close.getAttribute('disabled')).not.toBeNull()

      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-launcher')).not.toBeNull()
    })
  })
})
