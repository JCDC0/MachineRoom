import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide } from '../src/decider/decide.js'
import { DEFAULT_MODELS, formatReport, planEval, runEval } from '../src/decider/eval.js'
import { DEFAULT_URL, choice } from '../src/decider/wire.js'
import { assistantProbes } from '../tests/probes/assistant.js'
import { context } from '../tests/probes/context.js'
import { routingProbes } from '../tests/probes/routing.js'

const USAGE = `Compare decision models on the MachineRoom probe sets.

  npm run decide-eval -- --smoke            one call to the first model, to check the key and the endpoint
  npm run decide-eval                       show the plan and the estimated cost, make no calls
  npm run decide-eval -- --run              run the comparison

Options
  --models a,b,c    model ids (default: ${DEFAULT_MODELS.length} listed models)
  --set NAME        assistant, routing or all (default all)
  --repeat N        asks per probe, to measure answers that change (default 2)
  --limit N         use only N probes per set, spread over the list
  --llm ID          also run a plain language model as a baseline
  --url URL         Decisions API address (default ${DEFAULT_URL})
  --llm-url URL     chat completions address for the baseline
  --key-env NAME    name of the environment variable that holds the key (default OPENROUTER_API_KEY)
  --json PATH       also write the raw results to a file

The key is read from your environment and is never printed or written.`

const FLAGS = new Set(['run', 'smoke', 'help'])
const VALUES = new Set(['models', 'set', 'repeat', 'limit', 'llm', 'url', 'llm-url', 'key-env', 'json'])

export function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (!raw.startsWith('--')) return { error: `Unexpected argument: ${raw}` }
    const name = raw.slice(2)
    if (FLAGS.has(name)) args[name] = true
    else if (VALUES.has(name)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) return { error: `--${name} needs a value.` }
      args[name] = value
      index += 1
    } else return { error: `Unknown option: ${raw}` }
  }
  return { args }
}

export function safeUrl(text) {
  let url
  try {
    url = new URL(text)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}

function spread(list, limit) {
  if (!limit || limit >= list.length) return list
  const stride = list.length / limit
  return Array.from({ length: limit }, (_, index) => list[Math.floor(index * stride)])
}

export function selectProbes(set, limit) {
  const parts = []
  if (set === 'all' || set === 'assistant') parts.push(spread(assistantProbes(), limit))
  if (set === 'all' || set === 'routing') parts.push(spread(routingProbes(), limit))
  return parts.flat()
}

export async function main({ argv, env, out, err, fetch: fetchImpl = globalThis.fetch }) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    err(`${parsed.error}\n\n${USAGE}`)
    return 1
  }
  const { args } = parsed
  if (args.help) {
    out(USAGE)
    return 0
  }
  const set = args.set ?? 'all'
  const repeat = Number(args.repeat ?? 2)
  const limit = args.limit === undefined ? null : Number(args.limit)
  if (!['all', 'assistant', 'routing'].includes(set)) {
    err('--set must be assistant, routing or all.')
    return 1
  }
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5 || (limit !== null && (!Number.isInteger(limit) || limit < 1))) {
    err('--repeat must be 1 to 5 and --limit a whole number of 1 or more.')
    return 1
  }
  const url = args.url ?? DEFAULT_URL
  const llmUrl = args['llm-url']
  if (!safeUrl(url) || (llmUrl && !safeUrl(llmUrl))) {
    err('An address must use https, or http on this machine. The key is never sent over plain http to another host.')
    return 1
  }
  const models = args.models ? args.models.split(',').map((item) => item.trim()).filter(Boolean) : DEFAULT_MODELS
  const keyName = args['key-env'] ?? 'OPENROUTER_API_KEY'
  const key = env[keyName]

  if (args.smoke) {
    if (!key) {
      err(`Set ${keyName} in your shell first. The key stays in your environment.`)
      return 2
    }
    const result = await decide({
      fetch: fetchImpl,
      url,
      key,
      model: models[0],
      state: 'The sky on a clear day.',
      questions: { colour: choice('What colour is it?', { blue: 'Blue.', green: 'Green.' }) },
      timeoutMs: 15000,
      retries: 0,
    })
    if (!result.ok) {
      err(`Smoke call to ${models[0]} failed: ${result.kind}. ${result.error}`)
      return 3
    }
    out(`Smoke call to ${models[0]} worked in ${result.ms} ms. It answered "${result.answers.colour.choice}". Cost: ${result.usage.cost ?? 'not reported'}.`)
    return 0
  }

  const probes = selectProbes(set, limit)
  const plan = planEval({ probes, context, models, repeat, llm: args.llm ?? null })
  if (!args.run) {
    out(
      `Plan: ${plan.probes} probes (${Object.entries(plan.sets).map(([name, count]) => `${count} ${name}`).join(', ')}), ${plan.models} models, ${plan.repeat} asks each. About ${plan.calls} calls, about ${plan.inputTokens} input tokens, about $${plan.estimatedCostUsd.toFixed(3)}.\nNo calls were made. Add --run to start.`
    )
    return 0
  }
  if (!key) {
    err(`Set ${keyName} in your shell first. The key stays in your environment.`)
    return 2
  }
  err(`About ${plan.calls} calls, about $${plan.estimatedCostUsd.toFixed(3)}.`)
  const report = await runEval({
    probes,
    context,
    models,
    repeat,
    llm: args.llm ?? null,
    fetch: fetchImpl,
    url,
    llmUrl,
    key,
    onProgress: (line) => err(line),
  })
  out(formatReport(report))
  if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`)
  const answered = report.candidates.reduce((sum, item) => sum + item.calls - item.failed, 0)
  return answered === 0 ? 3 : 0
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) {
  const code = await main({
    argv: process.argv.slice(2),
    env: process.env,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  })
  process.exit(code)
}
