import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildCommand, candidatePlan, laneEnv, parseCandidateArgs, runCandidate } from '../scripts/candidate.mjs'
import { killTree } from '../server/processTree.js'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-candidate-no-git-config')
const cleanups = []
let repoTemplate = ''
let templateRoot = ''

beforeAll(() => {
  templateRoot = makeTempDir('mr-candidate-template-')
  repoTemplate = join(templateRoot, 'repo')
  mkdirSync(repoTemplate)
  git(repoTemplate, ['init', '-b', 'main'])
  git(repoTemplate, ['config', 'user.name', 'MachineRoom Test'])
  git(repoTemplate, ['config', 'user.email', 'test@example.invalid'])
  git(repoTemplate, ['config', 'commit.gpgsign', 'false'])
  git(repoTemplate, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repoTemplate, 'notes.txt'), 'one\n')
  git(repoTemplate, ['add', 'notes.txt'])
  git(repoTemplate, ['commit', '-m', 'first'])
})

afterAll(() => {
  rmSync(templateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

function makeLaneRepo() {
  const base = tempDir('mr-candidate-')
  const repo = join(base, 'repo')
  const worktree = join(base, 'lane')
  cpSync(repoTemplate, repo, { recursive: true })
  git(repo, ['worktree', 'add', '-b', 'feat/candidate', worktree])
  return { base, repo, worktree }
}

function writeLanes(base, worktree) {
  const dir = join(base, 'docs', 'agents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lanes.json'), JSON.stringify({ lane: { worktree } }))
}

function buildEnv(command) {
  return { ...process.env, MACHINEROOM_BUILD_COMMAND: JSON.stringify(command) }
}

function freePort() {
  return new Promise((settle, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => settle(port))
    })
  })
}

