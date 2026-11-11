const CHANGELOG_PATH = 'docs/agents/CHANGELOG.md'
const SECRET_PATHS = ['server/index.js', 'src/assistant/intent.js', 'src/assistant/actions.js', '.env.example']
const DEPLOY_PATHS = ['package.json', '.gitignore']
const DEPLOY_FOLDERS = ['.github/']
const DATA_FOLDERS = ['public/fixtures/', 'public/recordings/']
const FILES_MARKER = /\bFiles:/
const PATH_END = /\.(js|mjs|jsx|json|css|md|txt|yml|yaml|html)$/
const BARE_SPLIT = /[\s,;()[\]{}<>"']+/
const BARE_START = /^[()[\]{}<>"']+/
const BARE_END = /[.,;:!?()[\]{}<>"']+$/
const SMALL_TEXT = 300
const MEDIUM_TEXT = 1500
const SMALL_PATHS = 2
const MEDIUM_PATHS = 6

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

function bareIn(text) {
  const plain = text.replace(/`[^`\n]*`/g, ' ')
  const found = []
  for (const token of plain.split(BARE_SPLIT)) {
    const bare = token.replace(BARE_START, '').replace(BARE_END, '')
    if (isPath(bare)) found.push(bare)
  }
  return found
}

function namedIn(text) {
  return [...new Set([...pathsIn(text), ...bareIn(text)])]
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

export function profileFromTask(text) {
  const clean = typeof text === 'string' ? text.trim() : ''
  const paths = namedIn(clean)
  const large = clean === '' || clean.length > MEDIUM_TEXT || paths.length > MEDIUM_PATHS
  const small = clean !== '' && clean.length <= SMALL_TEXT && paths.length <= SMALL_PATHS
  return {
    files: paths.length,
    hasTests: small,
    newTest: false,
    clarity: large ? 'unclear' : 'clear',
    reversible: isReversible(clean),
    touchesSecrets: touchesAny(paths, SECRET_PATHS, []),
    touchesDeploy: touchesAny(paths, DEPLOY_PATHS, DEPLOY_FOLDERS),
    touchesData: touchesAny(paths, [], DATA_FOLDERS),
    kind: 'change',
  }
}
