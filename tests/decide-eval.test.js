import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baselines, formatReport, planEval, runEval } from '../src/decider/eval.js'
import { main, parseArgs, safeUrl, selectProbes } from '../scripts/decide-eval.mjs'
import { oracle, startFakeDecisions, truthOf } from './fakeDecisions.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { assistantProbes } from './probes/assistant.js'
import { context } from './probes/context.js'
import { routingProbes } from './probes/routing.js'

const KEY = 'secret-test-key-xyz'
const all = [...assistantProbes(), ...routingProbes()]
const small = [
  ...assistantProbes().filter((probe) => probe.group === 'plain').slice(0, 5),
  ...assistantProbes().filter((probe) => probe.group === 'indirect').slice(0, 5),
  ...routingProbes().slice(0, 5),
]
const truth = truthOf(all)
const noWait = async () => {}

const servers = []
afterEach(async () => {
  while (servers.length) await servers.pop().close()
})

async function serve(answer) {
  const server = await startFakeDecisions(answer)
  servers.push(server)
  return server
}

function byModel(request, count, seenByState) {
  const times = (seenByState.get(request.state) ?? 0) + 1
  seenByState.set(request.state, times)
  switch (request.model) {
    case 'fake/perfect':
      return oracle(request, truth)
    case 'fake/noisy':
      return oracle(request, truth, { wrongFor: (name) => name === 'action' || name === 'tier' })
    case 'fake/flaky':
      return oracle(request, truth, { wrongFor: () => times % 2 === 0 })
    case 'fake/down':
      return { status: 500, body: { error: { message: 'boom' } } }
    case 'fake/denied':
      return { status: 401, body: { error: { message: `rejected ${KEY}` } } }
    default:
      return { status: 404, body: {} }
  }
}

describe('planEval', () => {
  it('counts calls, tokens and a cost estimate', () => {
    const plan = planEval({ probes: small, context, models: ['a', 'b', 'c'], repeat: 2 })
    expect(plan.probes).toBe(15)
    expect(plan.sets).toEqual({ assistant: 10, routing: 5 })
    expect(plan.calls).toBe(15 * 3 * 2)
    expect(plan.inputTokens).toBeGreaterThan(1000)
    expect(plan.estimatedCostUsd).toBeGreaterThan(0)
    expect(plan.estimatedCostUsd).toBeLessThan(0.1)
  })

  it('adds one call per probe for a language model baseline', () => {
    expect(planEval({ probes: small, context, models: ['a'], repeat: 1, llm: 'x/y' }).calls).toBe(30)
  })

  it('stays well under a dollar for the full run on seven models', () => {
    const plan = planEval({ probes: all, context, models: Array(7).fill('m'), repeat: 2 })
    expect(plan.estimatedCostUsd).toBeLessThan(0.25)
  })
})

