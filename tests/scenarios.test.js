import { describe, expect, it } from 'vitest'
import { loadScenario } from './helpers.js'

function callLog(activities) {
  const ends = new Map()
  for (const a of activities) {
    if (a.type === 'tool.end') ends.set(`${a.runId}:${a.id}`, a.ok)
  }
  return activities
    .filter((a) => a.type === 'tool.start')
    .map((a) => {
      const touches = a.touches.map((t) => `${t.mode} ${t.kind} ${t.path || '.'}`).join(', ')
      return `${a.tool} | ${a.label} | ${touches || 'no touches'} | ok=${ends.get(`${a.runId}:${a.id}`)}`
    })
}

function writtenFiles(activities) {
  const paths = new Set()
  for (const a of activities) {
    if (a.type !== 'tool.start') continue
    for (const touch of a.touches) if (touch.mode === 'write' && touch.kind === 'file') paths.add(touch.path)
  }
  return [...paths].sort()
}

describe('scenario A: a failing test that the agent then fixes', () => {
  const { activities } = loadScenario('scenario-a')

  it('records every tool call with its touches and result', () => {
    expect(callLog(activities)).toEqual([
      "shell | $ dir /b | list dir . | ok=false",
      "shell | $ Get-ChildItem -Force | Select-Object Mode, Name | list dir . | ok=true",
      "read | read src/strings.js | read file src/strings.js | ok=true",
      "read | read test/strings.test.js | read file test/strings.test.js | ok=true",
      "read | read package.json | read file package.json | ok=true",
      "shell | $ git status --short; git log --oneline -5 -- src/strings.js; Get-ChildIt~ | read file src/strings.js, list dir docs | ok=true",
      "shell | $ git status --short; git log --oneline -5 | no touches | ok=true",
      "search | grep shout | no touches | ok=true",
      "other | skill {\"id\":\"paperclip\"} | no touches | ok=true",
      "shell | $ git show 4188241:src/strings.js; git show fbd0aba:src/strings.js | read file src/strings.js | ok=true",
      "edit | edit test/strings.test.js | write file test/strings.test.js | ok=true",
      "edit | edit test/strings.test.js | write file test/strings.test.js | ok=true",
      "shell | $ node --test | no touches | ok=false",
      "edit | edit src/strings.js | write file src/strings.js | ok=true",
      "edit | edit test/strings.test.js | write file test/strings.test.js | ok=true",
      "shell | $ node --test | no touches | ok=true",
      "read | read docs/api.md | read file docs/api.md | ok=true",
      "edit | edit docs/api.md | write file docs/api.md | ok=true",
      "shell | $ git add src/strings.js test/strings.test.js docs/api.md; git commit -m ~ | read file docs/api.md, read file src/strings.js, read file test/strings.test.js | ok=true",
      "shell | $ git show --stat HEAD; Get-Content src\\strings.js -TotalCount 6; \"---\"; ~ | read file src/strings.js | ok=true",
    ])
  })

  it('fails the first test run and passes the one after the fix', () => {
    const ids = activities.filter((a) => a.type === 'tool.start' && a.label === '$ node --test').map((a) => `${a.runId}:${a.id}`)
    const oks = ids.map((key) => activities.find((a) => a.type === 'tool.end' && `${a.runId}:${a.id}` === key).ok)
    expect(oks).toEqual([false, true])
  })

  it('writes the test, the source and the doc it updated', () => {
    expect(writtenFiles(activities)).toEqual(['docs/api.md', 'src/strings.js', 'test/strings.test.js'])
  })
})

describe('scenario B: an edit across three files', () => {
  const { activities } = loadScenario('scenario-b')

  it('records every tool call with its touches and result', () => {
    expect(callLog(activities)).toEqual([
      "other | skill {\"id\":\"paperclip\"} | no touches | ok=true",
      "shell | $ Get-ChildItem -Recurse -Force -Exclude .git | Select-Object -ExpandProp~ | list dir . | ok=true",
      "read | read src/math.js | read file src/math.js | ok=true",
      "read | read test/math.test.js | read file test/math.test.js | ok=true",
      "read | read docs/notes.md | read file docs/notes.md | ok=true",
      "read | read package.json | read file package.json | ok=true",
      "shell | $ git status --short; node --version | no touches | ok=true",
      "edit | edit src/math.js | write file src/math.js | ok=true",
      "edit | edit test/math.test.js | write file test/math.test.js | ok=true",
      "edit | edit test/math.test.js | write file test/math.test.js | ok=true",
      "edit | edit docs/notes.md | write file docs/notes.md | ok=true",
      "shell | $ node --test | no touches | ok=true",
      "shell | $ git diff --stat; git diff | no touches | ok=true",
      "other | execute {\"code\":\"\\nconst api = (process.env.PAPERCLIP_A~ | no touches | ok=true",
    ])
  })

  it('writes exactly the three files of the task', () => {
    expect(writtenFiles(activities)).toEqual(['docs/notes.md', 'src/math.js', 'test/math.test.js'])
  })
})

