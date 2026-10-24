import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'

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
})
