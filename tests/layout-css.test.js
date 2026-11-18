import { readFileSync } from 'node:fs'
import { list, parse } from 'postcss'
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

describe('shared panel controls', () => {
  it('uses the panel tokens, room palette and the two room fonts', () => {
    const sheet = parse(css)
    const roots = sheet.nodes.filter((node) => node.selector === ':root')
    const tokens = {
      '--surface-1': 'rgb(255 255 255 / 0.04)',
      '--surface-2': 'rgb(255 255 255 / 0.08)',
      '--border-soft': 'rgb(255 255 255 / 0.16)',
      '--text-faint': 'rgb(255 255 255 / 0.38)',
      '--radius-s': '6px',
      '--radius-m': '12px',
      '--control-h': '28px',
    }
    const panelRoot = roots.find((node) => node.nodes.some(({ prop }) => prop === '--control-h'))
    expect(panelRoot).toBeDefined()
    expect(Object.fromEntries(panelRoot.nodes.map(({ prop, value }) => [prop, value]))).toEqual(tokens)
    const room = Object.fromEntries(roots.flatMap((node) => node.nodes.map(({ prop, value }) => [prop, value])))
    const colors = ['--black', '--white', '--yellow', '--red', '--green', '--text-dim',
      '--surface-1', '--surface-2', '--border-soft', '--text-faint', '--ui-chip-border']
    const colorLiteral = /^(?:transparent|currentcolor|#(?:000000|ffffff|e5ff00|ff2a2a|2aff80|2a9dff)|rgb\((?:255 255 255|0 0 0) \/ (?:0(?:\.\d+)?|1)\))$/i
    for (const name of colors.filter((name) => name !== '--ui-chip-border')) {
      expect(room[name], name).toMatch(colorLiteral)
    }
    expect(room['--sans']).toMatch(/^'Jost',/)
    expect(room['--mono']).toMatch(/^'Space Mono',/)

    sheet.walkRules((block) => {
      if (!/\.ui-/.test(block.selector.replace(/:not\([^)]*\)/g, ''))) return
      block.walkDecls(({ prop, value }) => {
        const where = `${block.selector} ${prop}`
        expect(prop, where).not.toBe('font')
        if (prop === 'font-family') expect(['var(--sans)', 'var(--mono)'], where).toContain(value)
        if (prop === 'font-weight') expect(['400', '500'], where).toContain(value)
        if (!/^(?:--ui-chip-border|[\w-]*color|background(?:-image)?|outline|border(?:-(?:top|bottom|left|right))?|[\w-]*shadow|filter|fill|stroke)$/.test(prop)) return
        for (const part of list.space(value)) {
          const word = part.replace(/,$/, '')
          if (/^(?:0|none|solid|-?\d+px)$/.test(word)) continue
          if (word.startsWith('var(')) {
            expect(word, where).toMatch(/^var\(--[\w-]+(?:, var\(--[\w-]+\))?\)$/)
            for (const [, name] of word.matchAll(/var\((--[\w-]+)/g)) expect(colors, where).toContain(name)
          } else {
            expect(word, where).toMatch(colorLiteral)
          }
        }
      })
    })
  })

  it('keeps focus visible and row actions available to the keyboard', () => {
    const controls = parse(css)
    const rings = []
    controls.walkRules(/\.ui-.*focus-visible/, (block) => {
      if (block.nodes.some(({ prop, value }) => prop === 'outline' && value === '1px solid var(--white)')) {
        expect(block.nodes.find(({ prop }) => prop === 'outline-offset')?.value).toBe('2px')
        rings.push(block.selector)
      }
    })
    for (const selector of ['.ui-chip', '.ui-chip-select', '.ui-icon-btn', '.ui-switch', '.ui-menu-item', '.ui-row', '.ui-hover-anchor']) {
      expect(rings.join(' ')).toContain(selector)
    }
    expect(rule('.ui-chip-select > select').appearance).toBe('none')
    expect(rule('.ui-row-trailing').opacity).toBe('0')
    expect(rule('.ui-row-trailing').visibility).toBeUndefined()
    expect(css).toMatch(/\.ui-row:is\(:hover, :focus-within, [^\n]+\.ui-row-trailing,[\s\S]*?opacity: 1/)
  })
})

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
  it('places the marker chooser above its tick and bounds it to the viewport', () => {
    const chooser = rule('.scrubber-overflow:popover-open')
    expect(chooser.position).toBe('fixed')
    expect(chooser.inset).toBe('auto')
    expect(chooser.margin).toBe('0')
    expect(chooser.left).toMatch(/^clamp\(.*var\(--marker-x\).*100%/)
    expect(chooser.bottom).toBe('var(--chooser-inset)')
    expect(chooser['--chooser-inset']).toMatch(/^clamp\(.*var\(--marker-edge\).*100%/)
    expect(chooser['max-height']).toContain('100% - var(--chooser-inset)')
    expect(chooser.overflow).toBe('auto')
    expect(rule(".scrubber-overflow[data-side='below']:popover-open")).toEqual({
      top: 'var(--chooser-inset)', bottom: 'auto',
    })
  })

  it('keeps family targets inside their row', () => {
    const height = 'var(--control-h)'
    expect(pixels(rule('.ui-row:has(.ui-row-detail)')['min-height'])).toBeGreaterThanOrEqual(28)
    expect(rule('.ui-row')['align-items']).toBe('center')
    expect(rule('button.ui-icon-btn')).toMatchObject({ width: height, height })
    expect(rule('button.ui-switch')).toMatchObject({ 'min-width': height, height })
    expect(rule('.mr-family-actions').gap).toBe('var(--space)')
  })

  it('reserves header action space and keeps selection on one line', () => {
    const actions = merged('.mr-family-header-actions')
    expect(actions.flex).toBe('0 0 auto')
    expect(actions.opacity).toBe('0')
    expect(actions.width).toBeUndefined()
    expect(merged('.mr-family-selection')['flex-wrap']).toBeUndefined()
    expect(rule('.mr-family-selection-count')['white-space']).toBe('nowrap')
  })

  it('keeps row actions steady, reserves the Agents scrollbar gutter, aligns section titles and uses row surface for the selection bar', () => {
    const trailing = merged('.mr-family-row .ui-row-trailing')
    expect(trailing.flex).toBe('0 0 calc(var(--control-h) * 2 + var(--space))')
    expect(trailing.width).toBeUndefined()
    expect(trailing['margin-left']).toBeUndefined()
    expect(rule('.mr-side-body:has(> .mr-side-agents)')['scrollbar-gutter']).toBe('stable')

    const heads = sharedBlock(['button.mr-family-heading', '.mr-side .mr-family-heading', '.mr-team > .mr-side-head'])
    expect(heads).toBeTruthy()
    expect(declarations(heads[2]).padding).toBe('0 var(--space)')

    const selection = rule('.mr-family-selection')
    expect(selection.background).toBe('var(--surface-1)')
    expect(selection.border).toBe('0')
    expect(selection['border-radius']).toBe('var(--radius-s)')
    expect(rule('.mr-family-selection button.ui-chip.is-primary:not(:disabled)')['--ui-chip-border']).toBe('var(--yellow)')
    expect(rule('.mr-family-selection button.ui-chip.is-quiet')['--ui-chip-border']).toBe('transparent')
  })

  it('hides hover cards while Agents menus are open and keeps sidebar read errors off Agents', () => {
    expect(rule("body:has(.mr-family [aria-haspopup='menu'][aria-expanded='true']) > .ui-hovercard").visibility).toBe('hidden')
    expect(rule('.mr-side:has(> .mr-side-body > .mr-side-agents) > .mr-side-error:not([role])').display).toBe('none')
  })

  it('checks every stylesheet rule that gives a button a side under 24 pixels', () => {
    const exceptions = {
      '.lens-bar': 'Read-only lens progress track.',
      '.lens-bar-fill': 'Read-only lens progress fill.',
      '.mr-guide-dot': 'Read-only guide progress mark.',
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
      '.mr-family-vline': 'Decorative family tree connector.',
      '.mr-family-hline': 'Decorative family tree connector.',
      '.mr-family-dot': 'Status indicator inside a family tree row.',
      '.mr-orch-dot': 'Status indicator inside a chip or the status line.',
      '.mr-agent-dot': 'Decorative sender dot inside a name.',
      '.lens-edge-corner': 'Decorative lens corner.',
      '.mr-family-agent-check': 'Checkbox inside a clickable family editor label.',
    }
    const growsInHeightOnly = new Set(['.scrubber-tick'])
    parse(css).walkRules((block) => {
      if (!block.nodes.some(({ prop, value }) => ['width', 'height'].includes(prop) && pixels(value) < 24)) return
      for (const selector of block.selectors) {
        if (selector.includes('::') || Object.hasOwn(exceptions, selector)) continue
        const anchor = selector === '.hud-action-badge' ? '.hud-action-slot > button.hud-action-badge' : selector
        const after = merged(`${anchor}::after`)
        expect(after.content, `hit area for ${selector}`).toBe("''")
        if (!growsInHeightOnly.has(selector)) expect(pixels(after['min-width']), selector).toBeGreaterThanOrEqual(24)
        expect(pixels(after['min-height']), selector).toBeGreaterThanOrEqual(24)
      }
    })
  })

  it('gives the four remaining small buttons the shared 24 pixel hit area', () => {
    for (const selector of ['.mr-autocompact-unit', '.mr-model-refresh', '.waiting-close']) {
      const after = merged(`${selector}::after`)
      expect(after.content, selector).toBe("''")
      expect(after.position, selector).toBe('absolute')
      expect(after.left, selector).toBe('50%')
      expect(after.top, selector).toBe('50%')
      expect(after.transform, selector).toBe('translate(-50%, -50%)')
      expect(pixels(after['min-width']), selector).toBeGreaterThanOrEqual(24)
      expect(pixels(after['min-height']), selector).toBeGreaterThanOrEqual(24)
      expect(merged(selector).position, selector).toBe('relative')
    }
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bare).toMatch(/\.mr-autocompact-unit \{[^}]*height: 22px/)
    expect(bare).toMatch(/\.mr-model-refresh \{[^}]*width: 22px/)
    expect(bare).toMatch(/\.mr-model-refresh \{[^}]*height: 22px/)
    expect(bare).toMatch(/\.waiting-close \{[^}]*min-width: 20px/)
    expect(bare).toMatch(/\.waiting-close \{[^}]*height: 20px/)
  })

  it('keeps the seek marker targets below the full slider row', () => {
    expect(rule('.scrubber').display).toBe('grid')
    expect(rule('.scrubber')['grid-template-rows']).toBe('24px auto')
    expect(rule(".transport input[type='range']").height).toBe('24px')
    const rail = rule('.scrubber-markers')
    expect(rail.position).toBe('relative')
    expect(rail.height).toBe('calc(var(--marker-rows) * 24px)')
    const tick = rule('.scrubber-tick')
    expect(tick.top).toBe('calc((var(--marker-row) + 0.5) * 24px)')
    expect(tick.width).toBe('4px')
    expect(tick.height).toBe('var(--tick-height, calc(var(--space) * 2))')
    const hover = rule('.scrubber-tick:hover:not(:disabled)')
    expect(pixels(hover['--tick-height'])).toBeLessThanOrEqual(24)
    expect(hover.transform).toBeUndefined()
    const after = merged('.scrubber-tick::after')
    expect(after.content).toBe("''")
    expect(after.position).toBe('absolute')
    expect(after.left).toBe('50%')
    expect(after.top).toBe('50%')
    expect(after.transform).toBe('translate(-50%, -50%)')
    expect(after.width).toBe('100%')
    expect(after.height).toBe('100%')
    expect(after['min-width']).toBeUndefined()
    expect(pixels(after['min-height'])).toBe(24)
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
    ]
    const shared = sharedBlock(selectors)
    expect(shared).toBeTruthy()
    const size = declarations(shared[2])
    expect(pixels(size['min-width'])).toBeGreaterThanOrEqual(24)
    expect(pixels(size['min-height'])).toBeGreaterThanOrEqual(24)
    const targets = sharedBlock(selectors, (body) => body.includes("content: ''"))
    expect(targets).toBeTruthy()
    expect(declarations(targets[2])).toMatchObject({ position: 'absolute', left: '50%', top: '50%', width: '100%', height: '100%', transform: 'translate(-50%, -50%)' })
    const anchors = selectors.filter((selector) => selector.endsWith('::after') && !selector.includes('hud-action-badge') && !selector.includes('mr-side-switch')).map((selector) => selector.slice(0, -7))
    expect(sharedBlock(anchors, (body) => declarations(body).position === 'relative')).toBeTruthy()
    expect(rule('.hud-action-slot > .hud-action-badge').position).toBe('absolute')
    expect(rule('.mr-side .mr-side-switch').position).toBe('relative')
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
