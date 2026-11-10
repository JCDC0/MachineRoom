# Hunt: how lanes are given work, 2026-11-10

This is a hunt. It changes no code. It reads the room's own records, the routing policy and the code that gives a lane its work.

The records are `%TEMP%\machineroom-runs\runs.jsonl` and `outcomes.jsonl`: 578 run records in all, 225 started on or after 2026-10-28, and 277 outcome records, 49 of them written on or after 2026-10-28. Times and minutes are as the run record holds them. Local days are UTC+8, the machine's clock. A measuring run ran while other lanes ran, so every time here is high; the numbers compare like with like inside the same window.

Two briefs are not measurable from the records: the run record holds brief ids, not brief titles, so "hunt or review against build" below is read from the branch slug (`audit`, `hunt` or `review` in the name), not from the brief's title. Every run since 2026-10-28 carried at most one brief, so per-kind rows are clean.

## Per lane and model

| Lane | Model | Runs | Median | p90 | Killed | Failed | startFailed | retried | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| opencode | deepseek-v4.1-flash | 48 | 13.3 | 33.6 | 0 | 0 | 0 | 0 | $4.29 |
| opencode2 | deepseek-v4.1-flash | 40 | 13.6 | 31.0 | 1 | 2 | 1 | 1 | $3.57 |
| opencode3 | deepseek-v4.1-flash | 31 | 11.5 | 32.7 | 1 | 1 | 0 | 0 | $2.65 |
| opencode4 | deepseek-v4.1-flash | 20 | 12.7 | 21.5 | 0 | 0 | 0 | 0 | $1.69 |
| opencode5 | deepseek-v4.1-flash | 15 | 17.5 | 35.7 | 0 | 1 | 0 | 0 | $1.75 |
| agy | gemini-3.8-flash-high | 25 | 21.6 | 37.3 | 1 | 0 | 0 | 0 | not reported |
| agy2 | gemini-3.8-flash-high | 18 | 25.1 | 44.8 | 1 | 0 | 0 | 0 | not reported |
| agy3 | gemini-4-argon-high | 9 | 13.8 | 22.3 | 0 | 0 | 0 | 0 | not reported |
| agy3 | gemini-3.8-flash-high | 7 | 27.6 | 94.8 | 1 | 1 | 0 | 0 | not reported |
| opencode6 | deepseek-v4.1-flash | 2 | 29.9 | 34.4 | 0 | 0 | 0 | 0 | $0.39 |
| opencode6, opencode7 | crouton-alpha-free | 3 | 2.6 | 4.7 | 0 | 0 | 0 | 0 | $0.00 |
| opencode7 to opencode10 | deepseek-v4.1-flash | 5 | 25.6 | 44.0 | 0 | 0 | 0 | 0 | $0.34 |
| orchestrator, by the room | opencode and claude-opus-5-5 | 2 | 0.1 and 1.6 | - | 0 | 0 | 0 | 0 | $0.86 |

Minutes are minutes. "Failed" is a non-zero exit that was not killed. Cost is what the harness reported; 61 runs report none, all AGY and 2 OpenCode.

## Per kind of brief

| First letter | Runs | Median | p90 | Killed | Failed |
| --- | --- | --- | --- | --- | --- |
| U | 101 | 12.7 | 30.9 | 1 | 3 |
| Q | 32 | 13.5 | 29.7 | 0 | 0 |
| S | 29 | 17.5 | 42.6 | 1 | 1 |
| T | 20 | 30.9 | 51.9 | 2 | 1 |
| O | 10 | 17.0 | 44.5 | 0 | 0 |
| D | 8 | 9.8 | 25.2 | 0 | 0 |
| V | 6 | 9.7 | 32.8 | 0 | 0 |
| H | 5 | 20.3 | 29.5 | 0 | 0 |
| P | 5 | 21.4 | 49.9 | 0 | 0 |
| L | 4 | 24.4 | 94.8 | 1 | 0 |
| A | 3 | 21.1 | 27.2 | 0 | 0 |

By branch slug: 31 hunt, audit or review runs at a median of 17.9 minutes (p90 36.4, 2 killed), 2 doc runs at 10.9, and 192 build runs at 15.5 (p90 33.6, 3 killed, 5 failed). A hunt costs about 2.4 more minutes at the median, and its slow tail is 2.8 minutes longer.

## The wait after a run

