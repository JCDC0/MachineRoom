import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { main, parseReviewArgs, removeReviewTree, reviewLane } from '../scripts/review-lane.mjs'
import {
  briefCheck,
  briefFiles,
  changelogCheck,
  commitCheck,
  forbiddenHits,
  formatReport,
  newestRunFor,
  packageCheck,
  parseDiff,
  parseTestCounts,
  scanAdded,
  scanHeuristics,
  tasksCheck,
  unlistedFiles,
} from '../src/briefs/review.js'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const SYSTEM_TEMP = makeTempDir('mr-review-system-')
const SAVED_TEMP = { TEMP: process.env.TEMP, TMP: process.env.TMP }
process.env.TEMP = SYSTEM_TEMP
process.env.TMP = SYSTEM_TEMP
const NO_GIT_CONFIG = join(SYSTEM_TEMP, 'machineroom-review-lane-no-git-config')
const EM_DASH = '\u2014'
const fakeKey = 'sk-' + 'q'.repeat(40)
const fakeMail = 'someone' + '@' + 'site.com'
const fakeHome = 'C:' + '\\Users\\' + 'mira'
const cleanups = []

function systemReviewFolders() {
  return readdirSync(SYSTEM_TEMP, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('machineroom-review-'))
    .map((entry) => entry.name)
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

afterAll(() => {
  for (const name of ['TEMP', 'TMP']) {
    if (SAVED_TEMP[name] === undefined) delete process.env[name]
    else process.env[name] = SAVED_TEMP[name]
  }
  rmSync(SYSTEM_TEMP, { recursive: true, force: true })
})

function added(path, lines, start = 1) {
  return { path, added: lines.map((text, index) => ({ line: start + index, text })) }
}

function texts(details) {
  return details.map((detail) => [detail.status, detail.where, detail.text].filter(Boolean).join(' '))
}

describe('forbiddenHits', () => {
  const forbidden = ['server/**', 'src/styles.css']

  it('matches dir/** and plain entries without case', () => {
    expect(forbiddenHits(['Server/index.js', 'SRC/Styles.css', 'src/model/a.js'], forbidden)).toEqual([
      { path: 'Server/index.js', rule: 'server/**' },
      { path: 'SRC/Styles.css', rule: 'src/styles.css' },
    ])
  })

  it('folds . and .. before matching', () => {
    expect(forbiddenHits(['src/model/../../server/x.js', './src/./styles.css'], forbidden).map((hit) => hit.rule)).toEqual(['server/**', 'src/styles.css'])
  })

  it('does not match a folder that only starts with the same letters', () => {
    expect(forbiddenHits(['servers/x.js', 'src/styles.css.map'], forbidden)).toEqual([])
  })

  it('refuses a path that climbs out of the project', () => {
    expect(forbiddenHits(['../other/x.js'], forbidden)).toEqual([{ path: '../other/x.js', rule: null }])
  })
})

describe('the brief check', () => {
  const tasks = [
    '## Briefs',
    '**T9. A task (Hermes).** Do it. Files: `src/a.js`, `src/ui/**`, `tests/a.test.js` if needed, `docs/agents/CHANGELOG.md`.',
    '**T8. Another (Hermes).** No list here.',
  ].join('\n')

  it('reads the backticked paths after Files:', () => {
    expect(briefFiles('Do it. Files: `src/a.js`, `npm test`, `src/*.css`.')).toEqual(['src/a.js', 'src/*.css'])
    expect(briefFiles('No list.')).toBeNull()
  })

  it('always allows the changelog and matches globs without case', () => {
    expect(unlistedFiles(['docs/agents/CHANGELOG.md', 'SRC/UI/Hud.jsx', 'src/b.js'], ['src/ui/**'])).toEqual(['src/b.js'])
  })

  it('takes the newest record for the branch', () => {
    const records = [{ branch: 'feat/x', briefs: ['T1'] }, { branch: 'feat/y', briefs: ['T2'] }, { branch: 'feat/x', briefs: ['T9'] }]
    expect(newestRunFor(records, 'feat/x').briefs).toEqual(['T9'])
    expect(newestRunFor(records, 'feat/z')).toBeNull()
  })

  it('passes when every changed file is named', () => {
    const result = briefCheck({ record: { briefs: ['T9'] }, branch: 'feat/x', tasksText: tasks, paths: ['src/a.js', 'src/ui/Hud.jsx', 'docs/agents/CHANGELOG.md'] })
    expect(result.status).toBe('PASS')
    expect(result.files).toContain('src/a.js')
  })

  it('warns for each file the brief does not name', () => {
    const result = briefCheck({ record: { briefs: ['T9'] }, branch: 'feat/x', tasksText: tasks, paths: ['src/a.js', 'src/b.js'] })
    expect(result.status).toBe('WARN')
    expect(texts(result.details)).toEqual(['WARN src/b.js not named in the brief'])
  })

  it('warns when there is no record, no brief or no list', () => {
    expect(briefCheck({ record: null, branch: 'feat/x', tasksText: tasks, paths: [] }).text).toBe("No run record names feat/x, so the brief's Files: list was not checked.")
    expect(texts(briefCheck({ record: { briefs: ['T7'] }, branch: 'feat/x', tasksText: tasks, paths: [] }).details)).toEqual(['WARN The brief T7 is not in TASKS.md.'])
    expect(texts(briefCheck({ record: { briefs: ['T8'] }, branch: 'feat/x', tasksText: tasks, paths: [] }).details)).toEqual(['WARN The brief T8 has no Files: list.'])
  })
})

describe('scanAdded', () => {
  it('passes plain lines', () => {
    expect(scanAdded([added('src/a.js', ['const a = 1', 'font-weight: 500;', 'Co-Authored-By: Claude <noreply@anthropic.com>'])])).toEqual([])
  })

  it('fails an em dash, a key, a user path and an e-mail address', () => {
    const found = scanAdded([added('src/a.js', [`a ${EM_DASH} b`, `const k = '${fakeKey}'`, `const home = '${fakeHome}'`, `// ${fakeMail}`])])
    expect(texts(found)).toEqual([
      'FAIL src/a.js:1 an em dash',
      'FAIL src/a.js:2 a key',
      'FAIL src/a.js:3 a Windows user path',
      'FAIL src/a.js:4 an e-mail address',
    ])
    expect(JSON.stringify(found)).not.toContain(fakeKey)
  })

  it('warns for an emoji and for a weight above 500 or bold', () => {
    const found = scanAdded([added('src/styles.css', ['/* \u{1F680} */', 'font-weight: 600;', "fontWeight: 'bold',", 'font: bold 12px Jost;'])])
    expect(texts(found)).toEqual([
      'WARN src/styles.css:1 an emoji',
      'WARN src/styles.css:2 a font weight above 500 or bold',
      'WARN src/styles.css:3 a font weight above 500 or bold',
      'WARN src/styles.css:4 a font weight above 500 or bold',
    ])
  })
})

describe('scanHeuristics', () => {
  function warnings(path, lines) {
    return scanHeuristics([added(path, lines)]).map((detail) => detail.text)
  }

  it('warns for a bare git passed to spawn', () => {
    expect(warnings('server/a.js', ["spawnSync('git', ['status'])"])).toEqual(["a bare 'git' passed to a spawn call; use gitPath()"])
    expect(warnings('server/a.js', ["spawnSync(gitPath(), ['status'])"])).toEqual([])
  })

  it('warns for a main range and a bare main ref', () => {
    expect(warnings('scripts/a.mjs', ['const range = `main..${branch}`'])).toEqual(['a range that starts at a bare main; use refs/heads/main'])
    expect(warnings('scripts/a.mjs', ["git(root, ['rev-parse', 'main'])"])).toEqual(["a bare 'main' ref passed to git; use refs/heads/main"])
    expect(warnings('scripts/a.mjs', ["git(root, ['rev-list', `refs/heads/main..${head}`])", "if (branch === 'main') return"])).toEqual([])
  })

  it('warns for git diff without both flags, looking at the lines around it', () => {
    expect(warnings('server/a.js', ["git(['diff', '--stat'])"])).toEqual(['git diff without --no-ext-diff and --no-textconv'])
    expect(warnings('server/a.js', ['const args = [', "  'diff',", "  '--no-ext-diff',", "  '--no-textconv',", ']'])).toEqual([])
  })

  it('warns for a fetch without a signal, only in server/', () => {
    expect(warnings('server/a.js', ['const answer = await fetch(url)'])).toEqual(['a fetch without a signal'])
    expect(warnings('server/a.js', ['const answer = await fetch(url, {', "  method: 'GET',", '  signal: AbortSignal.timeout(15000),', '})'])).toEqual([])
    expect(warnings('src/live/a.js', ['const answer = await fetch(url)'])).toEqual([])
  })

  it('warns for a lookup by a name from a request without Object.hasOwn', () => {
    expect(warnings('server/a.js', ['const route = ROUTES[body.decision]'])).toEqual(['ROUTES[body.decision] without Object.hasOwn'])
    expect(warnings('scripts/a.mjs', ['const lane = lanes[laneKey]'])).toEqual(['lanes[laneKey] without Object.hasOwn'])
    expect(warnings('server/a.js', ['if (!Object.hasOwn(lanes, name)) return', 'const lane = lanes[name]'])).toEqual([])
    expect(warnings('server/a.js', ['const first = parts[0]', 'const value = list[index]', 'const home = process.env[name]'])).toEqual([])
  })

  it('leaves other folders and other file types alone', () => {
    expect(warnings('tests/a.test.js', ["spawnSync('git', ['diff', 'main'])"])).toEqual([])
    expect(warnings('docs/agents/ORCHESTRATOR.md', ['git log main..BRANCH'])).toEqual([])
    expect(warnings('src/styles.css', ['a { fetch(x) }'])).toEqual([])
  })
})

describe('packageCheck', () => {
  const base = JSON.stringify({ dependencies: { three: '1' }, devDependencies: { vitest: '1' } })

  it('passes an unchanged or dependency-free change', () => {
    expect(packageCheck(base, base).status).toBe('PASS')
    expect(packageCheck(base, JSON.stringify({ scripts: { x: 'y' }, dependencies: { three: '2' }, devDependencies: { vitest: '1' } })).status).toBe('PASS')
  })

  it('fails a new dependency and warns for a new dev dependency', () => {
    const result = packageCheck(base, JSON.stringify({ dependencies: { three: '1', lodash: '4' }, devDependencies: { vitest: '1', eslint: '9' } }))
    expect(result.status).toBe('FAIL')
    expect(texts(result.details)).toEqual(['FAIL lodash a new dependency', 'WARN eslint a new dev dependency'])
  })

  it('fails a package.json that does not parse', () => {
    expect(packageCheck(base, '{').status).toBe('FAIL')
  })
})

describe('changelogCheck', () => {
  const text = ['# Changelog', '', '## Unreleased', '', '- new line', '- older', '', '## 0.1.0', '', '- first'].join('\n')

  it('passes a line added under Unreleased', () => {
    expect(changelogCheck({ text, added: [{ line: 5, text: '- new line' }], files: null }).status).toBe('PASS')
  })

  it('fails a line added under an older version, or none', () => {
    expect(changelogCheck({ text, added: [{ line: 10, text: '- first' }], files: null }).status).toBe('FAIL')
    expect(changelogCheck({ text, added: [], files: ['src/a.js', 'docs/agents/CHANGELOG.md'] }).status).toBe('FAIL')
  })

  it('passes with no line when the brief does not list the changelog', () => {
    expect(changelogCheck({ text, added: [], files: ['README.md'] }).status).toBe('PASS')
  })
})

describe('commitCheck and tasksCheck', () => {
  it('passes commits with a version prefix', () => {
    expect(commitCheck([{ sha: 'a'.repeat(40), subject: '0.1.112: Add the checker.', body: '' }]).status).toBe('PASS')
  })

  it('fails a commit without a prefix or with an em dash', () => {
    const result = commitCheck([
      { sha: 'a'.repeat(40), subject: 'Add the checker', body: '' },
      { sha: 'b'.repeat(40), subject: '0.1.112: Add it.', body: `Why ${EM_DASH} because.` },
    ])
    expect(texts(result.details)).toEqual(['FAIL aaaaaaaa no version prefix such as 0.1.101:', 'FAIL bbbbbbbb an em dash in the message'])
  })

  it('passes unique brief ids and fails a repeated or missing file', () => {
    expect(tasksCheck('**T1. One (Hermes).** a\n**T2. Two (Hermes).** b').status).toBe('PASS')
    const repeated = tasksCheck('**T1. One (Hermes).** a\n**T1. Again (Hermes).** b')
    expect(repeated.status).toBe('FAIL')
    expect(repeated.text).toBe('TASKS.md repeats T1.')
    expect(tasksCheck(null).status).toBe('FAIL')
    expect(tasksCheck('nothing').status).toBe('FAIL')
  })
})

describe('parsing', () => {
  it('reads the vitest totals, colours included', () => {
    expect(parseTestCounts('\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m1211 passed\x1b[39m\x1b[22m\x1b[90m | \x1b[39m1 skipped (1212)\n')).toEqual({ passed: 1211, failed: 0, skipped: 1, todo: 0, total: 1212 })
    expect(parseTestCounts('Tests  3 failed | 1197 passed | 1 skipped (1201)')).toEqual({ passed: 1197, failed: 3, skipped: 1, todo: 0, total: 1201 })
    expect(parseTestCounts('no totals')).toBeNull()
  })

  it('reads added lines with their numbers from a diff', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -3,0 +4,2 @@',
      '+one',
      '+two',
      'diff --git a/old.js b/old.js',
      '--- a/old.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      'diff --git a/img.png b/img.png',
      'Binary files /dev/null and b/img.png differ',
      'diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"',
      '--- "a/caf\\303\\251.js"',
      '+++ "b/caf\\303\\251.js"',
      '@@ -0,0 +1 @@',
      '+x',
    ].join('\n')
    expect(parseDiff(diff).map((file) => [file.path, file.added])).toEqual([
      ['src/a.js', [{ line: 4, text: 'one' }, { line: 5, text: 'two' }]],
      ['caf\u00e9.js', [{ line: 1, text: 'x' }]],
    ])
  })

  it('takes one lane and the two flags', () => {
    expect(parseReviewArgs(['hermes', '--json', '--keep'])).toEqual({ lane: 'hermes', json: true, keep: true })
    expect(() => parseReviewArgs([])).toThrow('Use: npm run review-lane -- LANE [--json] [--keep]')
    expect(() => parseReviewArgs(['hermes', 'agy'])).toThrow('Use:')
    expect(() => parseReviewArgs(['hermes', '--force'])).toThrow('Use:')
  })

  it('ends the report with a summary line', () => {
    const report = formatReport({ lane: 'hermes', branch: 'feat/x', checks: [
      { name: 'commits', status: 'PASS', text: '1 commit ahead.', details: [] },
      { name: 'paths', status: 'FAIL', text: '1 outside.', details: [{ status: 'FAIL', where: 'server/a.js', text: 'forbidden by server/**' }] },
    ] })
    const lines = report.split('\n')
    expect(lines[0]).toBe('PASS  commits  1 commit ahead.')
    expect(lines[2]).toBe('        FAIL  server/a.js  forbidden by server/**')
    expect(lines.at(-1)).toBe('hermes feat/x: 1 PASS, 0 WARN, 1 FAIL. A PASS is not a review: read the diff yourself.')
  })
})

