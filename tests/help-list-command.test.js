import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getHarnessModels, parseHelpForListCommand } from '../server/harness-models.js'
import { MODELS } from '../server/model-list.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      fn()
    } catch {}
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

const CODEX_HELP = [
  'Codex CLI',
  '',
  'Usage: codex [options] [PROMPT]',
  '',
  'Options:',
  '  -m, --model <MODEL>',
  '          Model the agent should use',
  '  -c, --config <key=value>     Override a configuration value.',
  '  --full-auto                  Run without approval prompts.',
  '',
  'Run codex model to change the model for later runs.',
].join('\n')

describe('parseHelpForListCommand', () => {
  it('reads no list command from Codex help that only mentions the model option', () => {
    expect(parseHelpForListCommand(CODEX_HELP)).toBeNull()
  })

  it('reads the indented subcommand line and ignores a sentence', () => {
    const help = [
      'Options:',
      '  -m, --model <MODEL>   The model to use.',
      '',
      'Commands:',
      '  models     List models',
      '',
      'Run model list to see the same list.',
    ].join('\n')

    expect(parseHelpForListCommand(help)).toEqual(['models'])
  })
})

describe('a harness with no list command', () => {
  it('answers its static models and no error', async () => {
    const runs = tempDir('runs-')
    const binDir = tempDir('bin-')
    const script = join(binDir, 'fake-codex.mjs')
    writeFileSync(script, [
      `const help = ${JSON.stringify(CODEX_HELP)}`,
      'if (process.argv[2] === "--help") {',
      '  console.log(help)',
      '  process.exit(0)',
      '}',
      'console.error("The command does not exist.")',
      'process.exit(1)',
    ].join('\n'), 'utf8')

    const lanes = { codex: { cli: { harness: 'codex', bin: script } } }
    const result = await getHarnessModels('codex', { runsFolder: runs, lanes })

    expect(result.source).toBe('list')
    expect(result.error).toBeUndefined()
    const expected = MODELS.filter((model) => model.harness === 'codex').map(({ id, label }) => ({ id, label }))
    expect(result.models).toEqual(expected)
  })
})
