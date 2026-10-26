import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Transport, { LiveBadgeContext, liveBadgeText } from '../src/ui/Transport.jsx'
import {
  contextLabel,
  contextPercent,
  contextShare,
  contextTitle,
  contextTone,
  orchestratorStateWord,
} from '../src/ui/contextRing.js'

const LIVE = { live: true, position: 65000, duration: 0, playing: true, speed: 1 }

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const DOCUMENT_NODE = 9

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
      for (const fn of listeners.get(current)?.get(event.type) ?? []) {
        if (event.cancelBubble) break
        fn.call(current, event)
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
      style: {},
      attributes: Object.create(null),
      id: '',
      className: '',
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
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} }
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
  return { document: doc, window }
}

function elementByClass(node, className) {
  for (const child of node.childNodes) {
    if (child.nodeType !== ELEMENT_NODE) continue
    if (String(child.className).split(/\s+/).includes(className)) return child
    const found = elementByClass(child, className)
    if (found) return found
  }
  return null
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
  dom.document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await run({ container, root })
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

describe('the context ring helpers', () => {
  it('takes the share of the window and keeps it between none and full', () => {
    expect(contextShare(84000, 200000)).toBeCloseTo(0.42, 5)
    expect(contextShare(0, 200000)).toBe(0)
    expect(contextShare(250000, 200000)).toBe(1)
    expect(contextShare(null, 200000)).toBeNull()
    expect(contextShare(84000, null)).toBeNull()
    expect(contextShare(-1, 200000)).toBeNull()
    expect(contextShare(84000, 0)).toBeNull()
  })

  it('is white below the rule, yellow at or past it and red past 95 percent', () => {
    expect(contextTone(0.42, 80)).toBe('white')
    expect(contextTone(0.79, 80)).toBe('white')
    expect(contextTone(0.8, 80)).toBe('yellow')
    expect(contextTone(0.95, 80)).toBe('yellow')
    expect(contextTone(0.951, 80)).toBe('red')
    expect(contextTone(0.75, 70)).toBe('yellow')
    expect(contextTone(null, 80)).toBe('white')
    expect(contextTone(0.85, 0)).toBe('yellow')
    expect(contextTone(0.85, 120)).toBe('white')
    expect(contextTone(0.5, 5000)).toBe('white')
  })

  it('gives the percent and the label or says the context is not reported', () => {
    expect(contextPercent(0.42)).toBe(42)
    expect(contextPercent(0.4237)).toBe(42)
    expect(contextPercent(1)).toBe(100)
    expect(contextPercent(null)).toBeNull()
    expect(contextLabel(84000, 200000)).toBe('42%')
    expect(contextLabel(null, 200000)).toBe('context not reported')
    expect(contextLabel(84000, null)).toBe('context not reported')
    expect(contextTitle(84000, 200000)).toBe('84000 of 200000 tokens')
    expect(contextTitle(250000, 200000)).toBe('250000 of 200000 tokens')
    expect(contextTitle(null, 200000)).toBe('')
  })

  it('gives the state word the bar shows', () => {
    expect(orchestratorStateWord('working')).toBe('working')
    expect(orchestratorStateWord('idle')).toBe('waiting for you')
    expect(orchestratorStateWord('paused')).toBe('paused')
    expect(orchestratorStateWord(undefined)).toBe('waiting for you')
    expect(orchestratorStateWord('queued')).toBe('waiting for you')
  })
})

describe('the transport under the lens', () => {
  it('shows the orchestrator state and a context ring in the live bar', () => {
    const html = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          id: 'orchestrator',
          state: 'working',
          contextTokens: 84000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(html).toContain('class="transport is-live has-orchestrator"')
    expect(html).toContain('class="transport-orchestrator"')
    expect(html).toContain('>Orchestrator<')
    expect(html).toContain('class="transport-orchestrator-state mono">working<')
    expect(html).toContain('class="transport-center mono"')
    expect(html.indexOf('transport-badge')).toBeLessThan(html.indexOf('transport-center'))
    expect(html).not.toContain('Live feed')
    expect(html).toContain('class="transport-context is-white"')
    expect(html).toContain('width="22"')
    expect(html).toContain('title="84000 of 200000 tokens"')
    expect(html).toContain('stroke-dasharray="42 100"')
    expect(html).toContain('>42%<')
    expect(html).toContain('>01:05<')
    expect(html).toContain('since opening')
  })

  it('shows an empty ring and the plain words when the answer has no numbers', () => {
    const html = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: { id: 'orchestrator', state: 'idle' },
      })
    )
    expect(html).toContain('class="transport-context is-white"')
    expect(html).toContain('>context not reported<')
    expect(html).toContain('>waiting for you<')
    expect(html).not.toContain('transport-context-arc')
    expect(html).not.toContain('stroke-dasharray')
  })

  it('turns the ring yellow at the autocompact rule and red past 95 percent', () => {
    const yellow = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          state: 'paused',
          contextTokens: 160000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(yellow).toContain('transport-context is-yellow')
    expect(yellow).toContain('>80%<')
    expect(yellow).toContain('>paused<')

    const red = renderToString(
      createElement(Transport, {
        snapshot: LIVE,
        speeds: [1],
        orchestrator: {
          state: 'working',
          contextTokens: 192000,
          contextWindow: 200000,
          autocompactPercent: 80,
        },
      })
    )
    expect(red).toContain('transport-context is-red')
    expect(red).toContain('>96%<')
  })

  it('leaves the bar as it was below 900 pixels and in a replay', () => {
    const narrow = renderToString(createElement(Transport, { snapshot: LIVE, speeds: [1] }))
    expect(narrow).toContain('class="transport is-live"')
    expect(narrow).not.toContain('transport-orchestrator')
    expect(narrow).not.toContain('transport-context')

    const replay = renderToString(
      createElement(Transport, {
        snapshot: { position: 12.5, duration: 60, playing: false, speed: 1 },
        speeds: [1],
      })
    )
    expect(replay).toContain('class="transport"')
    expect(replay).not.toContain('transport-orchestrator')
    expect(replay).not.toContain('transport-context')
    expect(replay).not.toContain('transport-badge')
  })

  it('puts the live link tag at the left of the bar beside the Center button', () => {
    const connected = renderToString(
      createElement(Transport, { snapshot: { ...LIVE, status: 'live' }, speeds: [1] })
    )
    expect(connected).toContain('class="transport-live-head"')
    expect(connected).toContain('class="transport-badge is-live"')
    expect(connected).toContain('Live // connected')
    expect(connected).toContain('class="transport-center mono"')
    expect(connected).toContain('aria-label="Center camera"')
    expect(connected).toContain('title="Center camera"')
    expect(connected).toContain('>Center<')
    expect(connected).not.toContain('Live feed')
    expect(connected.indexOf('transport-badge')).toBeLessThan(connected.indexOf('transport-center'))

    const down = renderToString(
      createElement(Transport, { snapshot: { ...LIVE, status: 'reconnecting' }, speeds: [1] })
    )
    expect(down).toContain('class="transport-badge is-down"')
    expect(down).toContain('Live // reconnecting')
  })

  it('says Demo in the tag when the room plays the demo', () => {
    const html = renderToString(
      createElement(
        LiveBadgeContext.Provider,
        { value: 'demo' },
        createElement(Transport, { snapshot: { ...LIVE, status: 'live' }, speeds: [1] })
      )
    )
    expect(html).toContain('Demo // connected')
    expect(liveBadgeText('live')).toBe('Live // connected')
    expect(liveBadgeText('disconnected')).toBe('Live // disconnected')
    expect(liveBadgeText(undefined)).toBe('Live // connecting')
    expect(liveBadgeText('live', 'demo')).toBe('Demo // connected')
  })
})

describe('the Center button', () => {
  it('calls onOverview from either live mount', async () => {
    await withDom(async ({ container, root }) => {
      let calls = 0
      const onOverview = () => {
        calls += 1
      }
      await act(async () => {
        root.render(
          createElement(Transport, {
            snapshot: { ...LIVE, status: 'live' },
            speeds: [1],
            orchestrator: { id: 'orchestrator', state: 'idle' },
            onOverview,
          })
        )
      })
      const wide = elementByClass(container, 'transport-center')
      expect(wide).not.toBeNull()
      expect(wide.textContent).toBe('Center')
      expect(wide.getAttribute('aria-label')).toBe('Center camera')
      await act(async () => {
        wide.click()
      })
      expect(calls).toBe(1)

      await act(async () => {
        root.render(
          createElement(Transport, {
            snapshot: { ...LIVE, status: 'live' },
            speeds: [1],
            onOverview,
          })
        )
      })
      const narrow = elementByClass(container, 'transport-center')
      expect(narrow).not.toBeNull()
      await act(async () => {
        narrow.click()
      })
      expect(calls).toBe(2)
    })
  })
})
