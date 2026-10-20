#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = 'bin/machine-room.mjs'
const PACK_TIME_LIMIT_MS = 60000

function toPosix(path) {
  return path.split(sep).join('/')
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function importSpecifiers(text) {
  const specifiers = []
  const pattern = /^\s*import\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/gm
  let match
  while ((match = pattern.exec(text)) !== null) specifiers.push(match[1])
  return specifiers
}

function resolveImport(fromFolder, specifier) {
  const base = resolve(fromFolder, specifier)
  const candidates = [base, `${base}.js`, join(base, 'index.js')]
  for (const candidate of candidates) if (isFile(candidate)) return candidate
  return null
}

export function walkImports(entry = ENTRY, root = process.cwd()) {
  const files = new Set()
  const missing = new Set()
  const seen = new Set()

  function visit(path) {
    const full = resolve(root, path)
    if (seen.has(full)) return
    seen.add(full)
    let text
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      missing.add(toPosix(relative(root, full)))
      return
    }
    files.add(toPosix(relative(root, full)))
    for (const specifier of importSpecifiers(text)) {
      if (!specifier.startsWith('.')) continue
      const target = resolveImport(dirname(full), specifier)
      if (target === null) {
        missing.add(toPosix(relative(root, resolve(dirname(full), specifier))))
        continue
      }
      visit(target)
    }
  }

  visit(entry)
  return { files: [...files].sort(), missing: [...missing].sort() }
}

export function isForbidden(path) {
  const clean = toPosix(path).replace(/^\.\//, '')
  const parts = clean.split('/')
  const name = parts[parts.length - 1]
  if (name === '.env') return true
  if (name.startsWith('.env.') && name !== '.env.example') return true
  if (/\.log$/i.test(name)) return true
  if (clean === 'tests' || clean.startsWith('tests/')) return true
  if (clean === 'public/recordings' || clean.startsWith('public/recordings/')) return true
  if (clean === 'dist/recordings' || clean.startsWith('dist/recordings/')) return true
  if (parts.includes('node_modules')) return true
  if (parts.includes('.git')) return true
  return false
}

export function findPackProblems({ packed = [], imports = [], missing = [] } = {}) {
  const packedSet = new Set(packed.map((path) => toPosix(path)))
  const missingSet = new Set(missing)
  const problems = []
  for (const path of [...missingSet].sort()) {
    problems.push(`bin/machine-room.mjs imports ${path}, but that file is not on disk.`)
  }
  for (const path of [...imports].sort()) {
    if (!packedSet.has(path) && !missingSet.has(path)) {
      problems.push(`The pack list leaves out ${path}, which bin/machine-room.mjs imports.`)
    }
  }
  for (const path of [...packedSet].sort()) {
    if (isForbidden(path)) problems.push(`The pack list holds ${path}, which must not ship.`)
  }
  return problems
}

export function readPackReport(stdout) {
  const parsed = JSON.parse(stdout)
  const entry = Array.isArray(parsed) ? parsed[0] : null
  if (!entry || !Array.isArray(entry.files)) throw new Error('npm pack gave no file list.')
  return {
    files: entry.files.map((file) => toPosix(file.path)),
    count: Number.isInteger(entry.entryCount) ? entry.entryCount : entry.files.length,
    size: Number.isFinite(entry.size) ? entry.size : 0,
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function npmCliPath() {
  const fromEnv = process.env.npm_execpath
  if (fromEnv && fromEnv.endsWith('.js') && existsSync(fromEnv)) return fromEnv
  const besideNode = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(besideNode)) return besideNode
  return null
}

export function runPack(root = ROOT, timeoutMs = PACK_TIME_LIMIT_MS) {
  const npmCli = npmCliPath()
  const options = {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  }
  if (npmCli) {
    return spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], options)
  }
  return spawnSync('npm', ['pack', '--dry-run', '--json'], { ...options, shell: process.platform === 'win32' })
}

export function packCheck(root = ROOT) {
  const result = runPack(root)
  if (result.error || result.status !== 0) {
    return { code: 1, lines: ['npm pack did not finish.'] }
  }
  let report
  try {
    report = readPackReport(result.stdout)
  } catch {
    return { code: 1, lines: ['npm pack gave no file list.'] }
  }
  const walked = walkImports(ENTRY, root)
  const problems = findPackProblems({
    packed: report.files,
    imports: walked.files,
    missing: walked.missing,
  })
  if (problems.length > 0) return { code: 1, lines: problems }
  return {
    code: 0,
    lines: [`Pack check passed: ${report.count} files, ${formatSize(report.size)} packed.`],
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = packCheck(ROOT)
  const write = result.code === 0 ? console.log : console.error
  for (const line of result.lines) write(line)
  process.exitCode = result.code
}
