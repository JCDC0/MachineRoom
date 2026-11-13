import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/agy-prompt.mjs', import.meta.url))
const USAGE = 'Usage: node scripts/agy-prompt.mjs BRIEF_ID [--clean]'

describe('agy-prompt help', () => {
  it('prints the usage for --help and -h without writing a prompt', () => {
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(process.execPath, [SCRIPT, flag], { encoding: 'utf8', windowsHide: true })

      expect(result.status, flag).toBe(0)
      expect(result.stdout.trim(), flag).toBe(USAGE)
      expect(result.stderr, flag).toBe('')
      expect(result.stdout, flag).not.toContain('Wrote ')
    }
  })
})
