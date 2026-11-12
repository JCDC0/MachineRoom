import { act } from 'react'
import { createRoot } from 'react-dom/client'

export const ELEMENT_NODE = 1
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

function selection() {
  return {
    rangeCount: 0,
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    isCollapsed: true,
    getRangeAt() {
      return null
    },
  }
}

export function createTestDom() {
  const listeners = new WeakMap()

  function captureOf(options) {
    return typeof options === 'boolean' ? options : Boolean(options?.capture)
  }

  function addListener(node, type, fn, options) {
    if (!listeners.has(node)) listeners.set(node, new Map())
    const map = listeners.get(node)
    if (!map.has(type)) map.set(type, [])
    map.get(type).push({ fn, capture: captureOf(options) })
  }

  function removeListener(node, type, fn, options) {
    const map = listeners.get(node)
    const list = map && map.get(type)
    if (!list) return
    const capture = captureOf(options)
    const index = list.findIndex((entry) => entry.fn === fn && entry.capture === capture)
    if (index !== -1) list.splice(index, 1)
  }

  function dispatch(node, event) {
    event.target = node
    event.bubbles = event.bubbles !== false
    event.cancelable = event.cancelable !== false
    event.defaultPrevented = false
    event.cancelBubble = false
    event.immediateStopped = false
    event.isTrusted = true
    event.timeStamp = Date.now()
    event.preventDefault = () => {
      event.defaultPrevented = true
    }
    event.stopPropagation = () => {
      event.cancelBubble = true
    }
    event.stopImmediatePropagation = () => {
      event.cancelBubble = true
      event.immediateStopped = true
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
    const path = []
    let current = node
    while (current) {
      path.push(current)
      current = current.parentNode
    }
    function invoke(target, capture) {
      const list = listeners.get(target)?.get(event.type)
      if (!list) return
      for (const entry of [...list]) {
        if (entry.capture !== capture) continue
        if (event.immediateStopped) return
        entry.fn.call(target, event)
        if (event.immediateStopped) return
      }
    }
    for (let index = path.length - 1; index >= 0 && !event.cancelBubble; index -= 1) {
      event.currentTarget = path[index]
      invoke(path[index], true)
    }
    for (let index = 0; index < path.length && !event.cancelBubble; index += 1) {
      if (index > 0 && !event.bubbles) break
      event.currentTarget = path[index]
      invoke(path[index], false)
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
        if (child === before) return child
        if (child.parentNode) child.parentNode.removeChild(child)
        const index = node.childNodes.indexOf(before)
        if (index === -1) throw new Error('reference node not found')
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
      addEventListener(type, fn, options) {
        addListener(node, type, fn, options)
      },
      removeEventListener(type, fn, options) {
        removeListener(node, type, fn, options)
      },
      attachEvent() {},
      detachEvent() {},
      dispatchEvent(event) {
        return dispatch(node, event)
      },
      click() {
        dispatch(node, { type: 'click', bubbles: true, cancelable: true })
      },
      focus() {
        doc.activeElement = node
      },
      blur() {
        if (doc.activeElement === node) doc.activeElement = doc.body
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
    if (String(tag).toLowerCase() === 'input') {
      node.type = 'text'
      node.checked = false
      node.selectionStart = 0
      node.selectionEnd = 0
    }
    if (String(tag).toLowerCase() === 'textarea') {
      let value = ''
      Object.defineProperty(node, 'value', {
        get: () => value,
        set: (next) => {
          value = String(next)
        },
        configurable: true,
      })
      Object.defineProperty(node, 'defaultValue', {
        get: () => value,
        set: (next) => {
          value = String(next)
        },
        configurable: true,
      })
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
    Object.defineProperty(node, 'options', {
      get: () => node.querySelectorAll('option'),
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
    addEventListener(type, fn, options) {
      addListener(doc, type, fn, options)
    },
    removeEventListener(type, fn, options) {
      removeListener(doc, type, fn, options)
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
    getSelection() {
      return selection()
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

  class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = String(type)
      this.detail = init.detail ?? null
      this.bubbles = init.bubbles === true
      this.cancelable = init.cancelable === true
      this.defaultPrevented = false
    }
  }

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
      removeItem(key) {
        window.localStorage.values.delete(key)
      },
    },
    CustomEvent: TestCustomEvent,
    addEventListener(type, fn, options) {
      addListener(window, type, fn, options)
    },
    removeEventListener(type, fn, options) {
      removeListener(window, type, fn, options)
    },
    dispatchEvent(event) {
      return dispatch(window, event)
    },
    getComputedStyle(element) {
      return element.style
    },
    getSelection() {
      return selection()
    },
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} }
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
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

export async function withDom(run) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    CustomEvent: globalThis.CustomEvent,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  const dom = createTestDom()
  globalThis.window = dom.window
  globalThis.document = dom.document
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = dom.document.createElement('div')
  dom.body.appendChild(container)
  const root = createRoot(container)
  try {
    await run({ container, dom, root, window: dom.window })
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
        ['CustomEvent', saved.CustomEvent],
      ]) {
        if (value === undefined) delete globalThis[key]
        else globalThis[key] = value
      }
      if (saved.actEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
      else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.actEnvironment
    }
  }
}

export async function click(root, node) {
  await act(async () => {
    node.click()
  })
}

export async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

export async function type(root, node, value) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = value
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
    node.dispatchEvent({ type: 'input', bubbles: true, cancelable: true })
    node.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
  })
}

export function buttonWithText(scope, text) {
  return scope.querySelectorAll('button').find((button) => button.textContent.trim() === text) ?? null
}

export function classesOf(node) {
  return String(node.className).split(/\s+/).filter(Boolean)
}
