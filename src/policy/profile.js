const CHANGELOG_PATH = 'docs/agents/CHANGELOG.md'
const SECRET_PATHS = ['server/index.js', 'src/assistant/intent.js', 'src/assistant/actions.js', '.env.example']
const DEPLOY_PATHS = ['package.json', '.gitignore']
const DEPLOY_FOLDERS = ['.github/']
const DATA_FOLDERS = ['public/fixtures/', 'public/recordings/']
const FILES_MARKER = /\bFiles:/
const PATH_END = /\.(js|mjs|jsx|json|css|md|txt|yml|yaml|html)$/

function textOf(brief) {
  return brief !== null && typeof brief === 'object' && typeof brief.text === 'string' ? brief.text : ''
}

function isPath(token) {
  if (token === '' || /\s/.test(token)) return false
  return token.includes('/') || token.startsWith('.') || PATH_END.test(token)
}

function backticked(text) {
  const found = []
  const pattern = /`([^`\n]+)`/g
  let match = pattern.exec(text)
  while (match !== null) {
    found.push(match[1].trim())
    match = pattern.exec(text)
  }
  return found
}

function pathsIn(text) {
  return [...new Set(backticked(text).filter(isPath))]
}

function listedIn(text) {
  const marker = FILES_MARKER.exec(text)
  if (!marker) return []
  return pathsIn(text.slice(marker.index + marker[0].length))
}

function namesTest(text, paths) {
  if (/\bTests in\b/.test(text)) return true
  return paths.some((path) => path.startsWith('tests/'))
}

function isReversible(text) {
  return !/needs the owner's yes|\bspends\b/i.test(text)
}

function touchesAny(paths, exact, folders) {
  return paths.some((path) => exact.includes(path) || folders.some((folder) => path.startsWith(folder)))
}

export function profileFromBrief(brief) {
  const text = textOf(brief)
  const paths = pathsIn(text)
  const listed = listedIn(text)
  const files = listed.filter((path) => path !== CHANGELOG_PATH && !path.startsWith('tests/'))
  const hasTests = namesTest(text, paths)
  const design =
    Array.isArray(brief?.owners) && brief.owners.includes('agy') && /\bby eye\b/i.test(text)
  return {
    files: files.length,
    hasTests,
    newTest: /\ba new\s+`tests\//.test(text),
    clarity: files.length > 0 && hasTests ? 'clear' : 'unclear',
    reversible: isReversible(text),
    touchesSecrets: touchesAny(listed, SECRET_PATHS, []),
    touchesDeploy: touchesAny(listed, DEPLOY_PATHS, DEPLOY_FOLDERS),
    touchesData: touchesAny(listed, [], DATA_FOLDERS),
    kind: design ? 'design' : 'change',
  }
}
