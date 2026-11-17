import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function declarations(block) {
  const found = {}
  for (const part of block.split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    found[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  return found
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`).exec(css)
  expect(match, `a rule for ${selector}`).not.toBeNull()
  return declarations(match[1])
}

function pixels(value) {
  const space = /--space:\s*(\d+)px/.exec(css)
  expect(space, 'the 8 pixel space token').not.toBeNull()
  const multiple = /^calc\(var\(--space\)\s*\*\s*(\d+)\)$/.exec(value)
  if (multiple) return Number(multiple[1]) * Number(space[1])
  const fixed = /^(\d+)px$/.exec(value)
  return fixed ? Number(fixed[1]) : NaN
}

describe('the transport state word and the spend', () => {
  it('keeps at least 8 pixels between them', () => {
    const gap = rule('.transport.is-live.has-orchestrator')['column-gap']
    expect(gap).toBeTruthy()
    expect(pixels(gap)).toBeGreaterThanOrEqual(8)
  })

  it('lets the side groups keep their width so the middle shrinks instead of being overlapped', () => {
    const columns = rule('.transport.is-live.has-orchestrator')['grid-template-columns']
    expect(columns).toBe('minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)')
  })

  it('keeps the summary readable and lets the list scroll', () => {
    expect(rule('.transport-agents-toggle')['white-space']).toBe('nowrap')
    expect(rule('.transport-agents-list').overflow).toBe('auto')
    expect(rule('.transport-agent')['overflow-wrap']).toBe('anywhere')
  })
})

describe('the panel toolbar buttons', () => {
  it('gives a button directly in a toolbar the Team refresh size and type', () => {
    const panel = rule('.panel-toolbar > button')
    const team = rule('.agent-builder-toolbar-actions button')
    for (const property of ['padding', 'font-size', 'letter-spacing', 'text-transform', 'white-space']) {
      expect(panel[property], property).toBe(team[property])
    }
    expect(panel.border).toBeUndefined()
    expect(team.border).toBeUndefined()
    expect(rule('button').border).toBe('1px solid var(--line)')
  })
})

describe('the storage days label', () => {
  it('stays on one line beside its number box', () => {
    const label = rule(".mr-search-row:has(> input[type='number']) > .hud-settings-label")
    expect(label['white-space']).toBe('nowrap')
    expect(label.flex).toBe('none')
  })
})
