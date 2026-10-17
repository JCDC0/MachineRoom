import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrames, prepare } from '../src/model/source.js'

const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fixtures')

export function loadRecording() {
  const frames = parseFrames(readFileSync(join(folder, 'sandbox-run.jsonl'), 'utf8'))
  const agentsFile = JSON.parse(readFileSync(join(folder, 'agents.json'), 'utf8'))
  const treeFile = JSON.parse(readFileSync(join(folder, 'sandbox-tree.json'), 'utf8'))
  return prepare({ frames, agentsFile, treeFile })
}

export function loadScenario(name) {
  const frames = parseFrames(readFileSync(join(folder, `${name}-run.jsonl`), 'utf8'))
  const agentsFile = JSON.parse(readFileSync(join(folder, `${name}-agents.json`), 'utf8'))
  const treeFile = JSON.parse(readFileSync(join(folder, `${name}-tree.json`), 'utf8'))
  return prepare({ frames, agentsFile, treeFile })
}

export function testContext() {
  const files = ['docs/notes.md', 'package.json', 'src/math.js', 'src/strings.js', 'test/math.test.js']
  const dirs = ['', 'docs', 'src', 'test']
  return { rootName: 'agent-sandbox', files, dirs }
}
