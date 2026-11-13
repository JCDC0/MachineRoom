import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import {
  ARCHIVE_PATH_PROBLEM,
  CONFIRM_PROBLEM,
  DAYS_PROBLEM,
  DESTINATION_EXISTS_REASON,
  FILES_PROBLEM,
  NOT_ELIGIBLE_REASON,
  ORIGIN_PROBLEM,
  STAT_CONCURRENCY,
  applyStorageArchive,
  measureDirectoryBytes,
  measureStorage,
  moveFileSafe,
  previewStorageArchive,
  worktreesCleanCommand,
} from '../server/storage.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-storage-no-git-config')
const DAY_MS = 24 * 60 * 60 * 1000
const NOW_MS = Date.UTC(2026, 10, 13, 12, 0, 0)
const OLD_45_MS = NOW_MS - 45 * DAY_MS
const RECENT_5_MS = NOW_MS - 5 * DAY_MS

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function writeAgedFile(filePath, content, mtimeMs) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  if (typeof mtimeMs === 'number') {
    const date = new Date(mtimeMs)
    utimesSync(filePath, date, date)
  }
  return Buffer.byteLength(content, 'utf8')
}

function testGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

function buildSyntheticFixture() {
  const base = makeTempDir('mr-storage-')
  cleanups.push(() => removeTempDir(base))
  const project = join(base, 'project')
  const runs = join(base, 'runs')
  const recordings = join(project, 'public', 'recordings')
  const worktrees = join(project, '.worktrees')
  mkdirSync(project, { recursive: true })
  mkdirSync(runs, { recursive: true })
  mkdirSync(recordings, { recursive: true })
  mkdirSync(join(worktrees, 'agy'), { recursive: true })
  mkdirSync(join(worktrees, 'codex'), { recursive: true })
  return { base, project, runs, recordings, worktrees }
}

async function sequentialWalkBytes(dirPath) {
  let bytes = 0
  const stack = [dirPath]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile()) {
        try {
          const info = await lstat(fullPath)
          if (info.isFile()) bytes += info.size
        } catch {
        }
      }
    }
  }
  return bytes
}

