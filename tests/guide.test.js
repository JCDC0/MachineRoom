import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import Connect, { CONNECT_INTRO, TOUR_QUERY } from '../src/ui/Connect.jsx'
import Guide from '../src/ui/Guide.jsx'
import Hud from '../src/ui/Hud.jsx'
import {
  CONFIRM_SELECTOR,
  GUIDE_FLAG,
  GUIDE_STEPS,
  LIVE_TOUR_STEPS,
  TOUR_STEPS,
  availableSteps,
  clampStep,
  confirmCardOpen,
  connectHref,
  findStepTarget,
  guideBlocked,
  guideCanOpen,
  guideSeen,
  isFirstBoot,
  markGuideSeen,
  nextStepIndex,
  placeGuideCard,
  resolveStepIndex,
  setTourSpeed,
  setupCardOpen,
  shouldShowGuide,
  stepAvailable,
  stepTargetRect,
  tourRequested,
} from '../src/ui/guide.js'
import { SETTINGS_KEY } from '../src/ui/settings.js'
import { resetSetupPostponed } from '../src/ui/setup.js'
import { buttonWithText, withDom } from './helpers/uiDom.js'

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
  resetSetupPostponed()
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

    expect(GUIDE_STEPS[1].text).toContain('dock has three columns')
    expect(GUIDE_STEPS[1].text).toContain('agent list on the left')
    expect(GUIDE_STEPS[1].text).toContain('selected agent, else the first working, else the orchestrator in the middle')
    expect(GUIDE_STEPS[1].text).toContain('settings and costs on the right')

    expect(GUIDE_STEPS[2].text).toContain('grey tunnel')
    expect(GUIDE_STEPS[2].text).toContain('a star in its own colour travels it')
    expect(GUIDE_STEPS[2].text).toContain('white is a read or write')
    expect(GUIDE_STEPS[2].text).toContain('green is finished')
    expect(GUIDE_STEPS[2].text).toContain('red is a failure')

    expect(GUIDE_STEPS[3].text).toContain('chat sits at the bottom right')
    expect(GUIDE_STEPS[3].text).toContain('runs with --lanes')
    expect(GUIDE_STEPS[3].text).toContain('click ORCHESTRATOR')
    expect(GUIDE_STEPS[3].text).not.toContain('Attach')
    expect(GUIDE_STEPS[3].text).toContain('tabs switch between them')

    expect(GUIDE_STEPS[4].text).toContain('C opens the control drawer')
    expect(GUIDE_STEPS[4].text).toContain('L the event log')
    expect(GUIDE_STEPS[4].text).toContain('/ opens the chat with --lanes or the assistant in a replay')
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
    expect(CONFIRM_SELECTOR).toContain('.mr-orch-confirm')
    expect(CONFIRM_SELECTOR).toContain('.mr-assistant-btn-confirm')
    expect(CONFIRM_SELECTOR).toContain('.mr-side-confirm')
    expect(CONFIRM_SELECTOR).toContain('.strip-pop.is-confirm')
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

  it('holds the guide until the setup card is gone', () => {
    const doc = {
      querySelector(selector) {
        return selector === '.mr-setup' ? {} : null
      },
    }
    expect(setupCardOpen(doc)).toBe(true)
    expect(guideBlocked(doc)).toBe(true)
    expect(guideCanOpen(doc)).toBe(false)
    expect(setupCardOpen(null)).toBe(false)
    expect(guideBlocked(null)).toBe(false)
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

  it('points the tour at the Settings button in the menu row', () => {
    const html = renderToString(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1] }))
    expect(html).toContain('class="hud-action"')
    expect(html).toContain('aria-label="Settings"')
    expect(LIVE_TOUR_STEPS[4].selector).toBe('.hud-action[aria-label="Settings"]')
    expect(html).not.toContain('hud-strip-settings')
  })

  it('has the line from an agent in the legend', () => {
    const html = renderToString(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1] }))
    expect(html).toContain('Line from an agent: the file it is working on')
    expect(html).toContain('class="is-line"')
  })
})

