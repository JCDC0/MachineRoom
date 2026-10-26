import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import FamilyTree from '../src/ui/FamilyTree.jsx'

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

const NODES = [
  {
    id: 'orchestrator',
    kind: 'orchestrator',
    label: 'Orchestrator',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: null,
    children: ['frontend', 'opencode', 'claude'],
    active: true,
    working: false,
  },
  {
    id: 'frontend',
    kind: 'sub',
    label: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'orchestrator',
    children: ['opencode2'],
    active: true,
    working: false,
  },
  {
    id: 'opencode',
    kind: 'lane',
    label: 'OpenCode',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'orchestrator',
    active: true,
    working: true,
  },
  {
    id: 'opencode2',
    kind: 'lane',
    label: 'OpenCode 2',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    effort: 'max',
    parent: 'frontend',
    active: false,
    working: false,
  },
  {
    id: 'claude',
    kind: 'lane',
    label: 'Claude',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    parent: 'orchestrator',
    active: true,
    working: false,
  },
]

const FAMILY = { nodes: NODES, keys: [], proposals: [] }

const LANES = {
  lanes: [
    { key: 'opencode', name: 'OpenCode', harness: 'opencode', active: true },
    { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', active: false },
    { key: 'claude', name: 'Claude', harness: 'claude', active: true },
  ],
  max: 4,
  chosen: true,
}

const HARNESSES = {
  harnesses: [
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      efforts: ['low', 'high'],
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
      efforts: ['low', 'max'],
    },
    { key: 'agy', name: 'Antigravity', available: false, models: [], efforts: [] },
  ],
}

const ORCHESTRATORS = [
  { id: 'orchestrator', name: 'Orchestrator' },
  {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    lanes: ['opencode2'],
  },
]

function makeClient() {
  const calls = { createLane: [], deleteLane: [], setLadder: [], setActiveLanes: [] }
  const added = []
  const client = {
    family: async () => ({ ...FAMILY, nodes: [...FAMILY.nodes, ...added] }),
    lanes: async () => LANES,
    harnesses: async () => HARNESSES,
    models: async () => ({ models: [] }),
    keys: async () => ({ keys: [] }),
    orchestrators: async () => ORCHESTRATORS,
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      return { ok: true }
    },
    createLane: async (payload) => {
      calls.createLane.push(payload)
      const id = `lane-${added.length + 2}`
      added.push({
        id,
        kind: 'lane',
        label: payload.name,
        harness: payload.harness,
        model: payload.model,
        effort: payload.effort,
        parent: 'orchestrator',
        active: true,
        working: false,
      })
      return { key: id }
    },
    deleteLane: async (payload) => {
      calls.deleteLane.push(payload)
      return { ok: true }
    },
    setActiveLanes: async (payload) => {
      calls.setActiveLanes.push(payload)
      return { ok: true }
    },
  }
  return { client, calls, added }
}

async function mount(root, client) {
  await act(async () => {
    root.render(createElement(FamilyTree, { client }))
  })
  await act(async () => {})
}

function rows(container) {
  return container.querySelectorAll('.mr-family-node')
}

function rowByLabel(container, label) {
  return (
    rows(container).find((row) => {
      const found = row.querySelector('.mr-family-label')
      return found !== null && found.textContent === label
    }) ?? null
  )
}

function classesOf(node) {
  return String(node.className).split(/\s+/).filter(Boolean)
}

function buttonWithText(scope, text) {
  return scope.querySelectorAll('button').find((button) => button.textContent.trim() === text) ?? null
}

async function click(root, node) {
  await act(async () => {
    node.click()
  })
}

