import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countLeaks, findLeaks, LEAK_KINDS, maskKeys } from '../src/briefs/audit.js'
import { historyArgsFrom, parseAuditArgs, readHistory } from '../scripts/history-audit.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/history-audit.mjs', import.meta.url))

const fakeSk = 'sk-' + 'a'.repeat(40)
const fakeOr = 'sk-or-v1-' + 'b'.repeat(40)
const fakeGhp = 'ghp_' + 'c'.repeat(36)
const fakeGho = 'gho_' + 'd'.repeat(36)
const fakePat = 'github_pat_' + 'e'.repeat(36)
const fakeAws = 'AKIA' + 'F'.repeat(16)
const fakeMail = 'someone' + '@' + 'site.com'
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
    expect(findLeaks('OPENROUTER_API_KEY=[key]')).toEqual([])
    expect(findLeaks('OPENROUTER_API_KEY=your-key')).toEqual([])
    expect(findLeaks('ANTHROPIC_API_KEY=xxx')).toEqual([])
    expect(findLeaks('OPENAI_API_KEY=<your key>')).toEqual([])
    expect(findLeaks('OPENAI_API_KEY=')).toEqual([])
    expect(findLeaks('The prefixes `OPENROUTER_API_KEY=`, a space')).toEqual([])
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

  it('allows the addresses that may leave', () => {
    expect(findLeaks('noreply@anthropic.com')).toEqual([])
    expect(findLeaks('noreply@github.com')).toEqual([])
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

describe('findLeaks placeholders', () => {
  it('leaves out each placeholder user folder, any case', () => {
    const folders = ['user', 'owner', 'name', 'you', 'me', 'example', 'username', '%USERNAME%', '$env:USERNAME', '<user>']
    for (const folder of folders) {
      expect(findLeaks(`C:\\Users\\${folder}\\notes.md`)).toEqual([])
      expect(findLeaks(`C:\\Users\\${folder.toUpperCase()}\\notes.md`)).toEqual([])
    }
  })

  it('leaves out a placeholder folder with either slash', () => {
    expect(findLeaks('c:/users/user/notes.md')).toEqual([])
  })

  it('keeps a folder that only starts with a placeholder', () => {
    expect(kindsOf('C:\\Users\\username2\\notes.md')).toEqual(['userpath'])
    expect(kindsOf('C:\\Users\\users\\notes.md')).toEqual(['userpath'])
  })

  it('leaves out each domain kept for examples', () => {
    const domains = ['example.com', 'example.org', 'example.net', 'shop.example', 'host.invalid', 'x.test', 'app.localhost']
    for (const domain of domains) {
      expect(findLeaks(`write to someone@${domain}`)).toEqual([])
    }
    expect(findLeaks('write to Someone@Example.COM')).toEqual([])
  })

  it('still finds a real-looking folder and domain', () => {
    expect(kindsOf('C:\\Users\\mira\\notes.md')).toEqual(['userpath'])
    expect(kindsOf('write to someone@site.com')).toEqual(['email'])
  })

  it('does not read an npm version as an address', () => {
    expect(findLeaks('npm install -g paperclipai@2026.1012.0')).toEqual([])
    expect(findLeaks('see paperclipai@2026.1012.0 --ignore-scripts')).toEqual([])
  })

  it('leaves out the house rule name and a template folder', () => {
    expect(findLeaks('C:\\Users\\<name>\\notes.md')).toEqual([])
    expect(findLeaks('C:/Users/${ACCOUNT}/AppData/Local/Temp')).toEqual([])
    expect(findLeaks('C:/Users/${ACCOUNT.slice(0, cut)}/notes.md')).toEqual([])
  })

  it('leaves out both placeholders on one line', () => {
    expect(findLeaks('C:\\Users\\user\\notes.md and test@example.com')).toEqual([])
  })

  it('keeps the real ones beside placeholders on one line', () => {
    const line = 'C:\\Users\\user\\a, C:\\Users\\mira\\b, test@example.com, real@site.com'
    expect(kindsOf(line)).toEqual(['userpath', 'email'])
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

describe('audit arguments', () => {
  it('reads --json and --from', () => {
    expect(parseAuditArgs([])).toEqual({ json: false, from: '' })
    expect(parseAuditArgs(['--json'])).toEqual({ json: true, from: '' })
    expect(parseAuditArgs(['--json', '--from', 'main'])).toEqual({ json: true, from: 'main' })
    expect(parseAuditArgs(['--from=abc123'])).toEqual({ json: false, from: 'abc123' })
  })

  it('refuses a missing or unknown option', () => {
    expect(() => parseAuditArgs(['--from'])).toThrow('--from needs a commit.')
    expect(() => parseAuditArgs(['--from='])).toThrow('--from needs a commit.')
    expect(() => parseAuditArgs(['--since', 'main'])).toThrow('Unknown option: --since')
  })

  it('builds the full range or the range after a commit', () => {
    expect(historyArgsFrom('')).toContain('refs/heads/main')
    expect(historyArgsFrom('')).toContain('--tags')
    const range = historyArgsFrom('abc123')
    expect(range.at(-1)).toBe('abc123..HEAD')
    expect(range).not.toContain('--tags')
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
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)
})

describe('history-audit script from a commit', () => {
  function startRepo(dir) {
    git(['init', '-b', 'main'], dir)
    git(['config', 'user.email', 'tester@users.noreply.github.com'], dir)
    git(['config', 'user.name', 'Tester'], dir)
    writeFileSync(join(dir, 'notes.md'), `contact ${fakeMail}\n`)
    git(['add', 'notes.md'], dir)
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Start'], dir)
    git(['checkout', '-b', 'feat'], dir)
  }

  it('reads the commits after the start and leaves the old lines alone', () => {
    const dir = makeTempDir('history-audit-')
    try {
      startRepo(dir)
      writeFileSync(join(dir, 'notes.md'), `contact ${fakeMail}\nfirst change\n`)
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add a line'], dir)
      const clean = spawnSync(process.execPath, [SCRIPT, '--json', '--from', 'main'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(clean.status).toBe(0)
      expect(JSON.parse(clean.stdout).counts.email).toBe(0)
      writeFileSync(join(dir, 'key.md'), `const key = '${fakeSk}'\n`)
      git(['add', 'key.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add a key'], dir)
      const result = spawnSync(process.execPath, [SCRIPT, '--json', '--from', 'main'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(result.status).toBe(1)
      const report = JSON.parse(result.stdout)
      expect(report.counts.key).toBeGreaterThanOrEqual(1)
      expect(report.counts.email).toBe(0)
      const [hit] = report.findings.filter((finding) => finding.kind === 'key')
      expect(hit.file).toBe('key.md')
      expect(hit.commit).toMatch(/^[0-9a-f]{7,}$/)
      expect(hit.sample).toBe('sk-a… (43 characters)')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)

  it('finds a key that was added and removed after the start', () => {
    const dir = makeTempDir('history-audit-')
    try {
      startRepo(dir)
      writeFileSync(join(dir, 'notes.md'), `const key = '${fakeSk}'\n`)
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add a key'], dir)
      writeFileSync(join(dir, 'notes.md'), 'const key = null\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Remove the key'], dir)
      const result = spawnSync(process.execPath, [SCRIPT, '--json', '--from', 'main'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).counts.key).toBeGreaterThanOrEqual(1)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)

  it('refuses a start that is not a commit', () => {
    const dir = makeTempDir('history-audit-')
    try {
      startRepo(dir)
      const result = spawnSync(process.execPath, [SCRIPT, '--json', '--from', 'no-such-ref'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('The audit could not read the commit no-such-ref.')
      expect(result.stdout).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)
})

describe('history audit range audit and removed lines', () => {
  it('leaves out removed lines in a range audit from the commit before deletion', () => {
    const dir = makeTempDir('history-audit-')
    try {
      git(['init', '-b', 'main'], dir)
      git(['config', 'user.email', 'tester@users.noreply.github.com'], dir)
      git(['config', 'user.name', 'Tester'], dir)
      writeFileSync(join(dir, 'notes.md'), 'initial line\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial commit'], dir)
      const base = git(['rev-parse', 'HEAD'], dir).trim()

      const fakeKey = 'sk-' + 'x'.repeat(40)
      writeFileSync(join(dir, 'secret.md'), `const token = '${fakeKey}'\n`)
      git(['add', 'secret.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add fake key'], dir)
      const commitWithKey = git(['rev-parse', 'HEAD'], dir).trim()

      const fullResult = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', windowsHide: true })
      expect(fullResult.status).toBe(1)
      const fullReport = JSON.parse(fullResult.stdout)
      expect(fullReport.counts.key).toBeGreaterThanOrEqual(1)

      const rangeResult = spawnSync(process.execPath, [SCRIPT, '--json', '--from', base], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(rangeResult.status).toBe(1)
      const rangeReport = JSON.parse(rangeResult.stdout)
      expect(rangeReport.counts.key).toBeGreaterThanOrEqual(1)

      writeFileSync(join(dir, 'secret.md'), 'const token = null\n')
      git(['add', 'secret.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Delete the key line'], dir)

      const fullAfterDelete = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', windowsHide: true })
      expect(fullAfterDelete.status).toBe(1)
      const fullAfterReport = JSON.parse(fullAfterDelete.stdout)
      expect(fullAfterReport.counts.key).toBeGreaterThanOrEqual(1)

      const rangeAfterDelete = spawnSync(process.execPath, [SCRIPT, '--json', '--from', commitWithKey], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(rangeAfterDelete.status).toBe(0)
      const rangeAfterReport = JSON.parse(rangeAfterDelete.stdout)
      expect(rangeAfterReport.counts.key).toBe(0)
      expect(rangeAfterReport.findings).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)

  it('readHistory leaves out removed lines when removed is false', async () => {
    const dir = makeTempDir('history-audit-')
    try {
      git(['init', '-b', 'main'], dir)
      git(['config', 'user.email', 'tester@users.noreply.github.com'], dir)
      git(['config', 'user.name', 'Tester'], dir)
      const fakeKey = 'sk-' + 'y'.repeat(40)
      writeFileSync(join(dir, 'notes.md'), `const key = '${fakeKey}'\n`)
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add key'], dir)
      const beforeDelete = git(['rev-parse', 'HEAD'], dir).trim()
      writeFileSync(join(dir, 'notes.md'), 'const key = null\n')
      git(['add', 'notes.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Remove key'], dir)

      const findingsWithRemoved = []
      await readHistory(dir, historyArgsFrom(beforeDelete), '', findingsWithRemoved, { removed: true })
      expect(findingsWithRemoved.some((item) => item.kind === 'key')).toBe(true)

      const findingsWithoutRemoved = []
      await readHistory(dir, historyArgsFrom(beforeDelete), '', findingsWithoutRemoved, { removed: false })
      expect(findingsWithoutRemoved).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)
})

describe('history audit profile check on GitHub Actions', () => {
  it('finds the current user name when GITHUB_ACTIONS is unset and skips it when GITHUB_ACTIONS is true', () => {
    const dir = makeTempDir('history-audit-')
    try {
      git(['init', '-b', 'main'], dir)
      git(['config', 'user.email', 'tester@users.noreply.github.com'], dir)
      git(['config', 'user.name', 'Tester'], dir)
      const currentName = userInfo().username
      writeFileSync(join(dir, 'author.md'), `maintainer is ${currentName}\n`)
      git(['add', 'author.md'], dir)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Add author'], dir)

      const envUnset = { ...process.env }
      delete envUnset.GITHUB_ACTIONS
      const unsetResult = spawnSync(process.execPath, [SCRIPT, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
        env: envUnset,
      })
      expect(unsetResult.status).toBe(1)
      const unsetReport = JSON.parse(unsetResult.stdout)
      expect(unsetReport.counts.profile).toBeGreaterThanOrEqual(1)

      const envSet = { ...process.env, GITHUB_ACTIONS: 'true' }
      const setResult = spawnSync(process.execPath, [SCRIPT, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
        env: envSet,
      })
      expect(setResult.status).toBe(0)
      const setReport = JSON.parse(setResult.stdout)
      expect(setReport.counts.profile).toBe(0)
      expect(setReport.findings).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30000)
})

describe('findLeaks on a line that holds a key', () => {
  it('masks the key in the samples of every other kind on that line', () => {
    const key = 'sk-or-v1-' + 'q'.repeat(48)
    const line = `OPENROUTER_API_KEY=${key} set by someuser at C:/Users/someuser/x, mail someone@site.com`
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
    expect(maskKeys('X-MachineRoom-Orchestrator: secret-orchestrator-token-value')).toEqual({
      text: 'X-MachineRoom-Orchestrator: [key]',
      count: 1,
    })
    expect(maskKeys('x-machineroom-orchestrator: secret-orchestrator-token-value')).toEqual({
      text: 'x-machineroom-orchestrator: [key]',
      count: 1,
    })
    expect(maskKeys('curl -H "X-MachineRoom-Orchestrator: secret-token" http://localhost:4040/api/control/runs')).toEqual({
      text: 'curl -H "X-MachineRoom-Orchestrator: [key]" http://localhost:4040/api/control/runs',
      count: 1,
    })
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
    expect(maskKeys('X-MachineRoom-Orchestrator: {{TOKEN}}')).toEqual({ text: 'X-MachineRoom-Orchestrator: {{TOKEN}}', count: 0 })
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
