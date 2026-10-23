import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { viewInput } from '../src/engine/cards.js'
import { planFolderView } from '../src/model/folderView.js'
import { apply, createState } from '../src/model/state.js'
import { loadRecording, loadScenario } from './helpers.js'

const PLAN_DIGESTS = {
  sandbox: 'ae5d30b00ecdf96d',
  'scenario-a': '4b3e72323954daeb',
  'scenario-b': 'f1ab1b3c433a6af9',
  'scenario-c': 'ecb910f0c9df6809',
  'scenario-d': '176cd9d806d2e88a',
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function byPath(plan) {
  return new Map(plan.map((entry) => [entry.path, entry]))
}

function paths(plan) {
  return plan.map((entry) => entry.path)
}

describe('planFolderView', () => {
  it('opens every folder on the way to a deep focus file', () => {
    const files = ['README.md', 'src/model/parsers/common.js', 'src/model/state.js', 'src/model/paths.js']

    const plan = planFolderView({ files, focus: ['src/model/parsers/common.js'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src', 'src/model', 'src/model/parsers'])
    expect(folders.get('').state).toBe('open')
    expect(folders.get('src').state).toBe('open')
    expect(folders.get('src/model').state).toBe('open')
    expect(folders.get('src/model').folders).toEqual(['src/model/parsers'])
    expect(folders.get('src/model').hiddenFolders).toBe(0)
    expect(folders.get('src/model/parsers').state).toBe('files')
    expect(folders.get('src/model/parsers').items).toEqual([
      { path: 'src/model/parsers/common.js', kind: 'file' },
    ])
    expect(folders.get('src/model/parsers').hiddenItems).toBe(0)
  })

  it('shows three of a hundred child folders and stacks three back', () => {
    const files = []
    for (let i = 0; i < 100; i += 1) files.push(`big/f${String(i).padStart(2, '0')}/a.js`)

    const plan = planFolderView({ files, focus: ['big/f00/a.js'] })
    const folders = byPath(plan)
    const big = folders.get('big')

    expect(big.state).toBe('open')
    expect(big.folders).toEqual(['big/f00', 'big/f01', 'big/f02'])
    expect(big.back).toBe(3)
    expect(big.hiddenFolders).toBe(97)
    expect(folders.get('big/f00').state).toBe('files')
    expect(folders.get('big/f01').state).toBe('closed')
    expect(paths(plan)).toEqual(['', 'big', 'big/f00', 'big/f01', 'big/f02'])
  })

  it('lists the focused file, then touched files, then names, with at most three folders', () => {
    const files = []
    for (let i = 1; i <= 40; i += 1) files.push(`docs/doc${String(i).padStart(2, '0')}.md`)
    for (const letter of ['a', 'b', 'c', 'd', 'e']) files.push(`docs/${letter}/one.md`)

    const plan = planFolderView({ files, focus: ['docs/doc07.md'], touched: ['docs/doc39.md'] })
    const docs = byPath(plan).get('docs')

    expect(docs.state).toBe('files')
    expect(docs.items).toEqual([
      { path: 'docs/doc07.md', kind: 'file' },
      { path: 'docs/doc39.md', kind: 'file' },
      { path: 'docs/a', kind: 'dir' },
      { path: 'docs/b', kind: 'dir' },
      { path: 'docs/c', kind: 'dir' },
      { path: 'docs/doc01.md', kind: 'file' },
      { path: 'docs/doc02.md', kind: 'file' },
      { path: 'docs/doc03.md', kind: 'file' },
      { path: 'docs/doc04.md', kind: 'file' },
      { path: 'docs/doc05.md', kind: 'file' },
    ])
    expect(docs.items.filter((item) => item.kind === 'dir')).toHaveLength(3)
    expect(docs.hiddenItems).toBe(35)
  })

  it('opens both branches when two agents work on two files', () => {
    const files = [
      'docs/notes.md',
      'src/engine/layout.js',
      'src/engine/room.js',
      'src/model/player.js',
      'src/model/state.js',
    ]

    const plan = planFolderView({ files, focus: ['src/model/state.js', 'src/engine/room.js'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'docs', 'src', 'src/engine', 'src/model'])
    expect(folders.get('').folders).toEqual(['src', 'docs'])
    expect(folders.get('src').state).toBe('open')
    expect(folders.get('src').folders).toEqual(['src/engine', 'src/model'])
    expect(folders.get('src/engine').state).toBe('files')
    expect(folders.get('src/engine').items).toEqual([
      { path: 'src/engine/room.js', kind: 'file' },
      { path: 'src/engine/layout.js', kind: 'file' },
    ])
    expect(folders.get('src/model').state).toBe('files')
    expect(folders.get('src/model').items).toEqual([
      { path: 'src/model/state.js', kind: 'file' },
      { path: 'src/model/player.js', kind: 'file' },
    ])
    expect(folders.get('docs').state).toBe('closed')
  })

  it('opens a folder that is the focus, with no files state', () => {
    const files = ['src/model/state.js', 'src/ui/Hud.jsx', 'tests/a.test.js']

    const plan = planFolderView({ files, focus: ['src/ui'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src', 'src/model', 'src/ui', 'tests'])
    expect(folders.get('src/ui').state).toBe('open')
    expect(folders.get('src/ui').folders).toEqual([])
    expect(folders.get('src/ui').items).toEqual([])
    expect(folders.get('src').folders).toEqual(['src/ui', 'src/model'])
    expect(plan.some((entry) => entry.state === 'files')).toBe(false)
  })

  it('draws the root alone when nothing is focused or touched', () => {
    const plan = planFolderView({ files: ['src/model/state.js', 'README.md'] })

    expect(plan).toEqual([
      { path: '', state: 'closed', folders: [], back: 0, hiddenFolders: 0, items: [], hiddenItems: 0 },
    ])
  })

  it('opens the root when the focus is the root', () => {
    const plan = planFolderView({ files: ['src/model/state.js', 'README.md'], focus: [''] })
    const root = byPath(plan).get('')

    expect(root.state).toBe('open')
    expect(root.folders).toEqual(['src'])
  })

  it('cleans paths the way paths.js does', () => {
    const files = ['src/model/state.js']

    const plan = planFolderView({
      files,
      focus: ['src\\model\\state.js', './src/model/state.js'],
      touched: ['src/model/state.js'],
    })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src', 'src/model'])
    expect(folders.get('src/model').state).toBe('files')
    expect(folders.get('src/model').items).toEqual([{ path: 'src/model/state.js', kind: 'file' }])
  })

  it('keeps a child folder on another focus path in a folder that lists its files', () => {
    const files = ['a/sub/c.js', 'a/b.js', ...Array.from({ length: 12 }, (_, i) => `a/f${String(i).padStart(2, '0')}.js`), 'a/aa/x.js', 'a/ab/x.js', 'a/ac/x.js']
    const plan = planFolderView({ files, focus: ['a/b.js', 'a/sub/c.js'] })
    const folders = new Map(plan.map((folder) => [folder.path, folder]))
    expect(folders.get('a').state).toBe('files')
    expect(folders.get('a').items.slice(0, 2)).toEqual([{ path: 'a/b.js', kind: 'file' }, { path: 'a/sub', kind: 'dir' }])
    expect(folders.get('a/sub').state).toBe('files')
  })

  it('gives the same plan whatever the input order', () => {
    const files = ['src/model/state.js', 'src/engine/room.js', 'docs/notes.md', 'tests/a.test.js']
    const focus = ['src/engine/room.js']
    const touched = ['tests/a.test.js']

    const first = planFolderView({ files, focus, touched })
    const second = planFolderView({
      files: [...files].reverse(),
      focus: [...focus].reverse(),
      touched: [...touched].reverse(),
    })

    expect(second).toEqual(first)
  })

  it('keeps the plans recorded on main at depth 0', () => {
    const fixtures = [
      ['sandbox', loadRecording()],
      ['scenario-a', loadScenario('scenario-a')],
      ['scenario-b', loadScenario('scenario-b')],
      ['scenario-c', loadScenario('scenario-c')],
      ['scenario-d', loadScenario('scenario-d')],
    ]
    for (const [name, { agents, tree, activities }] of fixtures) {
      const state = createState(tree, agents)
      const plans = []
      for (const activity of activities) {
        apply(state, activity)
        plans.push(planFolderView({ ...viewInput(state, []), alwaysDepth: 0 }))
      }
      expect(digest(plans)).toBe(PLAN_DIGESTS[name])
    }
  })

  it('draws every folder down to the depth, closed and pinned', () => {
    const files = [
      'README.md',
      'docs/notes.md',
      'src/model/state.js',
      'src/model/parsers/common.js',
      'src/engine/room.js',
      'tests/a.test.js',
    ]
    const expected = {
      1: ['', 'docs', 'src', 'tests'],
      2: ['', 'docs', 'src', 'src/engine', 'src/model', 'tests'],
      3: ['', 'docs', 'src', 'src/engine', 'src/model', 'src/model/parsers', 'tests'],
    }

    for (const depth of [1, 2, 3]) {
      const plan = planFolderView({ files, alwaysDepth: depth })
      expect(paths(plan)).toEqual(expected[depth])
      for (const view of plan) {
        expect(view.state).toBe('closed')
        expect(view.pinned).toBe(true)
        expect(view.back).toBe(0)
        expect(view.hiddenFolders).toBe(0)
      }
    }
  })

  it('caps the always folders at 300 and keeps the rest in back layers', () => {
    const files = Array.from({ length: 500 }, (_, i) => `big/f${String(i).padStart(3, '0')}/a.js`)

    const plan = planFolderView({ files, alwaysDepth: 2 })
    const folders = byPath(plan)

    expect(plan).toHaveLength(300)
    expect(paths(plan)).toEqual(['', 'big', ...Array.from({ length: 298 }, (_, i) => `big/f${String(i).padStart(3, '0')}`)])
    expect(folders.get('big').state).toBe('closed')
    expect(folders.get('big').pinned).toBe(true)
    expect(folders.get('big').hiddenFolders).toBe(202)
    expect(folders.get('big').back).toBe(3)
    expect(folders.has('big/f297')).toBe(true)
    expect(folders.has('big/f298')).toBe(false)
  })

  it('keeps the children with the most files when the cap cuts a depth', () => {
    const files = []
    for (let i = 0; i < 500; i += 1) {
      const folder = `big/f${String(i).padStart(3, '0')}`
      files.push(`${folder}/a.js`)
      if (i === 100) files.push(`${folder}/b.js`, `${folder}/c.js`, `${folder}/d.js`)
      if (i >= 400 && i <= 404) files.push(`${folder}/b.js`)
    }

    const plan = planFolderView({ files, alwaysDepth: 2, maxAlways: 10 })
    const folders = byPath(plan)
    const kept = paths(plan).filter((path) => path.startsWith('big/f'))

    expect(kept).toEqual(['big/f000', 'big/f001', 'big/f100', 'big/f400', 'big/f401', 'big/f402', 'big/f403', 'big/f404'])
    expect(folders.get('big').hiddenFolders).toBe(492)
    expect(folders.get('big').back).toBe(3)
  })

  it('adds only the deep path an agent touches below the always depth', () => {
    const files = ['src/model/parsers/common.js', 'src/model/state.js', 'lib/util/tool.js', 'docs/notes.md']

    const base = planFolderView({ files, alwaysDepth: 1 })
    expect(paths(base)).toEqual(['', 'docs', 'lib', 'src'])

    const plan = planFolderView({ files, alwaysDepth: 1, focus: ['src/model/parsers/common.js'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'docs', 'lib', 'src', 'src/model', 'src/model/parsers'])
    expect(folders.get('lib')).toMatchObject({ state: 'closed', pinned: true })
    expect(folders.get('src/model/parsers')).toMatchObject({
      state: 'files',
      items: [{ path: 'src/model/parsers/common.js', kind: 'file' }],
    })
    expect(folders.get('src/model/parsers').pinned).toBeUndefined()
    expect(folders.get('src/model').pinned).toBeUndefined()
  })

  it('removes only the folders below the always depth when a recent touch goes stale', () => {
    const files = ['src/model/parsers/common.js', 'src/model/state.js', 'src/engine/room.js', 'docs/notes.md']
    const input = { files, alwaysDepth: 2 }

    const fresh = planFolderView({ ...input, focus: ['src/model/parsers/common.js'], touched: ['src/model/parsers/common.js'] })
    const stale = planFolderView({ ...input, focus: [''], touched: [] })
    const stalePaths = paths(stale)

    expect(stalePaths).toEqual(['', 'docs', 'src', 'src/engine', 'src/model'])
    expect(paths(fresh)).toEqual(['', 'docs', 'src', 'src/engine', 'src/model', 'src/model/parsers'])
    expect(paths(fresh).filter((path) => !stalePaths.includes(path))).toEqual(['src/model/parsers'])
    expect(stale.every((view) => view.pinned)).toBe(true)
    expect(fresh.filter((view) => view.pinned).map((view) => view.path)).toEqual(['', 'docs', 'src', 'src/engine', 'src/model'])
  })

  it('keeps the always plan the same as a fresh call when the file list grows', () => {
    const base = ['README.md', 'docs/notes.md', 'src/a.js', 'src/model/b.js']
    const steps = [
      base,
      [...base, 'src/model/parsers/c.js'],
      [...base, 'src/model/parsers/c.js', 'src/engine/d.js', 'tests/e.test.js'],
    ]
    planFolderView({ files: [] })
    const grown = steps.map((files) => planFolderView({ files, alwaysDepth: 3, maxAlways: 6 }))

    for (let i = 0; i < steps.length; i += 1) {
      planFolderView({ files: [] })
      expect(grown[i]).toEqual(planFolderView({ files: steps[i], alwaysDepth: 3, maxAlways: 6 }))
    }
  })

  it('gives the same always plan whatever the input order', () => {
    const files = [
      'src/model/parsers/common.js',
      'src/model/state.js',
      'src/engine/room.js',
      'docs/notes.md',
      'tests/a.test.js',
      'lib/util/tool.js',
    ]
    const focus = ['src/model/parsers/common.js', 'docs/notes.md']
    const touched = ['lib/util/tool.js']

    const first = planFolderView({ files, focus, touched, alwaysDepth: 3, maxAlways: 5 })
    const second = planFolderView({
      files: [...files].reverse(),
      focus: [...focus].reverse(),
      touched: [...touched].reverse(),
      alwaysDepth: 3,
      maxAlways: 5,
    })

    expect(second).toEqual(first)
  })
})