function git(cwd, args) {
  const result = spawnSync(gitPath(), args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: '',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: '',
    },
  })
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function write(dir, name, text) {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), text)
}

function commitAll(dir, message) {
  git(dir, ['add', '-A'])
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message])
}

const FAKE_TEST = [
  "import { existsSync } from 'node:fs'",
  "if (existsSync('fail-tests')) {",
  "  console.log(' Tests  1 failed | 2 passed (3)')",
  '  process.exit(1)',
  '}',
  "console.log(' Tests  3 passed (3)')",
].join('\n')

const CHANGELOG_TEXT = ['# Changelog', '', '## Unreleased', '', '- An older line.', '', '## 0.1.0', '', '- First.', ''].join('\n')

function setup() {
  const repo = makeTempDir('mr-review-main-')
  const lane = join(makeTempDir('mr-review-lane-'), 'MachineRoom-hermes')
  const runs = makeTempDir('mr-review-runs-')
  const tempRoot = makeTempDir('mr-review-temp-')
  cleanups.push(() => {
    for (const dir of [repo, dirname(lane), runs, tempRoot]) rmSync(dir, { recursive: true, force: true })
  })
  git(repo, ['init', '-q', '-b', 'main'])
  write(repo, 'package.json', `${JSON.stringify({ name: 'fixture', version: '0.1.1', private: true, scripts: { test: 'node fake-test.mjs', build: 'node -e "console.log(\'built\')"' }, dependencies: { three: '1.0.0' } }, null, 2)}\n`)
  write(repo, 'fake-test.mjs', `${FAKE_TEST}\n`)
  write(repo, '.gitignore', 'node_modules/\n')
  write(repo, 'docs/agents/lanes.json', JSON.stringify({ hermes: { name: 'Hermes', worktree: lane, forbidden: ['server/**', 'src/styles.css'] } }, null, 2))
  write(repo, 'docs/agents/TASKS.md', '## Briefs\n\n**T9. A task (Hermes).** Add a. Files: `src/a.js`, `docs/agents/CHANGELOG.md`.\n')
  write(repo, 'docs/agents/CHANGELOG.md', CHANGELOG_TEXT)
  write(repo, 'src/keep.js', 'export const keep = 1\n')
  commitAll(repo, '0.1.1: Start.')
  write(repo, 'node_modules/marker.txt', 'kept')
  git(repo, ['worktree', 'add', '-q', '-b', 'feat/t9-a-task', lane, 'refs/heads/main'])
  const runsPath = join(runs, 'runs.jsonl')
  writeFileSync(runsPath, `${JSON.stringify({ lane: 'hermes', briefs: ['T9'], branch: 'feat/t9-a-task' })}\n`)
  return { repo, lane, runsPath, tempRoot }
}