describe('scenario C: a file rename, once per parser', () => {
  const { activities } = loadScenario('scenario-c')
  const runs = new Map()
  for (const a of activities) {
    if (!runs.has(a.runId)) runs.set(a.runId, [])
    runs.get(a.runId).push(a)
  }

  it('records every tool call with its touches and result', () => {
    expect(callLog(activities)).toEqual([
      "shell | $ Get-ChildItem -Force | Select-Object Name, Mode; if (Test-Path docs) { ~ | list dir ., list dir docs | ok=true",
      "shell | $ Get-ChildItem -Force docs | Select-Object Name, Length | list dir docs | ok=true",
      "shell | $ git ls-files docs; git status --porcelain | list dir docs | ok=true",
      "shell | $ git log --oneline -5 | no touches | ok=true",
      "shell | $ git mv docs/notes.md docs/readme.md; git hash-object docs/readme.md; gi~ | write file docs/notes.md, write file docs/readme.md, read file docs/readme.md, read file docs/notes.md | ok=true",
      "shell | $ git commit -m \"JC-20: rename docs/notes.md to docs/readme.md\" --no-veri~ | read file docs/notes.md, read file docs/readme.md | ok=true",
      "other | execute {\"code\":\"const s = await tools.opencode.list_mc~ | no touches | ok=true",
      "other | skill {\"id\":\"paperclip\"} | no touches | ok=true",
      "shell | $ \"URL=$env:PAPERCLIP_API_URL\"; \"TASK=$env:PAPERCLIP_TASK_ID\"; \"RUN=$env:~ | no touches | ok=true",
      "shell | $ $body = Get-Content \"$env:TEMP\\jc20-comment.md\" -Raw \"TYPE=$($body.GetT~ | no touches | ok=true",
      "shell | $ $body = [string](Get-Content \"$env:TEMP\\jc20-comment.md\" -Raw) $test = ~ | no touches | ok=true",
      "shell | $ cd \"C:/Users/user/AppData/Local/Temp/agent-sandbox\" && pwd && git statu~ | list dir ., list dir docs | ok=true",
      "read | read SKILL.md | no touches | ok=true",
      "shell | $ cd \"C:/Users/user/AppData/Local/Temp/agent-sandbox\" && git mv docs/note~ | list dir ., write file docs/notes.md, write file docs/readme.md, list dir docs | ok=true",
      "shell | $ PAPERCLIP_API_BASE=\"${PAPERCLIP_API_URL%/}\"; PAPERCLIP_API_BASE=\"${PAPE~ | read file docs/notes.md, read file docs/readme.md | ok=true",
      "shell | $ pwd | no touches | ok=true",
      "read | read docs/notes.md | read file docs/notes.md | ok=true",
      "shell | $ git status --short | no touches | ok=true",
      "other | grep notes\\.md | no touches | ok=true",
      "shell | $ git mv docs/notes.md docs/readme.md | write file docs/notes.md, write file docs/readme.md | ok=true",
      "shell | $ git diff --cached -M --summary | no touches | ok=true",
      "shell | $ ls -a .claude 2>/dev/null | list dir . | ok=true",
      "read | read AGENTS.md | read file AGENTS.md | ok=true",
      "shell | $ git commit -m \"JC-22: rename docs/notes.md to docs/readme.md\" | read file docs/notes.md, read file docs/readme.md | ok=true",
      "shell | $ api=\"${PAPERCLIP_API_URL%/}\" | no touches | ok=true",
      "write | write jc22_comment.md | no touches | ok=true",
      "shell | $ case \"$api\" in */api) | no touches | ok=true",
    ])
  })

  it('has one run per parser', () => {
    const agents = new Set(activities.map((a) => a.agent))
    expect([...agents].sort()).toEqual(['claude', 'hermes', 'opencode'])
  })

  it('marks the rename as a write of both names in every run', () => {
    for (const list of runs.values()) {
      const rename = list.find(
        (a) => a.type === 'tool.start' && a.tool === 'shell' && a.touches.some((t) => t.path === 'docs/notes.md' && t.mode === 'write')
      )
      expect(rename).toBeTruthy()
      expect(rename.touches.filter((t) => t.mode === 'write').map((t) => t.path)).toEqual(['docs/notes.md', 'docs/readme.md'])
    }
  })

  it('reads the renamed file by its bare name in the hermes run', () => {
    const hermes = activities.find((a) => a.agent === 'hermes' && a.type === 'tool.start' && a.label === 'read docs/notes.md')
    expect(hermes.touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])
  })
})

describe('scenario D: a tool error', () => {
  const { activities } = loadScenario('scenario-d')

  it('records every tool call with its touches and result', () => {
    expect(callLog(activities)).toEqual([
      "read | read AGENTS.md | no touches | ok=true",
      "other | skill {\"id\":\"paperclip\"} | no touches | ok=true",
      "search | glob **/does-not-exist* | no touches | ok=true",
      "shell | $ Get-ChildItem -Force | Select-Object Mode,Name; if (Test-Path src) { Ge~ | list dir ., list dir src | ok=true",
      "shell | $ Get-ChildItem -Force src | Select-Object Mode,Name; '---'; Test-Path sr~ | list dir src, list dir . | ok=true",
      "read | read src/does-not-exist.js | read file src/does-not-exist.js | ok=false",
      "shell | $ git status --porcelain; '--- log ---'; git log --oneline -5 -- src/does~ | list dir . | ok=true",
      "shell | $ 'TASK_ID set: ' + [bool]$env:PAPERCLIP_TASK_ID; 'API_URL set: ' + [bool~ | no touches | ok=true",
    ])
  })

  it('fails the read of the missing file', () => {
    const failed = activities.find((a) => a.type === 'tool.end' && !a.ok)
    const start = activities.find((a) => a.type === 'tool.start' && `${a.runId}:${a.id}` === `${failed.runId}:${failed.id}`)
    expect(start.label).toBe('read src/does-not-exist.js')
    expect(start.touches).toEqual([{ path: 'src/does-not-exist.js', mode: 'read', kind: 'file' }])
  })

  it('writes nothing', () => {
    expect(writtenFiles(activities)).toEqual([])
  })
})
