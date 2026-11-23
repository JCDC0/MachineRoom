import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import Hud from '../src/ui/Hud.jsx'
import { OrchestratorsContext } from '../src/ui/Transport.jsx'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

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

  it('closes every owned HUD panel and list when idleForced turns true (R75-2)', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const liveSnapshot = {
      ...SNAPSHOT,
      live: true,
      status: 'live',
      agents: [
        { key: 'opencode', name: 'OpenCode', status: 'working' },
        { key: 'claude', name: 'Claude', status: 'idle' },
      ],
    }
    const health = { ok: true, problems: ['A source stopped.'] }

    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.innerWidth = 1280
      const renderWide = async (idleForced) => {
        await act(async () => {
          root.render(
            createElement(
              OrchestratorsContext.Provider,
              { value: [{ id: 'orchestrator', name: 'Orchestrator', state: 'working' }] },
              createElement(Hud, {
                mode: 'live',
                liveAvailable: true,
                client,
                health,
                snapshot: liveSnapshot,
                speeds: [1, 2, 4],
                idleForced,
              })
            )
          )
        })
        await settle()
      }

      await renderWide(false)
      await click(root, container.querySelector('.hud-health-chip'))
      await click(root, container.querySelector('.transport-agents-toggle'))
      await click(root, container.querySelector('[aria-controls="hud-help-dialog"]'))
      await click(root, container.querySelector('[aria-controls="hud-control-drawer"]'))
      expect(container.querySelector('.hud-health-popover')).not.toBeNull()
      expect(container.querySelector('.transport-agents-list')).not.toBeNull()
      expect(container.querySelector('#hud-help-dialog')).not.toBeNull()
      expect(container.querySelector('#hud-control-drawer')).not.toBeNull()

      await renderWide(true)
      expect(container.querySelector('.hud-health-popover')).toBeNull()
      expect(container.querySelector('.transport-agents-list')).toBeNull()
      expect(container.querySelector('#hud-help-dialog')).toBeNull()
      expect(container.querySelector('#hud-control-drawer')).toBeNull()

      await renderWide(false)
      await click(root, container.querySelector('[aria-controls="hud-settings"]'))
      expect(container.querySelector('#hud-settings')).not.toBeNull()
      await renderWide(true)
      expect(container.querySelector('#hud-settings')).toBeNull()

      await renderWide(false)
      await click(root, container.querySelector('[aria-controls="hud-log-drawer"]'))
      expect(container.querySelector('#hud-log-drawer')).not.toBeNull()
      await renderWide(true)
      expect(container.querySelector('#hud-log-drawer')).toBeNull()
    })

    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.innerWidth = 800
      const renderNarrow = async (idleForced) => {
        await act(async () => {
          root.render(
            createElement(Hud, {
              mode: 'replay',
              client,
              health,
              snapshot: liveSnapshot,
              speeds: [1, 2, 4],
              idleForced,
            })
          )
        })
        await settle()
      }

      await renderNarrow(false)
      await click(root, container.querySelector('.idle-toggle'))
      await click(root, container.querySelector('.hud-menu-toggle'))
      await click(root, buttonWithText(container, 'Sessions'))
      await click(root, container.querySelector('.hud-menu-toggle'))
      expect(container.querySelector('.idle-toggle').getAttribute('aria-expanded')).toBe('true')
      expect(container.querySelector('.hud-menu.is-open')).not.toBeNull()
      expect(container.querySelector('#mr-side-overlay')).not.toBeNull()

      await renderNarrow(true)
      expect(container.querySelector('.idle-toggle').getAttribute('aria-expanded')).toBe('false')
      expect(container.querySelector('.hud-menu.is-open')).toBeNull()
      expect(container.querySelector('#mr-side-overlay')).toBeNull()
    })
  })

  it('closes the assistant on forced idle and blocks / while idleForced is true (R75-2)', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.innerWidth = 1280
      const renderHud = async (idleForced) => {
        await act(async () => {
          root.render(createElement(Hud, { mode: 'replay', snapshot: SNAPSHOT, speeds: [1, 2, 4], idleForced }))
        })
      }

      await renderHud(false)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '/', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-assistant-terminal')).not.toBeNull()

      await renderHud(true)
      expect(container.querySelector('#hud-assistant-terminal')).toBeNull()

      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '/', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-assistant-terminal')).toBeNull()

      await renderHud(false)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '/', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-assistant-terminal')).not.toBeNull()
    })
  })

  it('ignores number keys while idleForced is true (R75-5)', async () => {
    await withDom(async ({ root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.innerWidth = 1280
      const focused = []
      const renderHud = async (idleForced) => {
        await act(async () => {
          root.render(
            createElement(Hud, {
              mode: 'replay',
              snapshot: SNAPSHOT,
              speeds: [1, 2, 4],
              onFocus: (key) => focused.push(key),
              idleForced,
            })
          )
        })
      }

      await renderHud(true)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '1', bubbles: true, cancelable: true })
      })
      expect(focused).toEqual([])

      await renderHud(false)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '1', bubbles: true, cancelable: true })
      })
      expect(focused).toEqual(['opencode'])
    })
  })

  it('ignores L, C, ? and / while idleForced is true (R75-5)', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      window.innerWidth = 1280
      const renderHud = async (idleForced) => {
        await act(async () => {
          root.render(
            createElement(Hud, {
              mode: 'replay',
              client,
              health: { ok: true, orchestrator: true },
              snapshot: SNAPSHOT,
              speeds: [1, 2, 4],
              idleForced,
            })
          )
        })
        await settle()
      }

      await renderHud(true)
      for (const key of ['l', 'c', '?', '/']) {
        await act(async () => {
          window.dispatchEvent({ type: 'keydown', key, bubbles: true, cancelable: true })
        })
      }
      expect(container.querySelector('#hud-log-drawer')).toBeNull()
      expect(container.querySelector('#hud-control-drawer')).toBeNull()
      expect(container.querySelector('#hud-help-dialog')).toBeNull()
      expect(container.querySelector('#hud-orchestrator-chat')).toBeNull()

      await renderHud(false)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'l', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-log-drawer')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'c', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-control-drawer')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'c', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-control-drawer')).toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '?', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-help-dialog')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-help-dialog')).toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: '/', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-orchestrator-chat')).not.toBeNull()
    })
  })
})
