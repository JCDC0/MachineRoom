import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import RoomBoundary from '../src/ui/RoomBoundary.jsx'
import { withDom } from './helpers/uiDom.js'

const snapshot = { position: 0, duration: 60, playing: false, speed: 1, agents: [], log: [] }

function Broken() {
  throw new Error('broken part')
}

describe('render faults', () => {
  it('renders the HUD when the storage getter throws', async () => {
    await withDom(async ({ root, container, window }) => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied') } })
      await act(async () => root.render(<Hud mode="replay" snapshot={snapshot} speeds={[1]} />))
      expect(container.textContent).toContain('Menu')
      expect(container.textContent).not.toContain('This panel stopped')
    })
  })

  it('contains a failing HUD part and leaves its sibling visible', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await withDom(async ({ root, container, window }) => {
        window.innerWidth = 1280
        await act(async () => root.render(<Hud mode="replay" snapshot={snapshot} speeds={[1]} sidebar={<Broken />} inspector={<div>Inspector survives</div>} />))
        expect(container.textContent).toContain('This panel stopped: Sidebar: broken part.')
        expect(container.textContent).toContain('Inspector survives')
      })
    } finally { error.mockRestore() }
  })

  it('shows a bounded room message and reload button', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    const previous = globalThis.location
    globalThis.location = { reload }
    function BrokenRoom() { throw new Error('x'.repeat(150)) }
    try {
      await withDom(async ({ root, container }) => {
        await act(async () => root.render(<RoomBoundary><BrokenRoom /></RoomBoundary>))
        expect(container.textContent).toContain(`The room stopped: ${'x'.repeat(120)}.`)
        expect(container.textContent).not.toContain('x'.repeat(121))
        const button = container.querySelector('button')
        expect(button.textContent).toBe('Reload')
        await act(async () => button.click())
        expect(reload).toHaveBeenCalledOnce()
      })
    } finally { globalThis.location = previous; error.mockRestore() }
  })
})
