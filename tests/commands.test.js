import { describe, expect, it } from 'vitest'
import { touchesForCommand } from '../src/model/commands.js'
import { testContext } from './helpers.js'

const { files, dirs } = testContext()
const run = (command) =>
  touchesForCommand(command, files, dirs)
    .map((touch) => `${touch.mode}:${touch.path || '.'}`)
    .sort()

describe('touchesForCommand', () => {
  it('reads a file named in cat', () => {
    expect(run('cat src/math.js')).toEqual(['read:src/math.js'])
  })

  it('writes a file that follows a redirect', () => {
    expect(run('echo hi >> docs/notes.md')).toEqual(['write:docs/notes.md'])
  })

  it('reads the source of a redirect and writes the target', () => {
    expect(run('cat src/math.js > docs/notes.md')).toEqual(['read:src/math.js', 'write:docs/notes.md'])
  })

  it('lists a folder after a listing command', () => {
    expect(run('Get-ChildItem docs')).toEqual(['list:docs'])
    expect(run('ls -la src docs')).toEqual(['list:docs', 'list:src'])
  })

  it('lists the root when no folder is named', () => {
    expect(run('Get-ChildItem')).toEqual(['list:.'])
  })

  it('does not mistake npm test for the test folder', () => {
    expect(run('npm test')).toEqual([])
    expect(run('node --test')).toEqual([])
  })

  it('handles several commands in one line', () => {
    expect(run('cd /tmp/agent-sandbox && cat src/math.js && node --test')).toEqual(['list:.', 'read:src/math.js'])
  })

  it('treats Windows separators like slashes', () => {
    expect(run('Test-Path docs\\notes.md')).toEqual(['read:docs/notes.md'])
    expect(run('ls docs\\')).toEqual(['list:docs'])
  })

  it('writes both files of a rename', () => {
    const files = ['docs/notes.md', 'docs/readme.md']
    const touches = touchesForCommand('git mv docs/notes.md docs/readme.md', files, dirs)
      .map((touch) => `${touch.mode}:${touch.path}`)
    expect(touches).toEqual(['write:docs/notes.md', 'write:docs/readme.md'])
  })

  it('writes the named file of a delete', () => {
    const files = ['docs/notes.md', 'docs/readme.md']
    expect(touchesForCommand('rm docs/notes.md', files, dirs).map((touch) => `${touch.mode}:${touch.path}`)).toEqual(['write:docs/notes.md'])
    expect(touchesForCommand('Remove-Item docs/readme.md', files, dirs).map((touch) => `${touch.mode}:${touch.path}`)).toEqual(['write:docs/readme.md'])
  })

  it('keeps a commit message as a read of the named files', () => {
    expect(run('git commit -m "rename docs/notes.md to docs/readme.md"')).toEqual(['read:docs/notes.md'])
  })
})
