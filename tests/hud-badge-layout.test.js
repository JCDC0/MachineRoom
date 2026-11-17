import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const hud = readFileSync(new URL('../src/ui/Hud.jsx', import.meta.url), 'utf8')

describe('HUD badge and transport layout', () => {
  it('includes the slotted badge in the seam transform rule', () => {
    const rule = css.match(/([^{}]+)\{\s*transform:\s*translateY\(var\(--seam-y, 0\)\) rotate\(var\(--seam-r, 0\)\);\s*\}/)[1]
    expect(rule.split(',').map((selector) => selector.trim())).toContain('.hud-action-slot > .hud-action-badge')
  })

  it('keeps the badge inline and the Reviews button after the key hint', () => {
    const badge = css.match(/\.hud-action-badge\s*\{([^}]*)\}/)[1]
    expect(badge).not.toMatch(/position\s*:\s*absolute|(?:top|right|bottom|left)\s*:\s*-/)
    expect(hud).toMatch(/agent-key mono">C<\/span>[\s\S]*?className="hud-action-badge mono"[\s\S]*?aria-label=\{`Open Reviews,/)
    const slotted = css.match(/\.hud-action-slot > \.hud-action-badge\s*\{([^}]*)\}/)[1]
    expect(slotted).toMatch(/top\s*:\s*calc\(50% - 8px\)/)
    expect(slotted).not.toMatch(/(?:top|right|bottom|left)\s*:\s*-/)
    expect(css).toMatch(/\.hud-action\.has-badge\s*\{[^}]*padding-right/)
    expect(hud).toContain('has-badge')
  })


})
