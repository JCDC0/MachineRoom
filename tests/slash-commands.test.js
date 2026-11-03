import { mkdirSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SLASH_COMMAND_LIMIT,
  createOrchestrator,
  commandDescription,
  expandSlashCommand,
  scanSlashCommands,
} from '../server/orchestrator.js'
import { createOrchestrators } from '../server/orchestrators.js'
import {
  commandKeyAction,
  commandPickText,
  commandQuery,
  filterCommands,
  nextCommandIndex,
  parseRoomCommand,
} from '../src/ui/slashCommands.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      fn()
    } catch {}
  }
})

function temp(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

function fakeHarness() {
  const base = temp('mr-slash-')
  const project = join(base, 'project')
  const home = join(base, 'home')
  mkdirSync(project, { recursive: true })
  mkdirSync(home, { recursive: true })
  write(
    join(project, '.claude', 'commands', 'hello.md'),
    ['---', 'description: Say hello and stop.', '---', 'Say hello to $ARGUMENTS and stop.', ''].join('\n')
  )
  write(
    join(project, '.claude', 'commands', 'pair.md'),
    ['---', 'description: "Pair two things."', '---', 'Pair $1 with $2.'].join('\n')
  )
  write(
    join(project, '.claude', 'commands', 'team', 'review.md'),
    ['---', 'description: >', '  Review the branch and', '  report back.', '---', 'Review $ARGUMENTS.'].join('\n')
  )
  write(join(project, '.claude', 'skills', 'style', 'NOTES.md'), ['---', 'description: Not the skill.', '---', 'Notes body.'].join('\n'))
  write(
    join(project, '.claude', 'skills', 'style', 'SKILL.md'),
    ['---', 'description: Keep the house style.', '---', 'Follow the style guide.'].join('\n')
  )
  write(
    join(home, '.claude', 'commands', 'home.md'),
    ['---', 'description: A command from the user folder.', '---', 'Home body.'].join('\n')
  )
  return { base, project, home }
}

function fakeOpencodeHarness() {
  const base = temp('mr-slash-opencode-')
  const project = join(base, 'project')
  const home = join(base, 'home')
  mkdirSync(project, { recursive: true })
  mkdirSync(home, { recursive: true })
  write(join(project, '.opencode', 'command', 'go.md'), '---\ndescription: Go now.\n---\nGo $ARGUMENTS.\n')
  write(join(project, '.opencode', 'skills', 'notes', 'SKILL.md'), '---\ndescription: Notes skill.\n---\nNote it.\n')
  write(join(project, '.claude', 'skills', 'compat', 'SKILL.md'), '---\ndescription: Claude compat.\n---\nCompat.\n')
  write(join(project, '.agents', 'skills', 'extra', 'SKILL.md'), '---\ndescription: Agents folder.\n---\nExtra.\n')
  write(join(home, '.config', 'opencode', 'command', 'user.md'), '---\ndescription: User command.\n---\nUser body.\n')
  return { base, project, home }
}

describe('the slash query', () => {
  it('opens only for a draft that starts with a slash and has no space', () => {
    expect(commandQuery('/')).toBe('')
    expect(commandQuery('/co')).toBe('co')
    expect(commandQuery('/compact')).toBe('compact')
    expect(commandQuery('/compact keep')).toBeNull()
    expect(commandQuery(' /co')).toBeNull()
    expect(commandQuery('hello /co')).toBeNull()
    expect(commandQuery('')).toBeNull()
    expect(commandQuery(null)).toBeNull()
  })
})

describe('the command filter', () => {
  const commands = [
    { name: 'compact', description: 'Summarize the conversation.', source: 'room' },
    { name: 'clear', description: 'Start a new conversation.', source: 'room' },
    { name: 'hello', description: 'Say hello.', source: 'command' },
    { name: 'review', description: 'Review the branch and the cost.', source: 'command' },
    { name: 'style', description: 'Keep the house style.', source: 'skill' },
    { name: '/bad name', description: 'Not a command.', source: 'command' },
    { name: '', description: 'Missing a name.', source: 'command' },
    null,
  ]

  it('keeps the bridge order for an empty query', () => {
    expect(filterCommands(commands, '').map((entry) => entry.name)).toEqual([
      'compact',
      'clear',
      'hello',
      'review',
      'style',
    ])
  })

  it('puts names that start with the query first, then names that hold it, then descriptions', () => {
    expect(filterCommands(commands, 'co').map((entry) => entry.name)).toEqual(['compact', 'clear', 'review'])
    expect(filterCommands(commands, 'rev').map((entry) => entry.name)).toEqual(['review'])
    expect(filterCommands(commands, 'cost').map((entry) => entry.name)).toEqual(['review'])
    expect(filterCommands(commands, 'zzz')).toEqual([])
  })

  it('is case blind and cuts to the limit', () => {
    expect(filterCommands(commands, 'HELLO').map((entry) => entry.name)).toEqual(['hello'])
    expect(filterCommands(commands, '', 2).map((entry) => entry.name)).toEqual(['compact', 'clear'])
  })

  it('cleans the description and the source', () => {
    const rows = filterCommands(
      [{ name: 'one', description: '  Two\nlines  ', source: 'odd' }],
      ''
    )
    expect(rows).toEqual([{ name: 'one', description: 'Two lines', source: 'command' }])
  })
})

describe('the list selection', () => {
  it('wraps in both directions', () => {
    expect(nextCommandIndex(0, 3, 1)).toBe(1)
    expect(nextCommandIndex(2, 3, 1)).toBe(0)
    expect(nextCommandIndex(0, 3, -1)).toBe(2)
    expect(nextCommandIndex(0, 0, 1)).toBe(0)
  })

  it('builds the picked draft with a trailing space', () => {
    expect(commandPickText('hello')).toBe('/hello ')
    expect(commandPickText('/hello')).toBe('/hello ')
    expect(commandPickText('bad name')).toBe('')
  })
})

describe('the list keys', () => {
  const items = [{ name: 'compact' }, { name: 'new' }, { name: 'hello' }]

  it('moves with the arrow keys and wraps', () => {
    expect(commandKeyAction({ key: 'ArrowDown' }, { items, index: 0, draft: '/' })).toEqual({ type: 'move', index: 1 })
    expect(commandKeyAction({ key: 'ArrowDown' }, { items, index: 2, draft: '/' })).toEqual({ type: 'move', index: 0 })
    expect(commandKeyAction({ key: 'ArrowUp' }, { items, index: 0, draft: '/' })).toEqual({ type: 'move', index: 2 })
  })

  it('closes only the list on Escape', () => {
    expect(commandKeyAction({ key: 'Escape' }, { items, index: 1, draft: '/new' })).toEqual({ type: 'close' })
  })

  it('picks with Tab and with Enter while the name is incomplete', () => {
    expect(commandKeyAction({ key: 'Tab' }, { items, index: 1, draft: '/co' })).toEqual({ type: 'pick', index: 1 })
    expect(commandKeyAction({ key: 'Enter' }, { items, index: 0, draft: '/co' })).toEqual({ type: 'pick', index: 0 })
    expect(commandKeyAction({ key: 'Tab' }, { items, index: 9, draft: '/co' })).toEqual({ type: 'pick', index: 2 })
  })

  it('sends when the draft is already the whole name', () => {
    expect(commandKeyAction({ key: 'Enter' }, { items, index: 2, draft: '/hello' })).toEqual({ type: 'send' })
    expect(commandKeyAction({ key: 'Enter' }, { items, index: 1, draft: ' /new ' })).toEqual({ type: 'send' })
  })

  it('leaves modified keys and an empty list to the textarea', () => {
    expect(commandKeyAction({ key: 'Enter', shiftKey: true }, { items, index: 0, draft: '/co' })).toEqual({ type: 'none' })
    expect(commandKeyAction({ key: 'Tab', ctrlKey: true }, { items, index: 0, draft: '/co' })).toEqual({ type: 'none' })
    expect(commandKeyAction({ key: 'Enter' }, { items: [], index: 0, draft: '/co' })).toEqual({ type: 'none' })
    expect(commandKeyAction({ key: 'a' }, { items, index: 0, draft: '/co' })).toEqual({ type: 'none' })
  })
})

describe('the room command parse', () => {
  it('reads compact with its keep text', () => {
    expect(parseRoomCommand('/compact')).toEqual({ kind: 'compact', keep: '' })
    expect(parseRoomCommand('/compact keep the plan')).toEqual({ kind: 'compact', keep: 'keep the plan' })
    expect(parseRoomCommand('  /COMPACT   two  spaces  ')).toEqual({ kind: 'compact', keep: 'two  spaces' })
  })

  it('reads new and clear as one new conversation', () => {
    expect(parseRoomCommand('/new')).toEqual({ kind: 'new' })
    expect(parseRoomCommand('/clear')).toEqual({ kind: 'new' })
  })

  it('reads stop and help', () => {
    expect(parseRoomCommand('/stop')).toEqual({ kind: 'stop' })
    expect(parseRoomCommand('/help')).toEqual({ kind: 'help' })
    expect(parseRoomCommand('/help me')).toEqual({ kind: 'help' })
  })

  it('leaves every other draft alone', () => {
    expect(parseRoomCommand('/hello')).toBeNull()
    expect(parseRoomCommand('hello')).toBeNull()
    expect(parseRoomCommand('/')).toBeNull()
    expect(parseRoomCommand('/compact-all')).toBeNull()
    expect(parseRoomCommand(null)).toBeNull()
  })
})

describe('the command scan', () => {
  it('lists the room commands, the project commands and the user commands without their bodies', () => {
    const { project, home } = fakeHarness()
    const found = scanSlashCommands({ harness: 'claude', projectRoot: project, home })
    const names = found.map((entry) => entry.name)
    expect(names).toEqual(['compact', 'clear', 'help', 'new', 'stop', 'hello', 'home', 'pair', 'style', 'team:review'])
    expect(found.find((entry) => entry.name === 'hello')).toMatchObject({
      description: 'Say hello and stop.',
      source: 'command',
    })
    expect(found.find((entry) => entry.name === 'pair').description).toBe('Pair two things.')
    expect(found.find((entry) => entry.name === 'team:review').description).toBe('Review the branch and report back.')
    expect(found.find((entry) => entry.name === 'style').source).toBe('skill')
    expect(found.find((entry) => entry.name === 'style').description).toBe('Keep the house style.')
    expect(found.find((entry) => entry.name === 'compact').source).toBe('room')
    const json = JSON.stringify(found)
    expect(json).not.toContain('Say hello to')
    expect(json).not.toContain('Follow the style guide')
  })

  it('keeps the project over the user for the same name', () => {
    const { project, home } = fakeHarness()
    write(join(project, '.claude', 'commands', 'home.md'), '---\ndescription: Project wins.\n---\nBody.\n')
    const found = scanSlashCommands({ harness: 'claude', projectRoot: project, home })
    expect(found.filter((entry) => entry.name === 'home')).toHaveLength(1)
    expect(found.find((entry) => entry.name === 'home').description).toBe('Project wins.')
  })

  it('scans the OpenCode folders and its compatibility skill folders', () => {
    const { project, home } = fakeOpencodeHarness()
    const found = scanSlashCommands({ harness: 'opencode', projectRoot: project, home })
    const names = found.map((entry) => entry.name)
    expect(names).toEqual(['compact', 'clear', 'help', 'new', 'stop', 'compat', 'extra', 'go', 'notes', 'user'])
    expect(found.find((entry) => entry.name === 'go').source).toBe('command')
    expect(found.find((entry) => entry.name === 'notes').source).toBe('skill')
    expect(names).not.toContain('hello')
  })

  it('cuts to the limit', () => {
    const { project, home } = fakeHarness()
    expect(scanSlashCommands({ harness: 'claude', projectRoot: project, home, limit: 3 })).toHaveLength(3)
    expect(SLASH_COMMAND_LIMIT).toBe(200)
  })

  it('reads a frontmatter description and nothing else', () => {
    expect(commandDescription('---\ndescription: One line.\n---\nbody')).toBe('One line.')
    expect(commandDescription('---\ndescription: "Quoted."\nother: 1\n---\n')).toBe('Quoted.')
    expect(commandDescription('no frontmatter')).toBe('')
    expect(commandDescription('---\ntitle: x\n---\n')).toBe('')
  })
})

describe('the command expansion', () => {
  const entries = [
    { name: 'hello', description: '', source: 'command', file: 'hello.md' },
    { name: 'pair', description: '', source: 'command', file: 'pair.md' },
    { name: 'plain', description: '', source: 'command', file: 'plain.md' },
    { name: 'compact', description: '', source: 'room' },
  ]
  const bodies = {
    'hello.md': '---\ndescription: Say hello.\n---\nSay hello to $ARGUMENTS and stop.',
    'pair.md': 'Pair $1 with $2 and keep $3.',
    'plain.md': 'Do the thing.',
  }
  const read = (file) => bodies[file] ?? ''

  it('fills $ARGUMENTS and the positions', () => {
    expect(expandSlashCommand('/hello Ada', entries, read)).toBe('Say hello to Ada and stop.')
    expect(expandSlashCommand('/pair one two', entries, read)).toBe('Pair one with two and keep .')
    expect(expandSlashCommand('/pair one two three', entries, read)).toBe('Pair one with two and keep three.')
  })

  it('appends the arguments when the body does not name them', () => {
    expect(expandSlashCommand('/plain now', entries, read)).toBe('Do the thing.\n\nARGUMENTS: now')
    expect(expandSlashCommand('/plain', entries, read)).toBe('Do the thing.')
  })

  it('sends an unknown command as plain text', () => {
    expect(expandSlashCommand('/nope now', entries, read)).toBe('/nope now')
    expect(expandSlashCommand('/compact', entries, read)).toBe('/compact')
    expect(expandSlashCommand('hello', entries, read)).toBe('hello')
  })

  it('works against a real scanned skill', () => {
    const { project, home } = fakeHarness()
    const found = scanSlashCommands({ harness: 'claude', projectRoot: project, home })
    expect(expandSlashCommand('/style now', found)).toBe('Follow the style guide.\n\nARGUMENTS: now')
  })
})

describe('the command expansion on a turn', () => {
  function fakeSpawn(captured, harness) {
    return (file, args) => {
      captured.push({ file, args })
      const child = new EventEmitter()
      child.pid = 0
      child.kill = () => {}
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      setImmediate(() => {
        const line =
          harness === 'opencode'
            ? { type: 'text', part: { text: 'ok' } }
            : { type: 'result', subtype: 'success', result: 'ok' }
        child.stdout.write(`${JSON.stringify(line)}\n`)
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0)
      })
      return child
    }
  }

  function turn(harness, text) {
    const { project, home } = fakeHarness()
    if (harness === 'opencode') {
      write(
        join(project, '.opencode', 'command', 'hello.md'),
        ['---', 'description: Say hello and stop.', '---', 'Say hello to $ARGUMENTS and stop.'].join('\n')
      )
    }
    const captured = []
    const instance = createOrchestrator({
      harness,
      model: harness === 'opencode' ? 'opencode-go/deepseek-v4.1-flash' : 'opus',
      projectRoot: project,
      runsFolder: join(project, '..', `runs-${harness}`),
      home,
      spawn: fakeSpawn(captured, harness),
      now: () => Date.parse('2026-11-03T12:00:00.000Z'),
    })
    cleanups.push(() => instance.close())
    instance.send({ text, confirmed: true })
    return captured
  }

  it('sends the expanded command to Claude Code', () => {
    const captured = turn('claude', '/hello Ada')
    expect(captured).toHaveLength(1)
    const index = captured[0].args.indexOf('-p')
    expect(index).toBeGreaterThan(-1)
    expect(captured[0].args[index + 1]).toBe('Say hello to Ada and stop.')
  })

  it('sends the expanded command to OpenCode as plain text', () => {
    const captured = turn('opencode', '/hello Ada')
    expect(captured).toHaveLength(1)
    expect(captured[0].args.at(-1)).toContain('Say hello to Ada and stop.')
  })

  it('sends an unknown command unchanged', () => {
    const captured = turn('claude', '/nope Ada')
    const index = captured[0].args.indexOf('-p')
    expect(captured[0].args[index + 1]).toBe('/nope Ada')
  })
})

