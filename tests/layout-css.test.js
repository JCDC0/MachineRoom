import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
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

function sharedBlock(selectors, wanted = () => true) {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  return blocks.find(([, names, body]) => wanted(body) && selectors.every((selector) => names.split(',').map((name) => name.trim()).includes(selector)))
}

function merged(selector) {
  const found = {}
  for (const [, names, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!names.split(',').map((name) => name.trim()).includes(selector)) continue
    Object.assign(found, declarations(body))
  }
  return found
}

function pixels(value) {
  const space = /--space:\s*(\d+)px/.exec(css)
  expect(space, 'the 8 pixel space token').not.toBeNull()
  const multiple = /^calc\(var\(--space\)\s*\*\s*(\d+)\)$/.exec(value)
  if (multiple) return Number(multiple[1]) * Number(space[1])
  const fixed = /^((?:\d*\.)?\d+)px$/.exec(value)
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
    expect(rule('.transport-agents-list').position).toBe('fixed')
    expect(rule('.transport-agents-list').bottom).toBe('var(--agents-list-bottom)')
    expect(rule('.transport-agents-list')['max-height']).toContain('--agents-list-height')
    expect(rule('.transport-agent')['white-space']).toBe('nowrap')
  })

  it('aligns agent rows in a grid and highlights them on hover', () => {
    const list = rule('.transport-agents-list')
    const row = rule('.transport-agent')
    expect(list.display).toBe('grid')
    expect(list['grid-template-columns']).toBe('repeat(4, max-content)')
    expect(row.display).toBe('grid')
    expect(row['grid-template-columns']).toBe('subgrid')
    expect(rule('button:hover:not(:disabled)')['border-color']).toBe('var(--white)')
  })

  it('colours every state word', () => {
    expect(css).toMatch(/\.transport-agent-state\.is-working,[\s\S]*?\.transport-agent-state\.is-waiting \{ color: var\(--yellow\); \}/)
    expect(css).toMatch(/\.transport-agent-state\.is-failed,[\s\S]*?color: var\(--red\)/)
    expect(css).toMatch(/\.transport-agent-state\.is-finished,[\s\S]*?\.transport-agent-state\.is-succeeded \{ color: var\(--green\); \}/)
    expect(rule('.transport-agent-state.is-idle').color).toBe('rgb(255 255 255 / 0.5)')
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

describe('run-end room notice layout', () => {
  it('keeps the notice on one line and clips the subject', () => {
    expect(rule('.mr-orch-line.is-run-notice')['min-width']).toBe('0')
    expect(rule('.mr-orch-run-summary')['white-space']).toBe('nowrap')
    expect(rule('.mr-orch-run-subject').overflow).toBe('hidden')
    expect(rule('.mr-orch-run-subject')['text-overflow']).toBe('ellipsis')
  })
})

describe('small control targets', () => {
  it('keeps family targets inside their row', () => {
    expect(pixels(rule('.mr-family-under')['min-height'])).toBeGreaterThanOrEqual(24)
    expect(rule('.mr-family-under')['align-items']).toBe('center')
    expect(pixels(rule('.mr-family-check-space').width)).toBe(pixels(merged('.mr-family .mr-family-check')['min-width']))
  })

  it('checks every stylesheet rule that gives a button a side under 24 pixels', () => {
    const exceptions = {
      '.lens-bar': 'Read-only lens progress track.',
      '.lens-bar-fill': 'Read-only lens progress fill.',
      '.mr-guide-dot': 'Read-only guide progress mark.',
      '.scrubber-tick': 'Existing 4 pixel seek marker for a point on the timeline.',
      '.mr-board-bar-track': 'Read-only cost meter track.',
      '.mr-board-bar': 'Read-only cost meter fill.',
      ".panel-checkbox-field input[type='checkbox']": 'Checkbox inside a clickable label.',
      '.meter-track': 'Read-only meter track.',
      '.mr-card-bracket': 'Decorative corner bracket.',
      '.mr-card-tab': 'Decorative card edge.',
      '.mr-item': 'Clickable file row in a 3D folder card, rendered as a div.',
      '.mr-card-more': 'Read-only count of hidden card rows.',
      '.mr-orch-tab-dot': 'Unread indicator inside a tab.',
      '.mr-side .mr-side-twist': 'Expand icon inside a sidebar control.',
      '.mr-side-folder': 'Folder icon inside a sidebar control.',
      '.mr-side-unread': 'Unread indicator inside a sidebar control.',
      '.lens-rail-track': 'Vertical slider track.',
      '.lens-rail-fill': 'Decorative line inside the slider.',
      '.lens-rail-handle': 'Decorative marker inside the slider.',
      '.mr-side-switch-knob': 'Decorative knob inside the switch.',
      '.mr-side-input': 'Sidebar text field.',
      '.mr-side-select': 'Sidebar select field.',
      '.mr-autocompact-unit': 'Existing 22 pixel button in the unit toggle.',
      '.mr-family-vline': 'Decorative family tree connector.',
      '.mr-family-hline': 'Decorative family tree connector.',
      '.mr-family-dot': 'Status indicator inside a family tree row.',
      '.lens-edge-corner': 'Decorative lens corner.',
      '.mr-model-refresh': 'Existing 22 pixel model-list refresh button.',
      '.mr-family-agent-check': 'Checkbox inside a clickable family editor label.',
      '.waiting-close': 'Existing 20 pixel dismiss button on the waiting notice.',
    }
    parse(css).walkRules((block) => {
      if (!block.nodes.some(({ prop, value }) => ['width', 'height'].includes(prop) && pixels(value) < 24)) return
      for (const selector of block.selectors) {
        if (selector.includes('::') || Object.hasOwn(exceptions, selector)) continue
        const anchor = selector === '.hud-action-badge' ? '.hud-action-slot > button.hud-action-badge' : selector
        const after = merged(`${anchor}::after`)
        expect(after.content, `hit area for ${selector}`).toBe("''")
        expect(pixels(after['min-width']), selector).toBeGreaterThanOrEqual(24)
        expect(pixels(after['min-height']), selector).toBeGreaterThanOrEqual(24)
      }
    })
  })

  it('gives every target at least 24 pixels in both directions', () => {
    const selectors = [
      '.lens-failures-clear::after',
      '.hud-band-switch::after',
      '.hud-action-slot > button.hud-action-badge::after',
      '.transport-spend::after',
      '.mr-side .mr-side-menu-button::after',
      '.mr-side .mr-side-switch::after',
      '.mr-side .mr-side-open-folder::after',
      '.mr-side .mr-repo-tree::after',
      '.mr-side .mr-repo-switch::after',
      '.mr-family .mr-family-add::after',
      '.mr-family .mr-family-chat::after',
      '.mr-family .mr-family-trash::after',
      '.mr-family .mr-family-check',
    ]
    const shared = sharedBlock(selectors)
    expect(shared).toBeTruthy()
    const size = declarations(shared[2])
    expect(pixels(size['min-width'])).toBeGreaterThanOrEqual(24)
    expect(pixels(size['min-height'])).toBeGreaterThanOrEqual(24)
    const targets = sharedBlock(selectors.slice(0, -1), (body) => body.includes("content: ''"))
    expect(targets).toBeTruthy()
    expect(declarations(targets[2])).toMatchObject({ position: 'absolute', left: '50%', top: '50%', width: '100%', height: '100%', transform: 'translate(-50%, -50%)' })
    const anchors = selectors.filter((selector) => selector.endsWith('::after') && !selector.includes('hud-action-badge') && !selector.includes('mr-side-switch')).map((selector) => selector.slice(0, -7))
    expect(sharedBlock(anchors, (body) => declarations(body).position === 'relative')).toBeTruthy()
    expect(rule('.hud-action-slot > .hud-action-badge').position).toBe('absolute')
    expect(rule('.mr-side .mr-side-switch').position).toBe('relative')
    expect(pixels(rule('.mr-family-actions').gap)).toBeGreaterThanOrEqual(6)
  })

  it('gives the six small controls a 24 pixel hit area without a neighbour overlap', () => {
    const six = [
      '.hud-band-switch',
      '.hud-action-slot > button.hud-action-badge',
      '.transport-spend',
      '.mr-side .mr-side-open-folder',
      '.mr-side .mr-repo-tree',
      '.mr-side .mr-repo-switch',
    ]
    for (const selector of six) {
      const after = merged(`${selector}::after`)
      expect(after.content, selector).toBe("''")
      expect(after.position, selector).toBe('absolute')
      expect(after.left, selector).toBe('50%')
      expect(after.top, selector).toBe('50%')
      expect(after.transform, selector).toBe('translate(-50%, -50%)')
      expect(pixels(after['min-width']), selector).toBeGreaterThanOrEqual(24)
      expect(pixels(after['min-height']), selector).toBeGreaterThanOrEqual(24)
    }
    for (const selector of six.filter((name) => name !== '.hud-action-slot > button.hud-action-badge')) {
      expect(merged(selector).position, selector).toBe('relative')
    }
    expect(rule('.hud-band-switch').padding).toBe('0')
    expect(rule('.hud-band-switch')['min-width']).toBe('0')
    expect(rule('.hud-action-badge')['min-width']).toBe('16px')
    expect(rule('.hud-action-badge').height).toBe('16px')
    expect(rule('.mr-side .mr-side-open-folder').padding).toBe('2px 4px')
    expect(rule('.mr-side .mr-repo-tree').padding).toBe('2px 4px')
    expect(rule('.mr-side .mr-repo-switch').padding).toBe('2px 4px')
  })

  it('keeps the six hit areas side by side to the extra height only', () => {
    for (const selector of ['.hud-band-switch', '.mr-side .mr-repo-switch']) {
      const after = merged(`${selector}::after`)
      expect(after.width, selector).toBe('100%')
      expect(after.height, selector).toBe('100%')
      expect(pixels(after['min-width']), selector).toBe(24)
      expect(pixels(after['min-height']), selector).toBe(24)
    }
    expect(rule('.mr-repo-row')['flex-wrap']).toBe('wrap')
    expect(rule('.mr-repo-row').gap).toBe('2px 6px')
  })
})

describe('the command console', () => {
  it('uses white activity styling without a cyan glow or fill', () => {
    const consoleRule = rule('.mr-term-console')
    const label = rule('.mr-term-console-label')
    expect(consoleRule.color).toBe('var(--white)')
    expect(consoleRule.border).toBe('1px solid var(--white)')
    expect(consoleRule['box-shadow']).toBeUndefined()
    expect(label.color).toBe('var(--white)')
    expect(label.background).toBeUndefined()
    expect(label['border-bottom']).toBe('1px solid rgb(255 255 255 / 0.35)')
    expect(rule('.mr-term-console-link').color).toBe('var(--white)')
    expect(rule('.mr-term-console-line.is-dim').color).toBe('rgb(255 255 255 / 0.62)')
    expect(css).not.toMatch(/--cyan|56 232 255|#38e8ff/i)
    expect(css).not.toMatch(/\.mr-term-console\.is-address\s*\{/)
  })
})
