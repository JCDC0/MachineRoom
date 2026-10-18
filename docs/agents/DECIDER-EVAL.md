# Decision model comparison (task D1)

The design and the list of candidate models are in `CONTROL-PLANE.md` under "The decision model". This file says how to run the comparison and how to read it.

## What is here

| Path | What it is |
| --- | --- |
| `src/decider/wire.js` | The Decisions API shape: question builders (`choice`, `noul`, `score`), `buildRequest`, `parseAnswers` |
| `src/decider/decide.js` | `decide()`: one call with an injected `fetch`, a time limit, retries, plain error kinds, and the key scrubbed from every message |
| `src/decider/questions.js` | The fixed question wording for the assistant (action, agent, path, tab, section) and for routing (tier, coordination, uncertainty, consequence, splits, effort, shape) |
| `src/decider/stats.js` | Accuracy, coverage at 5 percent accepted-case error, calibration error, repeat flips, median |
| `src/decider/baseline.js` | The two baselines: our plain rules, and a small language model asked the same questions |
| `src/decider/eval.js` | `runEval`, `planEval`, `formatReport` |
| `scripts/decide-eval.mjs` | The command line |
| `tests/probes/` | The probe sets: 98 assistant phrases (57 plain, 41 indirect) and 40 coding tasks |
| `tests/fakeDecisions.js` | A fake Decisions server used by the tests |

Nothing here is used by the app yet. D2 to D5 build on it.

## Running it

The key stays in your own shell. Claude never needs it and the script never prints or writes it. It is sent only over https, or to a server on this machine.

PowerShell:

```
$env:OPENROUTER_API_KEY = "paste it here, in your own terminal"
npm run decide-eval -- --smoke
npm run decide-eval
npm run decide-eval -- --run --json decide-report.json
Remove-Item Env:OPENROUTER_API_KEY
```

1. `--smoke` makes one call to the first model and says whether the key and the endpoint work. The Decisions API is an alpha endpoint, and one source says it is limited to selected customers, so do this first. A `not_found` or `unauthorized` answer tells you which.
2. With no flag it prints the plan and the estimated cost, and makes no call. The full default run is about 1,900 calls and about $0.05.
3. `--run` runs it. Useful options: `--models typesafe/jev-1.14,perplexity/pplx-decider-v1.2`, `--set assistant`, `--limit 20` (a spread of 20 probes per set, for a cheap trial), `--repeat 1`, `--llm <model id>` for the language model baseline (find ids at `https://openrouter.ai/api/v1/models`, no key needed).

The default model list is the seven in `src/decider/eval.js`. The live list of decision models is at `https://openrouter.ai/api/v1/models?output_modalities=decisions`.

## Reading the report

Each set has two tables. The first has one row per candidate:

- **right**: share of probes where the main question (`action` for the assistant, `tier` for routing) is right. A call that failed counts as wrong.
- **All right**: share of probes where every question that applies is right. This is what the assistant needs, because one wrong field makes the action invalid.
- **Coverage at 5% error**: the share of answers you could accept automatically, taking the most confident first, while at most 5 percent of the accepted ones are wrong. This is the number that matters most. It says how often the model can decide alone.
- **Calibration error**: how far its confidence is from how often it is right. Lower is better. Zero means 80 percent confident answers are right 80 percent of the time.
- **Answered**, **Median ms**, **Cost per 1k calls**.
- **Repeat flips**: share of answers that change when the same question is asked again. Hosted Jev changes about 1 in 100.

The second table is accuracy per question. The baselines are in the same tables: `plain rules` (our `interpret`, assistant only) and `majority answer` (always the most common label). On the shipped probes the plain rules get all of the plain group right and 39 percent of the indirect group, and the majority answer gets 20 percent of the assistant `action` and 53 percent of the routing `tier`. A decision model that does not clearly beat these is not worth a call.

## How to choose

Take the model that passes all of these, and among those the one with the highest coverage at 5 percent error:

1. Answered at least 98 percent of calls.
2. Assistant: `action` right at least 90 percent, and the indirect group clearly above the rules (39 percent).
3. Routing: `tier` right at least 70 percent, and each yes or no question above the majority answer.
4. Repeat flips under 3 percent, calibration error under 0.15.

Keep the runner-up as the fallback. If all of them fail, keep the rules and the text model fallback (A4) and use no decision model. The audit in `CONTROL-PLANE.md` says that is a real possibility.

## Read this before trusting the routing numbers

The routing labels (`tests/probes/routing.js`) are a first draft by Claude, not by you. The rule used: `large` when a wrong result would be costly or when the work is both cross-cutting and open-ended, `medium` when it is one or the other or a new bounded feature, and `small` otherwise. Review them, change what you disagree with, and run again. The assistant `indirect` labels deserve a glance too. If you change labels, `npm test` checks that they are still valid.

The probes are made up and hold no real task text, file contents or keys, so nothing private is sent. They use the context in `tests/probes/context.js` (five agents and 18 paths), which is smaller than a real project.

## Things the first run may show

- `bad_answer` on every call for one model means its reply differs from the reference shape. One guess is built in: score levels start at 0. The `Failed calls` section prints the first error. Send that line to Claude. It holds no key.
- `not_found` for a model means the id is not on your account or was renamed. Check the live list.
- A model with a short context (Kev 4B has 8,192 tokens) may reject the assistant questions, which carry 15 action options.
- Results from different days can differ a little, because hosted models are not fully repeatable.
