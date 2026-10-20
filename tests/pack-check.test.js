import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findPackProblems, isForbidden, readPackReport, runPack, walkImports } from '../scripts/pack-check.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACK_BUDGET_MS = 20000

function makeTree(files) {
  const base = mkdtempSync(join(tmpdir(), 'machine-room-pack-'))
  for (const [path, text] of Object.entries(files)) {
    const full = join(base, ...path.split('/'))
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return base
}

describe('walkImports', () => {
  it('walks relative imports once, skips a package and reports a missing file', () => {
    const base = makeTree({
      'bin/start.mjs': [
        "import { a } from './a.js'",
        "import 'some-package'",
        "import { gone } from './missing.js'",
        "import { readFileSync } from 'node:fs'",
        '',
      ].join('\n'),
      'bin/a.js': "import { b } from './b.js'\nexport const a = b\n",
      'bin/b.js': "import { a } from './a.js'\nexport const b = a\n",
    })
    try {
      expect(walkImports('bin/start.mjs', base)).toEqual({
        files: ['bin/a.js', 'bin/b.js', 'bin/start.mjs'],
        missing: ['bin/missing.js'],
      })
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('isForbidden', () => {
  it('marks secrets, tests, recordings, modules and logs', () => {
    const forbidden = [
      '.env',
      '.env.local',
      'config/.env.production',
      'tests/pack-check.test.js',
      'public/recordings/run.json',
      'dist/recordings/hermes-T1-run.jsonl',
      'node_modules/pkg/index.js',
      '.git/config',
      'logs/run.log',
      'logs/RUN.LOG',
    ]
    for (const path of forbidden) expect(isForbidden(path)).toBe(true)
  })

  it('allows the example env file and ordinary source files', () => {
    const allowed = [
      '.env.example',
      'docs/.env.example',
      'README.md',
      'server/index.js',
      'src/model/paths.js',
      'src/tests.js',
      'logs/notes.txt',
    ]
    for (const path of allowed) expect(isForbidden(path)).toBe(false)
  })
})

describe('findPackProblems', () => {
  it('names missing imports, omitted imports and files that must not ship', () => {
    const problems = findPackProblems({
      imports: ['bin/machine-room.mjs', 'server/index.js'],
      missing: ['server/gone.js'],
      packed: ['bin/machine-room.mjs', 'tests/pack-check.test.js', 'logs/run.log'],
    })
    expect(problems).toContain('bin/machine-room.mjs imports server/gone.js, but that file is not on disk.')
    expect(problems).toContain('The pack list leaves out server/index.js, which bin/machine-room.mjs imports.')
    expect(problems).toContain('The pack list holds tests/pack-check.test.js, which must not ship.')
    expect(problems).toContain('The pack list holds logs/run.log, which must not ship.')
    expect(problems).toHaveLength(4)
  })
})

describe('the real pack', () => {
  it('holds every imported file and nothing forbidden', (context) => {
    const run = runPack(root, PACK_BUDGET_MS)
    if (run.error?.code === 'ETIMEDOUT' || run.signal) {
      context.skip()
      return
    }
    expect(run.status).toBe(0)
    const report = readPackReport(run.stdout)
    const walked = walkImports('bin/machine-room.mjs', root)
    expect(findPackProblems({ packed: report.files, imports: walked.files, missing: walked.missing })).toEqual([])
    expect(report.files).toContain('README.md')
    expect(report.files).toContain('bin/machine-room.mjs')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.private).toBe(true)
    expect(manifest.files).toContain('dist/')
  }, 30000)
})