describe('runEval against a fake server', () => {
  it('scores a perfect model, a model wrong on the main question, and a model that changes its mind', async () => {
    const seenByState = new Map()
    const server = await serve((request, count) => byModel(request, count, seenByState))
    const report = await runEval({
      probes: small,
      context,
      models: ['fake/perfect', 'fake/noisy', 'fake/flaky'],
      repeat: 2,
      fetch: globalThis.fetch,
      url: server.url,
      key: KEY,
      sleep: noWait,
    })
    const [perfect, noisy, flaky] = report.candidates
    expect(perfect.sets.assistant.questions.action.accuracy).toBe(1)
    expect(perfect.sets.routing.questions.tier.accuracy).toBe(1)
    expect(perfect.sets.assistant.complete).toBe(1)
    expect(perfect.sets.assistant.questions.action.coverage5).toBe(1)
    expect(perfect.flips).toBe(0)
    expect(perfect.failed).toBe(0)
    expect(perfect.costUsd).toBeCloseTo(0.00003 * 30, 8)
    expect(noisy.sets.assistant.questions.action.accuracy).toBe(0)
    expect(noisy.sets.assistant.questions.agent.accuracy).toBe(1)
    expect(noisy.sets.assistant.complete).toBe(0)
    expect(noisy.flips).toBe(0)
    expect(flaky.sets.assistant.questions.action.accuracy).toBe(1)
    expect(flaky.flips).toBe(1)
  })

  it('sends the key, the model and the fixed question names on every call', async () => {
    const server = await serve((request) => oracle(request, truth))
    await runEval({ probes: small.slice(0, 2), context, models: ['fake/perfect'], repeat: 1, fetch: globalThis.fetch, url: server.url, key: KEY, sleep: noWait })
    expect(server.seen).toHaveLength(2)
    for (const call of server.seen) {
      expect(call.authorization).toBe(`Bearer ${KEY}`)
      expect(call.body.model).toBe('fake/perfect')
      expect(Object.keys(call.body.questions)).toEqual(['action', 'agent', 'path', 'tab', 'section'])
    }
  })

  it('counts failed calls as wrong, reports the kinds, and keeps the key out of every message', async () => {
    const seenByState = new Map()
    const server = await serve((request, count) => byModel(request, count, seenByState))
    const report = await runEval({
      probes: small.slice(0, 6),
      context,
      models: ['fake/down', 'fake/denied'],
      repeat: 1,
      fetch: globalThis.fetch,
      url: server.url,
      key: KEY,
      sleep: noWait,
    })
    const [down, denied] = report.candidates
    expect(down.failed).toBe(6)
    expect(down.errors).toEqual({ server: 6 })
    expect(down.sets.assistant.questions.action.accuracy).toBe(0)
    expect(denied.errors).toEqual({ unauthorized: 6 })
    expect(JSON.stringify(report)).not.toContain(KEY)
    expect(formatReport(report)).not.toContain(KEY)
    expect(formatReport(report)).toContain('Failed calls')
  })

  it('runs a language model baseline through the chat address', async () => {
    const decisions = await serve((request) => oracle(request, truth))
    const chat = await serve((request) => {
      const text = request.messages[0].content.split('Text:\n')[1].split('\n\nQuestions:')[0].split('\n').slice(1).join('\n')
      const expected = truth.get(text) ?? {}
      const content = {}
      for (const question of ['action', 'agent', 'path', 'tab', 'section', 'tier', 'shape', 'coordination', 'uncertainty', 'consequence', 'splits', 'effort']) {
        if (request.messages[0].content.includes(`- ${question} (`)) content[question] = expected[question] ?? (question === 'path' || question === 'agent' || question === 'tab' || question === 'section' ? 'none' : 0)
      }
      return { body: { choices: [{ message: { content: `Here you go:\n${JSON.stringify(content)}` } }], usage: { prompt_tokens: 500, completion_tokens: 30 } } }
    })
    const report = await runEval({
      probes: small.slice(0, 5),
      context,
      models: ['fake/perfect'],
      repeat: 1,
      llm: 'fake/chat',
      fetch: globalThis.fetch,
      url: decisions.url,
      llmUrl: chat.url,
      key: KEY,
      sleep: noWait,
    })
    const llm = report.candidates.find((candidate) => candidate.kind === 'llm')
    expect(llm.name).toBe('fake/chat (language model)')
    expect(llm.failed).toBe(0)
    expect(llm.sets.assistant.questions.action.accuracy).toBe(1)
    expect(llm.sets.assistant.questions.action.coverage5).toBe(0)
    expect(chat.seen[0].authorization).toBe(`Bearer ${KEY}`)
    expect(chat.seen[0].body.model).toBe('fake/chat')
  })
})

describe('baselines', () => {
  it('score the plain rules and the majority answer without any call', () => {
    const [majority, rules] = baselines({ probes: all, context })
    expect(majority.name).toBe('majority answer')
    expect(rules.name).toBe('plain rules')
    expect(rules.sets.assistant.byGroup.plain).toBe(1)
    expect(rules.sets.assistant.byGroup.indirect).toBeLessThan(0.8)
    expect(majority.sets.routing.questions.shape.accuracy).toBeGreaterThan(0.7)
    expect(majority.sets.assistant.questions.action.accuracy).toBeLessThan(0.3)
    expect(rules.sets.routing).toBeUndefined()
  })
})

describe('report', () => {
  it('prints a table per set with every candidate and baseline', async () => {
    const server = await serve((request) => oracle(request, truth))
    const report = await runEval({ probes: small, context, models: ['fake/perfect'], repeat: 1, fetch: globalThis.fetch, url: server.url, key: KEY, sleep: noWait })
    const text = formatReport(report)
    expect(text).toContain('## assistant')
    expect(text).toContain('## routing')
    expect(text).toContain('fake/perfect')
    expect(text).toContain('plain rules')
    expect(text).toContain('majority answer')
    expect(text).toContain('Coverage at 5% error')
  })
})

