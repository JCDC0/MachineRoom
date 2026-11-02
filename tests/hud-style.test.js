import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CompactCard from '../src/ui/AgentStrip.jsx'
import Assistant from '../src/ui/Assistant.jsx'
import Hud from '../src/ui/Hud.jsx'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import MetersPanel from '../src/ui/panels/MetersPanel.jsx'
import Waiting from '../src/ui/Waiting.jsx'

const SAMPLE_AGENTS = [
  { id: 'a1', key: 'scout', name: 'Scout', status: 'working', open: true },
  { id: 'a2', key: 'forge', name: 'Forge', status: 'error', open: false },
]

const SAMPLE_LOG = [
  { time: 12.5, agent: 'scout', text: 'Read src/index.js', tone: 'normal' },
]

const SAMPLE_SNAPSHOT = {
  position: 12.5,
  duration: 60,
  playing: false,
  speed: 1,
  agents: SAMPLE_AGENTS,
  log: SAMPLE_LOG,
}

describe('HUD concept style structure', () => {
  it('renders the HUD header strip and agent tag rows', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        liveStatus: 'replay',
        snapshot: SAMPLE_SNAPSHOT,
        speeds: [1, 2, 4],
      })
    )

    expect(html).toContain('class="hud-header-strip"')
    expect(html).toContain('class="hud-status-tag"')
    expect(html).toContain('class="agent-head"')
    expect(html).toContain('class="agent-subtags mono"')
    expect(html).toContain('class="agent-subtag agent-lane"')
    expect(html).toContain('class="agent-subtag agent-status"')
    expect(html).not.toContain('hud-strip')
  })

  it('renders the help overlay as a numbered index list with a box-drawing rule', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        liveStatus: 'replay',
        snapshot: SAMPLE_SNAPSHOT,
        speeds: [1, 2, 4],
        helpOpen: true,
      })
    )

    expect(html).toContain('id="hud-help-dialog"')
    expect(html).toContain('class="hud-help-header hud-header-strip"')
    expect(html).toContain('<ol class="hud-shortcuts hud-index-list">')
    expect(html).toContain('class="hud-index-rule mono"')
    expect(html).toContain('│')
    expect(html).toContain('<span class="hud-index-num mono">1</span>')
  })

  it('renders the assistant command bar with an outlined EXEC submit button', () => {
    const html = renderToString(
      createElement(Assistant, {
        open: true,
        mode: 'replay',
        agents: SAMPLE_AGENTS,
      })
    )

    expect(html).toContain('class="mr-assistant-title hud-header-strip"')
    expect(html).toContain('class="mr-assistant-form"')
    expect(html).toContain('type="submit" class="mr-assistant-exec mono">EXEC</button>')
  })

  it('renders outlined meter bars with percentages for budgets', () => {
    const html = renderToString(
      createElement(MetersPanel, {
        initialCosts: {
          summary: {
            budgetCents: 10000,
            spendCents: 4500,
            utilizationPercent: 45,
          },
          byAgent: [{ agentId: 'a1', costCents: 500 }],
          quota: [],
        },
        initialAgents: [
          {
            id: 'a1',
            name: 'Scout',
            role: 'researcher',
            budgetMonthlyCents: 2000,
            spentMonthlyCents: 500,
          },
        ],
      })
    )

    expect(html).toContain('class="meter-bar"')
    expect(html).toContain('class="meter-track"')
    expect(html).toContain('class="meter-fill')
    expect(html).toContain('<span class="meter-percent mono">45%</span>')
    expect(html).not.toContain('backup-age-bar')
  })

  it('renders the control drawer header strip and the waiting cursor underscore', () => {
    const drawerHtml = renderToString(
      createElement(ControlDrawer, {
        open: true,
        activeTab: 'tasks',
        mode: 'replay',
        issues: [],
        agents: [],
        approvals: [],
        quotas: [],
      })
    )
    expect(drawerHtml).toContain('class="control-drawer-header hud-header-strip"')

    const waitingHtml = renderToString(
      createElement(Waiting, {
        status: 'connected',
        agents: SAMPLE_AGENTS,
      })
    )
    expect(waitingHtml).toContain('class="waiting-header hud-header-strip"')
    expect(waitingHtml).toContain('<span class="waiting-cursor" aria-hidden="true">_</span>')
  })

  it('renders the Compact card with what to keep and the autocompact switch', () => {
    const html = renderToString(
      createElement(CompactCard, {
        name: 'Orchestrator',
        id: 'orchestrator',
        orchestrator: {
          id: 'orchestrator',
          autocompact: true,
          autocompactPercent: 70,
        },
        client: {},
      })
    )

    expect(html).toContain('class="strip-card hud-strip-compact-card"')
    expect(html).toContain('>What to keep</label>')
    expect(html).toContain('Autocompact')
    expect(html).toContain('type="number"')
    expect(html).not.toContain('type="range"')
    expect(html).toContain('Compacts at 140000 of 200000 tokens')
    expect(html).toContain('>Compact now</button>')
    expect(html).toContain('Compacting is not available from this bridge.')
  })

  it('shows the lower half in place of the strip and dock at 900 pixels wide', () => {
    const savedWindow = globalThis.window
    let savedSettings = null
    const storage = {
      getItem: (key) => {
        if (key === 'machineroom.guide') return '1'
        if (key === 'machineroom.settings') return savedSettings
        return null
      },
      setItem: () => {},
    }
    globalThis.window = {
      innerWidth: 1200,
      location: { search: '' },
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    try {
      const html = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: SAMPLE_SNAPSHOT,
          speeds: [1, 2, 4],
        })
      )
      expect(html).toContain('class="hud-lower"')
      expect(html).toContain('class="hud-lower-left"')
      expect(html).toContain('class="hud-lower-main"')
      expect(html).toContain('class="hud-lower-crumb mono"')
      expect(html).toContain('PROJECT / New conversation')
      expect(html).toContain('class="hud-overview"')
      expect(html).toContain('>Overview</h2>')
      expect(html).toContain('>Settings</span>')
      expect(html).toContain('>Agent</span>')
      expect(html).toContain('>Costs</span>')
      expect(html).toContain('>Log</span>')
      expect(html).toContain('This is a recorded run. Connect to your project to talk to the orchestrator.')
      expect(html).toContain('>Connect</button>')
      expect(html).toContain('class="hud-drawer"')
      expect(html).toContain('id="hud-dock-costs"')
      expect(html).not.toMatch(/class="hud-strip[ "]/)
      expect(html).not.toContain('class="hud-dock"')
      savedSettings = JSON.stringify({ dockOpen: true })
      const open = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: SAMPLE_SNAPSHOT,
          speeds: [1, 2, 4],
        })
      )
      expect(open).toContain('class="hud-lower"')
      expect(open).not.toMatch(/class="hud-strip[ "]/)
      expect(open).not.toContain('class="hud-dock"')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('keeps the dock and leaves out the lower half below 900 pixels', () => {
    const savedWindow = globalThis.window
    const storage = {
      getItem: (key) => (key === 'machineroom.guide' ? '1' : null),
      setItem: () => {},
    }
    globalThis.window = {
      innerWidth: 800,
      location: { search: '' },
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    try {
      const html = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: SAMPLE_SNAPSHOT,
          speeds: [1, 2, 4],
        })
      )
      expect(html).toContain('class="hud-dock"')
      expect(html).toContain('class="hud-dock-agents"')
      expect(html).toContain('class="hud-dock-context"')
      expect(html).toContain('class="hud-dock-side"')
      expect(html).not.toContain('class="hud-lower"')
      expect(html).not.toContain('class="hud-overview"')
      expect(html).not.toMatch(/class="hud-strip[ "]/)
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('shows the project and conversation band at 900 pixels wide', () => {
    const savedWindow = globalThis.window
    const storage = {
      getItem: (key) => (key === 'machineroom.guide' ? '1' : null),
      setItem: () => {},
    }
    globalThis.window = {
      innerWidth: 1200,
      location: { search: '' },
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    try {
      const html = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: SAMPLE_SNAPSHOT,
          speeds: [1, 2, 4],
          project: '/agent-sandbox',
        })
      )
      expect(html).toContain('class="hud-band"')
      expect(html).toContain('class="hud-band-project">/agent-sandbox')
      expect(html).toContain('class="hud-band-v"')
      expect(html).toContain('mr-menu-icon')
      expect(html).toContain('hud-band-title">Main')
      expect(html).toContain('aria-label="Orchestrator conversations, showing Main"')
      expect(html).not.toContain('class="hud-header-strip"')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('defines the curved lens edges and the waiting card inside the lens in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.hud-band-project')
    expect(css).toContain('.lens-corner.is-center')
    expect(css).toContain('.lens-clock')
    expect(css).toContain('.lens-edge.is-top')
    expect(css).toContain('.lens-edge.is-bottom')
    expect(css).toContain('.lens-edge-rule')
    expect(css).toContain('height: calc(var(--lens-bow, 28px) + 24px)')
    expect(css).toContain('.lens-edge-line {\n  fill: none;\n}')
    expect(css).toContain('.lens-edge-label')
    expect(css).toContain('.lens-edge-cross')
    expect(css).toContain('top: calc(var(--lens-bow, 28px) + 2px)')
    expect(css).toContain('.lens-edge-corner.is-left')
    expect(css).toContain('.lens-edge-corner.is-right')
    expect(css).toContain('.transport-badge.is-live')
    expect(css).toContain('.transport-badge.is-down')
    expect(css).toContain('rgb(255 255 255 / 0.35)')
    expect(css).not.toContain('url(#mr-lens-clip)')
    expect(css).not.toContain('.lens-brackets')
    expect(css).not.toContain('.hud.is-disconnected .hud-menu')
    expect(css).toMatch(/@media \(min-width: 900px\) \{\n  \.waiting \{/)
  })

  it('defines corner ticks, 0.04em title spacing, and faint red scanlines in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('--corner-ticks:')
    expect(css).toContain('--scanlines-red:')
    expect(css).toContain('letter-spacing: 0.04em;')
    expect(css).toContain('.mr-item.is-failed')
    expect(css).toContain('.mr-card.is-flash-red .mr-card-face')
    expect(css).toContain('.hud-lower')
    expect(css).toContain('grid-template-columns: clamp(280px, 22vw, 340px) minmax(0, 1fr) 280px')
    expect(css).toContain('.hud-lower-crumb')
    expect(css).toContain('.hud-overview')
    expect(css).toContain('.hud-drawer')
    expect(css).toContain('--lens-h: var(--lens-h-user, calc(100vh - var(--menu-h) - var(--transport-h)))')
    expect(css).toContain('.hud-dock[hidden]')
  })

  it('paints the scrolled menu past the bow and keeps a virtual row gap out of the way', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.stage.is-scrolled .hud-menu::before')
    expect(css).toMatch(/\.stage\.is-scrolled \.hud-menu::before \{[^}]*bottom: calc\(-1 \* var\(--lens-bow, 28px\)\);[^}]*z-index: -1;[^}]*pointer-events: none;/)
    expect(css).toMatch(/\.hud-lower \{[^}]*padding-top: var\(--lens-bow, 28px\);/)
    expect(css).toContain('.mr-card-gap + .mr-item')
    expect(css).toContain('.mr-card-gap {')
  })

  it('narrows the right column below 1100 pixels and keeps a log path whole', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('@media (min-width: 900px) and (max-width: 1099px)')
    expect(css).toContain(
      'grid-template-columns: clamp(280px, 22vw, 340px) minmax(0, 1fr) clamp(200px, calc(40vw - 160px), 280px)'
    )
    expect(css).toMatch(
      /@media \(min-width: 900px\) \{\s+\.log-agent \{\s+width: calc\(var\(--space\) \* 12\);\s+\}\s+\.log-text \{\s+overflow-wrap: anywhere;\s+word-break: normal;\s+\}/
    )
    expect(css).toMatch(/\.log-text \{[^}]*word-break: break-word;/)
  })
})
