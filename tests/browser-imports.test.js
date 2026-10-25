import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm

function importsOf(file) {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((match) => match[1])
}

function nodeImportsReached(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)
  const found = []
  for (const spec of importsOf(file)) {
    if (spec.startsWith('node:')) {
      found.push(`${relative(ROOT, file)} imports ${spec}`)
    } else if (spec.startsWith('.')) {
      found.push(...nodeImportsReached(resolve(dirname(file), spec), seen))
    }
  }
  return found
}

describe('the browser bundle', () => {
  it('reaches no Node module from the page entry', () => {
    expect(nodeImportsReached(join(ROOT, 'src', 'main.jsx'))).toEqual([])
  })
})
