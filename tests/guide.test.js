import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import Connect, { CONNECT_INTRO, TOUR_QUERY } from '../src/ui/Connect.jsx'
import Guide from '../src/ui/Guide.jsx'
import Hud from '../src/ui/Hud.jsx'
import {
  CONFIRM_SELECTOR,
  GUIDE_FLAG,
  GUIDE_STEPS,
  TOUR_STEPS,
  clampStep,
  confirmCardOpen,
  connectHref,
  findStepTarget,
  guideCanOpen,
  guideSeen,
  isFirstBoot,
  markGuideSeen,
  placeGuideCard,
  setTourSpeed,
  shouldShowGuide,
  stepReady,
  stepTargetRect,
  tourRequested,
} from '../src/ui/guide.js'
import { SETTINGS_KEY } from '../src/ui/settings.js'

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

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const DOCUMENT_NODE = 9

function selectorMatches(node, selector) {
  if (!node || node.nodeType !== ELEMENT_NODE) return false
  return String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => simpleSelectorMatches(node, part))
}

function simpleSelectorMatches(node, part) {
  let matched = false
  const id = part.match(/#([\w-]+)/)
  if (id) {
    if (node.id !== id[1]) return false
    matched = true
  }
  for (const item of part.match(/\.([\w-]+)/g) ?? []) {
    if (!String(node.className).split(/\s+/).includes(item.slice(1))) return false
    matched = true
  }
  for (const item of part.match(/\[([\w-]+)(?:="([^"]*)")?\]/g) ?? []) {
    const found = item.match(/\[([\w-]+)(?:="([^"]*)")?\]/)
    const value = found ? node.getAttribute(found[1]) : null
    if (value == null) return false
    if (found[2] !== undefined && value !== found[2]) return false
    matched = true
  }
  const tag = part.match(/^([a-zA-Z][\w-]*)/)
  if (tag) {
    if (String(node.tagName).toLowerCase() !== tag[1].toLowerCase()) return false
    matched = true
  }
  return matched
}

function testStyle() {
  const style = {}
  Object.defineProperty(style, 'setProperty', {
    value(name, value) {
      style[name] = String(value)
    },
  })
  Object.defineProperty(style, 'removeProperty', {
    value(name) {
      delete style[name]
    },
  })
  return style
}

function createTestDom() {
  const listeners = new WeakMap()

  function addListener(node, type, fn) {
    if (!listeners.has(node)) listeners.set(node, new Map())
    const map = listeners.get(node)
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(fn)
  }

  function removeListener(node, type, fn) {
    const map = listeners.get(node)
    const list = map && map.get(type)
    if (!list) return
    const index = list.indexOf(fn)
    if (index !== -1) list.splice(index, 1)
  }

  function dispatch(node, event) {
    event.target = node
    event.bubbles = event.bubbles !== false
    event.cancelable = event.cancelable !== false
    event.defaultPrevented = false
    event.isTrusted = true
    event.timeStamp = Date.now()
    event.preventDefault = () => {
      event.defaultPrevented = true
    }
    event.stopPropagation = () => {
      event.cancelBubble = true
    }
    event.persist = () => {}
    event.composedPath = () => {
      const path = []
      let current = node
      while (current) {
        path.push(current)
        current = current.parentNode
      }
      return path
    }
    let current = node
    while (current) {
      event.currentTarget = current
      const list = listeners.get(current)?.get(event.type)
      if (list) {
        for (const fn of [...list]) {
          if (event.cancelBubble) break
          fn.call(current, event)
        }
      }
      if (event.cancelBubble || !event.bubbles) break
      current = current.parentNode
    }
    event.currentTarget = null
    return !event.defaultPrevented
  }

  function createTextNode(data) {
    const node = {
      ownerDocument: doc,
      nodeType: TEXT_NODE,
      nodeName: '#text',
      nodeValue: String(data),
      parentNode: null,
      childNodes: [],
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(node, 'data', {
      get: () => node.nodeValue,
      set: (value) => {
        node.nodeValue = String(value)
      },
    })
    Object.defineProperty(node, 'textContent', {
      get: () => node.nodeValue,
      set: (value) => {
        node.nodeValue = String(value)
      },
    })
    return node
  }

  function makeElement(tag) {
    const node = {
      ownerDocument: doc,
      nodeType: ELEMENT_NODE,
      nodeName: String(tag).toUpperCase(),
      tagName: String(tag).toUpperCase(),
      localName: String(tag).toLowerCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      parentNode: null,
      childNodes: [],
      style: testStyle(),
      attributes: Object.create(null),
      id: '',
      className: '',
      hidden: false,
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child)
        node.childNodes.push(child)
        child.parentNode = node
        return child
      },
      insertBefore(child, before) {
        if (before == null) return node.appendChild(child)
        const index = node.childNodes.indexOf(before)
        if (index === -1) throw new Error('reference node not found')
        if (child.parentNode) child.parentNode.removeChild(child)
        node.childNodes.splice(index, 0, child)
        child.parentNode = node
        return child
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child)
        if (index === -1) throw new Error('child not found')
        node.childNodes.splice(index, 1)
        child.parentNode = null
        return child
      },
      setAttribute(name, value) {
        const text = String(value)
        node.attributes[name] = text
        if (name === 'id') node.id = text
        if (name === 'class') node.className = text
      },
      getAttribute(name) {
        return Object.hasOwn(node.attributes, name) ? node.attributes[name] : null
      },
      hasAttribute(name) {
        return Object.hasOwn(node.attributes, name)
      },
      removeAttribute(name) {
        delete node.attributes[name]
      },
      addEventListener(type, fn) {
        addListener(node, type, fn)
      },
      removeEventListener(type, fn) {
        removeListener(node, type, fn)
      },
      dispatchEvent(event) {
        return dispatch(node, event)
      },
      click() {
        dispatch(node, { type: 'click', bubbles: true, cancelable: true })
      },
      focus() {
        doc.activeElement = node
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      },
      scrollIntoView() {},
      contains(other) {
        let current = other
        while (current) {
          if (current === node) return true
          current = current.parentNode
        }
        return false
      },
      querySelectorAll(selector) {
        const found = []
        function walk(current) {
          for (const child of current.childNodes) {
            if (selectorMatches(child, selector)) found.push(child)
            walk(child)
          }
        }
        walk(node)
        return found
      },
      querySelector(selector) {
        return node.querySelectorAll(selector)[0] ?? null
      },
    }
    Object.defineProperty(node, 'firstChild', { get: () => node.childNodes[0] ?? null })
    Object.defineProperty(node, 'nextSibling', {
      get: () => {
        const parent = node.parentNode
        if (!parent) return null
        return parent.childNodes[parent.childNodes.indexOf(node) + 1] ?? null
      },
    })
    Object.defineProperty(node, 'children', {
      get: () => node.childNodes.filter((child) => child.nodeType === ELEMENT_NODE),
    })
    Object.defineProperty(node, 'textContent', {
      get: () => node.childNodes.map((child) => child.textContent ?? '').join(''),
      set: (value) => {
        for (const child of node.childNodes) child.parentNode = null
        node.childNodes.length = 0
        if (value !== '') node.appendChild(createTextNode(value))
      },
    })
    return node
  }

  const doc = {
    ownerDocument: null,
    nodeType: DOCUMENT_NODE,
    nodeName: '#document',
    activeElement: null,
    createElement: makeElement,
    createElementNS(namespace, tag) {
      return makeElement(tag)
    },
    createTextNode,
    createComment(data) {
      return createTextNode(data)
    },
    addEventListener(type, fn) {
      addListener(doc, type, fn)
    },
    removeEventListener(type, fn) {
      removeListener(doc, type, fn)
    },
    dispatchEvent(event) {
      return dispatch(doc, event)
    },
    querySelectorAll(selector) {
      return doc.documentElement.querySelectorAll(selector)
    },
    querySelector(selector) {
      return doc.documentElement.querySelector(selector)
    },
  }

  const html = makeElement('html')
  const head = makeElement('head')
  const body = makeElement('body')
  html.appendChild(head)
  html.appendChild(body)
  doc.documentElement = html
  doc.head = head
  doc.body = body
  doc.activeElement = body

  const window = {
    document: doc,
    innerWidth: 1280,
    innerHeight: 800,
    location: { search: '', pathname: '/', assign() {} },
    history: { replaceState() {} },
    localStorage: {
      values: new Map(),
      getItem(key) {
        return window.localStorage.values.has(key) ? window.localStorage.values.get(key) : null
      },
      setItem(key, value) {
        window.localStorage.values.set(key, String(value))
      },
    },
    addEventListener(type, fn) {
      addListener(window, type, fn)
    },
    removeEventListener(type, fn) {
      removeListener(window, type, fn)
    },
    dispatchEvent(event) {
      return dispatch(window, event)
    },
    getComputedStyle(element) {
      return element.style
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: (fn) => globalThis.setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => globalThis.clearTimeout(id),
  }
  doc.defaultView = window
  window.Element = function Element() {}
  window.Node = function Node() {}
  window.HTMLElement = window.Element
  window.HTMLIFrameElement = function HTMLIFrameElement() {}
  return { document: doc, window, html, body }
}

async function withDom(run) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  const dom = createTestDom()
  globalThis.window = dom.window
  globalThis.document = dom.document
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = dom.document.createElement('div')
  dom.body.appendChild(container)
  const root = createRoot(container)
  try {
    await run({ container, dom, root })
  } finally {
    try {
      await act(async () => root.unmount())
    } finally {
      for (const [key, value] of [
        ['window', saved.window],
        ['document', saved.document],
        ['Element', saved.Element],
        ['Node', saved.Node],
        ['HTMLElement', saved.HTMLElement],
      ]) {
        if (value === undefined) delete globalThis[key]
        else globalThis[key] = value
      }
      if (saved.actEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
      else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.actEnvironment
    }
  }
}

function buttonWithText(container, text) {
  return container.querySelectorAll('button').find((button) => button.textContent.trim() === text) ?? null
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

    expect(GUIDE_STEPS[1].text).toContain('dock has three columns')
    expect(GUIDE_STEPS[1].text).toContain('agent list on the left')
    expect(GUIDE_STEPS[1].text).toContain('selected agent, else the first working, else the orchestrator in the middle')
    expect(GUIDE_STEPS[1].text).toContain('settings and costs on the right')

    expect(GUIDE_STEPS[2].text).toContain('yellow tunnel')
    expect(GUIDE_STEPS[2].text).toContain('packets run along it')
    expect(GUIDE_STEPS[2].text).toContain('white is a read or write')
    expect(GUIDE_STEPS[2].text).toContain('green is finished')
    expect(GUIDE_STEPS[2].text).toContain('red is a failure')

    expect(GUIDE_STEPS[3].text).toContain('chat sits at the bottom right')
    expect(GUIDE_STEPS[3].text).toContain('runs with --lanes')
    expect(GUIDE_STEPS[3].text).toContain('click ORCHESTRATOR')
    expect(GUIDE_STEPS[3].text).toContain('Attach adds a sub orchestrator')
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
    const replayPos = html.indexOf('Open the recorded replay')
    expect(tourPos).toBeGreaterThan(-1)
    expect(tourPos).toBeLessThan(bridgePos)
    expect(tourPos).toBeLessThan(demoPos)
    expect(tourPos).toBeLessThan(replayPos)
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
  it('holds eight tour steps with one sentence each and finds the HUD ones in the HUD', async () => {
    expect(TOUR_STEPS).toHaveLength(8)
    expect(TOUR_STEPS.map((step) => step.label)).toEqual([
      'The lens',
      'The hub and an agent',
      'A working tunnel',
      'The agent list',
      'The agent context',
      'Settings and costs',
      'The transport',
      'Control and orchestrator',
    ])
    expect(TOUR_STEPS[1].text).toContain('outlined terminal chip')
    expect(TOUR_STEPS[1].text).toContain('opens its log')
    expect(TOUR_STEPS[3].text).toContain('selected agent, else the first working agent, else the orchestrator')
    expect(TOUR_STEPS[7].text).toContain('Dispatch, Tasks, Meters, Team and Reviews')
    expect(TOUR_STEPS[7].text).toContain('with --lanes')
    expect(TOUR_STEPS[7].text).toContain('in a replay / opens the assistant')
    const outsideHud = new Set([
      '.lens',
      '.mr-term',
      '.mr-card.is-targeted, .mr-callout.is-working, .mr-term.is-working',
    ])
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
    for (const step of TOUR_STEPS) {
      expect(step.text.endsWith('.')).toBe(true)
      expect(step.text.split('.').length - 1).toBe(1)
      expect(step.text.length).toBeGreaterThan(20)
      expect(step.text.length).toBeLessThan(200)
    }
    expect(clampStep(7, TOUR_STEPS)).toBe(7)
    expect(clampStep(99, TOUR_STEPS)).toBe(7)
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
    expect(findStepTarget(doc, TOUR_STEPS[5], viewport)).toBeNull()
    expect(findStepTarget(doc, TOUR_STEPS[6], viewport)).toBeNull()
    expect(findStepTarget(doc, TOUR_STEPS[7], viewport)).toBeNull()
    expect(stepTargetRect(null, TOUR_STEPS[0], viewport)).toBeNull()
  })

  it('waits on the tunnel step until an agent is working or a tunnel target is visible', () => {
    const tunnelStep = TOUR_STEPS[2]
    expect(stepReady(tunnelStep, { agents: [{ key: 'opencode', status: 'idle' }] }, null)).toBe(false)
    expect(stepReady(tunnelStep, { agents: [{ key: 'opencode', status: 'working' }] }, null)).toBe(true)

    const docWithTarget = {
      querySelector: (selector) =>
        selector === '.mr-card.is-targeted'
          ? { getBoundingClientRect: () => ({ left: 100, top: 100, width: 180, height: 120 }) }
          : null,
    }
    expect(stepReady(tunnelStep, { agents: [] }, docWithTarget)).toBe(true)
    expect(stepReady(TOUR_STEPS[0], { agents: [] }, null)).toBe(true)
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

  it('renders the tour with an outline around a present target, a waiting note when not ready, and last-step choices', () => {
    const docWithLens = {
      querySelector: (selector) =>
        selector === '.lens'
          ? { getBoundingClientRect: () => ({ left: 0, top: 44, width: 1280, height: 464 }) }
          : null,
    }
    const step1 = renderToString(
      createElement(Guide, { tour: true, initialStep: 0, doc: docWithLens })
    )
    expect(step1).toContain('1 / 8')
    expect(step1).toContain('class="mr-guide-outline"')
    expect(step1).toContain('mr-guide is-tour is-placed')
    expect(step1).toContain('data-selector=".lens"')

    const waitingTunnel = renderToString(
      createElement(Guide, {
        tour: true,
        initialStep: 2,
        snapshot: { agents: [{ key: 'opencode', status: 'idle' }] },
        doc: fakeDocument(null),
      })
    )
    expect(waitingTunnel).toContain('3 / 8')
    expect(waitingTunnel).toContain('Waiting for an agent to start working.')
    expect(waitingTunnel).toContain('mr-guide is-tour is-centered')
    expect(waitingTunnel).not.toContain('class="mr-guide-outline"')
    expect(waitingTunnel).toContain('>Next</button>')

    const finalStep = renderToString(
      createElement(Guide, { tour: true, initialStep: 7, doc: fakeDocument(null) })
    )
    expect(finalStep).toContain('8 / 8')
    expect(finalStep).toContain('>Connect to my project</button>')
    expect(finalStep).toContain('>Keep watching</button>')

    const overConfirm = renderToString(
      createElement(Guide, { tour: true, initialStep: 0, doc: fakeDocument({}) })
    )
    expect(overConfirm).toBe('')
  })

  it('opens the tour when the Help dialog Guide button is clicked', async () => {
    await withDom(async ({ container, dom, root }) => {
      dom.window.localStorage.setItem(GUIDE_FLAG, '1')
      await act(async () => {
        root.render(createElement(Hud, { snapshot: SNAPSHOT, speeds: [1], helpOpen: true }))
      })
      expect(container.textContent).toContain('Keyboard Shortcuts')
      expect(container.textContent).not.toContain('1 / 8')
      const guideButton = buttonWithText(container, 'Guide')
      expect(guideButton).not.toBeNull()
      await act(async () => {
        guideButton.click()
      })
      expect(container.textContent).toContain('1 / 8')
      expect(container.textContent).toContain(TOUR_STEPS[0].text)
    })
  })
})