The time from a run's end to that lane's next start on the same local day.

| Lane | Pairs | Median | p90 | Max | Share of the active day |
| --- | --- | --- | --- | --- | --- |
| opencode | 35 | 64.2 | 730.3 | 1182.3 | 24% |
| opencode2 | 27 | 37.8 | 854.4 | 1172.6 | 24% |
| opencode3 | 22 | 33.3 | 845.3 | 1246.2 | 13% |
| opencode4 | 13 | 40.5 | 805.4 | 856.1 | 12% |
| opencode5 | 9 | 77.9 | 934.8 | 934.8 | 15% |
| agy | 17 | 78.5 | 754.5 | 1096.5 | 26% |
| agy2 | 11 | 70.4 | 759.4 | 1095.1 | 10% |
| agy3 | 9 | 87.6 | 1091.0 | 1091.0 | 11% |

"Share of the active day" is that lane's run minutes over the span from the day's first start to its last end, averaged over the days it ran. The tail is not a queue of work: a lane often waits for the next evening. The median wait of 33 to 88 minutes is the review and the next brief.

## The overlap

Minutes at each number of lanes working at the same moment, counting only time when at least one lane ran: 690 at 1, 351 at 2, 180 at 3, 140 at 4 and 274 at 5 or more. So 1635 minutes had a lane at work and 17% of them had 5 or more.

| Lanes working at the run's start | Runs | Killed | Failed | Over 45 min | Median | p90 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 55 | 0 | 0 | 2 | 14.3 | 30.9 |
| 2 | 48 | 1 | 2 | 1 | 13.6 | 32.7 |
| 3 | 34 | 2 | 3 | 2 | 14.4 | 32.0 |
| 4 | 24 | 1 | 0 | 0 | 17.9 | 32.4 |
| 5 or more | 64 | 1 | 0 | 4 | 18.2 | 42.6 |

Kills and failures do not rise with overlap. Time does: the median is 27% longer and the p90 38% longer at 5 or more lanes than at 1. No lane ever had two of its own runs overlap.

## The time limit

The runner stops every run at `--minutes`, 100 by default (`src/briefs/run.js:56`). A brief's own "stop starting new work at minute N" is only a sentence in its prompt: the runner never reads it and never stops at N.

Of 225 prompts, 53 state a limit: 20 at 45, 12 at 40, 10 at 50, 4 at 35, 3 at 25, 3 at 70 and 1 at 30. One run went over its stated limit, U157 at 56.8 minutes against 45. No run reached 100 minutes; the longest was 95 (L7, killed). 172 prompts state no limit at all, so most briefs leave the stop time to nothing but the 100 minute cap.

## The outcome table

`npm run run-lane -- --outcomes --since 2026-10-28` prints what the brief said: opencode 48 runs, 13 merged, 35 pending. Across all lanes it prints 175 pending and 39 merged.

The branches were merged. Of the 175 pending runs, 166 name a brief whose `Merge ID` line is in `refs/heads/main`'s history; 7 do not (O25, L7, T30, Q32, Q33, Q34 and T35), and 2 carry no brief id. So the outcome table is not wrong about the work. It has no row to read for it.

The cause is the record, not the join:

- The outcome file has rows for 2026-10-20 to 2026-10-26 and then for 2026-11-04 to 2026-11-09. Nothing was written for the merges of 2026-10-27 to 2026-11-03.
- The only writer is `npm run outcome`, a hand step in the merge loop (`scripts/outcome.mjs:73-76`, `docs/agents/ORCHESTRATOR.md:39`). No bridge route, runner or review writes one.
- The table cannot tell "not recorded" from "not merged". A run whose branch has no row counts as pending (`server/outcomes.js:66-70`).

The join itself is sound for the rows that exist. `server/outcomes.js:49` keeps the newest run per branch and `:66` looks the branch up in `newestOutcomes` (`:3-13`), which keeps the newest merged or rejected row per branch.

Three branches had two runs in the window. For an older run on a branch that has a decision, the table adds its cost to `decidedCost` (`server/outcomes.js:71`) but does not count a merge for it (`:72`), so cost per merge is high by that run's cost. This is small today and grows with reruns.

Two branches, s42 and s43, were recorded rejected at grade F on 2026-11-04 and then merged at grade A later the same day. The newest row wins, so the rejection is lost.

## Grades and fixes at merge

