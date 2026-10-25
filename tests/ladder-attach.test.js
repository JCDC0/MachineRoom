import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LadderAttach from '../src/ui/LadderAttach.jsx'

const LIST = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    state: 'idle',
    lanes: ['opencode', 'opencode4'],
    scope: [],
    restricted: false,
    setBy: 'owner',
  },
  {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    state: 'idle',
    lanes: ['opencode2'],
    scope: ['src/ui/**'],
    restricted: true,
    setBy: 'owner',
  },
]

const client = {
  orchestrators: async () => LIST,
  setLadder: async (ladder) => ({ ladder }),
  subscribe: () => () => {},
}

describe('LadderAttach', () => {
  it('stays out when the bridge cannot set a ladder', () => {
    expect(renderToString(createElement(LadderAttach, { client: null }))).toBe('')
    expect(
      renderToString(createElement(LadderAttach, { client: { orchestrators: async () => LIST } }))
    ).toBe('')
  })

  it('lists each sub with its Detach and the Attach button', () => {
    const html = renderToString(
      createElement(LadderAttach, { client, initialList: LIST })
    )
    expect(html).toContain('aria-label="Sub orchestrators"')
    expect(html).toContain('>Sub orchestrators</span>')
    expect(html).toContain('>Frontend</span>')
    expect(html).toContain('aria-label="Detach Frontend"')
    expect(html).not.toContain('aria-label="Detach Orchestrator"')
    expect(html).toContain('>Attach</button>')
    expect(html).not.toContain('No sub orchestrators yet.')
  })

  it('draws the attach form with free lanes, scope and Restricted on', () => {
    const html = renderToString(
      createElement(LadderAttach, {
        client,
        initialList: LIST,
        initialForm: {
          name: 'Bridge',
          id: 'bridge',
          harness: 'claude',
          model: 'sonnet',
          lanes: ['opencode'],
          scope: 'server/**',
          restricted: true,
        },
      })
    )
    expect(html).toContain('aria-label="Attach a sub orchestrator"')
    expect(html).toContain('>Name</span>')
    expect(html).toContain('>Id</span>')
    expect(html).toContain('>Harness</span>')
    expect(html).toContain('>Model</span>')
    expect(html).toContain('>Lanes</legend>')
    expect(html).toContain('>opencode</span>')
    expect(html).toContain('>opencode4</span>')
    expect(html).not.toContain('>opencode2</span>')
    expect(html).toContain('>Scope, one glob per line</span>')
    expect(html).toContain('>Restricted</span>')
    expect(html).toContain('>Review</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('checked=""')
  })
})