function waitForText(child, marker, timeoutMs = 15000) {
  return new Promise((settle, fail) => {
    let seen = ''
    const timer = setTimeout(() => {
      cleanup()
      fail(new Error(`The child did not print ${marker}.`))
    }, timeoutMs)
    const onData = (chunk) => {
      seen += chunk.toString('utf8')
      if (!seen.includes(marker)) return
      cleanup()
      settle(seen)
    }
    const onExit = (code) => {
      cleanup()
      fail(new Error(`The child exited with ${code} before it printed ${marker}.`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.once('exit', onExit)
  })
}

describe('parseCandidateArgs', () => {
  it('reads the lane, the port and the project folder', () => {
    expect(parseCandidateArgs([
      'opencode',
      '--port', '6175',
      '--root', 'C:\\Project',
    ])).toEqual({
      lane: 'opencode',
      port: 6175,
      projectRoot: 'C:\\Project',
      help: false,
    })
  })

  it('defaults to port 5175 and accepts the equals form', () => {
    expect(parseCandidateArgs(['hermes', '--port=6176'])).toMatchObject({ lane: 'hermes', port: 6176 })
    expect(parseCandidateArgs(['hermes'])).toMatchObject({ lane: 'hermes', port: 5175 })
  })

  it('refuses an unknown option, a bad port and a missing lane', () => {
    expect(() => parseCandidateArgs(['opencode', '--wat'])).toThrow('Unknown option --wat.')
    expect(() => parseCandidateArgs(['opencode', '--port', '0'])).toThrow('The port must be a whole number from 1 to 65535.')
    expect(() => parseCandidateArgs(['opencode', '--port', 'abc'])).toThrow('The port must be a whole number from 1 to 65535.')
    expect(() => parseCandidateArgs([])).toThrow('Give a lane to try')
  })

  it('asks for help without a lane', () => {
    expect(parseCandidateArgs(['--help'])).toMatchObject({ help: true, lane: '', port: 5175 })
  })
})

describe('candidatePlan', () => {
  const worktree = 'C:\\GitHub\\MachineRoom-opencode'

  it('builds the plan for a known lane', () => {
    expect(candidatePlan({ lanes: { opencode: { worktree } }, lane: 'opencode', port: 5176 })).toEqual({
      lane: 'opencode',
      worktree,
      port: 5176,
      dist: join(worktree, 'dist'),
      bin: join(worktree, 'bin', 'machine-room.mjs'),
    })
  })

  it('uses 5175 when no port is given', () => {
    expect(candidatePlan({ lanes: { opencode: { worktree } }, lane: 'opencode' })).toMatchObject({ port: 5175 })
  })

  it('refuses an unknown lane and __proto__', () => {
    expect(() => candidatePlan({ lanes: { opencode: { worktree } }, lane: 'hermes' })).toThrow('The lane hermes is not in lanes.json.')
    expect(() => candidatePlan({ lanes: {}, lane: '__proto__' })).toThrow('The lane __proto__ is not in lanes.json.')
  })

  it('refuses a lane with no worktree', () => {
    expect(() => candidatePlan({ lanes: { agy: {} }, lane: 'agy' })).toThrow('The lane agy has no worktree.')
    expect(() => candidatePlan({ lanes: { agy: { worktree: '' } }, lane: 'agy' })).toThrow('The lane agy has no worktree.')
  })
})

describe('buildCommand', () => {
  it('takes the JSON array override', () => {
    expect(buildCommand({ MACHINEROOM_BUILD_COMMAND: '["node","-e","process.exit(0)"]' })).toEqual({
      command: ['node', '-e', 'process.exit(0)'],
      shell: false,
    })
  })

  it('refuses a bad override', () => {
    expect(() => buildCommand({ MACHINEROOM_BUILD_COMMAND: 'nope' })).toThrow('MACHINEROOM_BUILD_COMMAND needs a JSON array')
    expect(() => buildCommand({ MACHINEROOM_BUILD_COMMAND: '[]' })).toThrow('MACHINEROOM_BUILD_COMMAND needs a JSON array')
  })

  it('refuses when npm cannot be found instead of starting it by name', () => {
    const folder = tempDir('mr-candidate-npm-')
    expect(() => buildCommand({}, join(folder, 'node.exe'))).toThrow('npm was not found. Run this as npm run candidate.')
  })
})

describe('runCandidate', () => {
  it('refuses a dirty worktree before it builds', async () => {
    const { base, worktree } = makeLaneRepo()
    writeLanes(base, worktree)
    writeFileSync(join(worktree, 'notes.txt'), 'changed\n')
    const marker = join(base, 'built.txt')
    const port = await freePort()
    const command = [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'built')`]
    await expect(runCandidate({
      argv: ['lane', '--port', String(port)],
      cwd: base,
      env: buildEnv(command),
      log: () => {},
      error: () => {},
    })).rejects.toThrow('The lane has uncommitted changes. Commit them first.')
    expect(existsSync(marker)).toBe(false)
  })

  it('refuses a taken port before it reads the lane file', async () => {
    const base = tempDir('mr-candidate-empty-')
    const server = createServer()
    await new Promise((settle, fail) => {
      server.once('error', fail)
      server.listen(0, '127.0.0.1', settle)
    })
    const { port } = server.address()
    try {
      await expect(runCandidate({
        argv: ['lane', '--port', String(port)],
        cwd: base,
        env: buildEnv([process.execPath, '-e', 'process.exit(0)']),
        log: () => {},
        error: () => {},
      })).rejects.toThrow(`Port ${port} is in use. Pass --port.`)
    } finally {
      await new Promise((settle) => server.close(settle))
    }
  })

  it('checks the port again after the build and refuses one it lost meanwhile', async () => {
    const { base, worktree } = makeLaneRepo()
    writeLanes(base, worktree)
    const port = await freePort()
    const holder = join(base, 'holder.mjs')
    const starter = join(base, 'start-holder.mjs')
    const pidFile = join(base, 'holder.pid')
    writeFileSync(holder, [
      "import { createServer } from 'node:net'",
      'const server = createServer()',
      `server.listen(${port}, '127.0.0.1', () => process.stdout.write('held\\n'))`,
      'setInterval(() => {}, 1000)',
    ].join('\n'))
    writeFileSync(starter, [
      "import { spawn } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      "import { connect } from 'node:net'",
      `const child = spawn(process.execPath, [${JSON.stringify(holder)}], { detached: true, stdio: 'ignore', windowsHide: true })`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
      'child.unref()',
      'const deadline = Date.now() + 10000',
      'const poll = () => {',
      `  const socket = connect(${port}, '127.0.0.1')`,
      "  socket.once('connect', () => { socket.destroy(); process.exit(0) })",
      "  socket.once('error', () => { socket.destroy(); if (Date.now() > deadline) process.exit(1); setTimeout(poll, 50) })",
      '}',
      'poll()',
    ].join('\n'))
    const logged = []
    let child = null
    try {
      await expect(runCandidate({
        argv: ['lane', '--port', String(port)],
        cwd: base,
        env: buildEnv([process.execPath, starter]),
        log: (line) => logged.push(line),
        error: () => {},
        onChild: (started) => {
          child = started
        },
      })).rejects.toThrow(`Port ${port} is in use. Pass --port.`)
      expect(child).toBeNull()
      expect(logged).toEqual([])
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill()
      if (existsSync(pidFile)) killTree({ pid: Number(readFileSync(pidFile, 'utf8')) })
    }
  })

  it('keeps keys, tokens and secrets out of the environment it gives the lane', () => {
    const env = {
      PATH: '/usr/bin',
      Path: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      TEMP: '/tmp',
      MACHINEROOM_BUILD_COMMAND: '["node"]',
      OPENROUTER_API_KEY: 'fake',
      ANTHROPIC_API_KEY: 'fake',
      openai_apikey: 'fake',
      GITHUB_TOKEN: 'fake',
      GH_TOKEN: 'fake',
      AWS_SECRET: 'fake',
      DB_PASSWORD: 'fake',
      SSH_KEY: 'fake',
      MONKEY: 'kept',
      TOKENIZER_HOME: 'kept',
    }
    expect(Object.keys(laneEnv(env)).sort()).toEqual(['MACHINEROOM_BUILD_COMMAND', 'MONKEY', 'PATH', 'Path', 'SystemRoot', 'TEMP', 'TOKENIZER_HOME'])
  })

  it('builds the lane without the keys in the owner shell', async () => {
    const { base, worktree } = makeLaneRepo()
    writeLanes(base, worktree)
    const port = await freePort()
    const script = "console.log('key ' + (process.env.OPENROUTER_API_KEY ?? 'none') + ' token ' + (process.env.GITHUB_TOKEN ?? 'none')); process.exit(1)"
    const errors = []
    const code = await runCandidate({
      argv: ['lane', '--port', String(port)],
      cwd: base,
      env: { ...buildEnv([process.execPath, '-e', script]), OPENROUTER_API_KEY: 'sk-or-v1-fake', GITHUB_TOKEN: 'ghp-fake' },
      log: () => {},
      error: (line) => errors.push(line),
    })
    expect(code).toBe(1)
    expect(errors).toContain('key none token none')
  })

  it('prints the last 20 build lines and exits 1', async () => {
    const { base, worktree } = makeLaneRepo()
    writeLanes(base, worktree)
    const port = await freePort()
    const script = "for (let i = 1; i <= 25; i += 1) console.log('build line ' + i); process.exit(1)"
    const errors = []
    const code = await runCandidate({
      argv: ['lane', '--port', String(port)],
      cwd: base,
      env: buildEnv([process.execPath, '-e', script]),
      log: () => {},
      error: (line) => errors.push(line),
    })
    expect(code).toBe(1)
    const text = errors.join('\n')
    expect(text).toContain('The build failed.')
    expect(text).toContain('build line 6')
    expect(text).toContain('build line 25')
    expect(text).not.toContain('build line 5')
    expect(errors.filter((line) => line.startsWith('build line '))).toHaveLength(20)
  })

  it('starts the worktree room with the dist, the port and the flags that pass through', async () => {
    const { base, worktree } = makeLaneRepo()
    mkdirSync(join(worktree, 'bin'), { recursive: true })
    writeFileSync(join(worktree, 'bin', 'machine-room.mjs'), [
      'console.log(JSON.stringify(process.argv.slice(2)))',
      "console.log('machine-room: open http://127.0.0.1:1/')",
      'setInterval(() => {}, 1000)',
    ].join('\n'))
    git(worktree, ['add', 'bin/machine-room.mjs'])
    git(worktree, ['commit', '-m', 'fake room'])
    writeLanes(base, worktree)
    const sha = git(worktree, ['rev-parse', 'HEAD']).trim().slice(0, 7)
    const port = await freePort()
    const logged = []
    const errors = []
    let child = null
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const running = runCandidate({
      argv: [
        'lane',
        '--port', String(port),
        '--root', 'project',
      ],
      cwd: base,
      env: buildEnv([process.execPath, '-e', 'process.exit(0)']),
      log: (line) => logged.push(line),
      error: (line) => errors.push(line),
      stdio: 'pipe',
      onChild: (started) => {
        child = started
        waitForText(started, 'machine-room: open').then(resolveReady, rejectReady)
      },
    })
    running.catch(rejectReady)
    try {
      const output = await ready
      const argsLine = output.split(/\r?\n/).find((line) => line.startsWith('['))
      expect(JSON.parse(argsLine)).toEqual([
        '--dist', join(worktree, 'dist'),
        '--port', String(port),
        '--root', 'project',
      ])
      expect(logged).toContain(`Candidate from lane (feat/candidate at ${sha}) on http://127.0.0.1:${port}/?live&bridge=http://127.0.0.1:${port}. The stable room keeps its own port.`)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill()
      await running.catch(() => {})
    }
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(errors).toEqual([])
  }, 30000)
})
