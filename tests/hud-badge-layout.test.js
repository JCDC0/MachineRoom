import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const hud = readFileSync(new URL('../src/ui/Hud.jsx', import.meta.url), 'utf8')

describe('HUD badge and transport layout', () => {
  it('keeps the badge inline and the Reviews button after the key hint', () => {
    const badge = css.match(/\.hud-action-badge\s*\{([^}]*)\}/)[1]
    expect(badge).not.toMatch(/position\s*:\s*absolute|(?:top|right|bottom|left)\s*:\s*-/)
    expect(hud).toMatch(/agent-key mono">C<\/span>[\s\S]*?className="hud-action-badge mono"[\s\S]*?aria-label=\{`Open Reviews,/)
    expect(hud).toContain("gridTemplateColumns: 'auto max-content'")
  })

  it('keeps the orchestrator button at least as wide as its title', () => {
    const button = css.match(/\.transport-orchestrators > \.transport-orchestrator\s*\{([^}]*)\}/)[1]
    expect(button).toMatch(/min-width\s*:\s*max-content\s*;/)
  })
})
