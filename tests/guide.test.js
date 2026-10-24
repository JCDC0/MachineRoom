import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import Guide from '../src/ui/Guide.jsx'
import Hud from '../src/ui/Hud.jsx'
import {
  CONFIRM_SELECTOR,
  GUIDE_FLAG,
  GUIDE_STEPS,
  clampStep,
  confirmCardOpen,
  guideCanOpen,
  guideSeen,
  markGuideSeen,
  shouldShowGuide,
} from '../src/ui/guide.js'

const realWindow = globalThis.window

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

function fakeDocument(result) {
  return {
    querySelector: (selector) => (selector === CONFIRM_SELECTOR ? result : null),
  }
}

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  agents: [],
  log: [],
}

afterEach(() => {
  if (realWindow === undefined) delete globalThis.window
  else globalThis.window = realWindow
})

describe('guide steps', () => {
  it('holds five short steps, each with a label and one sentence', () => {
    expect(GUIDE_STEPS).toHaveLength(5)
    expect(GUIDE_STEPS.map((step) => step.label)).toEqual([
      'The lens',
      'The dock',
      'The tunnel',
      'The chat',
      'The keys',
    ])
    for (const step of GUIDE_STEPS) {
      expect(step.text.endsWith('.')).toBe(true)
      expect(step.text.split('.').length - 1).toBe(1)
      expect(step.text.length).toBeGreaterThan(20)
      expect(step.text.length).toBeLessThan(180)
    }
  })

  it('names the lens, the dock, the tunnel and colours, the chat and the keys', () => {
    expect(GUIDE_STEPS[0].text).toContain('room sits in the lens at the top')
    expect(GUIDE_STEPS[0].text).toContain('project name is at its top left')
    expect(GUIDE_STEPS[0].text).toContain('folder cards')

    expect(GUIDE_STEPS[1].text).toContain('dock below has three columns')
    expect(GUIDE_STEPS[1].text).toContain('agent list on the left')
    expect(GUIDE_STEPS[1].text).toContain("selected agent's context in the middle")
    expect(GUIDE_STEPS[1].text).toContain('settings and costs on the right')

    expect(GUIDE_STEPS[2].text).toContain('yellow tunnel')
    expect(GUIDE_STEPS[2].text).toContain('packets run along it')
    expect(GUIDE_STEPS[2].text).toContain('white is a read or write')
    expect(GUIDE_STEPS[2].text).toContain('green is finished')
    expect(GUIDE_STEPS[2].text).toContain('red is a failure')

    expect(GUIDE_STEPS[3].text).toContain('chat sits at the bottom right')
    expect(GUIDE_STEPS[3].text).toContain('click ORCHESTRATOR')
    expect(GUIDE_STEPS[3].text).toContain('Attach adds a sub orchestrator')
    expect(GUIDE_STEPS[3].text).toContain('tabs switch between them')

    expect(GUIDE_STEPS[4].text).toContain('C opens the control drawer')
    expect(GUIDE_STEPS[4].text).toContain('L the event log')
    expect(GUIDE_STEPS[4].text).toContain('? lists every key')
  })

  it('clamps a step number to the list', () => {
    expect(clampStep(-1)).toBe(0)
    expect(clampStep(0)).toBe(0)
    expect(clampStep(4)).toBe(4)
    expect(clampStep(5)).toBe(4)
    expect(clampStep(99)).toBe(4)
    expect(clampStep(1.5)).toBe(0)
    expect(clampStep('2')).toBe(0)
    expect(clampStep(undefined)).toBe(0)
  })
})