function addGoodWork(lane) {
  write(lane, 'src/a.js', 'export const a = 1\n')
  write(lane, 'docs/agents/CHANGELOG.md', CHANGELOG_TEXT.replace('- An older line.', '- Add a (task T9).\n- An older line.'))
  commitAll(lane, '0.1.2: Add a.')
}

function snapshot(dir) {
  return { status: git(dir, ['status', '--porcelain', '--untracked-files=all']), head: git(dir, ['rev-parse', 'HEAD']), worktrees: git(dir, ['worktree', 'list', '--porcelain']) }
}

function byName(report) {
  return Object.fromEntries(report.checks.map((check) => [check.name, check]))
}

describe('reviewLane on real repositories', () => {
  it('passes good work, tests the merge in a worktree under tempRoot and removes it', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    addGoodWork(lane)
    const before = snapshot(repo)
    const laneBefore = snapshot(lane)
    const steps = []
    const report = await reviewLane({ root: repo, lane: 'hermes', runsPath, tempRoot, onStep: (line) => steps.push(line) })
    const checks = byName(report)
    expect(report.branch).toBe('feat/t9-a-task')
    expect(Object.values(checks).map((check) => `${check.name} ${check.status}`)).toEqual([
      'commits PASS',
      'paths PASS',
      'brief PASS',
      'added lines PASS',
      'package.json PASS',
      'heuristics PASS',
      'changelog PASS',
      'commit messages PASS',
      'TASKS.md PASS',
      'merged result PASS',
    ])
    expect(checks['merged result'].text).toBe('npm test passed (3 passed of 3), npm run build passed.')
    expect(steps).toHaveLength(2)
    expect(existsSync(checks['merged result'].tree)).toBe(false)
    expect(dirname(dirname(checks['merged result'].tree))).toBe(tempRoot)
    expect(readdirSync(tempRoot)).toEqual([])
    expect(snapshot(repo)).toEqual(before)
    expect(snapshot(lane)).toEqual(laneBefore)
    expect(readFileSync(join(repo, 'node_modules', 'marker.txt'), 'utf8')).toBe('kept')
  }, 60000)

  it('fails bad work on every check that sees it', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    write(lane, 'server/x.js', "spawnSync('git', ['diff', 'main'])\n")
    write(lane, 'src/a.js', `export const a = '${EM_DASH}'\n`)
    write(lane, 'fail-tests', 'yes\n')
    write(lane, 'package.json', readFileSync(join(lane, 'package.json'), 'utf8').replace('"three": "1.0.0"', '"three": "1.0.0",\n    "lodash": "4.0.0"'))
    commitAll(lane, 'Add things')
    write(lane, 'loose.txt', 'not committed\n')
    const before = snapshot(repo)
    const report = await reviewLane({ root: repo, lane: 'hermes', runsPath, tempRoot })
    const checks = byName(report)
    expect(checks.commits.status).toBe('FAIL')
    expect(texts(checks.commits.details)).toEqual(['FAIL loose.txt not committed'])
    expect(texts(checks.paths.details)).toEqual(['FAIL server/x.js forbidden by server/**'])
    expect(checks.brief.status).toBe('WARN')
    expect(texts(checks['added lines'].details)).toEqual(['FAIL src/a.js:1 an em dash'])
    expect(texts(checks['package.json'].details)).toEqual(['FAIL lodash a new dependency'])
    expect(checks.heuristics.status).toBe('WARN')
    expect(checks.heuristics.details.map((detail) => detail.text)).toEqual([
      "a bare 'git' passed to a spawn call; use gitPath()",
      "a bare 'main' ref passed to git; use refs/heads/main",
      'git diff without --no-ext-diff and --no-textconv',
    ])
    expect(checks.changelog.status).toBe('FAIL')
    expect(checks['commit messages'].status).toBe('FAIL')
    expect(checks['merged result'].status).toBe('FAIL')
    expect(checks['merged result'].text).toBe('npm test failed (2 passed, 1 failed of 3), npm run build passed.')
    expect(existsSync(checks['merged result'].tree)).toBe(false)
    expect(snapshot(repo)).toEqual(before)
  }, 60000)

  it('fails a lane with nothing ahead and does not run the merge', async () => {
    const { repo, runsPath, tempRoot } = setup()
    const report = await reviewLane({ root: repo, lane: 'hermes', runsPath, tempRoot })
    const checks = byName(report)
    expect(texts(checks.commits.details)).toEqual(['FAIL feat/t9-a-task has no commit ahead of main.'])
    expect(checks['merged result'].text).toBe('Not run: there is nothing to merge.')
  }, 60000)

  it('reports a conflict with main and leaves both checkouts as they were', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    write(lane, 'src/keep.js', 'export const keep = 2\n')
    commitAll(lane, '0.1.2: Change keep.')
    write(repo, 'src/keep.js', 'export const keep = 3\n')
    commitAll(repo, '0.1.2: Change keep on main.')
    const before = snapshot(repo)
    const laneBefore = snapshot(lane)
    const report = await reviewLane({ root: repo, lane: 'hermes', runsPath, tempRoot })
    const merged = byName(report)['merged result']
    expect(merged.status).toBe('FAIL')
    expect(merged.text).toBe('feat/t9-a-task does not merge cleanly into main.')
    expect(texts(merged.details)).toEqual(['FAIL src/keep.js a merge conflict'])
    expect(existsSync(merged.tree)).toBe(false)
    expect(snapshot(repo)).toEqual(before)
    expect(snapshot(lane)).toEqual(laneBefore)
  }, 60000)

  it('keeps the temporary worktree with --keep', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    addGoodWork(lane)
    const report = await reviewLane({ root: repo, lane: 'hermes', runsPath, keep: true, tempRoot })
    const merged = byName(report)['merged result']
    expect(merged.kept).toBe(merged.tree)
    expect(existsSync(join(merged.tree, 'src', 'a.js'))).toBe(true)
    expect(removeReviewTree({ root: repo, temp: dirname(merged.tree), tree: merged.tree })).toBe(true)
    expect(existsSync(join(repo, 'node_modules', 'marker.txt'))).toBe(true)
    expect(git(repo, ['worktree', 'list', '--porcelain'])).not.toContain(merged.tree)
  }, 60000)

  it('refuses an unknown lane and a lane worktree on main', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    expect(await reviewLane({ root: repo, lane: 'nobody', runsPath, tempRoot })).toEqual({ error: 'There is no lane named nobody.' })
    expect(await reviewLane({ root: repo, lane: '__proto__', runsPath, tempRoot })).toEqual({ error: 'There is no lane named __proto__.' })
    git(lane, ['switch', '-q', '--detach'])
    const detached = await reviewLane({ root: repo, lane: 'hermes', runsPath, tempRoot })
    expect(detached.checks).toEqual([{ name: 'commits', status: 'FAIL', text: 'The lane worktree is not on a branch.', details: [] }])
  }, 60000)

  it('prints JSON and exits 1 on a FAIL through main', async () => {
    const { repo, lane, runsPath, tempRoot } = setup()
    addGoodWork(lane)
    write(lane, 'src/b.js', 'export const b = 1\n')
    commitAll(lane, 'no prefix')
    const out = []
    const code = await main(['hermes', '--json'], { root: repo, runsPath, tempRoot, log: (line) => out.push(line), error: () => {} })
    const parsed = JSON.parse(out.join('\n'))
    expect(code).toBe(1)
    expect(parsed.counts).toEqual({ PASS: 8, WARN: 1, FAIL: 1 })
    expect(parsed.checks.find((check) => check.status === 'FAIL').name).toBe('commit messages')
    expect(parsed.checks.find((check) => check.name === 'brief').details.map((detail) => detail.where)).toEqual(['src/b.js'])
    const usage = []
    expect(await main([], { root: repo, runsPath, tempRoot, log: () => {}, error: (line) => usage.push(line) })).toBe(1)
    expect(usage).toEqual(['Use: npm run review-lane -- LANE [--json] [--keep]'])
  }, 60000)
})

describe('the test temp folder', () => {
  it('is the folder the review checker falls back to', () => {
    expect(resolve(tmpdir())).toBe(resolve(SYSTEM_TEMP))
  })

  it('gains no machineroom-review-* folder during this file', () => {
    expect(systemReviewFolders()).toEqual([])
  })
})
