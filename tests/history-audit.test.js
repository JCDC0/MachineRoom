import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countLeaks, findLeaks, LEAK_KINDS, maskKeys } from '../src/briefs/audit.js'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/history-audit.mjs', import.meta.url))

const fakeSk = 'sk-' + 'a'.repeat(40)
const fakeOr = 'sk-or-v1-' + 'b'.repeat(40)
const fakeGhp = 'ghp_' + 'c'.repeat(36)
const fakeGho = 'gho_' + 'd'.repeat(36)
const fakePat = 'github_pat_' + 'e'.repeat(36)
const fakeAws = 'AKIA' + 'F'.repeat(16)
const fakeMail = 'someone' + '@' + 'example.com'
const fakeHome = 'C:' + '\\Users\\' + 'mira'
const fakeHomeSlash = 'c:' + '/users/' + 'mira'
const fakeGraded = 'D:' + '\\School\\' + '6' + 'APSI' + '\\notes.md'

function kindsOf(text, options) {
  return findLeaks(text, options).map((finding) => finding.kind)
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

describe('findLeaks keys', () => {
  it('finds an sk token and never shows the token', () => {
    const found = findLeaks(`const key = '${fakeSk}'`)
    expect(found).toEqual([{ kind: 'key', line: 1, sample: 'sk-a… (43 characters)' }])
    expect(found[0].sample).not.toContain('a'.repeat(20))
  })

  it('finds an sk-or-v1 token', () => {
    expect(findLeaks(fakeOr)).toEqual([{ kind: 'key', line: 1, sample: 'sk-o… (49 characters)' }])
  })

  it('finds the GitHub token shapes', () => {
    expect(findLeaks(fakeGhp)).toEqual([{ kind: 'key', line: 1, sample: 'ghp_… (40 characters)' }])
    expect(findLeaks(fakeGho)).toEqual([{ kind: 'key', line: 1, sample: 'gho_… (40 characters)' }])
    expect(findLeaks(fakePat)).toEqual([{ kind: 'key', line: 1, sample: 'gith… (47 characters)' }])
  })

  it('finds an AWS access key id', () => {
    expect(findLeaks(fakeAws)).toEqual([{ kind: 'key', line: 1, sample: 'AKIA… (20 characters)' }])
  })

  it('finds a key set on a line and hides the value', () => {
    const found = findLeaks(`OPENROUTER_API_KEY=${fakeOr}`)
    expect(found).toEqual([{ kind: 'key', line: 1, sample: 'OPENROUTER_API_KEY=sk-o… (49 characters)' }])
    expect(found[0].sample).not.toContain(fakeOr)
  })

  it('finds a value that is not shaped like a token', () => {
    const line = 'OPENAI_API_KEY=' + 'abc123'
    expect(findLeaks(line)).toEqual([{ kind: 'key', line: 1, sample: 'OPENAI_API_KEY=abc1… (6 characters)' }])
  })

  it('reports one key for a line that sets one', () => {
    expect(findLeaks(`ANTHROPIC_API_KEY=${fakeSk}`)).toHaveLength(1)
  })

  it('leaves placeholders and empty values alone', () => {
    expect(findLeaks('OPENROUTER_API_KEY=your-key')).toEqual([])
    expect(findLeaks('ANTHROPIC_API_KEY=xxx')).toEqual([])
    expect(findLeaks('OPENAI_API_KEY=<your key>')).toEqual([])
    expect(findLeaks('OPENAI_API_KEY=')).toEqual([])
    expect(findLeaks('OPENROUTER_API_KEY=""')).toEqual([])
    expect(findLeaks('OPENAI_API_KEY=sk-...')).toEqual([])
    expect(findLeaks('OPENROUTER_API_KEY=${OPENROUTER_API_KEY}')).toEqual([])
  })

  it('does not read a comparison as a setting', () => {
    expect(findLeaks("typeof env.OPENROUTER_API_KEY === 'string'")).toEqual([])
  })

  it('does not read the sk- inside a longer word', () => {
    expect(findLeaks('task-' + 'a'.repeat(40))).toEqual([])
  })
})

describe('findLeaks addresses and paths', () => {
  it('finds an email address', () => {
    expect(findLeaks(`write to ${fakeMail}`)).toEqual([{ kind: 'email', line: 1, sample: `write to ${fakeMail}` }])
  })

  it('allows the two addresses that may leave', () => {
    expect(findLeaks('noreply@anthropic.com')).toEqual([])
    expect(findLeaks('1234+someone@users.noreply.github.com')).toEqual([])
    expect(findLeaks('NoReply@Anthropic.COM')).toEqual([])
  })

  it('still finds a real address beside an allowed one', () => {
    expect(kindsOf(`noreply@anthropic.com and ${fakeMail}`)).toEqual(['email'])
  })

  it('finds a user path with either slash and any case', () => {
    expect(findLeaks(`${fakeHome}\\Desktop`)).toEqual([{ kind: 'userpath', line: 1, sample: `${fakeHome}\\Desktop` }])
    expect(kindsOf(`${fakeHomeSlash}/notes.md`)).toEqual(['userpath'])
  })

  it('finds the profile name as a whole word and any case', () => {
    expect(findLeaks('ask mira about it', { profileName: 'mira' })).toEqual([
      { kind: 'profile', line: 1, sample: 'ask mira about it' },
    ])
    expect(kindsOf('MIRA', { profileName: 'mira' })).toEqual(['profile'])
    expect(findLeaks('miracle', { profileName: 'mira' })).toEqual([])
    expect(findLeaks('mira', {})).toEqual([])
  })

  it('finds a path into the graded folder', () => {
    expect(findLeaks(fakeGraded)).toEqual([{ kind: 'graded', line: 1, sample: fakeGraded }])
  })
})

describe('findLeaks output', () => {
  it('gives the line number inside the text', () => {
    expect(findLeaks(`clean\n${fakeMail}\nclean`)).toEqual([{ kind: 'email', line: 2, sample: fakeMail }])
  })

  it('cuts a long line to 80 characters around the match', () => {
    const long = `${'x'.repeat(100)} ${fakeMail} ${'y'.repeat(100)}`
    const [hit] = findLeaks(long)
    expect(hit.sample).toHaveLength(80)
    expect(hit.sample).toContain(fakeMail)
    expect(hit.sample.startsWith('…')).toBe(true)
    expect(hit.sample.endsWith('…')).toBe(true)
  })

  it('counts every kind', () => {
    const counts = countLeaks(findLeaks(`clean\n${fakeMail}`))
    expect(Object.keys(counts)).toEqual(LEAK_KINDS)
    expect(counts.email).toBe(1)
    expect(counts.key).toBe(0)
  })
})

describe('history-audit script', () => {
  it('finds a key that was added and then removed', () => {
    const dir = makeTempDir('history-audit-')
    try {
      git(['init', '-b', 'main'], dir)
      git(['config', 'user.email', 'tester@users.noreply.github.com'], dir)
      git(['config', 'user.name', 'Tester'], dir)
      writeFileSync(join(dir, 'notes.md'), `const key = '${fakeSk}'\n`)
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add notes'], dir)
      writeFileSync(join(dir, 'notes.md'), 'const key = null\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Remove the key'], dir)
      const result = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', windowsHide: true })
      expect(result.status).toBe(1)
      const report = JSON.parse(result.stdout)
      expect(report.counts.key).toBeGreaterThanOrEqual(1)
      expect(report.counts.email).toBe(0)
      expect(report.counts.userpath).toBe(0)
      expect(report.counts.profile).toBe(0)
      expect(report.counts.graded).toBe(0)
      const hits = report.findings.filter((finding) => finding.kind === 'key')
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].file).toBe('notes.md')
      expect(hits[0].commit).toMatch(/^[0-9a-f]{7,}$/)
      expect(hits[0].sample).toBe('sk-a… (43 characters)')
      expect(hits[0].sample).not.toContain(fakeSk)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('history-audit script and a tag named main', () => {
  it('reads the main branch, not a tag that has the same name', () => {
    const dir = makeTempDir('history-audit-')
    try {
      git(['init', '-b', 'main'], dir)
      git(['config', 'user.email', ''], dir)
      git(['config', 'user.name', 'Tester'], dir)
      writeFileSync(join(dir, 'notes.md'), 'first\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Start'], dir)
      git(['tag', 'main'], dir)
      writeFileSync(join(dir, 'notes.md'), `const key = '${fakeSk}'\n`)
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add notes'], dir)
      writeFileSync(join(dir, 'notes.md'), 'const key = null\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Remove the key'], dir)
      const result = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', windowsHide: true })
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).counts.key).toBeGreaterThanOrEqual(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('findLeaks on a line that holds a key', () => {
  it('masks the key in the samples of every other kind on that line', () => {
    const key = 'sk-or-v1-' + 'q'.repeat(48)
    const line = `OPENROUTER_API_KEY=${key} set by someuser at C:/Users/someuser/x, mail someone@example.com`
    const found = findLeaks(line, { profileName: 'someuser' })
    expect(found.map((finding) => finding.kind)).toEqual(expect.arrayContaining(['key', 'profile', 'userpath', 'email']))
    for (const finding of found) expect(finding.sample).not.toContain('q'.repeat(20))
  })
})

describe('findLeaks on other key shapes', () => {
  it('finds Anthropic, OpenAI project and Google keys', () => {
    const anthropic = 'sk-ant-api03-' + 'b'.repeat(40)
    const project = 'sk-proj-' + 'c'.repeat(30)
    const google = 'AIza' + 'd'.repeat(35)
    for (const key of [anthropic, project, google]) {
      const found = findLeaks(`value ${key} end`)
      expect(found.map((finding) => finding.kind)).toEqual(['key'])
      expect(found[0].sample).toBe(`${key.slice(0, 4)}… (${key.length} characters)`)
    }
  })
})

describe('maskKeys', () => {
  it('masks and counts each key shape', () => {
    const google = 'AIza' + 'g'.repeat(35)
    const shapes = [fakeSk, fakeOr, fakeGhp, fakeGho, fakePat, fakeAws, google]
    for (const key of shapes) {
      expect(maskKeys(`value ${key} end`)).toEqual({ text: 'value [key] end', count: 1 })
    }
  })

  it('masks two keys on one line', () => {
    expect(maskKeys(`${fakeSk} and ${fakeAws}`)).toEqual({ text: '[key] and [key]', count: 2 })
    expect(maskKeys(`${fakeGhp} ${fakeGho} ${fakePat}`)).toEqual({ text: '[key] [key] [key]', count: 3 })
  })

  it('keeps the name of a key setting and masks its value', () => {
    expect(maskKeys(`OPENROUTER_API_KEY=${fakeOr}`)).toEqual({ text: 'OPENROUTER_API_KEY=[key]', count: 1 })
    expect(maskKeys('OPENAI_API_KEY="abc123"')).toEqual({ text: 'OPENAI_API_KEY="[key]"', count: 1 })
    expect(maskKeys(`ANTHROPIC_API_KEY=${fakeSk}`)).toEqual({ text: 'ANTHROPIC_API_KEY=[key]', count: 1 })
  })

  it('leaves a 40 character git sha and a UUID alone', () => {
    const sha = '3f2a9c1d4b5e6f708192a3b4c5d6e7f8091a2b3c'
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    expect(sha).toHaveLength(40)
    expect(maskKeys(`commit ${sha}`)).toEqual({ text: `commit ${sha}`, count: 0 })
    expect(maskKeys(`run ${uuid}`)).toEqual({ text: `run ${uuid}`, count: 0 })
  })

  it('leaves a placeholder setting alone', () => {
    expect(maskKeys('OPENROUTER_API_KEY=your-key')).toEqual({ text: 'OPENROUTER_API_KEY=your-key', count: 0 })
    expect(maskKeys('ANTHROPIC_API_KEY=xxx')).toEqual({ text: 'ANTHROPIC_API_KEY=xxx', count: 0 })
    expect(maskKeys('OPENAI_API_KEY=<your key>')).toEqual({ text: 'OPENAI_API_KEY=<your key>', count: 0 })
    expect(maskKeys('OPENAI_API_KEY=')).toEqual({ text: 'OPENAI_API_KEY=', count: 0 })
    expect(maskKeys('OPENROUTER_API_KEY=${OPENROUTER_API_KEY}')).toEqual({
      text: 'OPENROUTER_API_KEY=${OPENROUTER_API_KEY}',
      count: 0,
    })
  })

  it('masks twice to the same text', () => {
    const sha = '3f2a9c1d4b5e6f708192a3b4c5d6e7f8091a2b3c'
    const text = `key ${fakeSk}\nOPENROUTER_API_KEY=${fakeOr}\nsha ${sha}`
    const once = maskKeys(text)
    const twice = maskKeys(once.text)
    expect(once.count).toBe(2)
    expect(once.text).toBe(`key [key]\nOPENROUTER_API_KEY=[key]\nsha ${sha}`)
    expect(twice.text).toBe(once.text)
    expect(twice.count).toBe(0)
  })

  it('keeps the other lines and their endings', () => {
    expect(maskKeys(`a ${fakeAws}\r\nb\r\nc ${fakeGhp}`)).toEqual({
      text: 'a [key]\r\nb\r\nc [key]',
      count: 2,
    })
  })

  it('masks one key once when two shapes overlap, and keeps the rest of the line', () => {
    expect(maskKeys(`use sk-${fakeGhp} then the tail`)).toEqual({ text: 'use [key] then the tail', count: 1 })
    expect(maskKeys(`x sk-${fakeAws}abcdefghij tail`)).toEqual({ text: 'x [key] tail', count: 1 })
  })

  it('keeps a JSON line valid when the key sits in an escaped string', () => {
    const line = JSON.stringify({ command: `$env:OPENROUTER_API_KEY="${fakeOr}"; npm test`, n: 1 })
    const masked = maskKeys(line)
    expect(masked.count).toBe(1)
    expect(JSON.parse(masked.text)).toEqual({ command: '$env:OPENROUTER_API_KEY="[key]"; npm test', n: 1 })
    const ended = JSON.stringify({ command: 'OPENAI_API_KEY=abc123\\' })
    expect(JSON.parse(maskKeys(ended).text)).toEqual({ command: 'OPENAI_API_KEY=[key]\\' })
  })

  it('answers an empty result for empty or missing text', () => {
    expect(maskKeys('')).toEqual({ text: '', count: 0 })
    expect(maskKeys(undefined)).toEqual({ text: '', count: 0 })
    expect(maskKeys(null)).toEqual({ text: '', count: 0 })
  })
})