Only the runs with an outcome row can be graded.

| Lane | Model | Decided | Rejected | Grades | Fixes, total | Cost a merge |
| --- | --- | --- | --- | --- | --- | --- |
| opencode | deepseek-v4.1-flash | 13 | 0 | A, A-, A, B, A-, B+, A-, A, A-, A-, A-, A, A- | 7 | $0.09 |
| opencode2 | deepseek-v4.1-flash | 9 | 0 | A, A, A-, A-, A, A, A-, A, A | 1 | $0.11 |
| opencode4 | deepseek-v4.1-flash | 6 | 0 | A, A, A-, A-, B+, A- | 2 | $0.08 |
| opencode3 | deepseek-v4.1-flash | 6 | 0 | A-, B+, A-, A, A, B+ | 3 | $0.06 |
| opencode5 | deepseek-v4.1-flash | 4 | 0 | B+, A, A, A- | 0 | $0.09 |
| agy | gemini-3.8-flash-high | 4 | 0 | A-, A, B+, A- | 1 | not reported |
| agy2 | gemini-3.8-flash-high | 2 | 0 | B+, B+ | 4 | not reported |
| agy3 | gemini-4-argon-high | 3 | 0 | A, B, B | 0 | not reported |
| opencode6, opencode7 | crouton-alpha-free | 3 | 0 | A, A, A | 2 | $0.00 |

## AGY on Flash, AGY on Argon, OpenCode on DeepSeek

| Group | Runs | Median | p90 | Killed | Failed | Decided | Merged | Fixes | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenCode, deepseek-v4.1-flash | 162 | 13.3 | 32.7 | 2 | 4 | 38 | 38 | 13 | $14.69 |
| AGY, gemini-3.8-flash-high | 50 | 24.8 | 42.6 | 3 | 1 | 6 | 6 | 5 | not reported |
| AGY, gemini-4-argon-high | 9 | 13.8 | 22.3 | 0 | 0 | 3 | 3 | 0 | not reported |

The OpenCode rows are the only ones with enough decided runs to compare, and they are nearly all merged. AGY's grades are not comparable yet: only 9 of 59 runs have an outcome row, its cost is never reported, and its model name in `policy.json` does not match the name in the run record (finding 2), so no table in the room can place it.

## Tokens

221 of 225 run records carry tokens. The figure is a sum over the whole run, not the size of one context: a 25.2 minute run on 2026-10-28 reports 62,205,436 input tokens and 111,276 output, and the largest run total is 62,205,436. The median run is 429,441 tokens a minute and the p90 is 1,163,286. 209 runs are over 400,000 in total.

That makes "runs that came near 500,000" unreadable from the record. The 500,000 rule is about one request's context, and `src/harnesses/opencode.js:69` sums `tokens.input`, `cache.read` and `cache.write` over every step (`sumTokens`, `src/harnesses/common.js:41-44`). No field holds the peak context of a run, so the room cannot show which run came close to the compact rule.

## The room's own routing