describe('first boot and Connect tour entry', () => {
  it('detects a first boot only when both connection and guide flag are missing', () => {
    const empty = memoryStorage()
    expect(isFirstBoot(empty)).toBe(true)

    const withGuide = memoryStorage({ [GUIDE_FLAG]: '1' })
    expect(isFirstBoot(withGuide)).toBe(false)

    const withSaved = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ source: 'bridge', bridge: 'http://127.0.0.1:5174' }),
    })
    expect(isFirstBoot(withSaved)).toBe(false)
  })

  it('sets the saved replay speed to 1x for a tour without adding a connection', () => {
    const saved = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        source: 'bridge',
        bridge: 'http://127.0.0.1:5174',
        speed: 4,
      }),
    })
    expect(setTourSpeed(saved)).toBe(true)
    expect(JSON.parse(saved.values.get(SETTINGS_KEY))).toMatchObject({
      source: 'bridge',
      bridge: 'http://127.0.0.1:5174',
      speed: 1,
    })

    const empty = memoryStorage()
    expect(setTourSpeed(empty)).toBe(false)
    expect(empty.values.has(SETTINGS_KEY)).toBe(false)
  })

  it('builds the connect link from the current path', () => {
    expect(connectHref('/')).toBe('/?connect')
    expect(connectHref('/room')).toBe('/room?connect')
    expect(connectHref('')).toBe('/?connect')
  })

  it('reads the tour parameter from a search string', () => {
    expect(tourRequested('?replay&fixture=scenario-i&tour')).toBe(true)
    expect(tourRequested('?replay')).toBe(false)
    expect(tourRequested('')).toBe(false)
    expect(tourRequested(null)).toBe(false)
  })

  it('opens Connect with two short sentences and Take the tour above the form and choices', () => {
    const sentences = CONNECT_INTRO.split('. ').filter(Boolean)
    expect(sentences).toHaveLength(2)
    expect(TOUR_QUERY).toBe('?replay&fixture=scenario-i&tour')

    const html = renderToString(createElement(Connect, { firstBoot: true }))
    expect(html).toContain(CONNECT_INTRO)
    expect(html).toContain('>Take the tour</button>')
    expect(html).toContain('autofocus=""')

    const tourPos = html.indexOf('>Take the tour</button>')
    const bridgePos = html.indexOf('Connect through the bridge')
    const demoPos = html.indexOf('Watch the demo')
    const replayPos = html.indexOf('Replay what this page has seen')
    expect(tourPos).toBeGreaterThan(-1)
    expect(tourPos).toBeLessThan(bridgePos)
    expect(tourPos).toBeLessThan(demoPos)
    expect(tourPos).toBeLessThan(replayPos)
  })

  it('describes the replay as what this page has seen and leads recovery with machineroom', () => {
    const html = renderToString(createElement(Connect, { firstBoot: false }))
    expect(html).toContain('Replay what this page has seen')
    expect(html).toContain('This visit')
    expect(html).not.toContain('5 min run')
    expect(html).toContain('Plays back what this page has seen since the first conversation')
    expect(html).toContain('For a sample run, take the tour.')
    expect(html).toContain('machineroom YOUR-PROJECT')
    expect(html).toContain('in the MachineRoom folder')
    expect(html.indexOf('machineroom YOUR-PROJECT')).toBeLessThan(
      html.indexOf('npm run serve -- up --root YOUR-PROJECT')
    )
  })

  it('starts the replay when Take the tour is clicked', async () => {
    let replays = 0
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(Connect, {
            firstBoot: false,
            onReplay: () => {
              replays += 1
            },
          })
        )
      })
      const tour = buttonWithText(container, 'Take the tour')
      expect(tour).not.toBeNull()
      await act(async () => {
        tour.click()
      })
    })
    expect(replays).toBe(1)
  })

  it('does not autofocus Take the tour when it is not a first boot', () => {
    const html = renderToString(createElement(Connect, { firstBoot: false }))
    expect(html).toContain('>Take the tour</button>')
    expect(html).not.toContain('autofocus=""')
  })

  it('shows the guide when the URL carries tour even after the flag was set', () => {
    const seen = memoryStorage({ [GUIDE_FLAG]: '1' })
    expect(shouldShowGuide(seen, '?replay&fixture=scenario-i&tour')).toBe(true)
    expect(shouldShowGuide(seen, '?replay')).toBe(false)
  })
})

