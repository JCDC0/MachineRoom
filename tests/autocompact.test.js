import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AgentDock from '../src/ui/AgentDock.jsx'
import CompactCard from '../src/ui/AgentStrip.jsx'
import AutocompactInput from '../src/ui/AutocompactInput.jsx'
import {
  DEFAULT_COMPACT_RULES,
  RULES_LIMIT,
  autocompactRequest,
  autocompactState,
  clampRules,
  compactsAtLine,
  convertAutocompactValue,
  defaultCompactRulesFor,
  valueProblem,
} from '../src/ui/autocompact.js'

const answer = {
  id: 'orchestrator',
  name: 'Orchestrator',
  autocompact: false,
  autocompactMode: 'tokens',
  autocompactValue: 160000,
  compactRules: 'Keep the tests',
  contextWindow: 200000,
}

describe('the autocompact answer', () => {
  it('reads the mode, value and rules', () => {
    expect(autocompactState(answer)).toEqual({
      id: 'orchestrator',
      on: false,
      mode: 'tokens',
      value: 160000,
      rules: 'Keep the tests',
      window: 200000,
      defaultCompactRules: DEFAULT_COMPACT_RULES,
    })
  })

  it('falls back to the percent in percent mode', () => {
    const state = autocompactState({ autocompact: true, autocompactPercent: 65 })
    expect(state.mode).toBe('percent')
    expect(state.value).toBe(65)
    expect(state.on).toBe(true)
  })

  it('reads a tokens answer without a value through the window', () => {
    const state = autocompactState({ autocompactMode: 'tokens', autocompactPercent: 80, contextWindow: 200000 })
    expect(state.mode).toBe('tokens')
    expect(state.value).toBe(160000)
  })

  it('takes percent 80 and the default rules when the answer is bare', () => {
    const state = autocompactState(null)
    expect(state).toMatchObject({
      id: 'orchestrator',
      on: true,
      mode: 'percent',
      value: 80,
      rules: '',
      window: 200000,
    })
    expect(state.defaultCompactRules).toBe(DEFAULT_COMPACT_RULES)
    expect(autocompactState({ autocompactMode: 'hours' }).mode).toBe('percent')
  })

  it('keeps a named default and caps the rules', () => {
    expect(defaultCompactRulesFor({ defaultCompactRules: 'Server defaults' })).toBe('Server defaults')
    expect(clampRules('x'.repeat(RULES_LIMIT + 20))).toHaveLength(RULES_LIMIT)
    expect(autocompactState({ compactRules: 'r'.repeat(RULES_LIMIT + 1) }).rules).toHaveLength(RULES_LIMIT)
    expect(autocompactState({ compactRules: 'keep' }).rules).toBe('keep')
    expect(autocompactState({ compactRules: 7 }).rules).toBe('')
  })
})

describe('the unit conversion', () => {
  it('reads 80 percent of 200000 as 160000 tokens and back', () => {
    expect(convertAutocompactValue(80, 'percent', 'tokens', 200000)).toBe(160000)
    expect(convertAutocompactValue(160000, 'tokens', 'percent', 200000)).toBe(80)
    expect(convertAutocompactValue(75.5, 'percent', 'tokens', 200000)).toBe(151000)
    expect(convertAutocompactValue(151000, 'tokens', 'percent', 200000)).toBe(75.5)
    expect(convertAutocompactValue(33.33, 'percent', 'tokens', 200000)).toBe(66660)
    expect(convertAutocompactValue(66660, 'tokens', 'percent', 200000)).toBe(33.33)
  })

  it('leaves an empty value and an unknown window alone', () => {
    expect(convertAutocompactValue('', 'percent', 'tokens', 200000)).toBe('')
    expect(convertAutocompactValue(80, 'percent', 'tokens', 0)).toBe(160000)
    expect(convertAutocompactValue(80, 'percent', 'percent', 200000)).toBe(80)
  })
})

describe('the compacts at line', () => {
  it('names the tokens for either unit', () => {
    expect(compactsAtLine('percent', 80, 200000)).toBe('Compacts at 160000 of 200000 tokens')
    expect(compactsAtLine('tokens', 160000, 200000)).toBe('Compacts at 160000 of 200000 tokens')
    expect(compactsAtLine('percent', 62.5, 80000)).toBe('Compacts at 50000 of 80000 tokens')
    expect(compactsAtLine('percent', '', 200000)).toBe('')
  })
})

describe('the limits from O14', () => {
  it('takes a percent above 0 and at most 100, decimals allowed', () => {
    expect(valueProblem('percent', 80)).toBe('')
    expect(valueProblem('percent', 0.5)).toBe('')
    expect(valueProblem('percent', 100)).toBe('')
    expect(valueProblem('percent', '99.5')).toBe('')
    expect(valueProblem('percent', 0)).toBe('Percent must be above 0 and at most 100.')
    expect(valueProblem('percent', 100.5)).toBe('Percent must be above 0 and at most 100.')
    expect(valueProblem('percent', -1)).toBe('Percent must be above 0 and at most 100.')
  })

  it('takes a whole token count from 1000 to 10000000', () => {
    expect(valueProblem('tokens', 1000)).toBe('')
    expect(valueProblem('tokens', 10000000)).toBe('')
    expect(valueProblem('tokens', 160000)).toBe('')
    expect(valueProblem('tokens', 999)).toBe('Tokens must be a whole number from 1000 to 10000000.')
    expect(valueProblem('tokens', 10000001)).toBe('Tokens must be a whole number from 1000 to 10000000.')
    expect(valueProblem('tokens', 1000.5)).toBe('Tokens must be a whole number from 1000 to 10000000.')
  })

  it('asks for a number when the box is empty', () => {
    expect(valueProblem('percent', '')).toBe('Enter a percent.')
    expect(valueProblem('tokens', '')).toBe('Enter a token count.')
    expect(valueProblem('percent', '  ')).toBe('Enter a percent.')
    expect(valueProblem('tokens', 'many')).toBe('Enter a token count.')
  })
})

