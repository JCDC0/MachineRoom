import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'vite'
import { describe, expect, it } from 'vitest'

const UI_DIR = fileURLToPath(new URL('../src/ui/', import.meta.url))
const GLOBAL_SETTERS = new Set(['setTimeout', 'setInterval', 'setImmediate'])

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (typeof node.type === 'string') visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    if (value && typeof value === 'object') walk(value, visit)
  }
}

function addPattern(pattern, names) {
  if (!pattern || typeof pattern !== 'object') return
  if (pattern.type === 'Identifier') {
    names.add(pattern.name)
    return
  }
  if (pattern.type === 'ArrayPattern') {
    for (const item of pattern.elements ?? []) addPattern(item, names)
    return
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties ?? []) {
      addPattern(property.type === 'RestElement' ? property.argument : property.value, names)
    }
    return
  }
  if (pattern.type === 'AssignmentPattern') {
    addPattern(pattern.left, names)
    return
  }
  if (pattern.type === 'RestElement') addPattern(pattern.argument, names)
}

function declaredNames(ast) {
  const names = new Set()
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers ?? []) names.add(specifier.local.name)
    }
    if (node.type === 'VariableDeclarator') addPattern(node.id, names)
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      if (node.id) names.add(node.id.name)
    }
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      for (const param of node.params ?? []) addPattern(param, names)
    }
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id) {
      names.add(node.id.name)
    }
    if (node.type === 'CatchClause') addPattern(node.param, names)
  })
  return names
}

function lineAt(source, start) {
  return source.slice(0, start).split('\n').length
}

function undefinedSetters(source) {
  const ast = parseAst(source, { lang: 'jsx' })
  const declared = declaredNames(ast)
  const found = []
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return
    if (!node.callee || node.callee.type !== 'Identifier') return
    const name = node.callee.name
    if (!/^set[A-Z]/.test(name)) return
    if (declared.has(name) || GLOBAL_SETTERS.has(name)) return
    found.push({ name, line: lineAt(source, node.start) })
  })
  return found
}

const OLD_DELIVER = [
  'function deliver(text) {',
  '  setSending(true)',
  '  setProblems([])',
  '}',
  '',
  'const [sending, setSending] = useState(false)',
].join('\n')

describe('undefined names', () => {
  it('finds the leftover setProblems call from the old deliver function', () => {
    expect(undefinedSetters(OLD_DELIVER)).toEqual([{ name: 'setProblems', line: 3 }])
  })

  it('accepts a declared setter and ignores a method with a setter name', () => {
    const source = [
      'const [width, setWidth] = useState(0)',
      'setWidth(2)',
      'const box = {}',
      'box.setWidth(3)',
    ].join('\n')
    expect(undefinedSetters(source)).toEqual([])
  })

  it('finds no undeclared setter call in src/ui/*.jsx', () => {
    const files = readdirSync(UI_DIR)
      .filter((name) => name.endsWith('.jsx'))
      .sort()
    expect(files.length).toBeGreaterThan(0)
    const problems = []
    for (const file of files) {
      const source = readFileSync(join(UI_DIR, file), 'utf8')
      for (const problem of undefinedSetters(source)) {
        problems.push(`${file}:${problem.line} ${problem.name} is not declared or imported`)
      }
    }
    expect(problems).toEqual([])
  })
})