describe('first visit', () => {
  it('shows the guide while the flag is missing', () => {
    const storage = memoryStorage()
    expect(guideSeen(storage)).toBe(false)
    expect(shouldShowGuide(storage)).toBe(true)
  })

  it('hides the guide after it was seen', () => {
    const storage = memoryStorage()
    expect(markGuideSeen(storage)).toBe(true)
    expect(storage.values.get(GUIDE_FLAG)).toBe('1')
    expect(guideSeen(storage)).toBe(true)
    expect(shouldShowGuide(storage)).toBe(false)
  })

  it('reads a stored flag', () => {
    const storage = memoryStorage({ [GUIDE_FLAG]: '1' })
    expect(shouldShowGuide(storage)).toBe(false)
  })

  it('shows the guide when there is no storage', () => {
    expect(shouldShowGuide(null)).toBe(true)
    expect(() => markGuideSeen(null)).not.toThrow()
  })

  it('shows the guide every time when the storage throws', () => {
    const blocked = {
      getItem() {
        throw new Error('storage is blocked')
      },
      setItem() {
        throw new Error('storage is blocked')
      },
    }
    expect(() => shouldShowGuide(blocked)).not.toThrow()
    expect(shouldShowGuide(blocked)).toBe(true)
    expect(() => markGuideSeen(blocked)).not.toThrow()
    expect(markGuideSeen(blocked)).toBe(false)
    expect(shouldShowGuide(blocked)).toBe(true)
  })

  it('shows the guide when localStorage throws on access', () => {
    globalThis.window = {
      get localStorage() {
        throw new Error('storage is blocked')
      },
    }
    expect(() => shouldShowGuide()).not.toThrow()
    expect(shouldShowGuide()).toBe(true)
    expect(() => markGuideSeen()).not.toThrow()
    expect(markGuideSeen()).toBe(false)
  })
})

describe('confirm cards', () => {
  it('stays closed while a confirm card is on the page', () => {
    const doc = fakeDocument({})
    expect(confirmCardOpen(doc)).toBe(true)
    expect(guideCanOpen(doc)).toBe(false)
  })

  it('may open when no confirm card is on the page', () => {
    const doc = fakeDocument(null)
    expect(confirmCardOpen(doc)).toBe(false)
    expect(guideCanOpen(doc)).toBe(true)
  })

  it('asks for every confirm card class', () => {
    expect(CONFIRM_SELECTOR).toContain('.brief-confirm-card')
    expect(CONFIRM_SELECTOR).toContain('.backup-confirm-card')
    expect(CONFIRM_SELECTOR).toContain('.mr-orch-confirm')
    expect(CONFIRM_SELECTOR).toContain('.mr-assistant-btn-confirm')
  })

  it('treats a missing or broken document as no confirm card', () => {
    expect(confirmCardOpen(null)).toBe(false)
    expect(guideCanOpen(undefined)).toBe(true)
    const broken = {
      querySelector() {
        throw new Error('no document')
      },
    }
    expect(() => confirmCardOpen(broken)).not.toThrow()
    expect(confirmCardOpen(broken)).toBe(false)
  })
})

describe('Guide card', () => {
  it('shows the first step with Next and Skip', () => {
    const html = renderToString(createElement(Guide, { initialStep: 0 }))
    expect(html).toContain('class="mr-guide-backdrop"')
    expect(html).toContain('class="mr-guide"')
    expect(html).toContain('The lens')
    expect(html).toContain('The room sits in the lens at the top')
    expect(html).toContain('1 / 5')
    expect(html).toContain('>Skip</button>')
    expect(html).toContain('>Next</button>')
    expect(html).toContain('class="mr-guide-dots"')
    expect(html.match(/class="mr-guide-dot"/g)).toHaveLength(4)
    expect(html).toContain('mr-guide-dot is-current')
  })

  it('shows Done on the last step', () => {
    const html = renderToString(createElement(Guide, { initialStep: 4 }))
    expect(html).toContain('The keys')
    expect(html).toContain('5 / 5')
    expect(html).toContain('>Done</button>')
    expect(html).not.toContain('>Next</button>')
  })

  it('keeps a step out of range on the last step', () => {
    const html = renderToString(createElement(Guide, { initialStep: 99 }))
    expect(html).toContain('5 / 5')
    expect(html).toContain('>Done</button>')
  })
})

describe('HUD entry points', () => {
  it('offers the Guide button in the help panel', () => {
    const html = renderToString(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1], helpOpen: true }))
    expect(html).toContain('id="hud-help-dialog"')
    expect(html).toContain('>Guide</button>')
    expect(html).toContain('>Close</button>')
  })

  it('has the line from an agent in the legend', () => {
    const html = renderToString(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1] }))
    expect(html).toContain('Line from an agent: the file it is working on')
    expect(html).toContain('class="is-line"')
  })
})
