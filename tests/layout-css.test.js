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

describe('the flat menu row', () => {
  const top = [
    '.hud-band-project',
    '.hud-band-switch',
    '.hud-modes button',
    '.hud-action',
    '.hud-action-slot > .hud-action-badge',
    '.hud-health-chip',
  ]

  function wideBlock() {
    const sheet = parse(css)
    const found = sheet.nodes.find(
      (node) =>
        node.type === 'atrule' &&
        node.params === '(min-width: 900px)' &&
        node.toString().includes('.hud-menu.is-flat')
    )
    expect(found, 'the flat rule in the 900 pixel block').toBeDefined()
    return found
  }

  it('straightens the six top buttons once the page leaves the top', () => {
    expect(merged('.hud-menu.is-flat .hud-action').transform).toBe('none')
    const wide = wideBlock()
    for (const selector of top) {
      expect(merged(`.hud-menu.is-flat ${selector}`).transform, selector).toBe('none')
      const slows = []
      wide.walkRules((block) => {
        if (!block.selectors.includes(selector)) return
        block.walkDecls('transition', (decl) => slows.push(decl.value))
      })
      expect(slows.join(' '), selector).toContain('transform 0.24s ease')
    }
    expect(rule('.hud-action').transition).toBeUndefined()
    expect(css).toContain('border-color 150ms, color 150ms, background-color 150ms, transform 0.24s ease')
    for (const selector of ['.transport-badge', '.transport-center', '.speeds button']) {
      expect(merged(`.hud-menu.is-flat ${selector}`).transform, selector).toBeUndefined()
    }
  })

  it('does not animate the straightening under reduced motion', () => {
    const sheet = parse(css)
    const quiet = sheet.nodes.find(
      (node) =>
        node.type === 'atrule' &&
        node.params === '(min-width: 900px) and (prefers-reduced-motion: reduce)'
    )
    expect(quiet, 'the reduced motion block for the flat menu row').toBeDefined()
    const quieted = []
    quiet.walkRules((block) => {
      if (!block.nodes.some(({ prop, value }) => prop === 'transition' && value === 'none')) return
      quieted.push(...block.selectors)
    })
    for (const selector of top) expect(quieted, selector).toContain(selector)
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

  it('keeps row actions steady while giving the model line full width, reserves the Agents scrollbar gutter, aligns section titles and uses row surface for the selection bar', () => {
    expect(rule('.mr-family-row').position).toBe('relative')
    const trailing = merged('.mr-family-row .ui-row-trailing')
    expect(trailing.position).toBe('absolute')
    expect(trailing.top).toBe('0')
    expect(trailing.right).toBe('var(--space)')
    expect(trailing.width).toBe('calc(var(--control-h) * 2 + var(--space))')
    expect(trailing.height).toBe('var(--control-h)')
    expect(trailing.opacity).toBe('0')
    expect(trailing['margin-left']).toBeUndefined()
    const top = rule('.mr-family-top')
    expect(top['min-height']).toBe('var(--control-h)')
    expect(top['padding-right']).toBe('calc(var(--control-h) * 2 + var(--space) * 2)')
    const detail = rule('.mr-family-row .ui-row-detail')
    expect(detail['padding-right']).toBeUndefined()
    expect(detail['line-height']).toBe('16px')
    const hover = rule('.mr-family-row:is(:hover, :focus-within, :has([aria-haspopup=\'menu\'][aria-expanded=\'true\'])) .ui-row-trailing,\n.ui-hover-anchor:focus-visible > .mr-family-row .ui-row-trailing')
    expect(hover).toEqual({ opacity: '1', 'pointer-events': 'auto' })
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

    const jumpRow = rule('.mr-orch-jump-row')
    expect(jumpRow.display).toBe('flex')
    expect(jumpRow['justify-content']).toBe('flex-end')
    expect(merged('.mr-orch-jump')).toEqual({})
  })

  it('keeps vertical padding on the inline jump row so the focus ring stays whole', () => {
    const inlineJumpRow = rule('.mr-orch.is-inline .mr-orch-jump-row')
    expect(inlineJumpRow['overflow-y']).toBe('hidden')
    expect(inlineJumpRow['scrollbar-gutter']).toBe('stable')
    expect(pixels(inlineJumpRow['padding-block'])).toBeGreaterThanOrEqual(3)
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
    const wide = parse(css).nodes.find((node) => node.type === 'atrule' && node.params === '(min-width: 900px)' && node.toString().includes('data-rows'))
    expect(wide, 'the 900 pixel media query with the marker row heights').toBeDefined()
    const stageHeights = {}
    wide.walkRules((found) => {
      const row = /^\.stage:has\(\.scrubber-markers\[data-rows='(\d)'\]\)$/.exec(found.selector)
      if (row) found.walkDecls('--transport-h', (decl) => { stageHeights[row[1]] = decl.value })
    })
    expect(stageHeights).toEqual({ 2: '80px', 3: '104px' })
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
  it('uses white activity styling inside the callout without a cyan glow or fill', () => {
    const consoleRule = rule('.mr-callout-console')
    expect(consoleRule.color).toBe('var(--white)')
    expect(consoleRule['border-top']).toBe('1px solid rgb(255 255 255 / 0.35)')
    expect(consoleRule['box-shadow']).toBeUndefined()
    expect(rule('.mr-callout .mr-term-console-link').color).toBe('var(--white)')
    expect(rule('.mr-callout-console-line.is-dim').color).toBe('rgb(255 255 255 / 0.62)')
    expect(css).not.toMatch(/--cyan|56 232 255|#38e8ff/i)
    expect(css).not.toMatch(/\.mr-term-console\s*\{/)
    expect(css).not.toMatch(/\.mr-term-console\.is-address\s*\{/)
  })

  it('gives pointer events to the callout title and address link only, not the callout box', () => {
    expect(rule('.mr-callout')['pointer-events']).toBe('none')
    expect(rule('.mr-callout-title')['pointer-events']).toBe('auto')
    expect(rule('.mr-callout .mr-term-console-link')['pointer-events']).toBe('auto')
  })
})

describe('the transport view row and forced idle state', () => {
  it('centres the view row with an 8 pixel gap and styles Idle like Center', () => {
    const view = rule('.transport-view')
    expect(view.display).toBe('inline-flex')
    expect(pixels(view.gap)).toBe(8)
    expect(rule('.transport.is-live .transport-view')['grid-column']).toBe('2')
    expect(rule('.transport.is-live .transport-view')['justify-self']).toBe('center')
    expect(rule('.transport.is-live.has-orchestrator .transport-view')['grid-row']).toBe('2')
    expect(rule('.transport:not(.is-live) .transport-view')['grid-column']).toBe('1 / -1')
    expect(rule('.transport:not(.is-live) .transport-view')['justify-self']).toBe('center')
    const shared = sharedBlock(['.transport .transport-center', '.transport .transport-idle'])
    expect(shared).toBeTruthy()
    const pressed = merged(".transport .transport-idle[aria-pressed='true']")
    expect(pressed['border-color']).toBe('var(--yellow)')
    expect(pressed.color).toBe('var(--yellow)')
    const seamRule = css.match(/([^{}]+)\{\s*transform:\s*translateY\(var\(--seam-y, 0\)\) rotate\(var\(--seam-r, 0\)\);\s*\}/)[1]
    const seamSelectors = seamRule.split(',').map((selector) => selector.trim())
    expect(seamSelectors).toContain('.transport-center')
    expect(seamSelectors).toContain('.transport-idle')
    expect(merged('.hud-menu.is-flat .transport-idle').transform).toBeUndefined()
  })

  it('keeps the Idle button visible and clickable in place while forced idle hides the rest', () => {
    const transport = merged('.stage.is-idle-forced .transport')
    expect(transport.opacity).toBe('1')
    expect(transport.transform).toBe('none')
    expect(transport['pointer-events']).toBe('none')
    expect(transport.position).toBe('fixed')
    expect(transport.top).toBe('calc(100vh - var(--transport-h))')
    expect(merged('.stage.is-idle-forced .hud-menu').opacity).toBe('0')
    expect(merged('.stage.is-idle-forced .hud-menu').transform).toBe('translateY(-100%)')
    expect(merged('.stage.is-idle-forced .transport > :not(.transport-view)').opacity).toBe('0')
    expect(merged('.stage.is-idle-forced .transport > :not(.transport-view)')['pointer-events']).toBe('none')
    expect(merged('.stage.is-idle-forced .transport-view > :not(.transport-idle)').opacity).toBe('0')
    expect(merged('.stage.is-idle-forced .transport-view > :not(.transport-idle)')['pointer-events']).toBe('none')
    expect(rule('.stage.is-idle-forced .transport-view .transport-idle').opacity).toBe('1')
    expect(rule('.stage.is-idle-forced .transport-view .transport-idle')['pointer-events']).toBe('auto')
  })

  it('hides the menu and transport for a forced idle only at 900 pixels and wider, above every backdrop, and blocks the room (R74-2, R74-4)', () => {
    const sheet = parse(css)
    const hiding = []
    sheet.walkRules((block) => {
      if (!block.selectors.some((selector) => selector.startsWith('.stage.is-idle-forced'))) return
      if (!block.nodes.some(({ prop, value }) => prop === 'opacity' && value === '0')) return
      hiding.push({ selectors: block.selectors.join(', '), media: block.parent?.type === 'atrule' ? block.parent.params : '' })
    })
    expect(hiding.length).toBeGreaterThan(0)
    for (const item of hiding) expect(item.media, item.selectors).toBe('(min-width: 900px)')
    const backdrops = [...css.matchAll(/backdrop[^{]*\{[^}]*z-index:\s*(\d+)/g)].map((match) => Number(match[1]))
    expect(Number(merged('.stage.is-idle-forced .transport')['z-index'])).toBeGreaterThan(Math.max(...backdrops))
    expect(merged('.stage.is-idle-forced .lens *')['pointer-events']).toBe('none !important')
  })

  it('drops forced-idle transitions under reduced motion', () => {
    const sheet = parse(css)
    const quieted = []
    sheet.walkAtRules('media', (atRule) => {
      if (atRule.params !== '(prefers-reduced-motion: reduce)') return
      atRule.walkRules((block) => {
        if (!block.nodes.some(({ prop, value }) => prop === 'transition' && value === 'none')) return
        quieted.push(...block.selectors)
      })
    })
    for (const selector of [
      '.stage.is-idle-forced .hud-menu',
      '.stage.is-idle-forced .transport',
      '.stage.is-idle-forced .transport > :not(.transport-view)',
      '.stage.is-idle-forced .transport-view > :not(.transport-idle)',
      '.stage.is-idle-forced .lens-rail',
      '.stage.is-idle-forced .lens-labels',
    ]) {
      expect(quieted, selector).toContain(selector)
    }
  })

  it('cascades stage is-idle is-idle-forced with nothing hidden at 800 pixels and only Idle shown at 1280 pixels (R75-1, R75-2)', () => {
    const sheet = parse(css)

    function node(tag, { id = '', classes = [], attrs = {}, children = [] } = {}) {
      const item = { tag, id, classes, attrs, children, parent: null }
      for (const child of children) child.parent = item
      return item
    }

    const idleButton = node('button', { classes: ['transport-idle', 'mono'], attrs: { 'aria-pressed': 'true' } })
    const centerButton = node('button', { classes: ['transport-center', 'mono'] })
    const transportView = node('div', { classes: ['transport-view'], children: [centerButton, idleButton] })
    const transportAgents = node('div', { classes: ['transport-agents'] })
    const transportTail = node('div', { classes: ['transport-tail'] })
    const transport = node('div', {
      classes: ['transport', 'is-live', 'has-orchestrator'],
      children: [node('div', { classes: ['transport-live-head'] }), transportAgents, transportTail, transportView],
    })
    const menu = node('header', { classes: ['hud-menu'] })
    const lower = node('div', { classes: ['hud-lower'] })
    const surfaceLayers = node('div', { classes: ['surface-layers'] })
    const lensLabels = node('div', { classes: ['lens-labels'] })
    const lensRail = node('div', { classes: ['lens-rail'] })
    const lens = node('div', {
      classes: ['lens'],
      children: [node('div', { classes: ['lens-frame'], children: [surfaceLayers, lensLabels] }), lensRail],
    })
    const stage = node('div', {
      classes: ['stage', 'is-idle', 'is-idle-forced'],
      children: [lens, node('div', { classes: ['hud'], children: [menu, transport, lower] })],
    })
    const body = node('body', { children: [node('div', { id: 'root', children: [stage] })] })
    const html = node('html', { children: [body] })

    function descendants(root) {
      const found = []
      for (const child of root.children) {
        found.push(child, ...descendants(child))
      }
      return found
    }

    function mediaMatches(params, width) {
      const parts = params.split(/\s+and\s+/i).map((part) => part.trim())
      for (const part of parts) {
        let match = /^\(min-width:\s*(\d+)px\)$/.exec(part)
        if (match) {
          if (width < Number(match[1])) return false
          continue
        }
        match = /^\(max-width:\s*(\d+)px\)$/.exec(part)
        if (match) {
          if (width > Number(match[1])) return false
          continue
        }
        if (part === '(prefers-reduced-motion: no-preference)') continue
        return false
      }
      return true
    }

    function splitTopLevel(text, delimiter) {
      const parts = []
      let depth = 0
      let start = 0
      for (let index = 0; index < text.length; index += 1) {
        const ch = text[index]
        if (ch === '(' || ch === '[') depth += 1
        else if (ch === ')' || ch === ']') depth -= 1
        else if (depth === 0 && ch === delimiter) {
          parts.push(text.slice(start, index))
          start = index + 1
        }
      }
      parts.push(text.slice(start))
      return parts
    }

    function tokenizeComplex(selector) {
      const tokens = []
      let depth = 0
      let current = ''
      let combinator = null
      const push = () => {
        const trimmed = current.trim()
        if (trimmed) {
          if (tokens.length > 0) tokens.push(combinator ?? ' ')
          tokens.push(trimmed)
        }
        current = ''
        combinator = null
      }
      for (let index = 0; index < selector.length; index += 1) {
        const ch = selector[index]
        if (ch === '(' || ch === '[') {
          depth += 1
          current += ch
        } else if (ch === ')' || ch === ']') {
          depth -= 1
          current += ch
        } else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) {
          push()
          combinator = ch
        } else if (depth === 0 && /\s/.test(ch)) {
          if (current.trim()) push()
        } else {
          current += ch
        }
      }
      push()
      return tokens
    }

    function addSpec(a, b) {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
    }

    function compareSpec(a, b) {
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
    }

    function matchCompound(el, compound) {
      let index = 0
      let spec = [0, 0, 0]
      while (index < compound.length) {
        const ch = compound[index]
        if (ch === '*') {
          index += 1
        } else if (ch === '.') {
          const match = /^\.([\w-]+)/.exec(compound.slice(index))
          if (!match || !el.classes.includes(match[1])) return null
          spec[1] += 1
          index += match[0].length
        } else if (ch === '#') {
          const match = /^#([\w-]+)/.exec(compound.slice(index))
          if (!match || el.id !== match[1]) return null
          spec[0] += 1
          index += match[0].length
        } else if (ch === '[') {
          const end = compound.indexOf(']', index)
          if (end < 0) return null
          const bodyText = compound.slice(index + 1, end)
          const match = /^([\w-]+)(?:=['"]?([^'"]*)['"]?)?$/.exec(bodyText)
          if (!match || !Object.hasOwn(el.attrs, match[1])) return null
          if (match[2] !== undefined && el.attrs[match[1]] !== match[2]) return null
          spec[1] += 1
          index = end + 1
        } else if (ch === ':') {
          if (compound[index + 1] === ':') return null
          const match = /^:([\w-]+)/.exec(compound.slice(index))
          if (!match) return null
          const name = match[1]
          index += match[0].length
          if (compound[index] === '(') {
            let depth = 1
            let end = index + 1
            while (end < compound.length && depth > 0) {
              if (compound[end] === '(') depth += 1
              else if (compound[end] === ')') depth -= 1
              end += 1
            }
            const inner = compound.slice(index + 1, end - 1).trim()
            index = end
            if (name === 'not') {
              let best = [0, 0, 0]
              for (const alt of splitTopLevel(inner, ',')) {
                const sub = matchComplex(el, alt.trim())
                if (sub) return null
                const altSpec = selectorSpecificity(alt.trim())
                if (compareSpec(altSpec, best) > 0) best = altSpec
              }
              spec = addSpec(spec, best)
            } else if (name === 'is' || name === 'where') {
              let matched = false
              let best = [0, 0, 0]
              for (const alt of splitTopLevel(inner, ',')) {
                const sub = matchComplex(el, alt.trim())
                if (sub) {
                  matched = true
                  if (compareSpec(sub, best) > 0) best = sub
                }
              }
              if (!matched) return null
              if (name === 'is') spec = addSpec(spec, best)
            } else if (name === 'has') {
              let matched = false
              let best = [0, 0, 0]
              for (const alt of splitTopLevel(inner, ',')) {
                const trimmed = alt.trim()
                const direct = trimmed.startsWith('>')
                const candidate = direct ? trimmed.slice(1).trim() : trimmed
                const pool = direct ? el.children : descendants(el)
                for (const item of pool) {
                  const sub = matchComplex(item, candidate)
                  if (sub) {
                    matched = true
                    if (compareSpec(sub, best) > 0) best = sub
                    break
                  }
                }
              }
              if (!matched) return null
              spec = addSpec(spec, best)
            } else {
              return null
            }
          } else {
            return null
          }
        } else {
          const match = /^([a-zA-Z][\w-]*)/.exec(compound.slice(index))
          if (!match || el.tag !== match[1].toLowerCase()) return null
          spec[2] += 1
          index += match[0].length
        }
      }
      return spec
    }

    function selectorSpecificity(selector) {
      let spec = [0, 0, 0]
      for (const token of tokenizeComplex(selector)) {
        if (token === ' ' || token === '>' || token === '+' || token === '~') continue
        for (const match of token.matchAll(/#[\w-]+/g)) spec[0] += match ? 1 : 0
        for (const match of token.matchAll(/\.[\w-]+|\[[^\]]+\]/g)) spec[1] += match ? 1 : 0
        if (/^[a-zA-Z][\w-]*/.test(token)) spec[2] += 1
      }
      return spec
    }

    function matchComplex(el, selector) {
      const tokens = tokenizeComplex(selector)
      if (tokens.length === 0) return null
      function step(current, pos) {
        const own = matchCompound(current, tokens[pos])
        if (!own) return null
        if (pos === 0) return own
        const comb = tokens[pos - 1]
        if (comb === '>') {
          if (!current.parent) return null
          const up = step(current.parent, pos - 2)
          return up ? addSpec(own, up) : null
        }
        if (comb === ' ') {
          let ancestor = current.parent
          while (ancestor) {
            const up = step(ancestor, pos - 2)
            if (up) return addSpec(own, up)
            ancestor = ancestor.parent
          }
          return null
        }
        return null
      }
      return step(el, tokens.length - 1)
    }

    function cascade(el, width) {
      const winner = new Map()
      let order = 0
      const visit = (container) => {
        for (const item of container.nodes) {
          if (item.type === 'atrule') {
            if (item.name === 'media' && mediaMatches(item.params, width)) visit(item)
            continue
          }
          if (item.type !== 'rule') continue
          let bestSpec = null
          for (const selector of item.selectors) {
            const spec = matchComplex(el, selector.trim())
            if (spec && (!bestSpec || compareSpec(spec, bestSpec) > 0)) bestSpec = spec
          }
          if (!bestSpec) continue
          for (const decl of item.nodes) {
            if (decl.type !== 'decl') continue
            order += 1
            const score = [decl.important ? 1 : 0, bestSpec[0], bestSpec[1], bestSpec[2], order]
            const prev = winner.get(decl.prop)
            if (!prev || score.some((val, at) => val !== prev.score[at] && val > prev.score[at] && score.slice(0, at).every((v, i) => v === prev.score[i]))) {
              winner.set(decl.prop, {
                value: decl.important ? `${decl.value} !important` : decl.value,
                score,
              })
            }
          }
        }
      }
      visit(sheet)
      return Object.fromEntries([...winner.entries()].map(([prop, entry]) => [prop, entry.value]))
    }

    const interactive = [menu, transport, transportAgents, transportTail, centerButton, idleButton, lensRail]
    const allTargets = [...interactive, lensLabels, lens, surfaceLayers, lower]
    stage.classes = ['stage']
    const plain800 = new Map(allTargets.map((target) => [target, cascade(target, 800)]))
    stage.classes = ['stage', 'is-idle', 'is-idle-forced']

    for (const target of allTargets) {
      const narrow = cascade(target, 800)
      expect(narrow, `800px cascade unchanged on ${target.classes.join('.')}`).toEqual(plain800.get(target))
      expect(narrow.opacity, `800px opacity on ${target.classes.join('.')}`).not.toBe('0')
      expect(narrow.visibility, `800px visibility on ${target.classes.join('.')}`).not.toBe('hidden')
      expect(narrow.transform, `800px transform on ${target.classes.join('.')}`).not.toBe('translateY(-100%)')
      expect(narrow.transform, `800px transform on ${target.classes.join('.')}`).not.toBe('translateY(100%)')
    }
    for (const target of interactive) {
      expect(cascade(target, 800)['pointer-events'], `800px pointer-events on ${target.classes.join('.')}`).not.toBe('none')
    }
    expect(cascade(lens, 800)['pointer-events']).not.toBe('none !important')
    expect(cascade(surfaceLayers, 800)['pointer-events']).not.toBe('none !important')

    expect(cascade(html, 1280).overflow).toBe('hidden')
    expect(cascade(body, 1280).overflow).toBe('hidden')
    expect(cascade(stage, 1280)).toMatchObject({ height: '100vh', overflow: 'hidden', 'padding-top': '0' })
    expect(cascade(lens, 1280)).toMatchObject({ height: '100vh', 'pointer-events': 'none !important' })
    expect(cascade(surfaceLayers, 1280)['pointer-events']).toBe('none !important')
    expect(cascade(menu, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none', visibility: 'hidden', transform: 'translateY(-100%)' })
    expect(cascade(lensRail, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none !important', visibility: 'hidden' })
    expect(cascade(lensLabels, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none !important', visibility: 'hidden' })
    expect(cascade(transport, 1280)).toMatchObject({ opacity: '1', transform: 'none', 'pointer-events': 'none', position: 'fixed', 'z-index': '20' })
    expect(cascade(transportAgents, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none', visibility: 'hidden' })
    expect(cascade(transportTail, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none', visibility: 'hidden' })
    expect(cascade(centerButton, 1280)).toMatchObject({ opacity: '0', 'pointer-events': 'none', visibility: 'hidden' })
    expect(cascade(lower, 1280)).toMatchObject({ visibility: 'hidden', 'pointer-events': 'none' })
    expect(cascade(idleButton, 1280)).toMatchObject({ opacity: '1', 'pointer-events': 'auto', visibility: 'visible' })
  })
})
