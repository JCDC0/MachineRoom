import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BRANCH_TRANSCRIPT_LIMIT,
  COMPACTED_MESSAGE,
  COMPACTION_LOG_LIMIT,
  ORCHESTRATOR_CHAT_LIMIT,
  SESSION_MESSAGES_LIMIT,
  chatFileFor,
  compactedMessage,
  compactedSummary,
  createOrchestrator,
} from '../server/orchestrator.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const CHAT = 'orchestrator-abc12345.json'
const LOGS = [
  'orchestrator-chat-20261116-090000-000.log',
  'orchestrator-chat-20261116-091500-250.log',
]
const TURN_LOG = /-chat-\d{8}-\d{6}-\d{3}\.log$/

const FAKE_CLAUDE = [
  "import { appendFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const at = args.indexOf('-p')",
  "const prompt = at === -1 ? '' : String(args[at + 1] ?? '')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "if (process.env.MR_DUMP) appendFileSync(process.env.MR_DUMP, prompt + '\\n=====\\n')",
  "const input = Number(process.env.MR_INPUT ?? 12)",
  "const reply = 'Summary: ' + prompt.split('\\n')[0].slice(0, 40)",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: reply, total_cost_usd: 0.1, usage: { input_tokens: input, output_tokens: 3 } }))",
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(15)
  }
}

function makeRig(inputs = null, extra = {}) {
  const base = makeTempDir('mr-compaction-links-')
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(project, { recursive: true })
  const script = join(base, 'fake-claude.mjs')
  writeFileSync(script, FAKE_CLAUDE)
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}')
  let spawned = 0
  const spawnFake = (file, args, options) => {
    spawned += 1
    const fallback = spawned === 1 ? 160000 : 12
    const input = Array.isArray(inputs) ? (inputs[spawned - 1] ?? 12) : fallback
    const env = { ...(options.env ?? process.env), MR_INPUT: String(input), MR_DUMP: join(base, 'prompts.txt') }
    return spawn(process.execPath, [script, ...args], { ...options, env })
  }
  const orchestrator = createOrchestrator({
    projectRoot: project,
    runsFolder: runs,
    lanes: {
      orchestrator: {
        name: 'Orchestrator',
        harness: 'Claude Code',
        cli: { harness: 'claude', bin: 'claude', model: 'opus', contextWindow: 200000 },
      },
    },
    harness: 'claude',
    model: 'opus',
    spawn: spawnFake,
    promptFile,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    ...extra,
  })
  cleanups.push(async () => {
    orchestrator.close()
    await sleep(20)
    removeTempDir(base)
  })
  return { base, runs, project, orchestrator }
}

function writeTurnLogs(runs, stamp, count) {
  const names = []
  for (let index = 0; index < count; index += 1) {
    const name = `orchestrator-chat-${stamp}-${String(index).padStart(3, '0')}.log`
    writeFileSync(join(runs, name), '')
    names.push(name)
  }
  return names
}

function turnLogsIn(runs) {
  return readdirSync(runs).filter((name) => TURN_LOG.test(name)).sort()
}

function compactionMessages(rig) {
  return rig.orchestrator
    .answer()
    .messages.filter((message) => message.from === 'room' && message.text.startsWith(COMPACTED_MESSAGE))
}

describe('the compaction message', () => {
  it('names the chat file, the turn logs and the limits', () => {
    const text = compactedMessage({ chatFile: CHAT, logs: LOGS })

    expect(text.startsWith(COMPACTED_MESSAGE)).toBe(true)
    expect(text).toContain(CHAT)
    expect(text).toContain('which the chat still shows')
    expect(text).toContain(LOGS[0])
    expect(text).toContain(LOGS[1])
    expect(text).toContain(`last ${ORCHESTRATOR_CHAT_LIMIT} messages`)
    expect(text).toContain(`last ${SESSION_MESSAGES_LIMIT} messages`)
    expect(text).toContain(`${BRANCH_TRANSCRIPT_LIMIT} characters`)
  })

  it('says when no earlier turn log was found', () => {
    const text = compactedMessage({ chatFile: CHAT, logs: [] })

    expect(text).toContain('No earlier turn logs were found in the runs folder.')
  })

  it('ignores names that are not turn logs', () => {
    const text = compactedMessage({ chatFile: CHAT, logs: ['../escape.log', 'notes.txt'] })

    expect(text).not.toContain('escape.log')
    expect(text).not.toContain('notes.txt')
  })
})

