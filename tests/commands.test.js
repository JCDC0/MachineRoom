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

  it('does not touch a file named only in a commit message', () => {
    expect(run('git commit -m "rename docs/notes.md to docs/readme.md"')).toEqual([])
  })

  it('does not touch a file named in the value of each message flag', () => {
    for (const flag of ['-m', '--message', '-d', '--data', '--data-raw', '--data-binary']) {
      expect(run(`curl ${flag} "src/math.js" http://example.test`)).toEqual([])
      expect(run(`curl ${flag}="src/math.js" http://example.test`)).toEqual([])
    }
  })

  it('does not touch a file named in a single quoted message', () => {
    expect(run("git commit -m 'rename docs/notes.md to docs/readme.md'")).toEqual([])
  })

  it('does not touch a file named in a message with a semicolon', () => {
    expect(run('git commit -m "add src/math.js; keep docs/notes.md"')).toEqual([])
  })

  it('does not touch a file named in a message whose quote is never closed', () => {
    expect(run('git commit -m "rename docs/notes.md to src/math.js')).toEqual([])
  })

  it('does not touch a file named in a message with a backslash escaped quote inside', () => {
    expect(run('git commit -m "say \\"docs/notes.md\\" quietly"')).toEqual([])
    expect(run('git commit -m \\"rename docs/notes.md to docs/readme.md\\" --no-verify')).toEqual([])
  })

  it('still reads a quoted path that is an ordinary argument', () => {
    expect(run('cat "src/math.js"')).toEqual(['read:src/math.js'])
  })

  it('reads a file when the write mark is inside a quoted pattern', () => {
    const known = ['index.html', 'src/x.js']
    const read = (command) =>
      touchesForCommand(command, known, [])
        .map((touch) => `${touch.mode}:${touch.path}`)
        .sort()
    expect(read('grep "<div>" index.html')).toEqual(['read:index.html'])
    expect(read("rg 'a>b' src/x.js")).toEqual(['read:src/x.js'])
  })

  it('reads files named inside an inline program', () => {
    const known = ['notes.md', 'src/math.js', 'x.js']
    const read = (command) =>
      touchesForCommand(command, known, [])
        .map((touch) => `${touch.mode}:${touch.path}`)
        .sort()
    expect(read(`python -c "open('x.js', 'w').write('')"`)).toEqual(['read:x.js'])
    expect(read(`node -e "writeFileSync('x.js', '')"`)).toEqual(['read:x.js'])
    expect(read(`node --eval "require('src/math.js')"`)).toEqual(['read:src/math.js'])
    expect(read('pwsh -Command "Set-Content notes.md x"')).toEqual(['read:notes.md'])
    expect(read('powershell -Command "Set-Content notes.md x"')).toEqual(['read:notes.md'])
    expect(read('bash -c "echo hi > notes.md"')).toEqual(['read:notes.md'])
  })

  it('writes only the file a write operator points at', () => {
    const known = ['docs/notes.md', 'src/math.js']
    const read = (command) =>
      touchesForCommand(command, known, [])
        .map((touch) => `${touch.mode}:${touch.path}`)
        .sort()
    expect(read('echo hi > docs/notes.md src/math.js')).toEqual(['read:src/math.js', 'write:docs/notes.md'])
    expect(read('cat src/math.js | tee docs/notes.md')).toEqual(['read:src/math.js', 'write:docs/notes.md'])
    expect(read('Get-Content src/math.js | Out-File docs/notes.md')).toEqual([
      'read:src/math.js',
      'write:docs/notes.md',
    ])
  })

  it('keeps a redirect after the heredoc opener and drops the body', () => {
    for (const opener of ['<<EOF', "<<'EOF'", '<<"EOF"', '<<-EOF']) {
      const command = [`cat ${opener} > out.txt`, 'src/a.js', 'EOF', 'cat src/b.js'].join('\n')
      expect(touchesForCommand(command, ['out.txt', 'src/a.js', 'src/b.js'], [])).toEqual([
        { path: 'out.txt', mode: 'write', kind: 'file' },
        { path: 'src/b.js', mode: 'read', kind: 'file' },
      ])
    }
  })

  it('keeps a redirect after an unterminated heredoc opener', () => {
    const command = ['cat <<EOF > out.txt', 'src/a.js'].join('\n')
    expect(touchesForCommand(command, ['out.txt', 'src/a.js'], [])).toEqual([
      { path: 'out.txt', mode: 'write', kind: 'file' },
    ])
  })

  it('does not skip an unknown redirect operand to write a known source', () => {
    for (const target of ['new.txt', '"new file.txt"', "'new file.txt'", 'new/src/b.js']) {
      for (const operator of ['>', '>>']) {
        const touches = touchesForCommand(`cat src/a.js ${operator} ${target} src/b.js`, ['src/a.js', 'src/b.js'], [])
        expect(touches.map((touch) => `${touch.mode}:${touch.path}`)).toEqual([
          'read:src/a.js', 'read:src/b.js',
        ])
      }
    }
  })

  it('writes the exact quoted redirect operand and handles each redirect separately', () => {
    const touches = touchesForCommand('cat src/a.js > "out file.txt" >> new.txt src/b.js', ['src/a.js', 'src/b.js', 'out file.txt'], [])
    expect(touches.map((touch) => `${touch.mode}:${touch.path}`)).toEqual([
      'read:src/a.js', 'read:src/b.js', 'write:out file.txt',
    ])
  })

  it('does not touch a file named in a bash heredoc body', () => {
    const known = ['SCRATCH/p85.md', 'scripts/run-lane.mjs', 'server/lanes-source.js', 'server/claude-sessions.js']
    const command = [
      "cat > SCRATCH/p85.md <<'EOF'",
      'The brief names scripts/run-lane.mjs, server/lanes-source.js and server/claude-sessions.js.',
      'EOF',
    ].join('\n')
    expect(touchesForCommand(command, known, []).map((touch) => `${touch.mode}:${touch.path}`)).toEqual([
      'write:SCRATCH/p85.md',
    ])
  })

  it('ends an indented heredoc on a line that holds only the word', () => {
    const command = ['cat <<-EOF', '\tdocs/notes.md', '\tEOF', 'cat src/math.js'].join('\n')
    expect(run(command)).toEqual(['read:src/math.js'])
  })

  it('ends a heredoc at the end when the word never appears', () => {
    const command = ["cat > docs/notes.md <<'EOF'", 'see src/math.js'].join('\n')
    expect(run(command)).toEqual(['write:docs/notes.md'])
  })

  it('removes a double quoted heredoc body', () => {
    const command = ['cat docs/notes.md <<"EOF"', 'src/math.js', 'EOF'].join('\n')
    expect(run(command)).toEqual(['read:docs/notes.md'])
  })

  it('writes the redirect target and reads the other file', () => {
    const known = ['in.txt', 'out.txt']
    expect(
      touchesForCommand('echo a > out.txt; cat in.txt', known, []).map((touch) => `${touch.mode}:${touch.path}`)
    ).toEqual(['write:out.txt', 'read:in.txt'])
  })

  it('touches only the longer known file when one lies inside another', () => {
    const known = ['src/a.js', 'lib/src/a.js']
    const read = (command) =>
      touchesForCommand(command, known, [])
        .map((touch) => `${touch.mode}:${touch.path}`)
        .sort()
    expect(read('cat lib/src/a.js')).toEqual(['read:lib/src/a.js'])
    expect(read('cat src/a.js lib/src/a.js')).toEqual(['read:lib/src/a.js', 'read:src/a.js'])
    expect(read('cat C:/proj/src/a.js')).toEqual(['read:src/a.js'])
  })

  it('lists only the longer known folder when one lies inside another', () => {
    const dirs = ['', 'lib', 'lib/src', 'src']
    const list = (command) =>
      touchesForCommand(command, [], dirs)
        .map((touch) => `${touch.mode}:${touch.path}`)
        .sort()
    expect(list('ls lib/src')).toEqual(['list:lib/src'])
    expect(list('ls src lib/src')).toEqual(['list:lib/src', 'list:src'])
    expect(list('ls C:/proj/src')).toEqual(['list:src'])
  })

  it('reads the rest of the command after a message', () => {
    expect(run('git commit -m "add src/math.js"; cat docs/notes.md')).toEqual(['read:docs/notes.md'])
  })

  it('does not touch a file named in a closed single quote here-string', () => {
    expect(run("$comment = @'\nrename docs/notes.md to src/math.js\n'@")).toEqual([])
  })

  it('does not touch a file named in a closed double quote here-string', () => {
    expect(run('$body = @"\nsee docs/notes.md and src/math.js\n"@')).toEqual([])
  })

  it('does not touch a file named in a here-string that never closes', () => {
    expect(run("$body = @' see docs/notes.md and src/math.js~")).toEqual([])
  })

  it('still writes a file named after the closing mark', () => {
    expect(run("$comment = @' see src/math.js '@ | Set-Content docs/notes.md")).toEqual(['write:docs/notes.md'])
  })

  it('does not treat an email address as a here-string', () => {
    expect(run('echo me@site.com')).toEqual([])
    expect(run('git log --author me@site.com -- src/math.js')).toEqual(['read:src/math.js'])
  })

  it('does not treat a single quoted at sign as a here-string', () => {
    expect(run("echo '@' > docs/notes.md")).toEqual(['write:docs/notes.md'])
  })
})
