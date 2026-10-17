import { llmDecide, rulesPredict } from './baseline.js'
import { decide } from './decide.js'
import { NONE, requestFor } from './questions.js'
import { flipRate, median, scoreAnswer, summarize } from './stats.js'

export const DEFAULT_MODELS = [
  'typesafe/jev-1.14',
  'perplexity/pplx-decider-v1.2',
  'perplexity/pplx-decider-flash-v1.2',
  'cloudflare/clef',
  'cloudflare/clef-flash',
  'inception/mercury-decide:free',
  'microsoft/microsoft-decision-1',
]

export const PRIMARY = { assistant: 'action', routing: 'tier' }

const PRICE_PER_TOKEN = 0.042 / 1e6
const tokensOf = (request) => Math.ceil(JSON.stringify(request).length / 4)

export function planEval({ probes, context, models, repeat = 2, llm = null }) {
  const sets = {}
  let tokens = 0
  for (const probe of probes) {
    sets[probe.set] = (sets[probe.set] ?? 0) + 1
    tokens += tokensOf(requestFor(probe, context))
  }
  return {
    probes: probes.length,
    sets,
    models: models.length,
    repeat,
    calls: probes.length * models.length * repeat + (llm ? probes.length : 0),
    inputTokens: tokens * models.length * repeat + (llm ? tokens * 2 : 0),
    estimatedCostUsd: tokens * models.length * repeat * PRICE_PER_TOKEN,
  }
}

async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, lane))
  return results
}

function summarizeSets(probes, recordsFor) {
  const sets = {}
  for (const set of new Set(probes.map((probe) => probe.set))) {
    const inSet = probes.filter((probe) => probe.set === set)
    const byQuestion = {}
    const complete = { all: [], plain: [], indirect: [] }
    const records = []
    for (const probe of inSet) {
      const own = recordsFor(probe)
      records.push(...own)
      for (const record of own) (byQuestion[record.question] ??= []).push(record)
      const right = own.every((record) => record.correct)
      complete.all.push(right)
      if (probe.group) (complete[probe.group] ??= []).push(right)
    }
    const share = (list) => (list && list.length ? list.filter(Boolean).length / list.length : null)
    sets[set] = {
      n: inSet.length,
      primary: PRIMARY[set],
      questions: Object.fromEntries(Object.entries(byQuestion).map(([question, list]) => [question, summarize(list)])),
      complete: share(complete.all),
      byGroup: { plain: share(complete.plain), indirect: share(complete.indirect) },
    }
  }
  return sets
}

async function evaluate({ name, kind, probes, repeat, concurrency, call }) {
  const tasks = []
  for (const probe of probes) for (let run = 0; run < repeat; run += 1) tasks.push({ probe, run })
  const results = await pool(tasks, concurrency, ({ probe, run }) => call(probe, run))
  const first = new Map()
  const second = new Map()
  const errors = {}
  const latencies = []
  let failed = 0
  let costUsd = 0
  let costKnown = false
  let inputTokens = 0
  const byProbe = new Map()
  tasks.forEach((task, index) => {
    const result = results[index]
    if (result.ok) {
      latencies.push(result.ms)
      inputTokens += result.usage?.inputTokens ?? 0
      if (result.usage?.cost !== null && result.usage?.cost !== undefined) {
        costUsd += result.usage.cost
        costKnown = true
      }
    } else {
      failed += 1
      errors[result.kind] = (errors[result.kind] ?? 0) + 1
    }
    if (task.run === 0) byProbe.set(task.probe.id, result)
    if (result.ok && task.run <= 1) {
      for (const [question, expected] of Object.entries(task.probe.expected)) {
        const scored = scoreAnswer(result.answers[question], expected)
        ;(task.run === 0 ? first : second).set(`${task.probe.id}:${question}`, scored.predicted)
      }
    }
  })
  const recordsFor = (probe) => {
    const result = byProbe.get(probe.id)
    return Object.entries(probe.expected).map(([question, expected]) => {
      if (!result || !result.ok) return { probeId: probe.id, question, expected, predicted: null, correct: false, confidence: null }
      return { probeId: probe.id, question, expected, ...scoreAnswer(result.answers[question], expected) }
    })
  }
  return {
    name,
    kind,
    calls: tasks.length,
    failed,
    errors,
    medianMs: median(latencies),
    costUsd: costKnown ? costUsd : null,
    inputTokens,
    flips: repeat > 1 ? flipRate(first, second) : null,
    sets: summarizeSets(probes, recordsFor),
    firstError: Object.values(results).find((result) => !result.ok)?.error ?? null,
  }
}

function baseline({ name, kind, probes, predict }) {
  const recordsFor = (probe) =>
    Object.entries(probe.expected).map(([question, expected]) => {
      const predicted = predict(probe, question)
      return { probeId: probe.id, question, expected, predicted, correct: predicted === expected, confidence: null }
    })
  return { name, kind, calls: 0, failed: 0, errors: {}, medianMs: null, costUsd: null, inputTokens: 0, flips: null, sets: summarizeSets(probes, recordsFor) }
}