describe('the kept summary', () => {
  it('starts with a line naming the source turn logs', () => {
    const summary = compactedSummary('The work so far.', LOGS)
    const first = summary.split('\n')[0]

    expect(first).toBe(`Summarized from these turn logs in the runs folder: ${LOGS.join(', ')}.`)
    expect(summary.endsWith('The work so far.')).toBe(true)
  })

  it('says no earlier log was found and keeps the summary', () => {
    const summary = compactedSummary('The work so far.', [])

    expect(summary.split('\n')[0]).toBe('Summarized from the saved chat. No earlier turn logs were found in the runs folder.')
    expect(summary).toContain('The work so far.')
  })
})

describe('the turn log list', () => {
  it('names the ten newest logs and counts the rest as earlier', () => {
    const logs = Array.from(
      { length: 15 },
      (_, index) => `orchestrator-chat-20260101-000000-${String(index).padStart(3, '0')}.log`
    )
    const text = compactedMessage({ chatFile: CHAT, logs })
    const first = compactedSummary('The work so far.', logs).split('\n')[0]
    const more = `and ${logs.length - COMPACTION_LOG_LIMIT} earlier`

    expect(text).toContain(more)
    expect(first).toContain(more)
    expect(text).not.toContain(logs[4])
    expect(first).not.toContain(logs[4])
    expect(text).toContain(logs[5])
    expect(text).toContain(logs[14])
    expect(first).toContain(logs[5])
    expect(first).toContain(logs[14])
  })
})

describe('a compaction in a real turn', () => {
  it('posts the links in the room and starts the saved summary with the log names', async () => {
    const rig = makeRig()
    rig.orchestrator.send({ text: 'Build the room.', confirmed: true })
    await waitFor(
      () => rig.orchestrator.answer().state === 'idle' && readdirSync(rig.runs).filter((name) => TURN_LOG.test(name)).length === 2,
      20000,
      'the compacted session'
    )

    const logs = readdirSync(rig.runs).filter((name) => TURN_LOG.test(name)).sort()
    const chatName = basename(chatFileFor(rig.project, rig.runs))
    const messages = rig.orchestrator.answer().messages
    const text = messages.find((message) => message.from === 'room' && message.text.startsWith(COMPACTED_MESSAGE))?.text ?? ''
    const saved = JSON.parse(readFileSync(chatFileFor(rig.project, rig.runs), 'utf8'))

    expect(text).toContain(chatName)
    expect(text).toContain('which the chat still shows')
    expect(text).toContain(logs[0])
    expect(text).toContain(`last ${ORCHESTRATOR_CHAT_LIMIT} messages`)
    expect(text).toContain(`last ${SESSION_MESSAGES_LIMIT} messages`)
    expect(saved.summary.split('\n')[0]).toBe(`Summarized from these turn logs in the runs folder: ${logs[0]}.`)
    expect(saved.summary).toContain('Summary: Write a summary')
  })
})

