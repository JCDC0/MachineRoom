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
| 200,000 | main | 14339 | 250 | 239 | 2 / 1 | 516 | 2 / 0 | 703 |
| 200,000 | before P51 | 2749 | 219 | 183 | 3 / 1 | 703 | 2 / 0 | 532 |

The three runs behind the medians:

| Files | Code | Full read ms | Full read CPU ms | New file ms | Burst CPU ms | Quiet CPU ms |
| ----- | ---- | ------------ | ---------------- | ----------- | ------------ | ------------ |
| 40,000 | main | 2658, 2628, 2645 | 109, 46, 47 | 158, 155, 161 | 124, 281, 203 | 204, 234, 141 |
| 40,000 | before P51 | 470, 436, 480 | 16, 47, 62 | 91, 83, 88 | 156, 218, 171 | 219, 141, 126 |
| 200,000 | main | 13860, 14339, 16179 | 266, 249, 250 | 234, 239, 881 | 438, 531, 516 | 703, 828, 641 |
| 200,000 | before P51 | 2660, 2818, 2749 | 219, 251, 141 | 181, 183, 187 | 718, 548, 703 | 532, 374, 579 |

The 40,000 bursts ran 4 full and 1 partial list on both sides. The 200,000 bursts ran 2 full and 1 partial on main and 3 full and 1 partial before P51. Every quiet window ran 2 full lists and no partial list, except one main run at 200,000 which ran 1.

## What grew

At 40,000 files a full read goes from 470 ms to 2645 ms, 2175 ms more and 5.6 times as long. At 200,000 files it goes from 2749 ms to 14339 ms, 11590 ms more and 5.2 times as long. The deleted list alone explains it. On the same checkouts:

| Files | File list ms | `--deleted` ms | `git diff --diff-filter=D` ms |
| ----- | ------------ | -------------- | ----------------------------- |
| 40,000 | 471 | 2742 | 126 |
| 200,000 | 2496 | 16887 | 489 |

The added check runs 5.8 times the list at 40,000 and 6.8 times the list at 200,000. Its cost grows with the file count, a little faster than linearly.

One new file goes from 88 ms to 158 ms to the page at 40,000, 70 ms more. At 200,000 it goes from 183 ms to 239 ms, 56 ms more. The new file event is a partial read, so its deleted check only looks at that path and stays cheap.

The bridge's own CPU stays close to flat for the full read: 47 ms on both sides at 40,000, and 219 to 250 ms at 200,000. Over two quiet minutes it rises from 141 ms to 204 ms at 40,000 and from 532 ms to 703 ms at 200,000, but the window runs the same two full reads on both sides. The wall cost of those reads is in the git child, not the bridge process, so this CPU number understates it. A burst's CPU is close to flat and moves with how many full lists the burst ran, which varies between runs.

The doctor's project read hit its 10 second limit in all six 200,000 file runs, on both sides, so that limit does not come from P51.

## Ways to cut it

A full read costs more than 10 percent more than before P51, so here are two ways to cut it.

1. Ask `git diff --name-only -z --diff-filter=D` for the deleted names instead of `git ls-files --deleted`. It took 126 ms against 2742 ms at 40,000 files and 489 ms against 16887 ms at 200,000, because it uses the index stat cache. It still names every tracked file missing from the worktree, which is the case P51 fixes.
2. Run the deleted check only on the quiet full read, or on a read that follows a watcher delete or rename, and keep the last deleted set on other reads. A missed delete is still corrected within 30 seconds by the quiet read. This keeps P51's guarantee and takes the check off the common partial path.
