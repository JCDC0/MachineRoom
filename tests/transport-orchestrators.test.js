import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Transport, { LanePillsContext, OrchestratorsContext } from '../src/ui/Transport.jsx'
import {
  OPEN_CHAT_EVENT,
  TRANSPORT_CHIP_LIMIT,
  chipTone,
  orchestratorAnswerList,
  orchestratorChips,
} from '../src/ui/transportOrchestrators.js'

import { withDom } from './helpers/uiDom.js'

const LIVE = { live: true, position: 65000, duration: 0, playing: true, speed: 1 }
const MAIN = { id: 'orchestrator', name: 'Orchestrator', state: 'working' }

function sub(id, name, state = 'idle') {
  return { id, name, state }
}

function renderTransport(orchestrators) {
  return renderToString(
    createElement(
      OrchestratorsContext.Provider,
      { value: orchestrators },
      createElement(Transport, { snapshot: LIVE, speeds: [1], orchestrator: MAIN })
    )
  )
}

describe('the transport chip list', () => {
  it('keeps the subs in order and leaves the main orchestrator out', () => {
    const { chips, more } = orchestratorChips([
      MAIN,
      sub('frontend', 'Frontend', 'working'),
      sub('backend', 'Backend', 'idle'),
    ])
    expect(chips).toEqual([
      { id: 'frontend', name: 'Frontend', tone: 'working', waiting: false },
      { id: 'backend', name: 'Backend', tone: 'idle', waiting: false },
    ])
    expect(more).toBe(0)
  })

  it('marks a sub with a waiting approval and keeps its tone', () => {
    const { chips } = orchestratorChips([
      MAIN,
      { ...sub('frontend', 'Frontend', 'working'), approvals: [{ approvalId: 'a1' }] },
      sub('backend', 'Backend', 'idle'),
    ])
    expect(chips.map((chip) => chip.waiting)).toEqual([true, false])
    expect(chips[0].tone).toBe('working')
  })

  it('names a sub by its id when it has no name', () => {
    const { chips } = orchestratorChips([{ id: 'frontend', state: 'working' }, { id: 'backend', name: '  ' }])
    expect(chips.map((chip) => chip.name)).toEqual(['frontend', 'backend'])
  })

  it('maps working to yellow, idle to dim and paused or failed to red', () => {
    expect(chipTone('working')).toBe('working')
    expect(chipTone('idle')).toBe('idle')
    expect(chipTone(undefined)).toBe('idle')
    expect(chipTone('queued')).toBe('idle')
    expect(chipTone('paused')).toBe('paused')
    expect(chipTone('failed')).toBe('failed')
    expect(chipTone('error')).toBe('failed')
  })

  it('shows TRANSPORT_CHIP_LIMIT chips and counts the rest', () => {
    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six']
    const list = [MAIN, ...names.map((name) => sub(name.toLowerCase(), name))]
    const { chips, more } = orchestratorChips(list)
    expect(chips.map((chip) => chip.id)).toEqual(names.slice(0, TRANSPORT_CHIP_LIMIT).map((name) => name.toLowerCase()))
    expect(more).toBe(names.length - TRANSPORT_CHIP_LIMIT)
    expect(orchestratorChips(list, 2)).toEqual({ chips: [
      { id: 'one', name: 'One', tone: 'idle', waiting: false },
      { id: 'two', name: 'Two', tone: 'idle', waiting: false },
    ], more: names.length - 2 })
  })

  it('leaves the list it reads as it was', () => {
    const list = [MAIN, sub('frontend', 'Frontend', 'working')]
    const copy = JSON.parse(JSON.stringify(list))
    orchestratorChips(list)
    expect(list).toEqual(copy)
  })

  it('reads either answer shape and drops entries with no id', () => {
    const items = [MAIN, { id: '' }, null, 'frontend', { name: 'No id' }, sub('backend', 'Backend')]
    expect(orchestratorAnswerList(items)).toEqual([MAIN, sub('backend', 'Backend')])
    expect(orchestratorAnswerList({ orchestrators: items })).toEqual([MAIN, sub('backend', 'Backend')])
    expect(orchestratorAnswerList(null)).toEqual([])
    expect(orchestratorAnswerList('orchestrator')).toEqual([])
  })
})

