# What the deleted-file list costs, measured alone

Measured on 2026-11-12 on a quiet Windows machine, no other lane running. Node v24.22.1, git 2.56.1.windows.1, AMD Ryzen 7 5700X, 16 logical processors.

Since the P51 merge (6f5d6f5b on main), every tree read runs `git ls-files --deleted` beside the file list, and 30 seconds after the last partial read the bridge runs one full read. This audit measures that cost against the commit before the merge (6dbb1e58) on the same checkout.

## Method

The tree path alone, with the git, review and worktree rows skipped:

`node scripts/scale-live.mjs --files N --folders M --seed 36 --tree-only --quiet-ms 120000 --keep`

For the commit before P51 the current probe loads that worktree's server:

`node scripts/scale-live.mjs --files N --folders M --seed 36 --tree-only --quiet-ms 120000 --keep --server <worktree of 6dbb1e58>`

The checkouts were built once and reused by every run, so the file tree is the same for both sides. The 40,000 file row uses 4,000 folders and the 200,000 file row uses 20,000 folders, ten files per folder.

- A full read is one `GET /api/tree`: the read's wall time and the bridge process CPU for it.
- CPU is the bridge process's own CPU from `process.cpuUsage`. The `git` commands run in child processes, so their CPU is not in that number. The time column carries the child work, which is where the deleted list runs.
- One new file is the write of `new-file.js` to its tree event on the folder stream.
- A burst is 2,000 new files in `out/` over 10 seconds. Reads are the full and partial lists the bridge ran during it, and CPU is the bridge process CPU over the burst plus a 3 second tail.
- Quiet is the bridge process CPU over 120 seconds after the new file event.

## Results

Median of three runs. Reads are full and partial tree lists.

| Files | Code | Full read ms | Full read CPU ms | New file ms | Burst reads | Burst CPU ms | Quiet reads | Quiet CPU ms |
| ----- | ---- | ------------ | ---------------- | ----------- | ----------- | ------------ | ----------- | ------------ |
| 40,000 | main | 2645 | 47 | 158 | 4 / 1 | 203 | 2 / 0 | 204 |
| 40,000 | before P51 | 470 | 47 | 88 | 4 / 1 | 171 | 2 / 0 | 141 |

The three runs behind the medians:

| Files | Code | Full read ms | Full read CPU ms | New file ms | Burst CPU ms | Quiet CPU ms |
| ----- | ---- | ------------ | ---------------- | ----------- | ------------ | ------------ |
| 40,000 | main | 2658, 2628, 2645 | 109, 46, 47 | 158, 155, 161 | 124, 281, 203 | 204, 234, 141 |
| 40,000 | before P51 | 470, 436, 480 | 16, 47, 62 | 91, 83, 88 | 156, 218, 171 | 219, 141, 126 |

Both sides ran 4 full reads and 1 partial read in every burst, and 2 full reads and no partial read in every quiet window.

## What grew

At 40,000 files a full read goes from 470 ms to 2645 ms, 2175 ms more and 5.6 times as long. The deleted list alone explains it: on the same checkout `git ls-files --cached --others --exclude-standard` took 471 ms and `git ls-files --deleted` took 2742 ms. The check runs longer than the list it accompanies.

One new file goes from 88 ms to 158 ms to the page, 70 ms more. A burst's bridge CPU goes from 171 ms to 203 ms, 32 ms more. The quiet window's bridge CPU goes from 141 ms to 204 ms, 63 ms more. The bridge's own CPU stays close to flat because the extra work is in the git child.

## Ways to cut it

A full read costs more than 10 percent more than before P51, so here are two ways to cut it.

1. Ask `git diff --name-only -z --diff-filter=D` for the deleted names instead of `git ls-files --deleted`. On the 40,000 file checkout that took 126 ms against 2742 ms, because it uses the index stat cache. It still names every tracked file missing from the worktree, which is the case P51 fixes.
2. Run the deleted check only on the quiet full read, or on a read that follows a watcher delete or rename, and keep the last deleted set on other reads. A missed delete is still corrected within 30 seconds by the quiet read. This keeps P51's guarantee and takes the check off the common partial path.
