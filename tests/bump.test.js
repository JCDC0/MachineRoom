import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bump, bumpTexts, isHigher } from '../scripts/bump.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/bump.mjs', import.meta.url))
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

const PKG = `${JSON.stringify({ name: 'machine-room', private: true, version: '0.1.112', dependencies: { three: '^0.186.1' } }, null, 2)}\n`
const LOCK = `${JSON.stringify({
  name: 'machine-room',
  version: '0.1.112',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'machine-room', version: '0.1.112', dependencies: { three: '^0.186.1' } },
    'node_modules/three': { version: '0.1.112', license: 'MIT' },
  },
}, null, 2)}\n`
const ARCHITECTURE = '# MachineRoom architecture\n\nVersion 0.1.112. A browser viewer.\n\nNot Version 0.1.112. here.\n'

function project({ pkg = PKG, lock = LOCK, architecture = ARCHITECTURE } = {}) {
  const dir = makeTempDir('mr-bump-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), pkg)
  writeFileSync(join(dir, 'package-lock.json'), lock)
  writeFileSync(join(dir, 'docs', 'agents', 'ARCHITECTURE.md'), architecture)
  return dir
}

function files(dir) {
  return {
    pkg: readFileSync(join(dir, 'package.json'), 'utf8'),
    lock: readFileSync(join(dir, 'package-lock.json'), 'utf8'),
    architecture: readFileSync(join(dir, 'docs', 'agents', 'ARCHITECTURE.md'), 'utf8'),
  }
}

describe('isHigher', () => {
  it('compares each part as a number', () => {
    expect(isHigher('0.1.113', '0.1.112')).toBe(true)
    expect(isHigher('0.2.0', '0.1.112')).toBe(true)
    expect(isHigher('0.1.100', '0.1.99')).toBe(true)
    expect(isHigher('0.1.112', '0.1.112')).toBe(false)
    expect(isHigher('0.1.9', '0.1.112')).toBe(false)
  })
})

describe('bump', () => {
  it('sets the four version slots and prints each change', () => {
    const dir = project()
    const result = bump(dir, ['0.1.113'])
    expect(result).toEqual({
      code: 0,
      lines: [
        'package.json: version 0.1.112 to 0.1.113',
        'package-lock.json: version 0.1.112 to 0.1.113',
        'package-lock.json: packages[""].version 0.1.112 to 0.1.113',
        'docs/agents/ARCHITECTURE.md: Version 0.1.112. to Version 0.1.113.',
      ],
    })
    const after = files(dir)
    expect(after.pkg).toBe(PKG.replace('"0.1.112"', '"0.1.113"'))
    expect(after.lock).toBe(LOCK.replace('"version": "0.1.112"', '"version": "0.1.113"').replace('"version": "0.1.112"', '"version": "0.1.113"'))
    expect(JSON.parse(after.lock).packages['node_modules/three'].version).toBe('0.1.112')
    expect(after.architecture).toBe('# MachineRoom architecture\n\nVersion 0.1.113. A browser viewer.\n\nNot Version 0.1.112. here.\n')
  })

  it('keeps Windows line endings', () => {
    const crlf = (text) => text.replace(/\n/g, '\r\n')
    const dir = project({ pkg: crlf(PKG), lock: crlf(LOCK), architecture: crlf(ARCHITECTURE) })
    expect(bump(dir, ['1.0.0']).code).toBe(0)
    const after = files(dir)
    expect(after.pkg).toBe(crlf(PKG).replace('0.1.112', '1.0.0'))
    expect(after.architecture.startsWith('# MachineRoom architecture\r\n\r\nVersion 1.0.0. A browser')).toBe(true)
  })

  it('refuses a version that is not three whole numbers and changes nothing', () => {
    for (const version of ['0.1', '0.1.113.1', 'v0.1.113', '0.1.x', '0.1.-1', '0.01.113', '']) {
      const dir = project()
      const result = bump(dir, [version])
      expect(result.code).toBe(1)
      expect(files(dir)).toEqual({ pkg: PKG, lock: LOCK, architecture: ARCHITECTURE })
    }
    expect(bump(project(), ['0.1']).lines).toEqual(['The version must be three whole numbers, such as 0.1.113. 0.1 is not.'])
  })

  it('refuses a version that is not higher', () => {
    for (const version of ['0.1.112', '0.1.111', '0.0.200']) {
      const dir = project()
      expect(bump(dir, [version])).toEqual({ code: 1, lines: [`The version must be higher than 0.1.112. ${version} is not.`] })
      expect(files(dir)).toEqual({ pkg: PKG, lock: LOCK, architecture: ARCHITECTURE })
    }
  })

  it('refuses a missing argument, an option and a second version', () => {
    expect(bump(project(), [])).toEqual({ code: 1, lines: ['Use: npm run bump -- X.Y.Z'] })
    expect(bump(project(), ['--help']).code).toBe(1)
    expect(bump(project(), ['0.1.113', '0.1.114']).code).toBe(1)
  })

  it('writes nothing when a file lacks its version slot', () => {
    const noLine = project({ architecture: '# MachineRoom architecture\n' })
    expect(bump(noLine, ['0.1.113'])).toEqual({ code: 1, lines: ['ARCHITECTURE.md has no line that starts with Version X.Y.Z. Nothing was changed.'] })
    expect(files(noLine).pkg).toBe(PKG)
    const lock = JSON.stringify({ name: 'machine-room', lockfileVersion: 3, packages: { '': { name: 'machine-room', version: '0.1.112' } } }, null, 2)
    const badLock = project({ lock })
    expect(bump(badLock, ['0.1.113'])).toEqual({ code: 1, lines: ['package-lock.json does not hold its two versions on its top lines. Nothing was changed.'] })
    expect(files(badLock).pkg).toBe(PKG)
  })

  it('names a file it cannot read', () => {
    const dir = project()
    rmSync(join(dir, 'package-lock.json'))
    const result = bump(dir, ['0.1.113'])
    expect(result.code).toBe(1)
    expect(result.lines[0]).toMatch(/package-lock\.json could not be read\. Nothing was changed\.$/)
  })

  it('reads the files the text helper is given', () => {
    expect(() => bumpTexts({ pkg: '{', lock: LOCK, architecture: ARCHITECTURE }, '0.1.113')).toThrow('package.json or package-lock.json is not valid JSON.')
  })

  it('runs as a command in the current folder', () => {
    const dir = project()
    const result = spawnSync(process.execPath, [SCRIPT, '0.1.113'], { cwd: dir, encoding: 'utf8', windowsHide: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('package.json: version 0.1.112 to 0.1.113')
    const refused = spawnSync(process.execPath, [SCRIPT, '0.1.113'], { cwd: dir, encoding: 'utf8', windowsHide: true })
    expect(refused.status).toBe(1)
    expect(refused.stderr.trim()).toBe('The version must be higher than 0.1.113. 0.1.113 is not.')
  })
})