describe('the transport agent list', () => {
  it('shows state classes and end ages in the rows', async () => {
    await withDom(async ({ container, root }) => {
      const agents = ['working', 'failed', 'finished', 'idle'].map((key) => ({ id: key, key, name: key, adapterType: 'opencode_local', role: null }))
      const feed = { agents, now: 200000000, liveRuns: [{ agentId: 'working', status: 'running', startedAt: 199700000 }], records: { last: [{ lane: 'failed', startedAt: 1000, finishedAt: 199700000, exitCode: 1 }, { lane: 'finished', startedAt: 1000, finishedAt: 189200000, exitCode: 0 }] } }
      const subs = [MAIN, { ...sub('waiting', 'Waiting', 'working'), approvals: [{}] }]
      await act(async () => root.render(createElement(OrchestratorsContext.Provider, { value: subs }, createElement(LanePillsContext.Provider, { value: feed }, createElement(Transport, { snapshot: LIVE, speeds: [1], orchestrator: MAIN })))))
      await act(async () => container.querySelector('.transport-agents-toggle').click())
      const rows = [...container.querySelectorAll('.transport-agent')]
      expect(rows.map((row) => row.querySelector('.transport-agent-state').className)).toEqual(['transport-agent-state is-waiting', 'transport-agent-state is-working', 'transport-agent-state is-failed'])
      expect(rows[2].querySelectorAll('span')[3].textContent).toBe('5 min')
    })
  })

  it('summarizes every sub and approval without showing old chips', () => {
    const list = [MAIN, ...Array.from({ length: 6 }, (_, i) => sub(String(i), `Sub ${i}`, 'working'))]
    list[1].approvals = [{}]
    const html = renderTransport(list)
    expect(html).toContain('Agents · 6 working')
    expect(html).toContain('1<!-- --> waiting')
    expect(html).not.toContain('transport-chip')
    expect(html).not.toContain('transport-orchestrator-state')
  })

  it('opens complete rows, dispatches their actions, and closes on Escape or outside', async () => {
    await withDom(async ({ container, root, dom, window }) => {
      const events = []
      window.addEventListener('machineroom:open-chat', (event) => events.push(event.detail))
      window.addEventListener('machineroom:inspect', (event) => events.push(event.detail))
      const subs = [MAIN, sub('sub-one', 'A long sub name', 'working')]
      const feed = { agents: [{ id: 'a', key: 'lane', name: 'A long lane name', adapterType: 'opencode_local', role: null }], liveRuns: [{ agentId: 'a', status: 'running', issueId: 'issue', startedAt: 1000 }], issues: [{ id: 'issue', identifier: 'A-very-long-task-identifier' }], now: 721000 }
      await act(async () => root.render(createElement(OrchestratorsContext.Provider, { value: subs }, createElement(LanePillsContext.Provider, { value: feed }, createElement(Transport, { snapshot: { ...LIVE, status: 'live' }, speeds: [1], orchestrator: MAIN })))))
      const toggle = container.querySelector('.transport-agents-toggle')
      expect(toggle.textContent).toContain('Agents · 2 working')
      const wrapper = container.querySelector('.transport-agents')
      toggle.getBoundingClientRect = () => ({ top: 700, left: 100, width: 200 })
      window.innerHeight = 800
      const menu = dom.document.createElement('header')
      menu.className = 'hud-menu'
      menu.getBoundingClientRect = () => ({ bottom: 52 })
      dom.document.body.appendChild(menu)
      await act(async () => toggle.click())
      expect(wrapper.style['--agents-list-height']).toBe('632px')
      expect(wrapper.style['--agents-list-bottom']).toBe('108px')
      toggle.getBoundingClientRect = () => ({ top: 500, left: 100, width: 200 })
      await act(async () => window.dispatchEvent({ type: 'resize' }))
      expect(wrapper.style['--agents-list-height']).toBe('432px')
      expect(container.textContent).toContain('A long sub name')
      expect(container.textContent).toContain('A long lane name')
      expect(container.textContent).toContain('A-very-long-task-identifier')
      expect(container.textContent).toContain('12 min')
      let rows = container.querySelectorAll('.transport-agent')
      await act(async () => rows[0].click())
      expect(events[0]).toEqual({ id: 'sub-one' })
      await act(async () => toggle.click())
      rows = container.querySelectorAll('.transport-agent')
      await act(async () => rows[1].click())
      expect(events[1]).toEqual({ kind: 'agent', id: 'lane' })
      await act(async () => toggle.click())
      await act(async () => dom.document.dispatchEvent({ type: 'keydown', key: 'Escape' }))
      expect(container.querySelector('.transport-agents-list')).toBeNull()
      await act(async () => toggle.click())
      await act(async () => dom.document.dispatchEvent({ type: 'pointerdown' }))
      expect(container.querySelector('.transport-agents-list')).toBeNull()
    })
  })

  it('counts a working session reader and lists it before orchestrators and lanes', async () => {
    await withDom(async ({ container, root }) => {
      const label = 'read src/ui/Transport.jsx with extra detail past forty characters'
      const snapshot = {
        ...LIVE,
        status: 'live',
        agents: [{ key: 'claude-session', name: 'Claude Code', status: 'working', label }],
      }
      const subs = [MAIN, sub('sub-one', 'Sub One', 'idle')]
      const feed = {
        agents: [{ id: 'a', key: 'lane', name: 'Lane', adapterType: 'opencode_local', role: null }],
        liveRuns: [{ agentId: 'a', status: 'running', startedAt: 1000 }],
        now: 61000,
      }
      await act(async () =>
        root.render(
          createElement(
            OrchestratorsContext.Provider,
            { value: subs },
            createElement(
              LanePillsContext.Provider,
              { value: feed },
              createElement(Transport, { snapshot, speeds: [1], orchestrator: MAIN })
            )
          )
        )
      )
      const toggle = container.querySelector('.transport-agents-toggle')
      expect(toggle.textContent).toBe('Agents · 2 working')
      await act(async () => toggle.click())
      const rows = [...container.querySelectorAll('.transport-agent')]
      expect(rows).toHaveLength(3)
      expect(rows[0].tagName.toUpperCase()).toBe('DIV')
      expect(rows[1].tagName.toUpperCase()).toBe('BUTTON')
      const spans = [...rows[0].querySelectorAll('span')]
      expect(spans).toHaveLength(4)
      expect(spans[0].textContent).toBe('Claude Code')
      expect(spans[1].className).toBe('transport-agent-state is-working')
      expect(spans[1].textContent).toBe('working')
      expect(spans[2].textContent).toBe(label.slice(0, 40))
      expect(spans[3].textContent).toBe('')
    })
  })

  it('does not count an idle session reader when no lane works', async () => {
    await withDom(async ({ container, root }) => {
      const snapshot = {
        ...LIVE,
        status: 'live',
        agents: [{ key: 'claude-session', name: 'Claude Code', status: 'idle' }],
      }
      const feed = { agents: [], liveRuns: [], issues: [], records: { running: [], recent: [] }, now: 61000 }
      await act(async () =>
        root.render(
          createElement(
            OrchestratorsContext.Provider,
            { value: [MAIN] },
            createElement(
              LanePillsContext.Provider,
              { value: feed },
              createElement(Transport, { snapshot, speeds: [1], orchestrator: MAIN })
            )
          )
        )
      )
      const toggle = container.querySelector('.transport-agents-toggle')
      expect(toggle.textContent).toBe('Agents · none working')
      await act(async () => toggle.click())
      expect(container.querySelectorAll('.transport-agent')).toHaveLength(0)
    })
  })

  it('leaves idle lanes out of the live list and says none working when nothing works', async () => {
    await withDom(async ({ container, root }) => {
      const agents = [{ id: 'idle', key: 'idle', name: 'Idle lane', adapterType: 'opencode_local', role: null }]
      const feed = { agents, liveRuns: [], issues: [], records: { running: [], recent: [] }, now: 200000000 }
      const subs = [MAIN]
      await act(async () => root.render(createElement(OrchestratorsContext.Provider, { value: subs }, createElement(LanePillsContext.Provider, { value: feed }, createElement(Transport, { snapshot: LIVE, speeds: [1], orchestrator: MAIN })))))
      const toggle = container.querySelector('.transport-agents-toggle')
      expect(toggle.textContent).toBe('Agents · none working')
      await act(async () => toggle.click())
      expect(container.querySelectorAll('.transport-agent')).toHaveLength(0)
      expect(container.textContent).not.toContain('Idle lane')
    })
  })
})