describe('a compaction after another compaction', () => {
  it('names only the turn logs written since the previous compaction', async () => {
    const rig = makeRig([160000, 12, 12])
    const old = writeTurnLogs(rig.runs, '20260101-000000', 19)
    rig.orchestrator.send({ text: 'Build the room.', confirmed: true })
    await waitFor(
      () => compactionMessages(rig).length === 1 && rig.orchestrator.answer().state === 'idle',
      20000,
      'the first compaction'
    )
    expect(compactionMessages(rig)[0].text).toContain('and 10 earlier')
    const firstReal = turnLogsIn(rig.runs).filter((name) => !old.includes(name))
    expect(firstReal).toHaveLength(2)

    const since = writeTurnLogs(rig.runs, '20270101-000000', 9)
    rig.orchestrator.send({ text: 'Go on.', confirmed: true })
    await waitFor(
      () =>
        rig.orchestrator.answer().state === 'idle' &&
        turnLogsIn(rig.runs).filter((name) => !old.includes(name) && !since.includes(name)).length === 3,
      20000,
      'the next turn'
    )
    rig.orchestrator.compact({ confirmed: true })
    await waitFor(
      () => compactionMessages(rig).length === 2 && rig.orchestrator.answer().state === 'idle',
      20000,
      'the second compaction'
    )

    const real = turnLogsIn(rig.runs).filter((name) => !old.includes(name) && !since.includes(name))
    const expected = [real[2], ...since]
    const text = compactionMessages(rig)[1].text
    const saved = JSON.parse(readFileSync(chatFileFor(rig.project, rig.runs), 'utf8'))
    const summaryLine = saved.summary.split('\n')[0]

    expect(expected).toHaveLength(COMPACTION_LOG_LIMIT)
    expect(/and \d+ earlier/.test(text)).toBe(false)
    for (const name of expected) {
      expect(text).toContain(name)
      expect(summaryLine).toContain(name)
    }
    for (const name of [...old, ...firstReal]) {
      expect(text).not.toContain(name)
      expect(summaryLine).not.toContain(name)
    }
  })

  it('names ten and says five earlier when fifteen were written since', async () => {
    const rig = makeRig([160000, 12, 12])
    const old = writeTurnLogs(rig.runs, '20260101-000000', 19)
    rig.orchestrator.send({ text: 'Build the room.', confirmed: true })
    await waitFor(
      () => compactionMessages(rig).length === 1 && rig.orchestrator.answer().state === 'idle',
      20000,
      'the first compaction'
    )

    const since = writeTurnLogs(rig.runs, '20270101-000000', 14)
    rig.orchestrator.send({ text: 'Go on.', confirmed: true })
    await waitFor(
      () =>
        rig.orchestrator.answer().state === 'idle' &&
        turnLogsIn(rig.runs).filter((name) => !old.includes(name) && !since.includes(name)).length === 3,
      20000,
      'the next turn'
    )
    rig.orchestrator.compact({ confirmed: true })
    await waitFor(
      () => compactionMessages(rig).length === 2 && rig.orchestrator.answer().state === 'idle',
      20000,
      'the second compaction'
    )

    const real = turnLogsIn(rig.runs).filter((name) => !old.includes(name) && !since.includes(name))
    const all = [real[2], ...since]
    const expected = all.slice(-COMPACTION_LOG_LIMIT)
    const older = all.slice(0, all.length - COMPACTION_LOG_LIMIT)
    const text = compactionMessages(rig)[1].text
    const saved = JSON.parse(readFileSync(chatFileFor(rig.project, rig.runs), 'utf8'))
    const summaryLine = saved.summary.split('\n')[0]

    expect(all).toHaveLength(15)
    expect(older).toHaveLength(5)
    expect(text).toContain('and 5 earlier')
    expect(summaryLine).toContain('and 5 earlier')
    for (const name of expected) {
      expect(text).toContain(name)
      expect(summaryLine).toContain(name)
    }
    for (const name of older) {
      expect(text).not.toContain(name)
      expect(summaryLine).not.toContain(name)
    }
  })
})

describe('the room state across a compaction', () => {
  const state = (lane) => ({ running: [{ lane, task: 'Build it' }], reviews: [], scopes: [] })

  async function compacted(extra) {
    const rig = makeRig(null, extra)
    rig.orchestrator.send({ text: 'Build the room.', confirmed: true })
    await waitFor(
      () => rig.orchestrator.answer().state === 'idle' && turnLogsIn(rig.runs).length === 2,
      20000,
      'the compacted session'
    )
    return rig
  }

  it('stores the block above the summary', async () => {
    const rig = await compacted({ readTaskState: () => state('codex') })
    const saved = JSON.parse(readFileSync(chatFileFor(rig.project, rig.runs), 'utf8'))

    expect(saved.summary.startsWith('Room state at compaction (from the room, not the model):\nRunning lanes:\n- codex, Build it')).toBe(true)
    expect(saved.summary.indexOf('Summarized from')).toBeGreaterThan(saved.summary.indexOf('Running lanes:'))
  })

  it('puts both blocks in the next session when the state changed', async () => {
    let lane = 'codex'
    const rig = await compacted({ readTaskState: () => state(lane) })
    lane = 'agy'
    rig.orchestrator.send({ text: 'Go on.', confirmed: true })
    const dump = join(rig.base, 'prompts.txt')
    await waitFor(() => readFileSync(dump, 'utf8').split('=====').length > 3, 20000, 'the next session')
    const prompts = readFileSync(dump, 'utf8').split('\n=====\n')
    const next = prompts[2]

    expect(next).toContain('- codex, Build it')
    expect(next).toContain('Room state now:\nRunning lanes:\n- agy, Build it')
  })

  it('changes nothing without a reader', async () => {
    const rig = await compacted({})
    const saved = JSON.parse(readFileSync(chatFileFor(rig.project, rig.runs), 'utf8'))

    expect(saved.summary).not.toContain('Room state')
  })
})
