import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { boardLines, boardVisible, createCostBoard } from '../src/engine/board.js'
import { costBoard } from '../src/model/costs.js'
import { createMockClient } from '../src/control/mock.js'
import { toAgents } from '../src/live/source.js'

function createFakeElement(tagName = 'div') {
  const listeners = new Map()
  const children = []
  let text = ''

  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    children,
    parentNode: null,
    ownerDocument: {
      defaultView: {
        Element: function Element() {},
      },
    },
    append(...nodes) {
      children.push(...nodes)
    },
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
    },
    removeEventListener(event, fn) {
      const list = listeners.get(event)
      if (list) {
        const index = list.indexOf(fn)
        if (index !== -1) list.splice(index, 1)
      }
    },
    dispatchEvent(event) {
      const list = listeners.get(event?.type || event) || []
      for (const fn of list) fn(event)
    },
    click() {
      element.dispatchEvent({ type: 'click', stopPropagation() {} })
    },
    setAttribute(name, val) {
      element[name] = val
    },
    remove() {
      element.removed = true
    },
    querySelector(selector) {
      return element.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      const matches = []
      function search(node) {
        if (!node || typeof node !== 'object') return
        if (selector.startsWith('.')) {
          const cls = selector.slice(1)
          if (node.className && node.className.split(/\s+/).includes(cls)) {
            matches.push(node)
          }
        } else if (node.tagName === selector.toUpperCase()) {
          matches.push(node)
        }
        for (const child of node.children || []) search(child)
      }
      for (const child of children) search(child)
      return matches
    },
  }

  Object.defineProperty(element, 'textContent', {
    get() {
      return text
    },
    set(value) {
      text = String(value)
      if (value === '') children.length = 0
    },
  })

  return element
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = {
    createElement: (tag) => createFakeElement(tag),
  }
})

afterAll(() => {
  globalThis.document = savedDocument
})

describe('boardLines', () => {
  it('formats the mock costs and agents in roster order', async () => {
    const client = createMockClient()
    const [agentsRaw, costsRaw] = await Promise.all([client.agents(), client.costs()])
    const roster = toAgents(agentsRaw)
    const board = costBoard(costsRaw, roster)
    const lines = boardLines(board)

    expect(lines.empty).toBeNull()
    expect(lines.summary).toEqual({
      text: 'SPENT $4.90, NO BUDGET',
      over: false,
    })

    expect(lines.rows).toHaveLength(5)
    expect(lines.rows.map((row) => row.key)).toEqual(['claude', 'opencode', 'opencode2', 'opencode3', 'opencode4'])

    expect(lines.rows[0]).toEqual({
      key: 'claude',
      name: 'Claude Code',
      cost: '$2.18',
      tokens: '310.0k in / 26.0k out',
      share: 0.445,
      reported: true,
    })
    expect(lines.rows[1]).toEqual({
      key: 'opencode',
      name: 'OpenCode',
      cost: '$1.43',
      tokens: '214.0k in / 31.0k out',
      share: 0.292,
      reported: true,
    })
    expect(lines.rows[2]).toEqual({
      key: 'opencode2',
      name: 'OpenCode 2',
      cost: '$0.87',
      tokens: '96.0k in / 14.0k out',
      share: 0.178,
      reported: true,
    })
    expect(lines.rows[3]).toEqual({
      key: 'opencode3',
      name: 'OpenCode 3',
      cost: '$0.42',
      tokens: '51.0k in / 7.2k out',
      share: 0.086,
      reported: true,
    })
    expect(lines.rows[4]).toEqual({
      key: 'opencode4',
      name: 'OpenCode 4',
      cost: 'not reported',
      tokens: null,
      share: null,
      reported: false,
    })

    expect(lines.quota).toEqual([])
  })

  it('formats a row that is not reported', () => {
    const board = costBoard(
      {
        summary: { spendCents: 100, budgetCents: 500 },
        byAgent: [],
      },
      [{ id: 'agent-1', key: 'one', name: 'Agent One' }]
    )
    const lines = boardLines(board)

    expect(lines.rows).toHaveLength(1)
    expect(lines.rows[0]).toEqual({
      key: 'one',
      name: 'Agent One',
      cost: 'not reported',
      tokens: null,
      share: null,
      reported: false,
    })
  })

  it('formats over budget', () => {
    const board = costBoard(
      {
        summary: { spendCents: 1200, budgetCents: 1000, utilizationPercent: 120 },
      },
      []
    )
    const lines = boardLines(board)
    expect(lines.summary).toEqual({
      text: 'SPENT $12.00 OF $10.00 (120.0%)',
      over: true,
    })
  })

  it('formats no budget', () => {
    const board = costBoard(
      {
        summary: { spendCents: 123, budgetCents: 0 },
      },
      []
    )
    const lines = boardLines(board)
    expect(lines.summary).toEqual({
      text: 'SPENT $1.23, NO BUDGET',
      over: false,
    })
  })

  it('formats a failed provider error', () => {
    const board = costBoard(
      {
        quota: [{ provider: 'openai', ok: false, error: 'spawn codex ENOENT' }],
      },
      []
    )
    const lines = boardLines(board)
    expect(lines.quota).toEqual([
      { text: 'OPENAI spawn codex ENOENT', error: true },
    ])
  })

  it('marks direction characters in a quota error from Paperclip', () => {
    const board = costBoard({ quota: [{ provider: 'openai', ok: false, error: 'spawn ‮exe.codex' }] }, [])
    expect(boardLines(board).quota).toEqual([{ text: 'OPENAI spawn [U+202E]exe.codex', error: true }])
  })

  it('returns empty message on null', () => {
    const lines = boardLines(null)
    expect(lines).toEqual({
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    })
  })

  it('returns empty message on junk input', () => {
    expect(boardLines('junk')).toEqual({
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    })
    expect(boardLines(42)).toEqual({
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    })
    expect(boardLines({})).toEqual({
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    })
    expect(boardLines({ summary: null, rows: null })).toEqual({
      summary: null,
      rows: [],
      quota: [],
      empty: 'Costs not available.',
    })
  })
})

describe('createCostBoard', () => {
  it('adds its element to the container, updates rows, handles pick, and removes on dispose', async () => {
    const container = document.createElement('div')
    const onPick = vi.fn()
    const board = createCostBoard(container, { onPick })

    expect(container.children).toHaveLength(1)
    expect(container.children[0]).toBe(board.element)
    expect(board.element.className).toBe('mr-board')
    expect(board.object).toBeUndefined()

    const client = createMockClient()
    const [agentsRaw, costsRaw] = await Promise.all([client.agents(), client.costs()])
    const roster = toAgents(agentsRaw)
    const boardData = costBoard(costsRaw, roster)

    board.update(boardData)

    const rows = board.element.querySelectorAll('.mr-board-row')
    expect(rows).toHaveLength(5)

    const quotas = board.element.querySelectorAll('.mr-board-quota')
    expect(quotas).toHaveLength(0)

    rows[1].click()
    expect(onPick).toHaveBeenCalledWith('opencode')

    rows[3].click()
    expect(onPick).toHaveBeenCalledWith('opencode3')

    board.dispose()
    expect(board.element.removed).toBe(true)
  })

  it('hides below 900 pixels wide and shows at 900', () => {
    expect(boardVisible(899)).toBe(false)
    expect(boardVisible(900)).toBe(true)

    const board = createCostBoard(document.createElement('div'))
    board.setVisible(false)
    expect(board.element.style.display).toBe('none')
    board.setVisible(true)
    expect(board.element.style.display).toBe('')
    board.dispose()
  })
})
