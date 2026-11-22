import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import { withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 60,
  playing: false,
  speed: 1,
  agents: [{ key: 'opencode', name: 'OpenCode', status: 'working' }],
  log: [],
}

describe('Hud menu button', () => {
  it('renders one folded menu button, closed at first', () => {
    const html = renderToString(
      createElement(Hud, { mode: 'replay', snapshot: SNAPSHOT, speeds: [1, 2, 4] })
    )

    expect(html).toContain('class="hud-menu"')
    expect(html).toContain('class="hud-menu-toggle"')
    expect(html).toMatch(/class="hud-menu-toggle"[^>]*aria-expanded="false"/)
    expect(html).toContain('>Menu</button>')
  })

  it('adds is-flat once the page scrolls past two pixels and removes it back at the top', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.scrollY = 0
      await act(async () => {
        root.render(createElement(Hud, { mode: 'replay', snapshot: SNAPSHOT, speeds: [1, 2, 4] }))
      })
      expect(container.querySelector('.hud-menu').className).toBe('hud-menu')

      window.scrollY = 2
      await act(async () => {
        window.dispatchEvent({ type: 'scroll' })
      })
      expect(container.querySelector('.hud-menu').className).toBe('hud-menu')

      window.scrollY = 240
      await act(async () => {
        window.dispatchEvent({ type: 'scroll' })
      })
      expect(container.querySelector('.hud-menu').className).toBe('hud-menu is-flat')

      window.scrollY = 0
      await act(async () => {
        window.dispatchEvent({ type: 'scroll' })
      })
      expect(container.querySelector('.hud-menu').className).toBe('hud-menu')
    })
  })
})

describe('Hud forced idle (R74-2, R74-6)', () => {
  it('passes idleForced and onToggleIdle to the transport at either width', async () => {
    for (const width of [1280, 600]) {
      await withDom(async ({ container, root, window }) => {
        window.localStorage.setItem('machineroom.guide', '1')
        window.innerWidth = width
        const toggled = []
        await act(async () => {
          root.render(createElement(Hud, { mode: 'replay', snapshot: SNAPSHOT, speeds: [1, 2, 4], idleForced: true, onToggleIdle: () => toggled.push(width) }))
        })
        const idle = container.querySelector('.transport-idle')
        expect(idle, `Idle at ${width}`).toBeTruthy()
        expect(idle.getAttribute('aria-pressed')).toBe('true')
        await act(async () => {
          idle.click()
        })
        expect(toggled).toEqual([width])
      })
    }
  })
})