describe('FamilyTree rows', () => {
  it('draws the orchestrator, the sub and every lane in tree order', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const tree = rows(container)
      expect(tree.map((row) => row.getAttribute('data-kind'))).toEqual([
        'orchestrator',
        'sub',
        'lane',
        'lane',
        'lane',
      ])
      expect(tree.map((row) => row.querySelector('.mr-family-label').textContent)).toEqual([
        'Orchestrator',
        'Frontend',
        'OpenCode 2',
        'OpenCode',
        'Claude',
      ])
      expect(tree.map((row) => Number(row.getAttribute('data-depth')))).toEqual([0, 1, 2, 1, 1])
      expect(tree[0].querySelector('.mr-family-kind').textContent).toBe('orchestrator')
      expect(tree[1].querySelector('.mr-family-kind').textContent).toBe('sub')
      expect(tree[2].querySelector('.mr-family-kind').textContent).toBe('lane')
      expect(container.querySelector('.mr-side-count').textContent).toBe('2 of 4 active')
      expect(container.querySelectorAll('.mr-family-check')).toHaveLength(3)
      expect(container.querySelectorAll('.mr-family-check-space')).toHaveLength(2)
      expect(container.textContent).not.toContain('agy')
    })
  })

  it('marks a working lane and keeps a turned-off lane with an off dot', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const working = rowByLabel(container, 'OpenCode')
      expect(classesOf(working.querySelector('.mr-family-dot'))).toEqual(['mr-family-dot', 'is-working'])

      const off = rowByLabel(container, 'OpenCode 2')
      expect(off.getAttribute('data-kind')).toBe('lane')
      expect(classesOf(off.querySelector('.mr-family-dot'))).toContain('is-off')
      const toggle = off.querySelector('.mr-side-switch')
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toBe('Turn on OpenCode 2')

      const sub = rowByLabel(container, 'Frontend')
      expect(classesOf(sub.querySelector('.mr-family-dot'))).toContain('is-idle')
    })
  })

  it('counts the checked lanes from their selection checkboxes and clears them', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const opencode = rowByLabel(container, 'OpenCode').querySelector('.mr-family-check')
      const claude = rowByLabel(container, 'Claude').querySelector('.mr-family-check')
      expect(opencode.getAttribute('aria-label')).toBe('Select OpenCode')
      expect(claude.getAttribute('aria-label')).toBe('Select Claude')

      await act(async () => {
        opencode.checked = true
        opencode.click()
      })
      await act(async () => {
        claude.checked = true
        claude.click()
      })
      expect(container.textContent).toContain('2 selected')
      expect(buttonWithText(container, 'Add sub orchestrator')).not.toBeNull()

      await click(root, buttonWithText(container, 'Clear'))
      expect(container.textContent).not.toContain('2 selected')
      expect(container.querySelector('.mr-family-selection')).toBeNull()
    })
  })

  it('removes a lane from its trash button behind a danger confirm', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      expect(container.querySelectorAll('.mr-family-trash')).toHaveLength(4)
      expect(rowByLabel(container, 'Orchestrator').querySelector('.mr-family-trash')).toBeNull()

      const trash = rowByLabel(container, 'OpenCode').querySelector('.mr-family-trash')
      expect(trash.getAttribute('aria-label')).toBe('Delete OpenCode')
      expect(rowByLabel(container, 'OpenCode 2').querySelector('.mr-family-trash')).not.toBeNull()

      await click(root, trash)
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Remove "OpenCode"? This cannot be undone.')
      await click(root, buttonWithText(card, 'Remove'))
      expect(calls.deleteLane).toEqual([{ key: 'opencode', confirmed: true }])
    })
  })

  it('removes a sub orchestrator from its trash button and returns its lanes', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const trash = rowByLabel(container, 'Frontend').querySelector('.mr-family-trash')
      expect(trash.getAttribute('aria-label')).toBe('Delete Frontend')

      await click(root, trash)
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Remove "Frontend"? Its agents return to the orchestrator.')
      await click(root, buttonWithText(card, 'Remove'))
      expect(calls.setLadder).toEqual([{ subs: [] }])
    })
  })

  it('starts the add child form on OpenCode and creates an opencode lane, never an agy lane', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      await click(root, rowByLabel(container, 'Orchestrator').querySelector('.mr-family-add'))

      const form = container.querySelector('.mr-family-child')
      expect(form).not.toBeNull()
      const harnessButtons = form.querySelectorAll('.mr-side-harness')
      expect(harnessButtons.map((button) => button.textContent.trim())).toEqual([
        'Claude Code',
        'OpenCode',
        'Direct API',
      ])
      const opencode = harnessButtons.find((button) => button.textContent.trim() === 'OpenCode')
      expect(classesOf(opencode)).toContain('is-on')
      expect(opencode.getAttribute('aria-pressed')).toBe('true')

      const label = form.querySelector('input[aria-label="New agent label"]')
      await act(async () => {
        label.focus()
        label.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
        label.value = 'Writer'
        label.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
      })
      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })

      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Create "Writer" under Orchestrator?')
      await click(root, buttonWithText(card, 'Create'))

      expect(calls.createLane).toEqual([
        {
          name: 'Writer',
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
          effort: 'max',
          confirmed: true,
        },
      ])
      expect(calls.createLane.some((payload) => payload.harness === 'agy')).toBe(false)
      const writer = rowByLabel(container, 'Writer')
      expect(writer).not.toBeNull()
      expect(writer.getAttribute('data-kind')).toBe('lane')
      expect(writer.querySelector('.mr-family-meta').textContent).toContain('opencode')
    })
  })
})
