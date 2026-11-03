import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SetupCard from '../src/ui/SetupCard.jsx'
import {
  SETUP_DEFAULT_COUNT,
  SETUP_LATER,
  SETUP_QUESTION,
  SETUP_START,
  clampAgentCount,
  initialAgentCount,
  laneKeys,
  pickedLanes,
  postponeSetup,
  resetSetupPostponed,
  setupCountLabel,
  setupFromAnswer,
  setupNeeded,
  setupPostponed,
  setupSavePayload,
} from '../src/ui/setup.js'
import { buttonWithText, withDom } from './helpers/uiDom.js'

const LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'model-a', active: true },
  { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'model-b', active: true },
  { key: 'claude', name: 'Claude', harness: 'claude', model: 'model-c', active: true },
  { key: 'hermes', name: 'Hermes', harness: 'hermes', model: 'model-d', active: true },
]

const ANSWER = { lanes: LANES, max: 4, chosen: false }

beforeEach(() => {
  resetSetupPostponed()
})

afterEach(() => {
  resetSetupPostponed()
})

describe('setup helpers', () => {
  it('asks the one question and starts at SETUP_DEFAULT_COUNT', () => {
    expect(SETUP_QUESTION).toBe('How many agents should work on this project?')
    expect(SETUP_START).toBe('Start')
    expect(SETUP_LATER).toBe('Later')
    expect(initialAgentCount(6)).toBe(SETUP_DEFAULT_COUNT)
    expect(initialAgentCount(1)).toBe(1)
    expect(initialAgentCount(0)).toBe(0)
  })

  it('clamps the count to the lanes', () => {
    expect(clampAgentCount(0, 4)).toBe(1)
    expect(clampAgentCount(1, 4)).toBe(1)
    expect(clampAgentCount(3, 4)).toBe(3)
    expect(clampAgentCount(4, 4)).toBe(4)
    expect(clampAgentCount(9, 4)).toBe(4)
    expect(clampAgentCount(2, 0)).toBe(0)
    expect(clampAgentCount('3', 4)).toBe(3)
    expect(clampAgentCount(undefined, 4)).toBe(SETUP_DEFAULT_COUNT)
  })

  it('normalises the lanes answer and needs a choice only when chosen is false', () => {
    expect(setupFromAnswer(null)).toBeNull()
    expect(setupFromAnswer('lanes')).toBeNull()
    expect(setupFromAnswer({ lanes: LANES, max: 4, chosen: false })).toEqual({
      lanes: LANES,
      max: 4,
      chosen: false,
    })
    expect(setupFromAnswer({ lanes: LANES, chosen: false }).max).toBe(4)
    expect(setupFromAnswer({ lanes: [null, {}, { key: '  ' }], max: 3 }).lanes).toEqual([])
    expect(setupNeeded(ANSWER)).toBe(true)
    expect(setupNeeded({ ...ANSWER, chosen: true })).toBe(false)
    expect(setupNeeded({ ...ANSWER, lanes: [] })).toBe(false)
    expect(setupNeeded({ ...ANSWER, max: 0 })).toBe(false)
    expect(setupNeeded(null)).toBe(false)
  })

  it('picks the lanes in the order the answer lists them', () => {
    expect(pickedLanes(LANES, 2).map((lane) => lane.key)).toEqual(['opencode', 'opencode2'])
    expect(pickedLanes(LANES, 4).map((lane) => lane.key)).toEqual([
      'opencode',
      'opencode2',
      'claude',
      'hermes',
    ])
    expect(pickedLanes(LANES, 0)).toEqual([])
    expect(pickedLanes(LANES, 9)).toHaveLength(4)
    expect(pickedLanes(null, 2)).toEqual([])
  })

  it('builds the save payload from the picked keys and Start is the confirm', () => {
    expect(setupSavePayload(LANES, 2)).toEqual({
      lanes: ['opencode', 'opencode2'],
      confirmed: true,
    })
    expect(setupSavePayload(LANES, 0)).toEqual({ lanes: [], confirmed: true })
    expect(laneKeys([null, { key: ' a ' }, { key: '' }, { key: 'b' }])).toEqual(['a', 'b'])
  })

  it('labels the count in plain words', () => {
    expect(setupCountLabel(1)).toBe('1 agent')
    expect(setupCountLabel(2)).toBe('2 agents')
    expect(setupCountLabel(0)).toBe('0 agents')
  })

  it('remembers Later for this visit only', () => {
    expect(setupPostponed()).toBe(false)
    expect(postponeSetup()).toBe(true)
    expect(setupPostponed()).toBe(true)
    resetSetupPostponed()
    expect(setupPostponed()).toBe(false)
  })
})