export function baselines({ probes, context }) {
  const majority = new Map()
  for (const set of new Set(probes.map((probe) => probe.set))) {
    for (const probe of probes.filter((item) => item.set === set)) {
      for (const [question, expected] of Object.entries(probe.expected)) {
        const key = `${set}:${question}`
        if (!majority.has(key)) majority.set(key, [])
        majority.get(key).push(expected)
      }
    }
  }
  const top = (labels) => {
    const counts = new Map()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  const winners = new Map([...majority.entries()].map(([key, labels]) => [key, top(labels)]))
  const list = [
    baseline({ name: 'majority answer', kind: 'majority', probes, predict: (probe, question) => winners.get(`${probe.set}:${question}`) }),
  ]
  const assistant = probes.filter((probe) => probe.set === 'assistant')
  if (assistant.length) {
    const cache = new Map(assistant.map((probe) => [probe.id, rulesPredict(probe.text, context)]))
    list.push(baseline({ name: 'plain rules', kind: 'rules', probes: assistant, predict: (probe, question) => cache.get(probe.id)[question] ?? NONE }))
  }
  return list
}

export async function runEval({
  probes,
  context,
  models,
  repeat = 2,
  llm = null,
  fetch: fetchImpl = globalThis.fetch,
  url,
  llmUrl,
  key,
  concurrency = 4,
  timeoutMs = 15000,
  onProgress = () => {},
  sleep,
}) {
  const candidates = []
  for (const model of models) {
    onProgress(`Asking ${model}`)
    candidates.push(
      await evaluate({
        name: model,
        kind: 'decision',
        probes,
        repeat,
        concurrency,
        call: (probe) => {
          const request = requestFor(probe, context)
          return decide({ fetch: fetchImpl, url, key, model, ...request, timeoutMs, retries: 2, sleep })
        },
      })
    )
  }
  if (llm) {
    onProgress(`Asking ${llm} as a plain language model`)
    candidates.push(
      await evaluate({
        name: `${llm} (language model)`,
        kind: 'llm',
        probes,
        repeat: 1,
        concurrency,
        call: (probe) => llmDecide({ fetch: fetchImpl, url: llmUrl, key, model: llm, ...requestFor(probe, context), timeoutMs: timeoutMs + 10000 }),
      })
    )
  }
  return { generatedAt: new Date().toISOString(), probes: probes.length, repeat, candidates, baselines: baselines({ probes, context }) }
}

const pct = (value) => (value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`)
const ms = (value) => (value === null || value === undefined ? '-' : `${Math.round(value)}`)

function perThousand(candidate) {
  if (candidate.costUsd === null || candidate.calls - candidate.failed === 0) return '-'
  return `$${((candidate.costUsd / (candidate.calls - candidate.failed)) * 1000).toFixed(3)}`
}

export function formatReport(report) {
  const lines = [`Decision model comparison, ${report.generatedAt}`, `Probes: ${report.probes}. Each model asked ${report.repeat} time(s) per probe.`, '']
  const everything = [...report.candidates, ...report.baselines]
  const sets = [...new Set(everything.flatMap((item) => Object.keys(item.sets)))]
  for (const set of sets) {
    const primary = PRIMARY[set]
    lines.push(`## ${set}`, '')
    lines.push(`| Candidate | ${primary} right | All right | Coverage at 5% error | Calibration error | Answered | Median ms | Cost per 1k calls | Repeat flips |`)
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const item of everything) {
      const entry = item.sets[set]
      if (!entry) continue
      const main = entry.questions[primary]
      const answered = item.calls ? `${item.calls - item.failed}/${item.calls}` : '-'
      lines.push(
        `| ${item.name} | ${pct(main?.accuracy)} | ${pct(entry.complete)} | ${item.kind === 'decision' ? pct(main?.coverage5) : '-'} | ${main?.ece === null || main?.ece === undefined ? '-' : main.ece.toFixed(2)} | ${answered} | ${ms(item.medianMs)} | ${perThousand(item)} | ${pct(item.flips)} |`
      )
    }
    lines.push('')
    const questions = Object.keys(everything.find((item) => item.sets[set])?.sets[set].questions ?? {})
    lines.push(`| Candidate | ${questions.join(' | ')} |`, `| --- | ${questions.map(() => '---').join(' | ')} |`)
    for (const item of everything) {
      const entry = item.sets[set]
      if (!entry) continue
      lines.push(`| ${item.name} | ${questions.map((question) => pct(entry.questions[question]?.accuracy)).join(' | ')} |`)
    }
    lines.push('')
  }
  const broken = report.candidates.filter((item) => item.failed > 0)
  if (broken.length) {
    lines.push('## Failed calls', '')
    for (const item of broken) lines.push(`- ${item.name}: ${item.failed} of ${item.calls} failed (${Object.entries(item.errors).map(([kind, count]) => `${kind} ${count}`).join(', ')}). ${item.firstError ?? ''}`)
    lines.push('')
  }
  return lines.join('\n')
}
