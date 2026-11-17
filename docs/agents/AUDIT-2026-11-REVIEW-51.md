# Review 51: P497 to P500 and the badge seam fix

Reviewed `76112d8e..9289153b` and the P500 merge at `fd6b5dec`.

## R51-1 | Medium | scripts/run-lane.mjs:1130

Lanes made in the room still use the hash fallback. It shares the listed lanes' offset range, so two lanes in one project can receive the same ports. The runner loads these lanes from `agents.json` at line 1793, but the offset function reads only `lanes.json`.

How to see it: pass the sorted keys of `docs/agents/lanes.json` to `portOffsetFor`. Both listed `opencode` and generated `opencode-11` receive 100. A server started by each lane on the same base port will collide.

Fix: keep one saved offset assignment for every lane, including room-made lanes, and allocate only unused offsets.

## R51-2 | Medium | scripts/run-lane.mjs:1127

The sorted index changes when the lane file changes. A running child keeps its old environment, while a new child computes its offset from the new list. A new lane can take a running lane's offset.

How to see it: start `beta` with keys `beta,gamma`, giving it 0. Add `alpha` to the file and start it while beta runs. Alpha also receives 0. Removing an earlier key can cause the same clash. The claim in `docs/agents/architecture/LIVE.md:19` that offsets are hashes and other lanes never move is also false for listed lanes.

Fix: retain saved assignments when keys are added or removed, keep active assignments reserved, and update the live-mode sentence.

## R51-3 | Medium | tests/hud-badge-layout.test.js:12

The layout test does not protect the badge seam fix. It checks the badge's absolute position but never checks its seam transform or the selector in `src/Stage.jsx:68`. The existing seam tests return fake controls without applying the selector, so they do not cover this either (`tests/stage-seam.test.js:104`).

How to see it: remove the badge selector from the seam transform group at `src/styles.css:9482`. Both layout tests still pass. Replaying their assertions against that CSS change in memory confirmed this. Removing the Stage selector is invisible to this test too, since it reads only CSS and Hud.

Fix: add a badge to a seam test whose DOM applies the real selector. Assert that it gets a pose, and check that the badge selector is in the CSS transform group.

## Checked and fine

- Copy checks use the target worktree. A failed exclude write removes its new copy. Two sequential new lanes add one exclude line.
- Rewind refusals and errors release the lane lock and repository write lock. A repeated recovery ref returns 409. Other lock failures return 500.
- The touched-list code marks a cut list partial after the fiftieth distinct safe path.
- Harness confirm openers use a plain dialog id. An active matching opener wins the lookup, and a bad lookup falls back to the active element.
- Reviews is a separate named button. Pin is a named native button, revealed on keyboard focus. Its first menu item is Pin and its handler uses that row.
- The current row follows the existing menu rules. Sort loads and saves the same storage key. Pinned and Recent labels depend on the displayed groups.
- The setup help line now sits by its setup field. The transport title keeps its full minimum width.

Checked and fine