describe('tour steps, selector lookup and card placement', () => {
  it('holds eight replay steps and six live steps, each one This sentence', async () => {
    expect(TOUR_STEPS).toHaveLength(8)
    expect(TOUR_STEPS.map((step) => step.label)).toEqual([
      'The lens',
      'The hub and an agent',
      'A working tunnel',
      'The sidebar',
      'The conversation',
      'Overview',
      'The transport',
      'Control and orchestrator',
    ])
    expect(LIVE_TOUR_STEPS).toHaveLength(6)
    expect(LIVE_TOUR_STEPS.map((step) => step.label)).toEqual([
      'The lens',
      'The hub and its agents',
      'Model and effort',
      'Compact',
      'Settings',
      'New conversation',
    ])
    expect(LIVE_TOUR_STEPS.map((step) => step.selector)).toEqual([
      '.lens',
      '.mr-term[data-agent="orchestrator"]',
      '.hud-strip-model',
      '.hud-strip-compact',
      '.hud-action[aria-label="Settings"]',
      '.hud-sessions-button',
    ])
    expect(TOUR_STEPS[0].text).toContain('This lens')
    expect(TOUR_STEPS[1].text).toContain('This terminal chip')
    expect(TOUR_STEPS[2].text).toContain('This tunnel runs grey')
    expect(TOUR_STEPS[2].text).toContain("a star in the agent's colour")
    expect(TOUR_STEPS[7].text).toContain('This action row')
    expect(LIVE_TOUR_STEPS[1].text).toContain('This terminal chip')
    expect(LIVE_TOUR_STEPS[2].text).toContain('This model picker')
    expect(LIVE_TOUR_STEPS[5].text).toContain('This New conversation button')
    for (const step of [...TOUR_STEPS, ...LIVE_TOUR_STEPS]) {
      expect(step.text.startsWith('This ')).toBe(true)
      expect(step.text.endsWith('.')).toBe(true)
      expect(step.text.split('.').length - 1).toBe(1)
      expect(step.text.length).toBeGreaterThan(20)
      expect(step.text.length).toBeLessThan(140)
    }
    const outsideHud = new Set(['.lens', '.mr-term', '.mr-card.is-targeted, .mr-callout.is-working, .mr-term.is-working'])
    const hudSteps = TOUR_STEPS.filter((step) => !outsideHud.has(step.selector))
    expect(hudSteps).toHaveLength(5)
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem(GUIDE_FLAG, '1')
      dom.window.innerWidth = 800
      await act(async () => {
        root.render(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1] }))
      })
      for (const step of hudSteps) {
        expect(container.querySelector(step.selector), step.selector).not.toBeNull()
      }
    })
    expect(clampStep(7, TOUR_STEPS)).toBe(7)
    expect(clampStep(99, TOUR_STEPS)).toBe(7)
    expect(clampStep(5, LIVE_TOUR_STEPS)).toBe(5)
    expect(clampStep(99, LIVE_TOUR_STEPS)).toBe(5)
  })

  it('looks up visible elements and skips missing, hidden or off-screen targets', () => {
    const visible = {
      getBoundingClientRect: () => ({ left: 20, top: 60, width: 320, height: 180 }),
    }
    const hiddenDisplay = {
      style: { display: 'none' },
      getBoundingClientRect: () => ({ left: 20, top: 60, width: 320, height: 180 }),
    }
    const zeroSize = {
      getBoundingClientRect: () => ({ left: 20, top: 60, width: 0, height: 180 }),
    }
    const offscreen = {
      getBoundingClientRect: () => ({ left: 20, top: 1400, width: 320, height: 180 }),
    }
    const doc = {
      querySelectorAll(selector) {
        if (selector === '.lens') return [visible]
        if (selector === '.hud-actions') return [hiddenDisplay]
        if (selector === '.hud-dock-side') return [zeroSize]
        if (selector === '.transport') return [offscreen]
        if (selector === '.mr-term') return [hiddenDisplay, visible]
        return []
      },
    }

    const viewport = { width: 1280, height: 800 }
    expect(findStepTarget(doc, TOUR_STEPS[0], viewport)).toBe(visible)
    expect(stepTargetRect(doc, TOUR_STEPS[0], viewport)).toEqual({
      left: 20,
      top: 60,
      width: 320,
      height: 180,
      right: 340,
      bottom: 240,
    })
    expect(findStepTarget(doc, TOUR_STEPS[1], viewport)).toBe(visible)
    expect(findStepTarget(doc, TOUR_STEPS[4], viewport)).toBeNull()
    expect(findStepTarget(doc, TOUR_STEPS[5], viewport)).toBeNull()
    expect(findStepTarget(doc, TOUR_STEPS[6], viewport)).toBeNull()
    expect(findStepTarget(doc, TOUR_STEPS[7], viewport)).toBeNull()
    expect(stepTargetRect(null, TOUR_STEPS[0], viewport)).toBeNull()
  })

  it('skips a missing step instead of showing it in the middle', () => {
    const lens = { getBoundingClientRect: () => ({ left: 0, top: 44, width: 1280, height: 464 }) }
    const transport = {
      getBoundingClientRect: () => ({ left: 20, top: 700, width: 900, height: 48 }),
    }
    const doc = {
      querySelectorAll(selector) {
        if (selector === '.lens') return [lens]
        if (selector === '.transport') return [transport]
        return []
      },
    }
    const viewport = { width: 1280, height: 800 }
    const found = availableSteps(TOUR_STEPS, doc, viewport)
    expect(found.map((step) => step.label)).toEqual(['The lens', 'The transport'])
    expect(stepAvailable(TOUR_STEPS[1], doc, viewport)).toBe(false)
    expect(nextStepIndex(TOUR_STEPS, 0, doc, viewport)).toBe(6)
    expect(nextStepIndex(TOUR_STEPS, 6, doc, viewport)).toBeNull()
    expect(resolveStepIndex(TOUR_STEPS, 1, doc, viewport)).toBe(6)
    expect(resolveStepIndex(TOUR_STEPS, 7, doc, viewport)).toBe(6)
    expect(resolveStepIndex(TOUR_STEPS, 0, { querySelectorAll: () => [] }, viewport)).toBeNull()
  })

  it('places the card beside a visible target inside the window and centers it when missing', () => {
    const card = { width: 420, height: 220 }
    const centered = placeGuideCard(null, card, { width: 1280, height: 800 })
    expect(centered.centered).toBe(true)
    expect(centered.outline).toBeNull()
    expect(centered.left).toBe(430)
    expect(centered.top).toBe(290)

    const belowLens = placeGuideCard(
      { left: 0, top: 44, width: 1280, height: 464 },
      card,
      { width: 1280, height: 800 }
    )
    expect(belowLens.centered).toBe(false)
    expect(belowLens.side).toBe('bottom')
    expect(belowLens.outline).toEqual({ left: 2, top: 44, width: 1276, height: 464 })
    expect(belowLens.top).toBeGreaterThanOrEqual(508)
    expect(belowLens.top + card.height).toBeLessThanOrEqual(800 - 16)

    const besideAgents = placeGuideCard(
      { left: 16, top: 520, width: 360, height: 220 },
      card,
      { width: 1280, height: 800 }
    )
    expect(besideAgents.centered).toBe(false)
    expect(besideAgents.side).toBe('right')
    expect(besideAgents.left).toBeGreaterThanOrEqual(376)
    expect(besideAgents.left + card.width).toBeLessThanOrEqual(1280 - 16)

    for (const vp of [
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
    ]) {
      const placed = placeGuideCard(
        { left: 12, top: 48, width: vp.width - 24, height: 300 },
        card,
        vp
      )
      expect(placed.left).toBeGreaterThanOrEqual(8)
      expect(placed.top).toBeGreaterThanOrEqual(8)
      expect(placed.outline.left).toBeGreaterThanOrEqual(2)
      expect(placed.outline.top).toBeGreaterThanOrEqual(2)
      expect(placed.outline.left + placed.outline.width).toBeLessThanOrEqual(vp.width - 2)
      expect(placed.outline.top + placed.outline.height).toBeLessThanOrEqual(vp.height - 2)
    }
  })

  it('renders the tour with an outline beside a present target, skips a missing step and offers the last choices', () => {
    const target = (rect) => ({ getBoundingClientRect: () => rect })
    const lens = target({ left: 0, top: 44, width: 1280, height: 464 })
    const chip = target({ left: 600, top: 300, width: 180, height: 80 })
    const all = {
      querySelectorAll(selector) {
        if (selector === '.lens') return [lens]
        if (selector === '.mr-term') return [chip]
        if (selector === '.mr-card.is-targeted, .mr-callout.is-working, .mr-term.is-working') {
          return [chip]
        }
        if (selector === '.hud-dock-agents') return [target({ left: 20, top: 560, width: 320, height: 220 })]
        if (selector === '.hud-dock-context') return [target({ left: 360, top: 560, width: 420, height: 220 })]
        if (selector === '.hud-dock-side') return [target({ left: 800, top: 560, width: 400, height: 220 })]
        if (selector === '.transport') return [target({ left: 20, top: 720, width: 900, height: 48 })]
        if (selector === '.hud-actions') return [target({ left: 900, top: 8, width: 340, height: 40 })]
        return []
      },
    }
    const step1 = renderToString(
      createElement(Guide, { tour: true, initialStep: 0, doc: all })
    )
    expect(step1).toContain('1 / 8')
    expect(step1).toContain('class="mr-guide-outline"')
    expect(step1).toContain('mr-guide is-tour is-placed')
    expect(step1).toContain('data-selector=".lens"')
    expect(step1).toContain(TOUR_STEPS[0].text)

    const lensOnly = {
      querySelectorAll(selector) {
        return selector === '.lens' ? [lens] : []
      },
    }
    const skipped = renderToString(
      createElement(Guide, { tour: true, initialStep: 2, doc: lensOnly })
    )
    expect(skipped).toContain('1 / 1')
    expect(skipped).toContain(TOUR_STEPS[0].text)
    expect(skipped).toContain('class="mr-guide-outline"')
    expect(skipped).not.toContain('mr-guide is-tour is-centered')

    const finalStep = renderToString(
      createElement(Guide, { tour: true, initialStep: 7, doc: all })
    )
    expect(finalStep).toContain('8 / 8')
    expect(finalStep).toContain('>Connect to my project</button>')
    expect(finalStep).toContain('>Keep watching</button>')

    const overConfirm = renderToString(
      createElement(Guide, { tour: true, initialStep: 0, doc: fakeDocument({}) })
    )
    expect(overConfirm).toBe('')
  })

  it('runs the live tour in its outlined mode and skips a missing strip control', () => {
    const target = (rect) => ({ getBoundingClientRect: () => rect })
    const lens = target({ left: 0, top: 44, width: 1280, height: 464 })
    const liveDoc = {
      querySelectorAll(selector) {
        if (selector === '.lens') return [lens]
        if (selector === '.mr-term[data-agent="orchestrator"]') {
          return [target({ left: 620, top: 280, width: 180, height: 80 })]
        }
        return []
      },
    }
    const live = renderToString(
      createElement(Guide, { mode: 'live', initialStep: 0, doc: liveDoc })
    )
    expect(live).toContain('1 / 2')
    expect(live).toContain(LIVE_TOUR_STEPS[0].text)
    expect(live).toContain('class="mr-guide-outline"')
    expect(live).toContain('mr-guide is-tour is-placed')

    const modelOnly = {
      querySelectorAll(selector) {
        if (selector === '.hud-strip-model') {
          return [target({ left: 40, top: 520, width: 260, height: 24 })]
        }
        return []
      },
    }
    const skipped = renderToString(
      createElement(Guide, { mode: 'live', initialStep: 0, doc: modelOnly })
    )
    expect(skipped).toContain('1 / 1')
    expect(skipped).toContain(LIVE_TOUR_STEPS[2].text)
    expect(skipped).toContain('data-selector=".hud-strip-model"')
    expect(skipped).not.toContain('mr-guide is-tour is-centered')

    const done = renderToString(
      createElement(Guide, { mode: 'live', initialStep: 5, doc: modelOnly })
    )
    expect(done).toContain('1 / 1')
    expect(done).toContain('>Done</button>')
    expect(done).not.toContain('>Connect to my project</button>')
  })

  it('shows the setup card before the live tour and starts the tour after Later', async () => {
    await withDom(async ({ container, dom, root }) => {
      const lens = dom.document.createElement('div')
      lens.className = 'lens'
      lens.getBoundingClientRect = () => ({ left: 0, top: 44, width: 1200, height: 460 })
      dom.body.appendChild(lens)
      const calls = []
      const client = {
        lanes: async () => ({
          lanes: [
            { key: 'opencode', name: 'OpenCode' },
            { key: 'opencode2', name: 'OpenCode 2' },
            { key: 'claude', name: 'Claude' },
          ],
          max: 3,
          chosen: false,
        }),
        setActiveLanes: async (payload) => {
          calls.push(payload)
        },
      }
      await act(async () => {
        root.render(
          createElement(Hud, { mode: 'live', snapshot: SNAPSHOT, speeds: [1], client })
        )
      })
      await act(async () => {})
      expect(container.textContent).toContain('How many agents should work on this project?')
      expect(container.textContent).not.toContain(LIVE_TOUR_STEPS[0].text)
      const later = buttonWithText(container, 'Later')
      expect(later).not.toBeNull()
      await act(async () => {
        later.click()
      })
      expect(calls).toEqual([])
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320))
      })
      expect(container.textContent).toContain('1 / 1')
      expect(container.textContent).toContain(LIVE_TOUR_STEPS[0].text)
      resetSetupPostponed()
    })
  })

  it('opens the tour when the Help dialog Guide button is clicked', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem(GUIDE_FLAG, '1')
      const lens = dom.document.createElement('div')
      lens.className = 'lens'
      lens.getBoundingClientRect = () => ({ left: 0, top: 44, width: 1200, height: 460 })
      dom.body.appendChild(lens)
      await act(async () => {
        root.render(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1], helpOpen: true }))
      })
      expect(container.textContent).toContain('Keyboard Shortcuts')
      expect(container.textContent).not.toContain('1 / 1')
      const guideButton = buttonWithText(container, 'Guide')
      expect(guideButton).not.toBeNull()
      await act(async () => {
        guideButton.click()
      })
      expect(container.textContent).toContain('1 / 1')
      expect(container.textContent).toContain(TOUR_STEPS[0].text)
    })
  })
})