describe('command line', () => {
  const run = async (argv, env, fetch) => {
    const out = []
    const err = []
    const code = await main({ argv, env, out: (text) => out.push(text), err: (text) => err.push(text), fetch })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }

  it('reads options and rejects unknown ones', () => {
    expect(parseArgs(['--run', '--models', 'a,b', '--limit', '5']).args).toEqual({ run: true, models: 'a,b', limit: '5' })
    expect(parseArgs(['--nope']).error).toMatch(/Unknown option/)
    expect(parseArgs(['--models']).error).toMatch(/needs a value/)
    expect(parseArgs(['--models', '--run']).error).toMatch(/needs a value/)
    expect(parseArgs(['stray']).error).toMatch(/Unexpected/)
  })

  it('sends the key only over https or to this machine', () => {
    expect(safeUrl('https://openrouter.ai/api/alpha/decisions')).toBe(true)
    expect(safeUrl('http://127.0.0.1:9999/x')).toBe(true)
    expect(safeUrl('http://localhost:9999/x')).toBe(true)
    expect(safeUrl('http://example.com/x')).toBe(false)
    expect(safeUrl('ftp://127.0.0.1/x')).toBe(false)
    expect(safeUrl('not a url')).toBe(false)
  })

  it('spreads a limit over each set', () => {
    const picked = selectProbes('assistant', 10)
    expect(picked).toHaveLength(10)
    expect(picked.some((probe) => probe.group === 'indirect')).toBe(true)
    expect(selectProbes('routing', 7)).toHaveLength(7)
    expect(selectProbes('all', null).length).toBe(all.length)
  })

  it('shows the plan and makes no call without --run', async () => {
    const server = await serve((request) => oracle(request, truth))
    const result = await run(['--limit', '5', '--models', 'fake/perfect', '--url', server.url], { OPENROUTER_API_KEY: KEY })
    expect(result.code).toBe(0)
    expect(result.out).toContain('No calls were made')
    expect(result.out).toContain('10 probes')
    expect(server.seen).toHaveLength(0)
  })

  it('refuses to call without a key and names only the variable', async () => {
    const result = await run(['--run', '--models', 'fake/perfect'], {})
    expect(result.code).toBe(2)
    expect(result.err).toContain('OPENROUTER_API_KEY')
    const smoke = await run(['--smoke'], {})
    expect(smoke.code).toBe(2)
  })

  it('refuses a plain http address on another host', async () => {
    const result = await run(['--run', '--url', 'http://example.com/x'], { OPENROUTER_API_KEY: KEY })
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/https/)
  })

  it('checks the key and the endpoint with one smoke call', async () => {
    const server = await serve((request) => ({
      body: { model: request.model, answers: { colour: { type: 'choice', choice: 'blue', probabilities: { blue: 0.97, green: 0.03 } } }, usage: { input_tokens: 40, output_tokens: 5, cost: 0.000002 } },
    }))
    const result = await run(['--smoke', '--models', 'fake/one', '--url', server.url, '--key-env', 'TEST_KEY'], { TEST_KEY: KEY })
    expect(result.code).toBe(0)
    expect(result.out).toContain('fake/one worked')
    expect(result.out).toContain('"blue"')
    expect(server.seen).toHaveLength(1)
    expect(result.out + result.err).not.toContain(KEY)
  })

  it('reports a refused key from the smoke call in plain words', async () => {
    const server = await serve(() => ({ status: 401, body: { error: { message: `no ${KEY}` } } }))
    const result = await run(['--smoke', '--url', server.url, '--key-env', 'TEST_KEY'], { TEST_KEY: KEY })
    expect(result.code).toBe(3)
    expect(result.err).toMatch(/unauthorized/)
    expect(result.err).not.toContain(KEY)
  })

  it('runs the comparison, prints the report and writes json without the key', async () => {
    const dir = makeTempDir('decide-eval-')
    try {
      const seenByState = new Map()
      const server = await serve((request, count) => byModel(request, count, seenByState))
      const file = join(dir, 'report.json')
      const result = await run(
        ['--run', '--limit', '6', '--repeat', '1', '--models', 'fake/perfect,fake/noisy', '--url', server.url, '--key-env', 'TEST_KEY', '--json', file],
        { TEST_KEY: KEY }
      )
      expect(result.code).toBe(0)
      expect(result.out).toContain('fake/perfect')
      expect(result.out).toContain('fake/noisy')
      expect(result.out).toContain('plain rules')
      expect(result.err).toContain('Asking fake/perfect')
      expect(server.seen).toHaveLength(24)
      const saved = readFileSync(file, 'utf8')
      expect(JSON.parse(saved).candidates).toHaveLength(2)
      expect(saved).not.toContain(KEY)
      expect(result.out + result.err).not.toContain(KEY)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits with 3 when no call was answered', async () => {
    const server = await serve(() => ({ status: 401, body: {} }))
    const result = await run(['--run', '--limit', '3', '--repeat', '1', '--models', 'fake/denied', '--url', server.url, '--key-env', 'TEST_KEY'], { TEST_KEY: KEY })
    expect(result.code).toBe(3)
    expect(result.out).toContain('Failed calls')
  })

  it('rejects a bad number of repeats and a bad set', async () => {
    expect((await run(['--repeat', '9'], {})).code).toBe(1)
    expect((await run(['--set', 'other'], {})).code).toBe(1)
  })

  it('prints the usage with --help', async () => {
    const result = await run(['--help'], {})
    expect(result.code).toBe(0)
    expect(result.out).toContain('--smoke')
  })
})