- `chooseRoute` is pure and tested (`src/policy/route.js:162-173`). It reads `policy.json`'s tier for a brief profile (`tierFor`, `:104-117`), escalates by failures (`:119-123`), refuses a tier whose provider is over its quota (`:125-138`) and refuses everything over a spend limit (`:140-149`). `profileFromBrief` (`src/policy/profile.js:52`) and the tier mapping are tested too (`tests/plan.test.js:271`, `tests/policy-profile.test.js`).
- Today `policy.json` sends small briefs to opencode2 on deepseek-v4.1-flash at max, then agy on Gemini 3.8 Flash; medium to opencode, then agy; large to agy on Gemini 4 Argon and then the owner. The quota skip is 90%, the run limit $0.25 and the company month $30.
- `npm run policy-propose -- --since 2026-10-28` prints "No change to propose" for all three tiers. With `--min 4` it still prints no change, because every AGY choice joins 0 decided runs (finding 2).
- Nothing in the app calls the policy. `client.route` is defined at `src/control/client.js:170` and has no caller under `src/`. The bridge route at `server/policy.js:49-93` answers it; the mock imports `chooseRoute` itself (`src/control/mock.js:8`). The route is a seam with no consumer.
- Dispatch does not use it either. `planLaneTasks` (`src/ui/panels/runs.js:229-250`) takes the idle lanes in the order `projectRunLanes` returned (`:189-211`, the agent list's order) and maps tasks onto them. It refuses when there are fewer idle lanes than tasks (`:235-241`) instead of queueing. The panel calls it at `src/ui/panels/DispatchPanel.jsx:363` and starts the runs at `:379`.
- `POST /api/control/runs` requires a lane in the body (`server/runs.js:559-565`) and never picks one. It checks the lane is known, not retired, not the orchestrator, not hidden and active (`server/runs.js:566-604`), and refuses a second run on a busy lane. `server/active-lanes.js` decides which lanes are eligible, active and shown (`:128-180`, `:186-217`), and picks none.

What it would take for Dispatch and the orchestrator's run start to pick a lane from the policy and the outcomes:

1. A row that runs can be compared on. Write the outcome at merge every time, or read "merged" from git when the row is missing, and key policy choices to the run record's model name (`lane.cli.model`).
2. One routing call both callers share: given a brief id or a profile plus the failure count, answer the policy's lane, then skip a lane that is retired, hidden, not active or busy, and fall to the next choice in the tier. The pieces exist: `chooseRoute`, `activeEligibleLaneKeys`, `isRunning`, `outcomeTable`.
3. Dispatch sends no lane and shows the answer before it starts; the bridge accepts a run with no lane and routes it, with the same check the panel shows.

## Findings

1. A run merged without an outcome record shows as pending, and 166 of 175 pending runs were merged. The table treats "no row" as "not merged" (`server/outcomes.js:66-70`); the only writer is a hand step (`scripts/outcome.mjs:73-76`). The records stop for 2026-10-27 to 2026-11-03. This is the whole "35 pending of 48" for opencode.
2. `policy-propose` can never move an AGY choice. It looks rows up by the model text in `policy.json` (`src/policy/proposals.js:110-111`), "Gemini 3.8 Flash (High)" (`docs/agents/policy.json:12`, `:26`), while run records hold the CLI model, `gemini-3.8-flash-high` (`scripts/run-lane.mjs:1305`). 0 of 9 AGY decisions join, so every tier stops at "0 decided runs, fewer than N".
3. A harness that reports no cost looks free. `server/outcomes.js:63-64` adds 0 for a null cost and `:71` adds it to the decided cost, so `costPerMerge` is $0.00; `src/policy/proposals.js:52-54` only knows null as Infinity, and never receives one. All 59 AGY runs report null.
4. The routing policy decides nothing. `chooseRoute` has one caller, the route at `server/policy.js:49-93`; no page code calls `client.route` (`src/control/client.js:170`).
5. Dispatch gives work by roster order. `idleProjectLanes` keeps the agent list's order and `planLaneTasks` maps tasks onto it (`src/ui/panels/runs.js:213-247`); no policy, no outcome, no cost, no model choice.
6. The bridge cannot pick a lane. `POST /api/control/runs` requires `body.lane` and refuses anything else (`server/runs.js:559-565`), so the orchestrator must choose before it calls, and the room cannot answer "which lane".
7. A second run on a branch inflates cost per merge. The older run's cost enters `decidedCost` but not the merge count (`server/outcomes.js:71-72`). Three branches had two runs.
8. A brief's stop time is not enforced. The runner stops at `--minutes`, 100 by default (`src/briefs/run.js:56`); the brief's "at minute N" stays in the prompt. 172 of 225 prompts state no limit, and among the 53 that do, 1 run went over it.
9. The token field is a run total, not a context size (`src/harnesses/opencode.js:69`, `src/harnesses/common.js:41-44`). 209 runs are over 400,000 by that total, and the 500,000 context rule cannot be read from any record.
10. No two briefs were joined in one run. 223 of 225 runs carried one brief and 2 carried none, though the loop allows two with disjoint files (`docs/agents/ORCHESTRATOR.md:35`).
11. Overlap costs time rather than success: the median run is 14.3 minutes at 1 lane and 18.2 at 5 or more, the p90 30.9 and 42.6, while kills and failures stay flat (table above).
12. A lane waits longer than it works. The median wait is 33 to 88 minutes and the p90 730 to 1246; the busiest lane (agy) ran 26% of its active day. The review and merge is the queue, not the harness.

## Recommendations for the orchestrator's method

- Run 5 or 6 lanes at once, not 10 to 12. Past 5 the p90 rises 38% and the median 27%, and the room's record shows no gain in merges or grades.
- Join two small, disjoint briefs into one run when they share no file. It was never done in the window, and it removes a wait and a review.
- Keep a measuring or hunt brief alone. Every number in this hunt is high because other lanes ran; a time measured under load is not a time.
- Run hunts on OpenCode at a median of 18 minutes and reviews on the lane that wrote the code. A T brief (test hunt) is the slowest kind at 30.9 minutes and the one most often killed, so give it a lane of its own.
- Give AGY no new briefs, as since 2026-11-09. Its cost is unreported and its model name does not join, so its grades cannot be compared.
- Record the outcome at every merge, before the next brief starts: `npm run outcome -- BRANCH merged --grade G --fixes N`. The 166 missing rows are a recording loss, not a merge loss.
- Put a stop time in every brief's opening paragraph, and pass the same number as `--minutes`.

## Recommendations for the room

- Make the outcome table read merges it has no row for, from `refs/heads/main`'s subjects, and keep the row for the grade. Mark such a row "merged, not graded" so a missing record is visible.
- Match a policy choice to a run row by lane and by both model names, and keep a null cost null through `outcomeTable` and `proposePolicy`.
- Give routing one answer both callers use: policy tier, then the next choice whose lane is eligible, active and idle, with the reason. Show it in Dispatch before the start; let the run start accept no lane and use it.
- Record the peak context per run beside the token totals, so the 500,000 rule can be seen.

## Proposed briefs

**P29. Read a merge the outcome table has no row for (OpenCode).** In `outcomeTable`, a run whose branch has no outcome row but whose brief id names a `Merge ID` subject in `refs/heads/main` counts as merged with no grade, and the row says so; the printed table keeps `pending` only for a run with no merge and no row. Read the merge subjects once per call through `gitPath()` with `--no-ext-diff` and a time limit. Tests: a fixture log with a merge subject and no row; a run with neither; a rejected row that wins over a merge subject. Files: `server/outcomes.js`, `server/runs.js`, `tests/`.

**P30. Route a brief to a lane from the policy and the outcomes (OpenCode).** One pure function answers a lane for a brief profile: the tier from `tierFor`, then each choice in order, skipping a provider over quota, a lane that is retired, hidden, not active or busy, and a model with no decided runs, and giving the reason. Add `POST /api/control/route/lane` beside the existing route and let `POST /api/control/runs` accept no lane and call it. Dispatch shows the answer before the start. Tests cover the skip order, the empty answer and the run start with no lane. Files: `src/policy/route.js`, `server/policy.js`, `server/runs.js`, `src/control/client.js`, `src/ui/panels/runs.js`, `src/ui/panels/DispatchPanel.jsx`, `tests/`, `docs/agents/ARCHITECTURE.md`, `docs/agents/CHANGELOG.md`.

**P31. Make the policy joins honest (OpenCode).** Key a policy choice to a run row by lane and by both the display model and the CLI model, and keep a null cost null through `outcomeTable` and `proposePolicy`, so a harness that reports no cost is "no cost a merge", not $0.00. Show the join in `npm run policy-propose`'s notes. Tests: AGY display name against a CLI model row; null cost; a cost that loses to a real one. Files: `server/outcomes.js`, `src/policy/proposals.js`, `scripts/policy-propose.mjs`, `tests/`.

**P32. Record a run's peak context (OpenCode).** In the OpenCode and Claude parsers, keep the largest single request's input and cache tokens beside the run totals, and write it in the run record as `peakTokens`. Show it in the run line and in the lane's costs row, with the 500,000 rule beside it. Tests: a log with two steps of different sizes; a log with no usage; a record that keeps the older shape. Files: `src/harnesses/opencode.js`, `src/harnesses/claude.js`, `src/briefs/run.js`, `server/lane-costs.js`, `src/ui/panels/runs.js`, `tests/`, `docs/agents/ARCHITECTURE.md`, `docs/agents/CHANGELOG.md`.

## What this hunt could not see

- The brief titles, so hunt and build are told apart by the branch slug.
- The `--minutes` passed to each run: the record holds minutes run, not the limit given.
- Any context size per request, so the 500,000 rule is out of reach.
- The merges' own times: the room records no merge time, so the wait is measured from run end to the next start.
- Why the outcome records stop on 2026-10-27: the record shows the gap, not the reason.
