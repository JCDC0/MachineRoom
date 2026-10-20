import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud, { SHORTCUTS } from '../src/ui/Hud.jsx'
import {
  areAllTerminalsOpen,
  isTerminalOpen,
  logButtonAriaLabel,
  toggleAllTerminalsLabel,
} from '../src/ui/terminalButtons.js'

describe('terminal buttons helpers', () => {
  const sampleAgents = [
    { key: 'claude', name: 'Claude Code' },
    { key: 'hermes', name: 'Hermes' },
    { key: 'opencode', name: 'OpenCode' },
  ]

  it('detects when all agent terminals are open', () => {
    expect(areAllTerminalsOpen(sampleAgents, ['claude', 'hermes', 'opencode'])).toBe(true)
    expect(areAllTerminalsOpen(sampleAgents, new Set(['claude', 'hermes', 'opencode']))).toBe(true)
    expect(areAllTerminalsOpen(sampleAgents, ['claude', 'hermes', 'opencode', 'extra'])).toBe(true)
  })

  it('detects when not all agent terminals are open', () => {
    expect(areAllTerminalsOpen(sampleAgents, ['claude', 'hermes'])).toBe(false)
    expect(areAllTerminalsOpen(sampleAgents, [])).toBe(false)
    expect(areAllTerminalsOpen(sampleAgents, null)).toBe(false)
    expect(areAllTerminalsOpen(sampleAgents, undefined)).toBe(false)
  })

  it('handles empty or missing agents safely', () => {
    expect(areAllTerminalsOpen([], ['claude'])).toBe(false)
    expect(areAllTerminalsOpen(null, ['claude'])).toBe(false)
    expect(areAllTerminalsOpen(undefined, ['claude'])).toBe(false)
    expect(areAllTerminalsOpen([{ key: '' }], [''])).toBe(false)
  })

  it('returns Hide all when every agent terminal is open, Show all otherwise', () => {
    expect(toggleAllTerminalsLabel(sampleAgents, ['claude', 'hermes', 'opencode'])).toBe('Hide all')
    expect(toggleAllTerminalsLabel(sampleAgents, ['claude'])).toBe('Show all')
    expect(toggleAllTerminalsLabel(sampleAgents, [])).toBe('Show all')
    expect(toggleAllTerminalsLabel([], ['claude'])).toBe('Show all')
  })

  it('checks whether an individual terminal is open', () => {
    expect(isTerminalOpen(['claude', 'hermes'], 'claude')).toBe(true)
    expect(isTerminalOpen(['claude', 'hermes'], 'opencode')).toBe(false)
    expect(isTerminalOpen(new Set(['claude']), 'claude')).toBe(true)
    expect(isTerminalOpen(null, 'claude')).toBe(false)
    expect(isTerminalOpen([], null)).toBe(false)
  })

  it('formats the screen reader label for an agent log button', () => {
    expect(logButtonAriaLabel('Hermes', false)).toBe('Show the log of Hermes')
    expect(logButtonAriaLabel('Hermes', true)).toBe('Hide the log of Hermes')
    expect(logButtonAriaLabel('', false)).toBe('Show the log of agent')
    expect(logButtonAriaLabel(null, true)).toBe('Hide the log of agent')
  })
})

describe('Hud terminal buttons integration', () => {
  const snapshot = {
    position: 0,
    duration: 1000,
    agents: [
      { key: 'claude', name: 'Claude Code', status: 'idle' },
      { key: 'hermes', name: 'Hermes', status: 'working' },
    ],
  }

  it('renders log buttons and Show all button in Hud', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: 'claude',
        speeds: [1],
        rootName: 'MachineRoom',
        openTerminals: ['hermes'],
      })
    )

    expect(html).toContain('class="hud-agent-row"')
    expect(html).toContain('aria-label="Show the log of Claude Code"')
    expect(html).toContain('aria-label="Hide the log of Hermes"')
    expect(html).toContain('Show all')
    expect(html).not.toContain('Hide all')
  })

  it('renders Hide all when every agent chip is open', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        openTerminals: ['claude', 'hermes'],
      })
    )

    expect(html).toContain('Hide all')
    expect(html).toContain('aria-pressed="true">Hide all</button>')
  })

  it('places the T shortcut after F in the shortcut list', () => {
    const fIndex = SHORTCUTS.findIndex(([k]) => k === 'F')
    expect(fIndex).toBeGreaterThanOrEqual(0)
    expect(SHORTCUTS[fIndex + 1]).toEqual([
      'T',
      'Show or hide the log of the selected agent, or of every agent',
    ])
  })

  it('supports openTerminals as a Set', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot,
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
        openTerminals: new Set(['claude']),
      })
    )
    expect(html).toContain('aria-label="Hide the log of Claude Code"')
    expect(html).toContain('aria-label="Show the log of Hermes"')
  })

  it('renders gracefully with empty agents and default props', () => {
    const html = renderToString(
      React.createElement(Hud, {
        snapshot: { agents: [], position: 0, duration: 0 },
        focused: null,
        speeds: [1],
        rootName: 'MachineRoom',
      })
    )
    expect(html).toContain('Show all')
  })
})
