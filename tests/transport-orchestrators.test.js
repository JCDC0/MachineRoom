import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Transport, { OrchestratorsContext } from '../src/ui/Transport.jsx'
import {
  OPEN_CHAT_EVENT,
  TRANSPORT_CHIP_LIMIT,
  chipTone,
  orchestratorAnswerList,
  orchestratorChips,
} from '../src/ui/transportOrchestrators.js'

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
      { id: 'frontend', name: 'Frontend', tone: 'working' },
      { id: 'backend', name: 'Backend', tone: 'idle' },
    ])
    expect(more).toBe(0)
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
    expect(TRANSPORT_CHIP_LIMIT).toBe(4)
  })

  it('shows four chips and counts the rest', () => {
    const list = [
      MAIN,
      sub('one', 'One'),
      sub('two', 'Two'),
      sub('three', 'Three'),
      sub('four', 'Four'),
      sub('five', 'Five'),
      sub('six', 'Six'),
    ]
    const { chips, more } = orchestratorChips(list)
    expect(chips.map((chip) => chip.id)).toEqual(['one', 'two', 'three', 'four'])
    expect(more).toBe(2)
    expect(orchestratorChips(list, 2)).toEqual({ chips: [
      { id: 'one', name: 'One', tone: 'idle' },
      { id: 'two', name: 'Two', tone: 'idle' },
    ], more: 4 })
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

describe('the transport chips', () => {
  it('shows a chip per sub after the main state word', () => {
    const html = renderTransport([MAIN, sub('frontend', 'Frontend', 'working'), sub('backend', 'Backend', 'paused')])
    expect(html).toContain('class="transport-orchestrators"')
    expect(html.indexOf('transport-orchestrator-state')).toBeLessThan(html.indexOf('transport-chip'))
    expect(html).toContain('class="transport-chip is-working mono"')
    expect(html).toContain('class="transport-chip is-paused mono"')
    expect(html).toContain('>Frontend<')
    expect(html).toContain('>Backend<')
    expect(html).not.toContain('transport-chip-overflow')
  })

  it('shows +N after four chips', () => {
    const list = [MAIN, sub('one', 'One'), sub('two', 'Two'), sub('three', 'Three'), sub('four', 'Four'), sub('five', 'Five')]
    const html = renderTransport(list)
    expect(html.match(/class="transport-chip /g)).toHaveLength(4)
    expect(html).toContain('class="transport-chip-overflow mono"')
    expect(html).toContain('title="1 more"')
    expect(html).not.toContain('>Five<')
  })

  it('shows no chips for a replay or with no sub', () => {
    expect(renderTransport([MAIN])).not.toContain('transport-chip')
    const replay = renderToString(
      createElement(Transport, {
        snapshot: { position: 12.5, duration: 60, playing: false, speed: 1 },
        speeds: [1],
      })
    )
    expect(replay).not.toContain('transport-chip')
    expect(OPEN_CHAT_EVENT).toBe('machineroom:open-chat')
  })
})
