import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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

  it('defines corner ticks, 0.04em title spacing, and faint red scanlines in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('--corner-ticks:')
    expect(css).toContain('--scanlines-red:')
    expect(css).toContain('letter-spacing: 0.04em;')
    expect(css).toContain('.mr-item.is-failed')
    expect(css).toContain('.mr-card.is-flash-red .mr-card-face')
  })
})
