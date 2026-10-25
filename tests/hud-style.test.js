import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AgentStrip from '../src/ui/AgentStrip.jsx'
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

  it('renders the compact strip with the identity, context and three log lines', () => {
    const agents = [
      { key: 'orchestrator', name: 'Orchestrator', status: 'working', harness: 'claude', model: 'opus' },
      { key: 'opencode', name: 'OpenCode', status: 'idle', adapterType: 'opencode_local', model: 'flash' },
    ]
    const log = [
      { agent: 'orchestrator', text: 'read a.js', tone: 'normal' },
      { agent: 'orchestrator', text: 'write b.js', tone: 'normal' },
      { agent: 'orchestrator', text: 'failed c.js', tone: 'error' },
      { agent: 'orchestrator', text: 'read d.js', tone: 'done' },
    ]
    const html = renderToString(
      createElement(AgentStrip, {
        lanes: agents,
        log,
        orchestrator: {
          id: 'orchestrator',
          model: 'opus',
          harness: 'claude',
          contextTokens: 96000,
          contextWindow: 200000,
          autocompact: true,
          autocompactPercent: 70,
        },
        client: {},
      })
    )

    expect(html).toContain('class="hud-strip is-closed"')
    expect(html).toContain('strip-dot is-working')
    expect(html).toContain('strip-name-text">Orchestrator')
    expect(html).toContain('Model:')
    expect(html).toContain('Context size 96.0k / 200.0k')
    expect(html).toContain('Compact')
    expect(html).toContain('Settings')
    expect(html).toContain('&gt; write b.js')
    expect(html).toContain('&gt; failed c.js')
    expect(html).toContain('read d.js')
    expect(html).not.toContain('read a.js')
    expect((html.match(/strip-log-line/g) ?? []).length).toBe(3)
    expect(html).toContain('Expand')
  })

  it('renders the lane tokens and cost in the strip instead of the context line', () => {
    const html = renderToString(
      createElement(AgentStrip, {
        agent: 'opencode',
        lanes: [
          { key: 'orchestrator', name: 'Orchestrator', status: 'idle' },
          { key: 'opencode', name: 'OpenCode', status: 'working', adapterType: 'opencode_local', model: 'flash' },
        ],
        costs: {
          rows: [
            {
              key: 'opencode',
              agentId: 'agent-opencode',
              costCents: 143,
              inputTokens: 214000,
              outputTokens: 31000,
              reported: true,
            },
          ],
        },
        client: {},
        dockOpen: true,
      })
    )

    expect(html).toContain('class="hud-strip is-open"')
    expect(html).toContain('Tokens 214.0k in / 31.0k out, $1.43 this month')
    expect(html).not.toContain('Context size')
    expect(html).not.toContain('Compact')
    expect(html).toContain('Close')
  })

  it('shows the strip and hides the dock at 900 pixels wide', () => {
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
      expect(html).toContain('class="hud-strip is-closed"')
      expect(html).toContain('class="hud-dock"')
      expect(html).toMatch(/class="hud-dock"[^>]*hidden/)

      savedSettings = JSON.stringify({ dockOpen: true })
      const open = renderToString(
        createElement(Hud, {
          mode: 'replay',
          snapshot: SAMPLE_SNAPSHOT,
          speeds: [1, 2, 4],
        })
      )
      expect(open).toContain('class="hud-strip is-open"')
      expect(open).not.toMatch(/class="hud-dock"[^>]*hidden/)
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
      expect(html).toContain('hud-band-v mono')
      expect(html).toContain('hud-band-title">Main')
      expect(html).toContain('aria-label="Orchestrator conversations, showing Main"')
      expect(html).not.toContain('class="hud-header-strip"')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('defines the lens brackets and the waiting card inside the lens in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.hud-band-project')
    expect(css).toContain('.lens-corner.is-center')
    expect(css).toContain('.lens-clock')
    expect(css).toContain('.lens-brackets')
    expect(css).toContain('.lens-mark.is-top-left')
    expect(css).toContain('.lens-mark.is-bottom-right')
    expect(css).toContain('border-color: rgb(255 255 255 / 0.3)')
    expect(css).toMatch(/@media \(min-width: 900px\) \{\n  \.waiting \{/)
  })

  it('defines corner ticks, 0.04em title spacing, and faint red scanlines in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('--corner-ticks:')
    expect(css).toContain('--scanlines-red:')
    expect(css).toContain('letter-spacing: 0.04em;')
    expect(css).toContain('.mr-item.is-failed')
    expect(css).toContain('.mr-card.is-flash-red .mr-card-face')
    expect(css).toContain('.stage:has(.hud-strip.is-closed)')
    expect(css).toContain('--strip-h: 72px')
    expect(css).toContain('.hud-dock[hidden]')
  })
})
