import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  abortMerge,
  branchBroughtUnreleasedLine,
  checkMerge,
  checkPrerequisites,
  defaultGitRunner,
  finishMerge,
  insertUnreleasedLine,
  main,
  parseMergeArgs,
  prepareMerge,
  runChecks,
  tailLines,
  USAGE,
} from '../scripts/merge-lane.mjs'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

let templateRoot = ''
let mainTemplate = ''

function gitCmd(cwd, args) {
  const result = spawnSync(gitPath(), ['-c', 'user.name=MachineRoom Test', '-c', 'user.email=', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`)
  }
  return String(result.stdout ?? '').trim()
}

function write(dir, name, text) {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), text)
}

function commitAll(dir, message) {
  gitCmd(dir, ['add', '-A'])
  gitCmd(dir, ['commit', '-q', '-m', message])
}

const CRLF = '\r\n'
const CHANGELOG_CRLF = `# Changelog${CRLF}${CRLF}## Unreleased${CRLF}${CRLF}- Older line.${CRLF}${CRLF}## 0.1.0${CRLF}${CRLF}- First.${CRLF}`
const PACKAGE_JSON = `${JSON.stringify({ name: 'machineroom-test', version: '0.1.401' }, null, 2)}\n`

beforeAll(() => {
  templateRoot = makeTempDir('mr-merge-template-')
  mainTemplate = join(templateRoot, 'main')
  mkdirSync(mainTemplate, { recursive: true })
  gitCmd(mainTemplate, ['init', '-q', '-b', 'main'])
  write(mainTemplate, 'package.json', PACKAGE_JSON)
  write(mainTemplate, 'docs/agents/CHANGELOG.md', CHANGELOG_CRLF)
  write(mainTemplate, 'docs/agents/TASKS.md', '## Briefs\n\n**T1. Task (Hermes).** Description.\n')
  write(mainTemplate, 'src/index.js', 'console.log("main")\n')
  commitAll(mainTemplate, '0.1.401: Initial commit')
})

afterAll(() => {
  rmSync(templateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function setupFixture() {
  const root = makeTempDir('mr-merge-fixture-')
  const mainDir = join(root, 'main')
  const laneDir = join(root, 'worktree-hermes')
  const runsDir = join(root, 'runs')
  mkdirSync(runsDir, { recursive: true })

  cpSync(mainTemplate, mainDir, { recursive: true })
  write(mainDir, 'docs/agents/lanes.json', JSON.stringify({
    hermes: { worktree: laneDir },
  }, null, 2))
  commitAll(mainDir, '0.1.401: Update lanes config')
  gitCmd(mainDir, ['worktree', 'add', '-q', '-b', 'feat/hermes-task', laneDir, 'refs/heads/main'])
  const previousLanesDir = process.env.MACHINEROOM_LANES_DIR
  process.env.MACHINEROOM_LANES_DIR = join(mainDir, 'docs', 'agents')

  cleanups.push(() => {
    if (previousLanesDir === undefined) delete process.env.MACHINEROOM_LANES_DIR
    else process.env.MACHINEROOM_LANES_DIR = previousLanesDir
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  return { root, mainDir, laneDir, runsDir }
}

describe('parseMergeArgs', () => {
  it('parses prepare command with a lane', () => {
    expect(parseMergeArgs(['hermes'])).toEqual({
      lane: 'hermes',
      finish: false,
      abort: false,
    })
  })

  it('parses --abort command', () => {
    expect(parseMergeArgs(['--abort'])).toEqual({
      lane: '',
      finish: false,
      abort: true,
    })
    expect(parseMergeArgs(['hermes', '--abort'])).toEqual({
      lane: 'hermes',
      finish: false,
      abort: true,
    })
  })

  it('parses --finish with required and optional flags', () => {
    const parsed = parseMergeArgs([
      'hermes',
      '--finish',
      '--subject',
      'Fix something',
      '--line',
      'A change line',
      '--grade',
      'A-',
      '--fixes',
      '0',
      '--ids',
      'P33,P34',
      '--note',
      'Good job',
      '--trailer',
      'Reviewed-by: tester',
    ])
    expect(parsed).toEqual({
      lane: 'hermes',
      finish: true,
      abort: false,
      subject: 'Fix something',
      line: 'A change line',
      grade: 'A-',
      fixes: '0',
      note: 'Good job',
      ids: ['P33', 'P34'],
      trailer: 'Reviewed-by: tester',
    })
  })

  it('returns error on missing required args or flags', () => {
    expect(parseMergeArgs([])).toEqual({ error: USAGE })
    expect(parseMergeArgs(['hermes', '--finish', '--subject', 'S'])).toEqual({ error: USAGE })
    expect(parseMergeArgs(['hermes', '--extra'])).toEqual({ error: USAGE })
  })
})

describe('insertUnreleasedLine', () => {
  it('inserts line under ## Unreleased preserving CRLF', () => {
    const text = `# Title${CRLF}${CRLF}## Unreleased${CRLF}${CRLF}- Older line.${CRLF}${CRLF}## 0.1.0${CRLF}`
    const result = insertUnreleasedLine(text, 'New line.')
    expect(result).toBe(`# Title${CRLF}${CRLF}## Unreleased${CRLF}${CRLF}- New line.${CRLF}- Older line.${CRLF}${CRLF}## 0.1.0${CRLF}`)
    expect(result.includes('\r\n')).toBe(true)
  })

  it('inserts line under ## Unreleased preserving LF', () => {
    const text = '# Title\n\n## Unreleased\n\n- Older line.\n\n## 0.1.0\n'
    const result = insertUnreleasedLine(text, 'New line.')
    expect(result).toBe('# Title\n\n## Unreleased\n\n- New line.\n- Older line.\n\n## 0.1.0\n')
  })

  it('throws when ## Unreleased is missing', () => {
    expect(() => insertUnreleasedLine('# Title\n', 'New line.')).toThrow('has no ## Unreleased section')
  })
})

describe('tailLines', () => {
  it('returns last N lines', () => {
    const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const tail = tailLines(text, 40)
    expect(tail.length).toBe(40)
    expect(tail[0]).toBe('line 20')
    expect(tail[39]).toBe('line 59')
  })
})

describe('refusals in prepareMerge', () => {
  it('refuses when not in main checkout', () => {
    const { laneDir } = setupFixture()
    const result = prepareMerge({ root: laneDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('This command must run in the main checkout.')
  })

  it('refuses when main checkout is not on main branch', () => {
    const { mainDir } = setupFixture()
    gitCmd(mainDir, ['switch', '-c', 'other'])
    const result = prepareMerge({ root: mainDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The main checkout must be on main.')
  })

  it('refuses when main checkout has uncommitted changes', () => {
    const { mainDir } = setupFixture()
    write(mainDir, 'dirty.txt', 'dirty')
    const result = prepareMerge({ root: mainDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The main checkout has uncommitted changes.')
  })

  it('refuses when a merge is already in progress', () => {
    const { mainDir, laneDir } = setupFixture()
    write(laneDir, 'file.txt', 'feature')
    commitAll(laneDir, '0.1.401: Feature commit')
    const head = gitCmd(laneDir, ['rev-parse', 'HEAD'])
    gitCmd(mainDir, ['merge', '--no-ff', '--no-commit', head])

    const result = prepareMerge({ root: mainDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('A merge is already in progress.')
  })

  it('refuses an unknown lane', () => {
    const { mainDir } = setupFixture()
    const result = prepareMerge({ root: mainDir, lane: 'unknown' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('There is no lane named unknown.')
  })

  it('refuses when worktree has uncommitted changes', () => {
    const { mainDir, laneDir } = setupFixture()
    write(laneDir, 'dirty.txt', 'dirty')
    const result = prepareMerge({ root: mainDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The worktree for hermes has uncommitted changes.')
  })

  it('refuses when lane branch has no commits ahead of main', () => {
    const { mainDir } = setupFixture()
    const result = prepareMerge({ root: mainDir, lane: 'hermes' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The branch feat/hermes-task has no commits ahead of main.')
  })

  it('refuses when lane lock has a live run', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/change.js', 'console.log(1)\n')
    commitAll(laneDir, '0.1.401: Change')

    const lockPath = join(runsDir, 'hermes.lock')
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, folder: laneDir }))

    const result = prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The hermes lane has a live run.')
  })
})

describe('clean merge stays staged', () => {
  it('merges cleanly, runs checks, and leaves merge staged', async () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/feature.js', 'export const feat = true\n')
    commitAll(laneDir, '0.1.401: Add feature')

    const runsFile = join(runsDir, 'runs.jsonl')
    writeFileSync(runsFile, `${JSON.stringify({ branch: 'feat/hermes-task', briefs: ['T1'], startedAt: new Date().toISOString() })}\n`)

    const prep = prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(prep.ok).toBe(true)
    expect(prep.changedFiles).toContain('src/feature.js')

    const mergeHead = gitCmd(mainDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mergeHead).toBeTruthy()

    const check = await checkMerge({
      root: mainDir,
      lane: 'hermes',
      branch: prep.branch,
      changedFiles: prep.changedFiles,
      runChecksFn: async () => [
        { name: 'vitest related', ok: true, output: 'Tests passed' },
        { name: 'build', ok: true, output: 'Build passed' },
      ],
      runsPath: runsFile,
    })

    expect(check.ok).toBe(true)
    expect(check.briefIds).toEqual(['T1'])
    expect(check.checkResults.every((c) => c.ok)).toBe(true)

    const status = gitCmd(mainDir, ['status', '--porcelain'])
    expect(status).toContain('A  src/feature.js')
    const mergeHeadStill = gitCmd(mainDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mergeHeadStill).toBeTruthy()
  })
})

describe('conflict handling', () => {
  it('aborts merge on conflict and leaves main as it was', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(mainDir, 'src/index.js', 'console.log("main conflicting")\n')
    commitAll(mainDir, '0.1.401: Conflict on main')
    const mainHead = gitCmd(mainDir, ['rev-parse', 'HEAD'])

    write(laneDir, 'src/index.js', 'console.log("lane conflicting")\n')
    commitAll(laneDir, '0.1.401: Conflict on lane')

    const prep = prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(prep.ok).toBe(false)
    expect(prep.conflict).toBe(true)
    expect(prep.conflicts).toContain('src/index.js')

    expect(gitCmd(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe('')
  })
})

describe('failing check aborts merge', () => {
  it('aborts merge and restores checkout when a check fails', async () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/fail.js', 'export const fail = true\n')
    commitAll(laneDir, '0.1.401: Failing code')
    const mainHead = gitCmd(mainDir, ['rev-parse', 'HEAD'])

    const prep = prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(prep.ok).toBe(true)

    const check = await checkMerge({
      root: mainDir,
      lane: 'hermes',
      branch: prep.branch,
      changedFiles: prep.changedFiles,
      runChecksFn: async () => [
        { name: 'vitest related', ok: false, output: 'Error in tests\nLine 2\nLine 3' },
      ],
    })

    expect(check.ok).toBe(false)
    expect(check.failed).toBe('vitest related')
    expect(check.tail).toContain('Error in tests')

    expect(gitCmd(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe('')
  })
})

describe('runChecks', () => {
  it('holds -- right before the first file in the vitest related command', async () => {
    const executed = []
    await runChecks({
      root: templateRoot,
      changedFiles: ['src/feature.js', 'src/other.js'],
      runCommand: async (command) => {
        executed.push(command)
        return { ok: true, output: '' }
      },
    })
    const vitestCheck = executed.find((cmd) => cmd.includes('related'))
    expect(vitestCheck).toBeDefined()
    const firstFileIndex = vitestCheck.indexOf('src/feature.js')
    expect(firstFileIndex).toBeGreaterThan(0)
    expect(vitestCheck[firstFileIndex - 1]).toBe('--')
  })
})

describe('--finish command', () => {
  it('refuses when no merge is in progress', () => {
    const { mainDir } = setupFixture()
    const result = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Finish test',
      line: 'Added line.',
      grade: 'A',
      fixes: '0',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('No merge is in progress.')
  })

  it('refuses changelog line with em dash or newline', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/item.js', 'item\n')
    commitAll(laneDir, '0.1.401: Item')
    prepareMerge({ root: mainDir, lane: 'hermes', runsDir })

    const resultDash = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Finish test',
      line: 'Line with \u2014 em dash.',
      grade: 'A',
      fixes: '0',
    })
    expect(resultDash.ok).toBe(false)
    expect(resultDash.error).toBe('The changelog line cannot contain an em dash or a line break.')

    const resultNl = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Finish test',
      line: 'Line with\nbreak.',
      grade: 'A',
      fixes: '0',
    })
    expect(resultNl.ok).toBe(false)
    expect(resultNl.error).toBe('The changelog line cannot contain an em dash or a line break.')
  })

  it('refuses subject or trailer with em dash or newline leaving changelog and checkout unchanged', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/item.js', 'item\n')
    commitAll(laneDir, '0.1.401: Item')
    prepareMerge({ root: mainDir, lane: 'hermes', runsDir })

    const changelogBefore = readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')
    const statusBefore = gitCmd(mainDir, ['status', '--porcelain'])

    const resultSubjectDash = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Subject with \u2014 em dash',
      line: 'Valid line.',
      grade: 'A',
      fixes: '0',
    })
    expect(resultSubjectDash.ok).toBe(false)
    expect(resultSubjectDash.error).toBe('The subject cannot contain an em dash or a line break.')
    expect(readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')).toBe(changelogBefore)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe(statusBefore)

    const resultSubjectNl = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Subject with\nnewline',
      line: 'Valid line.',
      grade: 'A',
      fixes: '0',
    })
    expect(resultSubjectNl.ok).toBe(false)
    expect(resultSubjectNl.error).toBe('The subject cannot contain an em dash or a line break.')
    expect(readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')).toBe(changelogBefore)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe(statusBefore)

    const resultTrailerDash = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Valid subject',
      line: 'Valid line.',
      grade: 'A',
      fixes: '0',
      trailer: 'Reviewed-by: tester \u2014 tag',
    })
    expect(resultTrailerDash.ok).toBe(false)
    expect(resultTrailerDash.error).toBe('The trailer cannot contain an em dash or a line break.')
    expect(readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')).toBe(changelogBefore)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe(statusBefore)

    const resultTrailerNl = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Valid subject',
      line: 'Valid line.',
      grade: 'A',
      fixes: '0',
      trailer: 'Reviewed-by: tester\nExtra line',
    })
    expect(resultTrailerNl.ok).toBe(false)
    expect(resultTrailerNl.error).toBe('The trailer cannot contain an em dash or a line break.')
    expect(readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')).toBe(changelogBefore)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe(statusBefore)
  })

  it('writes changelog keeping CRLF line ends, commits, and records outcome', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/finished.js', 'finished\n')
    commitAll(laneDir, '0.1.401: Finish item')

    const runsFile = join(runsDir, 'runs.jsonl')
    writeFileSync(runsFile, `${JSON.stringify({ branch: 'feat/hermes-task', briefs: ['T1'] })}\n`)

    const prep = prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(prep.ok).toBe(true)

    const outcomesPath = join(runsDir, 'outcomes.jsonl')

    const finish = finishMerge({
      root: mainDir,
      lane: 'hermes',
      subject: 'Finish item',
      line: 'A new feature added.',
      grade: 'A-',
      fixes: '0',
      ids: ['T1'],
      trailer: 'Reviewed-by: tester',
      outcomesPath,
      runsPath: runsFile,
    })

    expect(finish.ok).toBe(true)
    expect(finish.commitSubject).toBe('0.1.401: Merge T1, Finish item')
    expect(finish.isClean).toBe(true)

    const lastCommitMsg = gitCmd(mainDir, ['log', '-1', '--pretty=%B'])
    expect(lastCommitMsg).toContain('0.1.401: Merge T1, Finish item')
    expect(lastCommitMsg).toContain('Reviewed-by: tester')

    const changelog = readFileSync(join(mainDir, 'docs/agents/CHANGELOG.md'), 'utf8')
    expect(changelog).toContain(`## Unreleased${CRLF}${CRLF}- A new feature added.${CRLF}- Older line.`)
    expect(changelog.includes('\r\n')).toBe(true)

    const outcomeContent = readFileSync(outcomesPath, 'utf8')
    const outcomeRecord = JSON.parse(outcomeContent.trim())
    expect(outcomeRecord.branch).toBe('feat/hermes-task')
    expect(outcomeRecord.outcome).toBe('merged')
    expect(outcomeRecord.grade).toBe('A-')
    expect(outcomeRecord.fixes).toBe(0)
    expect(outcomeRecord.version).toBe('0.1.401')
  })
})

describe('--abort command execution', () => {
  it('aborts merge in progress cleanly', () => {
    const { mainDir, laneDir, runsDir } = setupFixture()
    write(laneDir, 'src/abort.js', 'abort test\n')
    commitAll(laneDir, '0.1.401: Abort test commit')

    prepareMerge({ root: mainDir, lane: 'hermes', runsDir })
    expect(gitCmd(mainDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).toBeTruthy()

    const result = abortMerge({ root: mainDir })
    expect(result.ok).toBe(true)
    expect(gitCmd(mainDir, ['status', '--porcelain'])).toBe('')
  })
})
