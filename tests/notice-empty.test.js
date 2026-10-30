import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Notice, { NOTHING_RECORDED } from '../src/ui/Notice.jsx'
import { ELEMENT_NODE, withDom } from './helpers/uiDom.js'

function elementByClass(node, className) {
  for (const child of node.childNodes) {
    if (child.nodeType !== ELEMENT_NODE) continue
    if (String(child.className).split(/\s+/).includes(className)) return child
    const found = elementByClass(child, className)
    if (found) return found
  }
  return null
}

describe('Notice empty state', () => {
  it('says the replay starts with the first conversation', () => {
    const html = renderToString(createElement(Notice, { status: 'empty' }))
    expect(NOTHING_RECORDED).toBe('Nothing recorded yet. Replay starts with the first conversation.')
    expect(html).toContain(NOTHING_RECORDED)
  })

  it('offers Back to live and Connection settings and runs each on a click', async () => {
    await withDom(async ({ container, root }) => {
      const calls = []
      await act(async () => {
        root.render(createElement(Notice, {
          status: 'empty',
          onLive: () => calls.push('live'),
          onConnect: () => calls.push('connect'),
        }))
      })
      const live = elementByClass(container, 'notice-live')
      const connect = elementByClass(container, 'notice-connect')
      expect(live?.textContent).toBe('Back to live')
      expect(connect?.textContent).toBe('Connection settings')
      await act(async () => live.click())
      await act(async () => connect.click())
      expect(calls).toEqual(['live', 'connect'])
    })
  })

  it('leaves on Escape through the live button first', async () => {
    await withDom(async ({ container, root, window }) => {
      const calls = []
      await act(async () => {
        root.render(createElement(Notice, {
          status: 'empty',
          onLive: () => calls.push('live'),
          onConnect: () => calls.push('connect'),
        }))
      })
      expect(elementByClass(container, 'notice-live')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Escape' })
      })
      expect(calls).toEqual(['live'])
    })
  })
})