describe('the commands route', () => {
  function rig() {
    const { project, home } = fakeHarness()
    const runs = join(project, '..', 'runs')
    mkdirSync(runs, { recursive: true })
    const sent = []
    const registry = createOrchestrators({
      projectRoot: project,
      runsFolder: runs,
      home,
      lanes: { orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: 'claude', model: 'opus' } } },
      spawn: () => {
        throw new Error('the route must not start a turn')
      },
      sendJson: (req, res, status, body) => sent.push({ status, body }),
      readJsonBody: async () => null,
    })
    cleanups.push(() => registry.close())
    return { project, registry, sent }
  }

  it('answers the command list without starting a turn', async () => {
    const { registry, sent } = rig()
    const handled = await registry.handle(
      { method: 'GET', headers: {} },
      {},
      new URL('http://127.0.0.1/api/orchestrator/commands')
    )
    expect(handled).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(200)
    const commands = sent[0].body.commands
    expect(commands[0]).toEqual({ name: 'compact', description: expect.any(String), source: 'room' })
    expect(commands.some((entry) => entry.name === 'hello' && entry.source === 'command')).toBe(true)
    for (const entry of commands) expect(Object.keys(entry).sort()).toEqual(['description', 'name', 'source'])
  })

  it('answers 404 for an unknown orchestrator', async () => {
    const { registry, sent } = rig()
    const handled = await registry.handle(
      { method: 'GET', headers: {} },
      {},
      new URL('http://127.0.0.1/api/orchestrator/commands?id=frontend')
    )
    expect(handled).toBe(true)
    expect(sent[0].status).toBe(404)
  })

  it('refuses a write', async () => {
    const { registry, sent } = rig()
    const handled = await registry.handle(
      { method: 'POST', headers: {} },
      {},
      new URL('http://127.0.0.1/api/orchestrator/commands')
    )
    expect(handled).toBe(true)
    expect(sent[0].status).toBe(405)
  })

  it('is on the orchestrator the list names', () => {
    const { project, home } = fakeHarness()
    const instance = createOrchestrator({
      projectRoot: project,
      runsFolder: join(project, '..', 'single-runs'),
      home,
      lanes: { orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: 'claude', model: 'opus' } } },
      spawn: () => {
        throw new Error('no turn')
      },
    })
    cleanups.push(() => instance.close())
    expect(instance.commands().some((entry) => entry.name === 'hello')).toBe(true)
  })
})