describe('SetupCard', () => {
  it('asks the question and lists the lanes the count picks', () => {
    const html = renderToString(createElement(SetupCard, { answer: ANSWER }))
    expect(html).toContain('class="mr-setup"')
    expect(html).toContain(SETUP_QUESTION)
    expect(html).toContain('2 agents')
    expect(html).toContain('OpenCode')
    expect(html).toContain('OpenCode 2')
    expect(html).not.toContain('Claude')
    expect(html).toContain(`>${SETUP_LATER}</button>`)
    expect(html).toContain(`>${SETUP_START}</button>`)
  })

  it('stays closed when the owner already chose or the bridge has no lanes', () => {
    expect(renderToString(createElement(SetupCard, { answer: { ...ANSWER, chosen: true } }))).toBe('')
    expect(renderToString(createElement(SetupCard, { answer: null }))).toBe('')
    expect(renderToString(createElement(SetupCard, {}))).toBe('')
  })

  it('steps the count and the picked lanes up and down', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(SetupCard, { answer: ANSWER }))
      })
      expect(container.textContent).toContain('2 agents')
      expect(container.textContent).not.toContain('Claude')

      const more = container.querySelectorAll('button').find((button) => button.textContent.trim() === '+')
      expect(more).not.toBeNull()
      await act(async () => {
        more.click()
      })
      expect(container.textContent).toContain('3 agents')
      expect(container.textContent).toContain('Claude')

      const fewer = container.querySelectorAll('button').find((button) => button.textContent.trim() === '-')
      await act(async () => {
        fewer.click()
      })
      await act(async () => {
        fewer.click()
      })
      expect(container.textContent).toContain('1 agent')
      expect(container.textContent).toContain('OpenCode')
      expect(container.textContent).not.toContain('OpenCode 2')
      expect(fewer.getAttribute('disabled')).not.toBeNull()
    })
  })

  it('saves the picked lanes from Start with no second confirm', async () => {
    const calls = []
    let closed = 0
    const client = {
      lanes: async () => ANSWER,
      setActiveLanes: async (payload) => {
        calls.push(payload)
        return { ok: true }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(SetupCard, { client, onClose: () => { closed += 1 } }))
      })
      await act(async () => {})
      expect(container.textContent).toContain(SETUP_QUESTION)
      const more = buttonWithText(container, '+')
      await act(async () => {
        more.click()
      })
      const start = buttonWithText(container, SETUP_START)
      expect(start).not.toBeNull()
      await act(async () => {
        start.click()
      })
      expect(calls).toEqual([{ lanes: ['opencode', 'opencode2', 'claude'], confirmed: true }])
      expect(closed).toBe(1)
      expect(container.textContent).not.toContain(SETUP_QUESTION)
    })
  })

  it('closes from Later without saving and stays closed for this visit', async () => {
    let saved = 0
    let closed = 0
    const client = {
      lanes: async () => ANSWER,
      setActiveLanes: async () => {
        saved += 1
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(SetupCard, { client, onClose: () => { closed += 1 } }))
      })
      await act(async () => {})
      const later = buttonWithText(container, SETUP_LATER)
      await act(async () => {
        later.click()
      })
      expect(closed).toBe(1)
      expect(saved).toBe(0)
      expect(container.textContent).not.toContain(SETUP_QUESTION)
      await act(async () => {
        root.render(createElement(SetupCard, { client, onClose: () => { closed += 1 } }))
      })
      await act(async () => {})
      expect(container.textContent).not.toContain(SETUP_QUESTION)
    })
  })

  it('shows the bridge message and keeps the card when the save fails', async () => {
    const client = {
      lanes: async () => ANSWER,
      setActiveLanes: async () => {
        throw new Error('The lane list is empty.')
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(SetupCard, { client }))
      })
      await act(async () => {})
      const start = buttonWithText(container, SETUP_START)
      await act(async () => {
        start.click()
      })
      expect(container.textContent).toContain('The lane list is empty.')
      expect(container.textContent).toContain(SETUP_QUESTION)
    })
  })

  it('says so when the bridge cannot save a choice', async () => {
    const client = { lanes: async () => ANSWER }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(SetupCard, { client }))
      })
      await act(async () => {})
      expect(container.textContent).toContain('Saving agents is not available from this bridge.')
      const start = buttonWithText(container, SETUP_START)
      expect(start).not.toBeNull()
      expect(start.getAttribute('disabled')).not.toBeNull()
    })
  })
})
