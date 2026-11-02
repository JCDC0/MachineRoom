import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/ui/panels/DispatchPanel.jsx', import.meta.url), 'utf8')

describe('the target brief effect', () => {
  it('runs only when the brief, the load or the error changes', () => {
    const start = source.indexOf('if (!targetResult?.brief || loading || loadError || pickedTargetRef.current) return')
    expect(start).toBeGreaterThan(-1)
    const effect = source.slice(start, start + 400)
    expect(effect).toContain('}, [targetResult?.brief?.id, loading, loadError])')
  })
})
