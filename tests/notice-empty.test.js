import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Notice, { NOTHING_RECORDED } from '../src/ui/Notice.jsx'

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
    await run({ container, root, window: dom.window })
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

describe('Notice empty state', () => {
  it('says the replay starts with the first conversation', () => {
    const html = renderToString(createElement(Notice, { status: 'empty' }))
    expect(NOTHING_RECORDED).toBe('Nothing recorded yet. Replay starts with the first conversation.')
    expect(html).toContain(NOTHING_RECORDED)
  })

  it('offers Back to live and Connection settings and runs each on a click', async () => {
    await withDom(async ({ container, root }) => {
      const calls = []
      await act(async () => {
        root.render(createElement(Notice, {
          status: 'empty',
          onLive: () => calls.push('live'),
          onConnect: () => calls.push('connect'),
        }))
      })
      const live = elementByClass(container, 'notice-live')
      const connect = elementByClass(container, 'notice-connect')
      expect(live?.textContent).toBe('Back to live')
      expect(connect?.textContent).toBe('Connection settings')
      await act(async () => live.click())
      await act(async () => connect.click())
      expect(calls).toEqual(['live', 'connect'])
    })
  })

  it('leaves on Escape through the live button first', async () => {
    await withDom(async ({ container, root, window }) => {
      const calls = []
      await act(async () => {
        root.render(createElement(Notice, {
          status: 'empty',
          onLive: () => calls.push('live'),
          onConnect: () => calls.push('connect'),
        }))
      })
      expect(elementByClass(container, 'notice-live')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Escape' })
      })
      expect(calls).toEqual(['live'])
    })
  })
})
