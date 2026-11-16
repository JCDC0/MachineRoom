import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseAst } from 'rolldown/parseAst'
import { expect, test } from 'vitest'

const names = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'])
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return
  if (node.type) visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
function files(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    return entry.isDirectory() ? files(path) : /\.[cm]?js$/.test(entry.name) ? [path] : []
  })
}
function missingWindowsHide(path, source = readFileSync(path, 'utf8')) {
  const ast = parseAst(source)
  const imports = new Map()
  const objects = new Set()
  const declarations = new Map()
  const helpers = new Map()
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration' && ['child_process', 'node:child_process'].includes(node.source.value)) {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && names.has(specifier.imported.name)) imports.set(specifier.local.name, specifier.imported.name)
        else if (specifier.type !== 'ImportSpecifier') objects.add(specifier.local.name)
      }
    }
    if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') helpers.set(specifier.local.name, [resolve(dirname(path), node.source.value), specifier.imported.name])
      }
    }
    if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && node.init.callee.name === 'require' && ['child_process', 'node:child_process'].includes(node.init.arguments[0]?.value)) {
      if (node.id.type === 'Identifier') objects.add(node.id.name)
      if (node.id.type === 'ObjectPattern') for (const property of node.id.properties) {
        if (names.has(property.key.name)) imports.set(property.value.name, property.key.name)
      }
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      if (!declarations.has(node.id.name)) declarations.set(node.id.name, [])
      declarations.get(node.id.name).push(node.init)
    }
  })
  function hidden(node, seen = new Set()) {
    if (!node) return false
    if (node.type === 'Identifier' && !seen.has(node.name)) {
      const values = declarations.get(node.name) ?? []
      return values.length > 0 && values.every((value) => hidden(value, new Set([...seen, node.name])))
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && helpers.has(node.callee.name)) {
      const [file, name] = helpers.get(node.callee.name)
      const key = `${file}:${name}`
      if (seen.has(key)) return false
      const helperAst = parseAst(readFileSync(file, 'utf8'))
      let returns = []
      walk(helperAst, (part) => {
        if (part.type === 'FunctionDeclaration' && part.id?.name === name) {
          walk(part.body, (item) => { if (item.type === 'ReturnStatement') returns.push(item.argument) })
        }
      })
      return returns.length > 0 && returns.every((value) => hidden(value, new Set([...seen, key])))
    }
    if (node.type === 'ConditionalExpression') return hidden(node.consequent, seen) && hidden(node.alternate, seen)
    if (node.type !== 'ObjectExpression') return false
    let result = false
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        if (property.argument.type === 'CallExpression' && property.argument.callee.name === 'treeSpawnOptions') {
          const [file, name] = helpers.get('treeSpawnOptions') ?? []
          const helperAst = file && parseAst(readFileSync(file, 'utf8'))
          let definition
          walk(helperAst, (part) => { if (part.type === 'FunctionDeclaration' && part.id?.name === name) definition = part })
          let mayOverride = false
          walk(definition, (part) => { if (part.type === 'SpreadElement' || (part.type === 'Property' && (part.key.name ?? part.key.value) === 'windowsHide')) mayOverride = true })
          if (!definition || mayOverride) result = hidden(property.argument, seen)
        } else if (property.argument.type === 'MemberExpression' && property.argument.object.name === 'command' && property.argument.property.name === 'options') {
          const definition = (declarations.get('command') ?? [])[0]
          const functionName = definition?.callee?.name
          let helper
          walk(ast, (part) => { if (part.type === 'FunctionDeclaration' && part.id?.name === functionName) helper = part })
          let mayOverride = false
          walk(helper, (part) => { if (part.type === 'SpreadElement' || (part.type === 'Property' && (part.key.name ?? part.key.value) === 'windowsHide')) mayOverride = true })
          if (!helper || mayOverride) result = false
        } else result = hidden(property.argument, seen)
      }
      else if ((property.key.name ?? property.key.value) === 'windowsHide') result = property.value.type === 'Literal' && property.value.value === true
    }
    return result
  }
  const failures = []
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    const name = callee.type === 'Identifier' ? imports.get(callee.name)
      : callee.type === 'MemberExpression' && objects.has(callee.object.name) ? callee.property.name : null
    if (!names.has(name)) return
    const callback = ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.arguments[2]?.type)
    const position = name === 'exec' || name === 'execSync' ? 1 : node.arguments[1]?.type === 'ArrayExpression' || (node.arguments.length >= 3 && !callback) ? 2 : 1
    const options = hidden(node.arguments[position])
    if (!options) failures.push(`${path}:${source.slice(0, node.start).split('\n').length}`)
  })
  return failures
}

test('child process calls hide Windows consoles', () => {
  expect(['server', 'scripts', 'bin'].flatMap(files).flatMap((path) => missingWindowsHide(path))).toEqual([])
})

test('audit finds missing and overridden options without matching unrelated calls', () => {
  const source = `import { spawn as run } from 'node:child_process'
    run('x', [])
    run('x', [], { windowsHide: true })
    run('x', [], { windowsHide: false })
    ;/x/.exec('x')`
  expect(missingWindowsHide('example.js', source)).toEqual(['example.js:2', 'example.js:4'])
})

test('spawnSync defaults to hidden and preserves false', () => {
  const helper = new URL('./helpers/hide-windows.mjs', import.meta.url).href
  const code = `import cp from 'node:child_process'; cp.spawnSync = (...args) => console.log(JSON.stringify(args)); await import(${JSON.stringify(helper)}); const { spawnSync } = await import('node:child_process'); spawnSync('x'); spawnSync('x', [], { windowsHide: false });`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } })
  expect(result.status).toBe(0)
  const lines = result.stdout.trim().split('\n').map(JSON.parse)
  expect(lines[0][1].windowsHide).toBe(true)
  expect(lines[1][2].windowsHide).toBe(false)
})
