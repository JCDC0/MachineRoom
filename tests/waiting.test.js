import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Waiting from '../src/ui/Waiting.jsx'
import { WIDE_LAYOUT_MIN } from '../src/ui/agentStrip.js'
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

describe('Waiting close button', () => {
  it('says the chat is in the lower half at WIDE_LAYOUT_MIN and wider', () => {
    const savedWindow = globalThis.window
    globalThis.window = { innerWidth: WIDE_LAYOUT_MIN }
    try {
      const html = renderToString(
        createElement(Waiting, {
          status: 'live',
          agents: [{ key: 'orchestrator', name: 'Orchestrator', status: 'idle' }],
        })
      )
      expect(html).toContain(
        'Nothing is running yet. Press / or click ORCHESTRATOR at the top, and the chat sits in the lower half, under the transport.'
      )
      expect(html).not.toContain('bottom right')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('keeps the bottom right sentence below WIDE_LAYOUT_MIN', () => {
    const savedWindow = globalThis.window
    globalThis.window = { innerWidth: WIDE_LAYOUT_MIN - 1 }
    try {
      const html = renderToString(
        createElement(Waiting, {
          status: 'live',
          agents: [{ key: 'orchestrator', name: 'Orchestrator', status: 'idle' }],
        })
      )
      expect(html).toContain('the chat opens at the bottom right.')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('renders a close button at the right end of the header', () => {
    const html = renderToString(createElement(Waiting, { status: 'live' }))
    expect(html).toContain('class="waiting-close mono"')
    expect(html).toContain('aria-label="Close waiting notice"')
    expect(html).toContain('title="Close"')
  })

  it('hides the popup and calls onClose on a click', async () => {
    await withDom(async ({ container, root }) => {
      const calls = []
      await act(async () => {
        root.render(createElement(Waiting, {
          status: 'live',
          onClose: () => calls.push('close'),
        }))
      })
      const close = elementByClass(container, 'waiting-close')
      const header = elementByClass(container, 'waiting-header')
      expect(close).not.toBeNull()
      expect(header.children.at(-1)).toBe(close)
      await act(async () => close.click())
      expect(elementByClass(container, 'waiting')).toBeNull()
      expect(calls).toEqual(['close'])
    })
  })

  it('shows the popup again when the status changes', async () => {
    await withDom(async ({ container, root }) => {
      const onClose = () => {}
      await act(async () => {
        root.render(createElement(Waiting, { status: 'live', onClose }))
      })
      await act(async () => elementByClass(container, 'waiting-close').click())
      expect(elementByClass(container, 'waiting')).toBeNull()

      await act(async () => {
        root.render(createElement(Waiting, { status: 'reconnecting', onClose }))
      })
      expect(elementByClass(container, 'waiting')).not.toBeNull()
      expect(elementByClass(container, 'waiting-badge').textContent).toBe('Reconnecting')
      expect(elementByClass(container, 'waiting-close')).not.toBeNull()
    })
  })
})
