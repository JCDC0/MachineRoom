import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import ControlDrawer from '../src/ui/panels/ControlDrawer.jsx'
import PanelBoundary, { panelStoppedText } from '../src/ui/panels/PanelBoundary.jsx'

const TAIL = 'Pick another tab, then come back.'

const TAB_IDS = ['dispatch', 'tasks', 'approvals', 'meters', 'agents', 'reviews']
const LOADING_TEXT = {
  dispatch: 'Loading dispatch options...',
  tasks: 'Loading tasks...',
  approvals: 'Loading approvals...',
  meters: 'Loading meters...',
  agents: 'Loading agents...',
  reviews: 'Loading reviews...',
}

describe('panelStoppedText', () => {
  it('names the error message', () => {
    expect(panelStoppedText(new Error('A comment body was an object'))).toBe(
      `This panel stopped: A comment body was an object. ${TAIL}`
    )
  })

  it('cuts a long message to 120 characters', () => {
    const message = 'x'.repeat(150)
    expect(panelStoppedText(new Error(message))).toBe(
      `This panel stopped: ${'x'.repeat(120)}. ${TAIL}`
    )
  })

  it('says no message when there is no error', () => {
    expect(panelStoppedText(null)).toBe(`This panel stopped: no message. ${TAIL}`)
    expect(panelStoppedText(undefined)).toBe(`This panel stopped: no message. ${TAIL}`)
    expect(panelStoppedText(new Error(''))).toBe(`This panel stopped: no message. ${TAIL}`)
  })
})

describe('PanelBoundary', () => {
  it('answers the thrown error as its state', () => {
    const error = new Error('The issue list was not a list')
    expect(PanelBoundary.getDerivedStateFromError(error)).toEqual({ error })
  })

  it('renders the stopped sentence in the error style', () => {
    const boundary = new PanelBoundary({ children: null })
    boundary.state = PanelBoundary.getDerivedStateFromError(new Error('The issue list was not a list'))
    const html = renderToString(boundary.render())
    expect(html).toContain('class="panel-boundary-message"')
    expect(html).toContain('role="alert"')
    expect(html).toContain(`This panel stopped: The issue list was not a list. ${TAIL}`)
  })
})

describe('ControlDrawer panels', () => {
  it('renders every tab with the mock client and no fallback', () => {
    const client = createMockClient({ latencyMs: 0 })
    for (const tab of TAB_IDS) {
      const html = renderToString(
        createElement(ControlDrawer, {
          client,
          open: true,
          activeTab: tab,
        })
      )
      expect(html, tab).toContain(`id="tab-${tab}"`)
      expect(html, tab).toContain(`aria-controls="panel-${tab}"`)
      expect(html, tab).toContain(`id="panel-${tab}"`)
      expect(html, tab).toContain(LOADING_TEXT[tab])
      expect(html, tab).not.toContain('panel-boundary-message')
    }
  })
})
