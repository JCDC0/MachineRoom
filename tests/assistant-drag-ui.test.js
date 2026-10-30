import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Assistant from '../src/ui/Assistant.jsx'
import { withDom } from './helpers/handDom.js'

function makeStorage() {
  const data = new Map()
  const writes = []
  return {
    storage: {
      getItem(key) {
        return data.has(key) ? data.get(key) : null
      },
      setItem(key, value) {
        writes.push({ key, value: String(value) })
        data.set(key, String(value))
      },
      removeItem(key) {
        data.delete(key)
      },
    },
    writes,
  }
}

async function pointerDown(header) {
  await act(async () => {
    header.dispatchEvent({
      type: 'pointerdown',
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 20,
      clientY: 30,
    })
  })
}

async function pointerMove(window, x, y) {
  await act(async () => {
    window.dispatchEvent({ type: 'pointermove', bubbles: true, clientX: x, clientY: y })
  })
}

async function pointerUp(window, x, y) {
  await act(async () => {
    window.dispatchEvent({ type: 'pointerup', bubbles: true, clientX: x, clientY: y })
  })
}

describe('Assistant drag', () => {
  it('ends the drag on Escape and does not save a closed terminal', async () => {
    const { storage, writes } = makeStorage()
    await withDom(async ({ container, dom, root }) => {
      await act(async () => {
        root.render(createElement(Assistant, { initialOpen: true, storage }))
      })
      const terminal = container.querySelector('.mr-assistant')
      expect(terminal).not.toBeNull()
      const before = terminal.style.left

      await pointerDown(terminal.querySelector('.mr-assistant-title'))
      await pointerMove(dom.window, 90, 110)
      expect(terminal.style.left).not.toBe(before)

      await act(async () => {
        dom.window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-assistant')).toBeNull()

      await pointerUp(dom.window, 90, 110)
      expect(writes).toEqual([])
    })
  })

  it('removes the pointer listeners when it unmounts during a drag', async () => {
    const { storage, writes } = makeStorage()
    await withDom(async ({ container, dom, root }) => {
      await act(async () => {
        root.render(createElement(Assistant, { initialOpen: true, storage }))
      })
      const terminal = container.querySelector('.mr-assistant')
      await pointerDown(terminal.querySelector('.mr-assistant-title'))
      await pointerMove(dom.window, 120, 140)

      await act(async () => {
        root.render(null)
      })
      await pointerUp(dom.window, 120, 140)
      expect(writes).toEqual([])
    })
  })
})