describe('the save body', () => {
  it('carries the id, switch, mode, value, rules and the confirmation', () => {
    expect(
      autocompactRequest({ id: 'ui', on: true, mode: 'percent', value: '75.5', rules: ' Keep tests ' })
    ).toEqual({
      id: 'ui',
      on: true,
      mode: 'percent',
      value: 75.5,
      rules: 'Keep tests',
      confirmed: true,
    })
    expect(
      autocompactRequest({ id: 'orchestrator', on: false, mode: 'tokens', value: '160000.4', rules: '' })
    ).toEqual({
      id: 'orchestrator',
      on: false,
      mode: 'tokens',
      value: 160000,
      rules: '',
      confirmed: true,
    })
    expect(autocompactRequest({ on: true, mode: 'hours', value: 80 }).mode).toBe('percent')
    expect(autocompactRequest({ on: true, mode: 'percent', value: 80 }).id).toBe('orchestrator')
  })
})

describe('AutocompactInput', () => {
  it('draws the switch, a number input, both units and the line', () => {
    const html = renderToString(
      createElement(AutocompactInput, {
        orchestrator: {
          ...answer,
          autocompact: true,
          autocompactValue: 80,
          autocompactMode: 'percent',
          compactRules: '',
        },
        client: { setAutocompact: async () => ({}) },
      })
    )

    expect(html).toContain('class="mr-autocompact"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('checked')
    expect(html).toContain('type="number"')
    expect(html).not.toContain('type="range"')
    expect(html).toContain('value="80"')
    expect(html).toContain('aria-pressed="true">%</button>')
    expect(html).toContain('aria-pressed="false">tokens</button>')
    expect(html).toContain('Compacts at 160000 of 200000 tokens')
    expect(html).toContain('>Compact rules</label>')
    expect(html).toContain('maxLength="2000"')
    expect(html).toContain('Using the default rules.')
    expect(html).toContain('>Save</button>')
  })

  it('shows the tokens value and the server default rules', () => {
    const html = renderToString(
      createElement(AutocompactInput, {
        orchestrator: { ...answer, defaultCompactRules: 'Server defaults' },
        client: { setAutocompact: async () => ({}) },
      })
    )

    expect(html).toContain('value="160000"')
    expect(html).toContain('aria-pressed="false">%</button>')
    expect(html).toContain('aria-pressed="true">tokens</button>')
    expect(html).toContain('Compacts at 160000 of 200000 tokens')
    expect(html).toContain('placeholder="Server defaults"')
    expect(html).toContain('>Keep the tests</textarea>')
    expect(html).not.toContain('Using the default rules.')
  })

  it('says why an out of range value cannot be saved', () => {
    const html = renderToString(
      createElement(AutocompactInput, {
        orchestrator: { ...answer, autocompactMode: 'percent', autocompactValue: 120 },
        client: { setAutocompact: async () => ({}) },
      })
    )

    expect(html).toContain('Percent must be above 0 and at most 100.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  })

  it('checks a token count against the whole number limits', () => {
    const html = renderToString(
      createElement(AutocompactInput, {
        orchestrator: { ...answer, autocompactValue: 1000.5 },
        client: { setAutocompact: async () => ({}) },
      })
    )

    expect(html).toContain('Tokens must be a whole number from 1000 to 10000000.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  })

  it('says when the bridge cannot change autocompact', () => {
    const html = renderToString(createElement(AutocompactInput, { orchestrator: answer, client: {} }))
    expect(html).toContain('The bridge cannot change autocompact.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  })
})

describe('the autocompact input in place', () => {
  it('replaces the percent slider in the Compact card', () => {
    const html = renderToString(
      createElement(CompactCard, {
        id: 'orchestrator',
        orchestrator: { id: 'orchestrator', autocompact: true, autocompactPercent: 70, contextWindow: 200000 },
        client: { setAutocompact: async () => ({}) },
      })
    )

    expect(html).toContain('class="strip-card hud-strip-compact-card"')
    expect(html).toContain('class="mr-autocompact"')
    expect(html).toContain('type="number"')
    expect(html).not.toContain('type="range"')
    expect(html).toContain('Compacts at 140000 of 200000 tokens')
  })

  it('sits in the dock for an orchestrator and not for a lane', () => {
    const lane = { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', status: 'idle' }
    const orchestrator = { key: 'orchestrator', name: 'Orchestrator', status: 'idle' }
    const props = {
      agent: null,
      lanes: [lane, orchestrator],
      costs: null,
      liveRuns: [],
      tasks: [],
      log: [],
      orchestrator: { id: 'orchestrator', autocompact: true, autocompactPercent: 80, contextWindow: 200000 },
      client: { setAutocompact: async () => ({}) },
    }
    const dock = renderToString(createElement(AgentDock, props))
    expect(dock).toContain('class="agent-dock-autocompact"')
    expect(dock).toContain('class="mr-autocompact"')
    expect(dock).toContain('Compacts at 160000 of 200000 tokens')

    const laneDock = renderToString(createElement(AgentDock, { ...props, agent: lane }))
    expect(laneDock).not.toContain('mr-autocompact')
  })

  it('gives the input its own block in styles.css', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('/* U40: the autocompact value, its unit and the compact rules */')
    expect(css).toContain('.mr-autocompact-number')
    expect(css).toContain('.mr-autocompact-rules')
    expect(css).toContain('.agent-dock-autocompact')
  })
})
