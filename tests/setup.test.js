import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
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

const LANES = [
  { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'model-a', active: true },
  { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'model-b', active: true },
  { key: 'claude', name: 'Claude', harness: 'claude', model: 'model-c', active: true },
  { key: 'hermes', name: 'Hermes', harness: 'hermes', model: 'model-d', active: true },
]

const ANSWER = { lanes: LANES, max: 4, chosen: false }

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
        const wanted = String(selector).toUpperCase()
        const found = []
        function walk(current) {
          for (const child of current.childNodes) {
            if (child.nodeType === ELEMENT_NODE && child.tagName === wanted) found.push(child)
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

beforeEach(() => {
  resetSetupPostponed()
})

afterEach(() => {
  resetSetupPostponed()
})

describe('setup helpers', () => {
  it('asks the one question and starts at two', () => {
    expect(SETUP_QUESTION).toBe('How many agents should work on this project?')
    expect(SETUP_START).toBe('Start')
    expect(SETUP_LATER).toBe('Later')
    expect(SETUP_DEFAULT_COUNT).toBe(2)
    expect(initialAgentCount(6)).toBe(2)
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
    expect(clampAgentCount(undefined, 4)).toBe(2)
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
