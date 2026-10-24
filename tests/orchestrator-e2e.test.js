import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { getJson, postJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const TASK_SUBJECT = 'Write the lane note from the fake lane.'
const SECOND_REPLY = 'Second turn: the lane report reached me.'
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), args, {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'machineroom@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'machineroom@example.invalid',
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${args[0]} failed.`).trim())
  }
  return String(result.stdout ?? '').trim()
}

function makeProject(base, fakeLane) {
  const project = join(base, 'project')
  mkdirSync(project, { recursive: true })
  gitIn(project, ['init'])
  gitIn(project, ['config', 'user.name', 'MachineRoom Test'])
  gitIn(project, ['config', 'user.email', 'machineroom@example.invalid'])
  gitIn(project, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(project, 'readme.txt'), 'A throwaway project for the end to end test.\n')
  copyFileSync(fakeLane, join(project, 'run'))
  gitIn(project, ['add', '-A'])
  gitIn(project, ['commit', '-m', 'Start the throwaway project.'])
  gitIn(project, ['branch', '-M', 'main'])
  return project
}

function writeLanes(base) {
  const fakeClaude = process.platform === 'win32' ? join(FIXTURES, 'fake-claude.cmd') : join(base, 'fake-claude.mjs')
  if (process.platform !== 'win32') {
    copyFileSync(join(FIXTURES, 'fake-claude'), fakeClaude)
    chmodSync(fakeClaude, 0o755)
  }
  const file = join(base, 'lanes.json')
  const lanes = {
    orchestrator: {
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: fakeClaude, model: 'opus' },
    },
    opencode: {
      name: 'Fake lane',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
    },
  }
  writeFileSync(file, `${JSON.stringify(lanes, null, 2)}\n`)
  return { file, lanes }
}

function spawnOrchestrator(callsFile, children) {
  return (file, args, options) => {
    const env = { ...(options.env ?? process.env) }
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'PATH') delete env[key]
    }
    env.PATH = [FIXTURES, process.env.PATH ?? process.env.Path ?? ''].filter(Boolean).join(delimiter)
    env.MR_E2E_CLAUDE_CALLS = callsFile
    env.MR_E2E_NODE = process.execPath
    const nextArgs = [...args]
    const messageAt = nextArgs.indexOf('-p')
    if (process.platform === 'win32' && messageAt !== -1 && /[\r\n]/.test(String(nextArgs[messageAt + 1] ?? ''))) {
      const messageFile = `${callsFile}.message.txt`
      writeFileSync(messageFile, String(nextArgs[messageAt + 1]))
      env.MR_E2E_MESSAGE_FILE = messageFile
      nextArgs[messageAt + 1] = 'MR_E2E_MESSAGE_FILE'
    }
    const instructionAt = nextArgs.indexOf('--append-system-prompt')
    if (process.platform === 'win32' && instructionAt !== -1 && /[\r\n]/.test(String(nextArgs[instructionAt + 1] ?? ''))) {
      const instructionFile = `${callsFile}.instruction.txt`
      writeFileSync(instructionFile, String(nextArgs[instructionAt + 1]))
      env.MR_E2E_INSTRUCTION_FILE = instructionFile
      nextArgs[instructionAt + 1] = 'MR_E2E_INSTRUCTION_FILE'
    }
    const next = { ...options, env }
    let child
    if (process.platform === 'win32' && /\.cmd$/i.test(file)) {
      const line = [file, ...nextArgs].map((part) => `"${part}"`).join(' ')
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
        ...next,
        shell: false,
        windowsVerbatimArguments: true,
      })
    } else {
      child = spawn(file, nextArgs, next)
    }
    children.add(child)
    child.once('close', () => children.delete(child))
    return child
  }
}

function readCalls(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1]
}

function sameFolder(one, two) {
  const left = resolve(one)
  const right = resolve(two)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

describe('the orchestrator loop with real programs', () => {
  it('starts a turn, a lane run in its worktree, the wake and the reply', async (context) => {
    try {
      gitPath()
    } catch {
      context.skip('Git is not on the PATH, so the lane worktree cannot be made.')
      return
    }

    const base = makeTempDir('mr-orchestrator-e2e-')
    cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const project = makeProject(base, join(FIXTURES, 'fake-lane.cjs'))
    const head = gitIn(project, ['rev-parse', 'HEAD'])
    const lanes = writeLanes(base)
    const callsFile = join(base, 'claude-calls.jsonl')
    const children = new Set()
    const bridge = createBridge({
      projectRoot: project,
      port: 0,
      env: {},
      runsFolder: runs,
      lanesFile: lanes.file,
      orchestratorFolder: runs,
      orchestratorSpawn: spawnOrchestrator(callsFile, children),
      lanesSource: {
        folder: runs,
        lanes: lanes.lanes,
        repoRoot: project,
        pollMs: 20,
        quietMs: 60000,
        primeMs: 600000,
      },
    })
    cleanups.push(async () => {
      await bridge.stop()
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) killTree(child)
      }
      await new Promise((done) => setTimeout(done, 50))
    })
    const { url } = await bridge.start()

    const sent = await postJson(`${url}/api/orchestrator/messages`, {
      text: 'Start one lane for the end to end test.',
      confirmed: true,
    })
    expect(sent.status).toBe(202)

    await waitFor(() => readdirSync(runs).some((name) => /^orchestrator-chat-.*\.log$/.test(name)), {
      timeoutMs: 15000,
      what: 'the first orchestrator turn log',
    })
    await waitFor(() => readCalls(callsFile).length >= 1, {
      timeoutMs: 15000,
      what: 'the first orchestrator turn',
    })
    const first = readCalls(callsFile)[0]
    expect(first.turn).toBe('first')
    expect(sameFolder(first.cwd, project)).toBe(true)
    expect(first.args).toContain('--session-id')
    expect(valueAfter(first.args, '-p')).toBe('Start one lane for the end to end test.')
    expect(first.instruction).toContain(url)
    expect(first.instruction).toContain('You are the orchestrator')
    expect(first.status).toBe(202)

    const worktree = join(base, 'project-mr-opencode')
    await waitFor(() => existsSync(join(worktree, 'lane-note.txt')), {
      timeoutMs: 30000,
      what: 'the fake lane to write its file in the worktree',
    })
    expect(sameFolder(gitIn(worktree, ['rev-parse', '--show-toplevel']), worktree)).toBe(true)
    expect(readFileSync(join(worktree, 'lane-note.txt'), 'utf8')).toBe('The fake lane wrote this file.\n')
    const laneLog = readdirSync(runs).find((name) => /^opencode-queue-.*\.log$/.test(name))
    expect(laneLog).toBeTruthy()
    expect(readFileSync(join(runs, laneLog), 'utf8')).toContain('"type":"tool_use"')

    const branch = await waitFor(
      () => {
        try {
          const names = gitIn(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/machineroom/queue-*'])
            .split(/\r?\n/)
            .filter(Boolean)
          return (
            names.find((name) => Number(gitIn(project, ['rev-list', '--count', `${head}..${name}`])) === 1) ?? null
          )
        } catch {
          return null
        }
      },
      { timeoutMs: 30000, what: 'the queue branch with one commit' }
    )
    expect(branch.startsWith('machineroom/queue-')).toBe(true)
    expect(gitIn(project, ['log', '-1', '--format=%s', branch])).toBe(TASK_SUBJECT)

    const room = await waitFor(
      async () => {
        const { body } = await getJson(`${url}/api/orchestrator`)
        return body.messages.find((message) => message.from === 'room' && message.text.includes(`branch ${branch}`)) ?? null
      },
      { timeoutMs: 45000, what: 'the room message that names the queue branch' }
    )
    expect(room.text).toContain('Run opencode-queue-')
    expect(room.text).toContain('lane opencode')

    await waitFor(() => readCalls(callsFile).some((call) => call.turn === 'second'), {
      timeoutMs: 45000,
      what: 'the second orchestrator turn',
    })
    const second = readCalls(callsFile).find((call) => call.turn === 'second')
    expect(valueAfter(second.args, '--resume')).toBe(valueAfter(first.args, '--session-id'))

    const reply = await waitFor(
      async () => {
        const { body } = await getJson(`${url}/api/orchestrator`)
        return body.messages.find((message) => message.from === 'orchestrator' && message.text.includes(SECOND_REPLY)) ?? null
      },
      { timeoutMs: 20000, what: 'the second turn reply in the chat' }
    )
    expect(reply.text).toBe(SECOND_REPLY)

    const final = await waitFor(
      async () => {
        const { body } = await getJson(`${url}/api/orchestrator`)
        return body.state === 'idle' ? body : null
      },
      { timeoutMs: 15000, what: 'the orchestrator to rest after the second turn' }
    )
    expect(final.messages.some((message) => message.text.includes(SECOND_REPLY))).toBe(true)
  }, 120000)
})
