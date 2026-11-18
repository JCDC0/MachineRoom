# Review 61: the control route caches and the build split (P602, P603)

Read from the code and the merge diffs against their first parents (`a0ef0905`, `dcf9456b`). No finding was run against a live bridge; each failure scenario comes from reading the code. The sandbox baseline failures were left alone.

## Grades

- P602: B. The record cache, the recovery index (same result as `succeededLater`: same trimming, same plan and edit split, same strict time test) and the per-lane views are correct for the append-only way `runs.jsonl` is written. The weak points are the caches that live for the whole bridge and never look at the disk again.
- P603: A-. The split is small and tested. One stray changelog line.

## Findings

### R61-1 (medium): `thisRepoCache` is set once and never refreshed

`server/runs.js` `isThisRepo` (about line 1943). `inThisRepository()` compares the project's git common dir with MachineRoom's. The answer is now kept for the life of the bridge. Before P602 it was asked on every call (though `rootCommonDirPromise` was already cached forever, so the answer was only fresh when git was slow to answer).
Scenario: the bridge starts on a plain folder; the owner runs `git init` there, or moves the project folder. `thisRepoCache` stays false, so records with an empty `project` stay hidden, and the Issues list and Runs list stay wrong until restart. In the other direction, a folder that stops being a checkout keeps showing the room's own records.
Fix: keep the cache but drop it (and `cachedRoomThisRepo`) when `stopAll` runs or when `rootCommonDir` is re-read; or key it on a `stat` of `<root>/.git` with a 5 second floor.

### R61-2 (medium): path resolutions are cached forever

`server/runs.js` `resolveCached`, `rootMatchCache`, `worktreeMatchCache`, `worktreeResolvedCache`.
Scenario: a record's `project` points at a worktree that was deleted and later recreated at the same path as a junction or symlink to another folder, or a project folder is renamed so the same string now resolves elsewhere. `realPath` of a missing folder falls back to the raw text and that fallback is cached too, so the folder is never matched once it exists, and a deleted folder keeps matching. Records then land in, or drop out of, the wrong room until restart.
Fix: do not cache a resolution that fell back (folder missing), and clear the four maps when the bridge sees the lanes file or the worktree list change; or give each entry a 30 second expiry.

### R61-3 (low): the maps behind R61-2 grow without bound

`resolvedPathCache` is keyed by every distinct `project` string in `runs.jsonl`, `worktreeMatchCache` by project times lane. Test projects and temporary folders add keys all the time and nothing evicts them (`runsViewFor` has a 64 lane cap, these do not). Growth is slow, a few hundred bytes per key, so this only matters over weeks.
Fix: cap each map (clear at 1024 keys, as `runsViewFor` does at 64).

### R61-4 (low): the head sample misses an in-place edit past byte 512

`cachedRunRecords`. The re-read triggers are: size smaller, same size with a new mtime, a new `ino`, a changed first 512 bytes. A file that is edited in place later than its first 512 bytes and grows (or is rewritten with the same inode and the same first record) is read from the old offset, so the edited record keeps its old value and the new tail is parsed from the middle of a line.
Today `runs.jsonl` is only appended (`appendFileSync` at `runs.js` about line 1306, `scripts/outcome.mjs`), so this needs a hand edit or a repair tool. A copy-over restore of a backup is the realistic case.
Fix: also sample the 512 bytes that end at the old offset and compare them; it costs one extra small read.

### R61-5 (low): a cached failover is never refreshed

`noteFailovers`. The mark is `lane, startedAt, kind, to`. When the same run is later rewritten with `failover.refused` flipped, or a new record for the same lane and start time carries a different outcome, `notedFailovers.has(mark)` is true and no note is sent. The first-call `quiet` flag also means failovers already in the file at bridge start are never announced, as before. Not a regression. Add `refused` to the mark if the second note matters.

### R61-6 (low): `isAppendOnlyExtension` checks two records, not the prefix

`server/runs.js` about line 565. It compares the first and last old element by identity. That is sound while the list comes from `cachedRunRecords`, because a reset builds new objects. A caller that passes a different array that shares its first and last record would be treated as a pure append. Today only `cachedRunRecords` output reaches `roomRecords` and `noteFailovers`. Add a comment-free guard by also checking the middle element, or document the contract in `LIMITS.md`.

### R61-7 (low): the same-size brief edit can hide behind the stamp

`readCachedBriefs` keys on `mtimeMs:size`. On NTFS the time has 100 ns steps, so two edits of equal size in one tick are not a real case. On a FAT or network folder with 2 second times, an edit that keeps the byte count (a status word swap, `open` to `done` is not equal, `P12` to `P13` is) can be missed until the next change. The brief names this case; it is accepted risk on NTFS.
Fix: add the first 64 bytes of a SHA of the file to the stamp only when `mtimeMs` has no sub-second part.

### R61-8 (low): `readCachedBriefs` returns a frozen shared array to every caller

Not a bug today (`laneTaskIssues`, `withArchivedBriefs` only read). A caller that `sort()`s or `push()`es the result now throws in strict code. The two exported readers, `readLaneBriefs` and `readArchivedBriefs`, have no test that asserts the frozen result.

### R61-9 (info): stray changelog line

`docs/agents/CHANGELOG.md` gained `- Hydrogen XHigh.` in the P602 merge. It says nothing about the change. The P602 line itself is in `LIMITS.md` only. Replace it with a real changelog line.

### R61-10 (info): the build test no longer asserts zero warnings

`tests/build-chunks.test.js` collects `warnings` and never checks it, so P603's goal (no chunk size warning) is covered only by `chunkSizeWarningLimit: 970` being set. The limit hides the warning rather than removing it: the `three` chunk must stay under 970 kB, and nothing fails when it grows past that. Assert the real chunk sizes in the test (for example `three` under 970 kB) in place of the dropped assertion.

## Checked and found sound

- Masking: every cached view holds raw records and `maskRecordCommits` runs on the returned slices each call, so no masked or unmasked copy is shared.
- Cross-project leaks: `roomRecords` filters before `runsViewFor`, and the view cache is cleared whenever the room list identity changes, so a lane view never holds records from another project.
- Truncation and rotation: a smaller size, a new inode or a changed head all reset the cache, and the reset makes new record objects, so downstream identity caches (`cachedRoomSource`, `recoveryIndexCache`, `briefLookupCache`) miss as they should.
- Recovery index: `buildRecoveryIndex` gives the same answer as `succeededLater` for briefs and tasks, plan and edit failures.
- Archive combining cache: bounded at 16 keys per list, keyed by the archive array identity, so an edited archive rebuilds.
