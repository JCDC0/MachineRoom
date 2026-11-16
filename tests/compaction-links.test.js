import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BRANCH_TRANSCRIPT_LIMIT,
  COMPACTED_MESSAGE,
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
  "const args = process.argv.slice(2)",
  "const at = args.indexOf('-p')",
  "const prompt = at === -1 ? '' : String(args[at + 1] ?? '')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
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

function makeRig() {
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
    const env = { ...(options.env ?? process.env), MR_INPUT: String(spawned === 1 ? 160000 : 12) }
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
  })
  cleanups.push(async () => {
    orchestrator.close()
    await sleep(20)
    removeTempDir(base)
  })
  return { base, runs, project, orchestrator }
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