describe('server/storage', () => {
  it('counts missing folders as 0 and measures synthetic runs, recordings, conversations and worktrees by kind', async () => {
    const base = makeTempDir('mr-storage-empty-')
    cleanups.push(() => removeTempDir(base))
    const emptySummary = await measureStorage({
      runsFolder: join(base, 'missing-runs'),
      projectRoot: join(base, 'missing-project'),
    })
    expect(emptySummary.kinds).toEqual({
      logs: { count: 0, bytes: 0 },
      recordings: { count: 0, bytes: 0 },
      conversations: { count: 0, bytes: 0 },
      worktrees: { count: 0, bytes: 0 },
    })
    expect(emptySummary.totalBytes).toBe(0)
    expect(emptySummary.worktrees.clean).toEqual([])

    const fixture = buildSyntheticFixture()
    const targetOutside = join(fixture.base, 'shared-node-modules')
    mkdirSync(targetOutside, { recursive: true })
    writeFileSync(join(targetOutside, 'huge.bin'), 'x'.repeat(2000))

    let logBytes = 0
    logBytes += writeAgedFile(join(fixture.runs, 'agy-20260925-100000-001.log'), 'log-old-1\n', OLD_45_MS)
    logBytes += writeAgedFile(
      join(fixture.runs, 'agy-20260925-100000-001.meta.json'),
      JSON.stringify({ lane: 'agy' }),
      OLD_45_MS
    )
    logBytes += writeAgedFile(
      join(fixture.runs, 'agy-20260925-100000-001.usage.json'),
      JSON.stringify({ totalUsd: 0.1 }),
      OLD_45_MS
    )
    logBytes += writeAgedFile(join(fixture.runs, 'orchestrator-abc-chat-20260925-100000-001.meta.json'), '{}', OLD_45_MS)

    mkdirSync(join(fixture.runs, 'archive', '2026-08'), { recursive: true })
    writeAgedFile(join(fixture.runs, 'archive', '2026-08', 'already-archived.log'), 'ignored\n', OLD_45_MS)

    let recordingBytes = 0
    writeAgedFile(join(fixture.recordings, 'index.json'), JSON.stringify([{ name: 'rec-kept' }]), OLD_45_MS)
    recordingBytes += writeAgedFile(join(fixture.recordings, 'rec-kept-run.jsonl'), '{"frame":1}\n', OLD_45_MS)
    recordingBytes += writeAgedFile(join(fixture.recordings, 'rec-kept-agents.json'), '{"agents":[]}\n', OLD_45_MS)
    recordingBytes += writeAgedFile(join(fixture.recordings, 'rec-kept-tree.json'), '{"files":[]}\n', OLD_45_MS)

    let conversationBytes = 0
    conversationBytes += writeAgedFile(
      join(fixture.runs, 'orchestrator-abc.json'),
      JSON.stringify({ messages: [{ text: 'hello' }] }),
      OLD_45_MS
    )
    conversationBytes += writeAgedFile(
      join(fixture.runs, 'orchestrator-abc-sub1.json'),
      JSON.stringify({ messages: [] }),
      OLD_45_MS
    )
    writeAgedFile(join(fixture.runs, 'orchestrator-abc.lock'), 'pid=999999\n', NOW_MS)

    let worktreeBytes = 0
    worktreeBytes += writeAgedFile(join(fixture.worktrees, 'agy', 'note.txt'), 'agy-worktree', NOW_MS)
    worktreeBytes += writeAgedFile(join(fixture.worktrees, 'codex', 'sub', 'code.js'), 'export const x = 1\n', NOW_MS)
    symlinkSync(targetOutside, join(fixture.worktrees, 'agy', 'node_modules'), 'junction')

    const summary = await measureStorage({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      collectWorktreesFn: () => ({
        project: fixture.project,
        branch: 'main',
        worktrees: [
          {
            lane: 'agy',
            path: join(fixture.worktrees, 'agy'),
            branch: 'feat/done',
            ahead: 0,
            dirty: false,
            ignored: 0,
            merged: true,
            running: false,
            locked: false,
            prunable: false,
          },
          {
            lane: 'codex',
            path: join(fixture.worktrees, 'codex'),
            branch: 'feat/wip',
            ahead: 1,
            dirty: true,
            ignored: 0,
            merged: false,
            running: false,
            locked: false,
            prunable: false,
          },
        ],
      }),
    })

    expect(summary.kinds).toEqual({
      logs: { count: 4, bytes: logBytes },
      recordings: { count: 3, bytes: recordingBytes },
      conversations: { count: 2, bytes: conversationBytes },
      worktrees: { count: 2, bytes: worktreeBytes },
    })
    expect(summary.totalBytes).toBe(logBytes + recordingBytes + conversationBytes + worktreeBytes)
    expect(summary.worktrees.clean).toEqual([
      {
        lane: 'agy',
        branch: 'feat/done',
        path: join(fixture.worktrees, 'agy'),
        bytes: Buffer.byteLength('agy-worktree', 'utf8'),
      },
    ])
    expect(summary.worktrees.command).toBe(worktreesCleanCommand(fixture.project))
  })

  it('excludes running runs, held lane locks, kept recordings and saved conversations from preview', async () => {
    const fixture = buildSyntheticFixture()

    writeAgedFile(join(fixture.runs, 'agy-20260920-090000-001.log'), 'done-old-log', OLD_45_MS)
    writeAgedFile(
      join(fixture.runs, 'agy-20260920-090000-001.meta.json'),
      JSON.stringify({ lane: 'agy' }),
      OLD_45_MS
    )
    writeAgedFile(
      join(fixture.runs, 'agy-20260920-090000-001.usage.json'),
      JSON.stringify({ tokens: 10 }),
      OLD_45_MS
    )
    writeAgedFile(join(fixture.runs, 'agy-20261108-090000-002.log'), 'recent-log', RECENT_5_MS)

    writeAgedFile(join(fixture.runs, 'opencode-20260919-080000-001.log'), 'running-old-log', OLD_45_MS)
    writeAgedFile(
      join(fixture.runs, 'opencode-20260919-080000-001.meta.json'),
      JSON.stringify({ lane: 'opencode' }),
      OLD_45_MS
    )
    writeAgedFile(join(fixture.runs, 'runner-20260917-070000-001.log'), 'is-running-log', OLD_45_MS)

    writeAgedFile(join(fixture.runs, 'codex-20260918-070000-001.log'), 'held-lock-log', OLD_45_MS)
    writeAgedFile(
      join(fixture.runs, 'codex-20260918-070000-001.meta.json'),
      JSON.stringify({ lane: 'codex' }),
      OLD_45_MS
    )
    writeFileSync(join(fixture.runs, 'codex.lock'), `${process.pid}\n`)
    writeFileSync(join(fixture.runs, 'agy.lock'), '999999999\n')
    writeFileSync(join(fixture.runs, 'orchestrator-abc.lock'), `${process.pid}\n`)
    writeAgedFile(join(fixture.runs, 'orchestrator-abc-chat-20260920-090000-001.log'), 'old-chat-turn', OLD_45_MS)

    writeAgedFile(join(fixture.runs, 'orchestrator-abc.json'), '{"messages":[]}', OLD_45_MS)

    writeAgedFile(join(fixture.recordings, 'index.json'), JSON.stringify([{ name: 'in-index-old' }]), OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'in-index-old-run.jsonl'), '{}', OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'kept-by-record-run.jsonl'), '{}', OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'orphan-old-run.jsonl'), '{"frame":1}', OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'orphan-old-agents.json'), '{}', OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'orphan-old-tree.json'), '{}', OLD_45_MS)

    const records = [
      {
        lane: 'agy',
        startedAt: new Date(OLD_45_MS).toISOString(),
        exitCode: 0,
        log: join(fixture.runs, 'agy-20260920-090000-001.log'),
      },
      {
        lane: 'agy',
        startedAt: new Date(RECENT_5_MS).toISOString(),
        exitCode: 0,
        log: join(fixture.runs, 'kept-by-record.log'),
      },
      {
        lane: 'agy',
        startedAt: new Date(OLD_45_MS).toISOString(),
        exitCode: 0,
        log: join(fixture.runs, 'orphan-old.log'),
      },
    ]
    writeFileSync(join(fixture.runs, 'runs.jsonl'), records.map((row) => JSON.stringify(row)).join('\n') + '\n')

    const preview = await previewStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      now: () => NOW_MS,
      openRuns: () => [{ name: 'opencode-20260919-080000-001', lane: 'opencode' }],
      isRunningFn: (lane) => lane === 'runner',
      isHolderAliveFn: (holder, path) => {
        if (path.endsWith('codex.lock') && holder.pid === process.pid) return true
        return false
      },
    })

    const previewNames = preview.files.map((item) => item.name).sort()
    expect(previewNames).toEqual([
      'agy-20260920-090000-001.log',
      'agy-20260920-090000-001.meta.json',
      'agy-20260920-090000-001.usage.json',
      'orchestrator-abc-chat-20260920-090000-001.log',
      'orphan-old-agents.json',
      'orphan-old-run.jsonl',
      'orphan-old-tree.json',
    ])
    expect(preview.files.every((item) => item.archiveDir === 'archive/2026-09')).toBe(true)
    expect(preview.totalBytes).toBe(preview.files.reduce((sum, item) => sum + item.bytes, 0))
  })

  it('archives exact previewed files into archive/YYYY-MM, keeps everything else, and moves nothing a second time', async () => {
    const fixture = buildSyntheticFixture()
    writeAgedFile(join(fixture.runs, 'agy-20260910-100000-001.log'), 'old-log-body', OLD_45_MS)
    writeAgedFile(join(fixture.runs, 'agy-20260910-100000-001.meta.json'), '{"lane":"agy"}', OLD_45_MS)
    writeAgedFile(join(fixture.runs, 'agy-20260910-100000-001.usage.json'), '{"cost":1}', OLD_45_MS)
    writeAgedFile(join(fixture.runs, 'agy-20261110-100000-002.log'), 'new-log-body', RECENT_5_MS)
    writeAgedFile(join(fixture.runs, 'orchestrator-abc.json'), '{"saved":true}', OLD_45_MS)
    writeAgedFile(join(fixture.worktrees, 'agy', 'keep.txt'), 'worktree-file', OLD_45_MS)
    writeAgedFile(join(fixture.recordings, 'orphan-agents.json'), '{"a":1}', OLD_45_MS)

    const preview = await previewStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      now: () => NOW_MS,
    })
    expect(preview.files.map((item) => item.name).sort()).toEqual([
      'agy-20260910-100000-001.log',
      'agy-20260910-100000-001.meta.json',
      'agy-20260910-100000-001.usage.json',
      'orphan-agents.json',
    ])

    const previewNames = preview.files.map((item) => item.name)
    const archived = await applyStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      files: previewNames,
      now: () => NOW_MS,
    })

    expect(archived.ok).toBe(true)
    expect(archived.count).toBe(preview.count)
    expect(archived.totalBytes).toBe(preview.totalBytes)
    expect(archived.moved.map((item) => item.name).sort()).toEqual(previewNames.slice().sort())
    expect(archived.skipped).toEqual([])

    expect(existsSync(join(fixture.runs, 'agy-20260910-100000-001.log'))).toBe(false)
    expect(existsSync(join(fixture.runs, 'agy-20260910-100000-001.meta.json'))).toBe(false)
    expect(existsSync(join(fixture.runs, 'agy-20260910-100000-001.usage.json'))).toBe(false)
    expect(existsSync(join(fixture.recordings, 'orphan-agents.json'))).toBe(false)

    const monthDir = join(fixture.runs, 'archive', '2026-09')
    expect(readFileSync(join(monthDir, 'agy-20260910-100000-001.log'), 'utf8')).toBe('old-log-body')
    expect(readFileSync(join(monthDir, 'agy-20260910-100000-001.meta.json'), 'utf8')).toBe('{"lane":"agy"}')
    expect(readFileSync(join(monthDir, 'agy-20260910-100000-001.usage.json'), 'utf8')).toBe('{"cost":1}')
    expect(readFileSync(join(monthDir, 'orphan-agents.json'), 'utf8')).toBe('{"a":1}')

    expect(existsSync(join(fixture.runs, 'agy-20261110-100000-002.log'))).toBe(true)
    expect(existsSync(join(fixture.runs, 'orchestrator-abc.json'))).toBe(true)
    expect(existsSync(join(fixture.worktrees, 'agy', 'keep.txt'))).toBe(true)

    const second = await applyStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      files: previewNames,
      now: () => NOW_MS,
    })
    expect(second).toEqual({
      ok: true,
      days: 30,
      count: 0,
      totalBytes: 0,
      moved: [],
      skipped: previewNames.map((name) => ({ name, reason: NOT_ELIGIBLE_REASON })),
    })
  })

  it('lists real clean merged worktrees via git without deleting them', async () => {
    const base = makeTempDir('mr-storage-git-')
    cleanups.push(() => removeTempDir(base))
    const repo = join(base, 'repo')
    const runs = join(base, 'runs')
    mkdirSync(repo, { recursive: true })
    mkdirSync(runs, { recursive: true })
    testGit(repo, ['init', '-b', 'main'])
    testGit(repo, ['config', 'user.name', 'MachineRoom Test'])
    testGit(repo, ['config', 'user.email', 'test@example.invalid'])
    writeFileSync(join(repo, 'README.md'), 'init\n')
    testGit(repo, ['add', '.'])
    testGit(repo, ['commit', '-m', 'init'])

    const wtDir = join(repo, '.worktrees', 'agy')
    mkdirSync(join(repo, '.worktrees'), { recursive: true })
    testGit(repo, ['worktree', 'add', '-b', 'feat/merged', wtDir])

    const summary = await measureStorage({ runsFolder: runs, projectRoot: repo })
    expect(summary.kinds.worktrees.count).toBe(1)
    expect(summary.worktrees.clean).toHaveLength(1)
    expect(summary.worktrees.clean[0].lane).toBe('agy')
    expect(summary.worktrees.clean[0].branch).toBe('feat/merged')
    expect(summary.worktrees.command).toBe(worktreesCleanCommand(repo))
    expect(existsSync(wtDir)).toBe(true)
  })

  it('serves storage routes over the bridge and enforces Origin and confirmed checks', async () => {
    const fixture = buildSyntheticFixture()
    const bytes = writeAgedFile(join(fixture.runs, 'agy-20260915-100000-001.log'), 'http-archive-me', OLD_45_MS)

    const bridge = createBridge({
      projectRoot: fixture.project,
      runsFolder: fixture.runs,
      now: () => NOW_MS,
    })
    const { url } = await bridge.start(0)
    cleanups.push(() => bridge.stop())

    const storageResponse = await fetch(`${url}/api/storage`)
    expect(storageResponse.status).toBe(200)
    const storageBody = await storageResponse.json()
    expect(storageBody.kinds.logs).toEqual({ count: 1, bytes })

    const badDays = await fetch(`${url}/api/storage/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 0 }),
    })
    expect(badDays.status).toBe(400)
    expect(await badDays.json()).toEqual({ error: DAYS_PROBLEM })

    const defaultPreview = await fetch(`${url}/api/storage/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(defaultPreview.status).toBe(200)
    const previewBody = await defaultPreview.json()
    expect(previewBody.days).toBe(30)
    expect(previewBody.count).toBe(1)
    expect(previewBody.totalBytes).toBe(bytes)

    const noOrigin = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30, confirmed: true }),
    })
    expect(noOrigin.status).toBe(403)
    expect(await noOrigin.json()).toEqual({ error: ORIGIN_PROBLEM })

    const evilOrigin = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ days: 30, confirmed: true }),
    })
    expect(evilOrigin.status).toBe(403)

    const unconfirmed = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, confirmed: false }),
    })
    expect(unconfirmed.status).toBe(400)
    expect(await unconfirmed.json()).toEqual({ error: CONFIRM_PROBLEM })

    const missingFiles = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, confirmed: true }),
    })
    expect(missingFiles.status).toBe(400)
    expect(await missingFiles.json()).toEqual({ error: FILES_PROBLEM })

    const emptyFiles = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, files: [], confirmed: true }),
    })
    expect(emptyFiles.status).toBe(400)
    expect(await emptyFiles.json()).toEqual({ error: FILES_PROBLEM })

    const badFiles = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, files: ['../escape.log'], confirmed: true }),
    })
    expect(badFiles.status).toBe(400)
    expect(await badFiles.json()).toEqual({ error: FILES_PROBLEM })

    const previewNames = previewBody.files.map((item) => item.name)
    const archiveOk = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, files: previewNames, confirmed: true }),
    })
    expect(archiveOk.status).toBe(200)
    const archivedBody = await archiveOk.json()
    expect(archivedBody.ok).toBe(true)
    expect(archivedBody.count).toBe(1)
    expect(archivedBody.totalBytes).toBe(bytes)
    expect(archivedBody.skipped).toEqual([])
    expect(existsSync(join(fixture.runs, 'archive', '2026-09', 'agy-20260915-100000-001.log'))).toBe(true)

    const secondArchive = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, files: previewNames, confirmed: true }),
    })
    expect(secondArchive.status).toBe(200)
    expect(await secondArchive.json()).toEqual({
      ok: true,
      days: 30,
      count: 0,
      totalBytes: 0,
      moved: [],
      skipped: previewNames.map((name) => ({ name, reason: NOT_ELIGIBLE_REASON })),
    })
  })

  it('matches the sequential walk byte totals across nested folders and skipped symbolic links, and counts failed reads as 0', async () => {
    const fixture = buildSyntheticFixture()
    const opencodeWt = join(fixture.worktrees, 'opencode')
    mkdirSync(opencodeWt, { recursive: true })

    const outsideDir = join(fixture.base, 'outside-target')
    mkdirSync(outsideDir, { recursive: true })
    writeAgedFile(join(outsideDir, 'linked.bin'), 'z'.repeat(4096), NOW_MS)

    let expectedWorktreeBytes = 0
    const agyRoot = join(fixture.worktrees, 'agy')
    expectedWorktreeBytes += writeAgedFile(join(agyRoot, 'root.txt'), 'alpha', NOW_MS)
    expectedWorktreeBytes += writeAgedFile(join(agyRoot, 'src', 'index.js'), 'export const a = 1\n', NOW_MS)
    expectedWorktreeBytes += writeAgedFile(join(agyRoot, 'src', 'deep', 'leaf', 'data.json'), '{"ok":true}', NOW_MS)
    mkdirSync(join(agyRoot, 'empty', 'nested'), { recursive: true })
    symlinkSync(
      outsideDir,
      join(agyRoot, 'src', 'linked-modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    const codexRoot = join(fixture.worktrees, 'codex')
    for (let i = 0; i < 40; i += 1) {
      expectedWorktreeBytes += writeAgedFile(join(codexRoot, `mod-${i % 4}`, `f-${i}.txt`), 'x'.repeat(10 + i), NOW_MS)
    }

    const failingFile = join(opencodeWt, 'a', 'broken.txt')
    const nonFilePath = join(opencodeWt, 'a', 'special.txt')
    const failingBytes = writeAgedFile(failingFile, 'secret-unreadable', NOW_MS)
    const nonFileBytes = writeAgedFile(nonFilePath, 'not-a-regular-file', NOW_MS)
    const keptOpenCodeBytes = writeAgedFile(join(opencodeWt, 'a', 'b', 'kept.txt'), 'kept-bytes', NOW_MS)
    expectedWorktreeBytes += failingBytes + nonFileBytes + keptOpenCodeBytes

    const agySequential = await sequentialWalkBytes(agyRoot)
    const codexSequential = await sequentialWalkBytes(codexRoot)
    const opencodeSequential = await sequentialWalkBytes(opencodeWt)
    expect(agySequential + codexSequential + opencodeSequential).toBe(expectedWorktreeBytes)

    expect(await measureDirectoryBytes(agyRoot)).toBe(agySequential)
    expect(await measureDirectoryBytes(codexRoot)).toBe(codexSequential)
    expect(await measureDirectoryBytes(opencodeWt)).toBe(opencodeSequential)

    const summary = await measureStorage({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      collectWorktreesFn: () => ({ worktrees: [] }),
    })
    expect(summary.kinds.worktrees).toEqual({ count: 3, bytes: expectedWorktreeBytes })
    expect(summary.worktrees.bytes).toBe(expectedWorktreeBytes)
    expect(summary.totalBytes).toBe(expectedWorktreeBytes)

    const withFailureSummary = await measureStorage({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      collectWorktreesFn: () => ({ worktrees: [] }),
      lstatFn: async (filePath) => {
        if (filePath === failingFile) throw new Error('EACCES')
        if (filePath === nonFilePath) return { isFile: () => false, size: 9999 }
        return lstat(filePath)
      },
    })
    expect(withFailureSummary.kinds.worktrees).toEqual({
      count: 3,
      bytes: expectedWorktreeBytes - failingBytes - nonFileBytes,
    })
  })

  it('keeps at most 64 lstat calls in flight across the whole scan and standalone directory reads', async () => {
    expect(STAT_CONCURRENCY).toBe(64)
    const fixture = buildSyntheticFixture()
    let expectedRunsBytes = 0
    for (let i = 0; i < 70; i += 1) {
      expectedRunsBytes += writeAgedFile(join(fixture.runs, `agy-20261101-100000-${String(i).padStart(3, '0')}.log`), 'run-log', NOW_MS)
    }
    let expectedRecBytes = 0
    for (let i = 0; i < 30; i += 1) {
      expectedRecBytes += writeAgedFile(join(fixture.recordings, `rec-${i}-agents.json`), '{}', NOW_MS)
    }
    let expectedWtBytes = 0
    let agyBytes = 0
    for (let f = 0; f < 70; f += 1) {
      agyBytes += writeAgedFile(join(fixture.worktrees, 'agy', 'dir-0', `file-${f}.txt`), '12345678', NOW_MS)
    }
    for (let d = 1; d < 4; d += 1) {
      for (let f = 0; f < 10; f += 1) {
        agyBytes += writeAgedFile(join(fixture.worktrees, 'agy', `dir-${d}`, `file-${f}.txt`), '12345678', NOW_MS)
      }
    }
    expectedWtBytes += agyBytes
    for (const wt of ['codex', 'opencode', 'lane-4', 'lane-5', 'lane-6']) {
      for (let d = 0; d < 4; d += 1) {
        for (let f = 0; f < 20; f += 1) {
          expectedWtBytes += writeAgedFile(join(fixture.worktrees, wt, `dir-${d}`, `file-${f}.txt`), '12345678', NOW_MS)
        }
      }
    }

    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const trackedLstat = async (filePath) => {
      calls += 1
      inFlight += 1
      if (inFlight > maxInFlight) maxInFlight = inFlight
      try {
        await new Promise((resolve) => setTimeout(resolve, 15))
        return await lstat(filePath)
      } finally {
        inFlight -= 1
      }
    }

    const summary = await measureStorage({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      collectWorktreesFn: () => ({ worktrees: [] }),
      lstatFn: trackedLstat,
    })

    expect(calls).toBe(70 + 30 + 100 + 5 * 4 * 20)
    expect(inFlight).toBe(0)
    expect(maxInFlight).toBe(STAT_CONCURRENCY)
    expect(summary.kinds.logs.bytes).toBe(expectedRunsBytes)
    expect(summary.kinds.recordings.bytes).toBe(expectedRecBytes)
    expect(summary.kinds.worktrees).toEqual({ count: 6, bytes: expectedWtBytes })
    expect(summary.totalBytes).toBe(expectedRunsBytes + expectedRecBytes + expectedWtBytes)

    inFlight = 0
    maxInFlight = 0
    calls = 0
    const standaloneWt = join(fixture.worktrees, 'agy')
    const singleBytes = await measureDirectoryBytes(standaloneWt, { lstatFn: trackedLstat })
    expect(calls).toBe(100)
    expect(inFlight).toBe(0)
    expect(maxInFlight).toBe(STAT_CONCURRENCY)
    expect(singleBytes).toBe(agyBytes)
  })

  it('refuses archive when the archive folder is a junction or symbolic link and keeps the source file', async (ctx) => {
    const fixture = buildSyntheticFixture()
    const outsideDir = join(fixture.base, 'outside-archive')
    mkdirSync(outsideDir, { recursive: true })
    const linkPath = join(fixture.runs, 'archive')
    try {
      symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOTSUP') {
        ctx.skip()
        return
      }
      throw error
    }

    const logPath = join(fixture.runs, 'agy-20260910-100000-001.log')
    writeAgedFile(logPath, 'keep-me-in-runs', OLD_45_MS)

    await expect(
      applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        files: ['agy-20260910-100000-001.log'],
        now: () => NOW_MS,
      })
    ).rejects.toThrow(ARCHIVE_PATH_PROBLEM)

    expect(existsSync(logPath)).toBe(true)
    expect(readFileSync(logPath, 'utf8')).toBe('keep-me-in-runs')
    expect(readdirSync(outsideDir)).toEqual([])

    const bridge = createBridge({
      projectRoot: fixture.project,
      runsFolder: fixture.runs,
      now: () => NOW_MS,
    })
    const { url } = await bridge.start(0)
    cleanups.push(() => bridge.stop())

    const response = await fetch(`${url}/api/storage/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ days: 30, files: ['agy-20260910-100000-001.log'], confirmed: true }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: ARCHIVE_PATH_PROBLEM })
    expect(existsSync(logPath)).toBe(true)
    expect(readdirSync(outsideDir)).toEqual([])
  })

  it('refuses archive when realpath places the archive or month folder outside the real runs folder', async () => {
    const fixture = buildSyntheticFixture()
    const outsideDir = join(fixture.base, 'outside-real')
    mkdirSync(outsideDir, { recursive: true })
    mkdirSync(join(fixture.runs, 'archive', '2026-09'), { recursive: true })
    const logPath = join(fixture.runs, 'agy-20260910-100000-001.log')
    writeAgedFile(logPath, 'keep-outside-check', OLD_45_MS)

    await expect(
      applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        files: ['agy-20260910-100000-001.log'],
        now: () => NOW_MS,
        realpathFn: async (targetPath) => {
          if (targetPath.endsWith('2026-09')) return outsideDir
          return realpath(targetPath)
        },
      })
    ).rejects.toThrow(ARCHIVE_PATH_PROBLEM)
    expect(existsSync(logPath)).toBe(true)
    expect(readdirSync(outsideDir)).toEqual([])
  })

  it('refuses archive when a month folder is a junction or symbolic link before moving any file', async (ctx) => {
    const fixture = buildSyntheticFixture()
    const outsideMonth = join(fixture.base, 'outside-month')
    mkdirSync(outsideMonth, { recursive: true })
    mkdirSync(join(fixture.runs, 'archive'), { recursive: true })
    const monthLink = join(fixture.runs, 'archive', '2026-09')
    try {
      symlinkSync(outsideMonth, monthLink, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOTSUP') {
        ctx.skip()
        return
      }
      throw error
    }

    const old80Ms = NOW_MS - 80 * DAY_MS
    const augLog = join(fixture.runs, 'agy-20260820-100000-001.log')
    const sepLog = join(fixture.runs, 'agy-20260910-100000-001.log')
    writeAgedFile(augLog, 'august-log', old80Ms)
    writeAgedFile(sepLog, 'september-log', OLD_45_MS)

    await expect(
      applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        files: ['agy-20260820-100000-001.log', 'agy-20260910-100000-001.log'],
        now: () => NOW_MS,
      })
    ).rejects.toThrow(ARCHIVE_PATH_PROBLEM)

    expect(existsSync(augLog)).toBe(true)
    expect(existsSync(sepLog)).toBe(true)
    expect(readFileSync(augLog, 'utf8')).toBe('august-log')
    expect(readFileSync(sepLog, 'utf8')).toBe('september-log')
    expect(existsSync(join(fixture.runs, 'archive', '2026-08'))).toBe(false)
    expect(readdirSync(outsideMonth)).toEqual([])
  })

  it('never overwrites an existing destination file or symlink', async () => {
    const fixture = buildSyntheticFixture()
    const source = join(fixture.runs, 'agy-20260910-100000-001.log')
    const monthDir = join(fixture.runs, 'archive', '2026-09')
    mkdirSync(monthDir, { recursive: true })
    const destination = join(monthDir, 'agy-20260910-100000-001.log')
    writeAgedFile(source, 'new-log-content', OLD_45_MS)
    writeAgedFile(destination, 'existing-archive-content', OLD_45_MS)

    await expect(moveFileSafe(source, destination)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(destination, 'utf8')).toBe('existing-archive-content')
    expect(readFileSync(source, 'utf8')).toBe('new-log-content')

    await expect(
      moveFileSafe(source, destination, {
        linkFn: async () => {
          const error = new Error('cross device')
          error.code = 'EXDEV'
          throw error
        },
      })
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(destination, 'utf8')).toBe('existing-archive-content')
    expect(readFileSync(source, 'utf8')).toBe('new-log-content')

    const raceLog = join(fixture.runs, 'agy-20260911-100000-001.log')
    const raceDest = join(monthDir, 'agy-20260911-100000-001.log')
    writeAgedFile(raceLog, 'race-source-content', OLD_45_MS)
    const archived = await applyStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      files: ['agy-20260911-100000-001.log'],
      now: () => NOW_MS,
      beforeMove: async (item) => {
        if (item.name === 'agy-20260911-100000-001.log') {
          writeFileSync(raceDest, 'concurrent-existing')
        }
      },
    })
    expect(archived.count).toBe(0)
    expect(archived.moved).toEqual([])
    expect(archived.skipped).toEqual([
      { name: 'agy-20260911-100000-001.log', reason: DESTINATION_EXISTS_REASON },
    ])
    expect(readFileSync(raceDest, 'utf8')).toBe('concurrent-existing')
    expect(readFileSync(raceLog, 'utf8')).toBe('race-source-content')

    const symLog = join(fixture.runs, 'agy-20260912-100000-001.log')
    const symDest = join(monthDir, 'agy-20260912-100000-001.log')
    const outsideTarget = join(fixture.base, 'outside-file.txt')
    writeAgedFile(symLog, 'sym-source', OLD_45_MS)
    writeFileSync(outsideTarget, 'outside-keep')
    let madeFileSym = false
    try {
      symlinkSync(outsideTarget, symDest, 'file')
      madeFileSym = true
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES' && error?.code !== 'ENOTSUP') throw error
    }
    if (madeFileSym) {
      const symResult = await applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        files: ['agy-20260912-100000-001.log'],
        now: () => NOW_MS,
      })
      expect(symResult.count).toBe(0)
      expect(symResult.skipped).toEqual([
        { name: 'agy-20260912-100000-001.log', reason: NOT_ELIGIBLE_REASON },
      ])
      expect(lstatSync(symDest).isSymbolicLink()).toBe(true)
      expect(readFileSync(outsideTarget, 'utf8')).toBe('outside-keep')
      expect(readFileSync(symLog, 'utf8')).toBe('sym-source')
    }
  })

  it('refuses archive with no files and moves only files in both the request and a fresh preview', async () => {
    const fixture = buildSyntheticFixture()
    const firstLog = join(fixture.runs, 'agy-20260910-100000-001.log')
    const secondLog = join(fixture.runs, 'agy-20260915-100000-001.log')
    const thirdLog = join(fixture.runs, 'agy-20260920-100000-001.log')
    const firstBytes = writeAgedFile(firstLog, 'first-old', OLD_45_MS)
    writeAgedFile(secondLog, 'became-eligible-later', RECENT_5_MS)
    writeAgedFile(thirdLog, 'became-ineligible-later', OLD_45_MS)

    const preview = await previewStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      now: () => NOW_MS,
    })
    expect(preview.files.map((item) => item.name).sort()).toEqual([
      'agy-20260910-100000-001.log',
      'agy-20260920-100000-001.log',
    ])

    const oldDate = new Date(OLD_45_MS)
    const recentDate = new Date(RECENT_5_MS)
    utimesSync(secondLog, oldDate, oldDate)
    utimesSync(thirdLog, recentDate, recentDate)

    await expect(
      applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        now: () => NOW_MS,
      })
    ).rejects.toThrow()

    await expect(
      applyStorageArchive({
        runsFolder: fixture.runs,
        projectRoot: fixture.project,
        days: 30,
        files: [],
        now: () => NOW_MS,
      })
    ).rejects.toThrow()

    const archived = await applyStorageArchive({
      runsFolder: fixture.runs,
      projectRoot: fixture.project,
      days: 30,
      files: preview.files.map((item) => item.name),
      now: () => NOW_MS,
    })

    expect(archived.ok).toBe(true)
    expect(archived.count).toBe(1)
    expect(archived.totalBytes).toBe(firstBytes)
    expect(archived.moved.map((item) => item.name)).toEqual(['agy-20260910-100000-001.log'])
    expect(archived.skipped).toEqual([
      { name: 'agy-20260920-100000-001.log', reason: 'The file is no longer eligible.' },
    ])
    expect(existsSync(join(fixture.runs, 'archive', '2026-09', 'agy-20260910-100000-001.log'))).toBe(true)
    expect(existsSync(secondLog)).toBe(true)
    expect(existsSync(join(fixture.runs, 'archive', '2026-09', 'agy-20260915-100000-001.log'))).toBe(false)
    expect(existsSync(thirdLog)).toBe(true)
  })
})
