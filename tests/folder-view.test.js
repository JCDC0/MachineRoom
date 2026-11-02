import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { viewInput } from '../src/engine/cards.js'
import { MAX_CHILD_CARDS, planFolderView } from '../src/model/folderView.js'
import { apply, createState } from '../src/model/state.js'
import { loadRecording, loadScenario } from './helpers.js'

const PLAN_DIGESTS = {
  sandbox: 'c2b708087298eb0c',
  'scenario-a': '73dd68c909528680',
  'scenario-b': 'f773c6e02d64c9dd',
  'scenario-c': 'a7524ec50b89129f',
  'scenario-d': '1abaa12fe0269330',
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
  it('lists its files on every folder on the way to a deep focus file', () => {
    const files = ['README.md', 'src/model/parsers/common.js', 'src/model/state.js', 'src/model/paths.js']

    const plan = planFolderView({ files, focus: ['src/model/parsers/common.js'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src', 'src/model', 'src/model/parsers'])
    for (const view of plan) expect(view.state).toBe('files')
    expect(folders.get('').items).toEqual([{ path: 'README.md', kind: 'file' }])
    expect(folders.get('src').items).toEqual([])
    expect(folders.get('src/model').items).toEqual([
      { path: 'src/model/paths.js', kind: 'file' },
      { path: 'src/model/state.js', kind: 'file' },
    ])
    expect(folders.get('src/model/parsers').items).toEqual([{ path: 'src/model/parsers/common.js', kind: 'file' }])
    expect(folders.get('src/model/parsers').hiddenItems).toBe(0)
  })

  it('shows three of a hundred child folders as cards and lists the rest in rows', () => {
    const files = []
    for (let i = 0; i < 100; i += 1) files.push(`big/f${String(i).padStart(2, '0')}/a.js`)

    const plan = planFolderView({ files, focus: ['big/f00/a.js'] })
    const folders = byPath(plan)
    const big = folders.get('big')

    expect(big.state).toBe('files')
    expect(big.items).toEqual([
      { path: 'big/f03', kind: 'dir' },
      { path: 'big/f04', kind: 'dir' },
      { path: 'big/f05', kind: 'dir' },
    ])
    expect(big.hiddenFolders).toBe(97)
    expect(big.hiddenItems).toBe(94)
    expect(paths(plan)).toEqual(['', 'big', 'big/f00', 'big/f01', 'big/f02'])
    for (const path of ['big/f00', 'big/f01', 'big/f02']) {
      expect(folders.get(path).state).toBe('files')
      expect(folders.get(path).items).toEqual([{ path: `${path}/a.js`, kind: 'file' }])
    }
  })

  it('stacks one outline behind an empty folder with an unexpanded child', () => {
    const plan = planFolderView({ files: ['empty/kid/one.js'], alwaysDepth: 1 })
    const folder = byPath(plan).get('empty')

    expect(folder.items).toEqual([{ path: 'empty/kid', kind: 'dir' }])
    expect(folder.hiddenItems).toBe(0)
    expect(folder.hiddenFolders).toBe(1)
    expect(folder.back).toBe(1)
  })

  it('stacks up to three outlines behind a folder that lists files', () => {
    const files = ['work/one.js', 'work/a/two.js', 'work/b/two.js', 'work/c/two.js', 'work/d/two.js']
    const plan = planFolderView({ files, alwaysDepth: 1 })
    const folder = byPath(plan).get('work')

    expect(folder.items.filter((item) => item.kind === 'file')).toEqual([{ path: 'work/one.js', kind: 'file' }])
    expect(folder.hiddenFolders).toBe(4)
    expect(folder.back).toBe(3)
  })

  it('leaves the root card without outlines', () => {
    const plan = planFolderView({ files: ['one/two/three.js'], alwaysDepth: 0 })
    const root = byPath(plan).get('')

    expect(root.hiddenFolders).toBe(1)
    expect(root.back).toBe(0)
  })

  it('draws every child of a clicked folder and the first three of the others', () => {
    const files = ['lib/a/x.js', 'lib/b/x.js', 'lib/c/x.js', 'lib/d/x.js', 'lib/e/x.js']
    const plain = planFolderView({ files, focus: ['lib'] })
    expect(paths(plain)).toEqual(['', 'lib', 'lib/a', 'lib/b', 'lib/c'])
    expect(byPath(plain).get('lib').back).toBe(2)
    const expanded = planFolderView({ files, focus: ['lib'], expanded: ['lib'] })
    expect(paths(expanded)).toEqual(['', 'lib', 'lib/a', 'lib/b', 'lib/c', 'lib/d', 'lib/e'])
    for (const view of expanded) {
      expect(view.state).toBe('files')
      expect(view.back).toBe(0)
    }
    expect(byPath(expanded).get('lib').items).toEqual([])
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
      { path: 'docs/d', kind: 'dir' },
      { path: 'docs/doc01.md', kind: 'file' },
      { path: 'docs/doc02.md', kind: 'file' },
      { path: 'docs/doc03.md', kind: 'file' },
      { path: 'docs/doc04.md', kind: 'file' },
      { path: 'docs/doc05.md', kind: 'file' },
      { path: 'docs/doc06.md', kind: 'file' },
      { path: 'docs/doc08.md', kind: 'file' },
    ])
    expect(docs.folders).toEqual([])
    expect(docs.back).toBe(2)
    expect(docs.hiddenFolders).toBe(2)
    expect(docs.hiddenItems).toBe(32)
  })

  it('keeps every folder and file item when limitItems is false', () => {
    const files = []
    for (let i = 1; i <= 40; i += 1) files.push(`docs/doc${String(i).padStart(2, '0')}.md`)
    for (const letter of ['a', 'b', 'c', 'd', 'e']) files.push(`docs/${letter}/one.md`)

    const limited = planFolderView({ files, focus: ['docs/doc07.md'] })
    const full = planFolderView({ files, focus: ['docs/doc07.md'], limitItems: false })
    const capped = byPath(limited).get('docs')
    const all = byPath(full).get('docs')

    expect(capped.items).toHaveLength(10)
    expect(capped.hiddenItems).toBeGreaterThan(0)
    expect(all.items).toHaveLength(capped.items.length + capped.hiddenItems)
    expect(all.items).toHaveLength(42)
    expect(all.items.filter((item) => item.kind === 'dir')).toHaveLength(2)
    expect(all.items.filter((item) => item.kind === 'file')).toHaveLength(40)
    expect(all.hiddenItems).toBe(0)
    for (const view of full) expect(view.hiddenItems).toBe(0)
  })

  it('lists a folder of 200,000 files without a spread and keeps every one', () => {
    const count = 200000
    const files = new Array(count)
    for (let index = 0; index < count; index += 1) files[index] = `src/f${index}.js`

    const plan = planFolderView({ files, alwaysDepth: 2, limitItems: false })
    const src = byPath(plan).get('src')

    expect(src.items).toHaveLength(count)
    expect(src.hiddenItems).toBe(0)
    expect(src.items[0]).toEqual({ path: 'src/f0.js', kind: 'file' })
    expect(src.items.some((item) => item.path === `src/f${count - 1}.js`)).toBe(true)
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
    for (const view of plan) expect(view.state).toBe('files')
    expect(folders.get('docs').items).toEqual([{ path: 'docs/notes.md', kind: 'file' }])
    expect(folders.get('src').items).toEqual([])
    expect(folders.get('src/engine').items).toEqual([
      { path: 'src/engine/room.js', kind: 'file' },
      { path: 'src/engine/layout.js', kind: 'file' },
    ])
    expect(folders.get('src/model').items).toEqual([
      { path: 'src/model/state.js', kind: 'file' },
      { path: 'src/model/player.js', kind: 'file' },
    ])
  })

  it('opens a folder that is the focus and lists its files', () => {
    const files = ['src/model/state.js', 'src/ui/Hud.jsx', 'tests/a.test.js']

    const plan = planFolderView({ files, focus: ['src/ui'] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src', 'src/model', 'src/ui', 'tests'])
    expect(folders.get('src/ui').state).toBe('files')
    expect(folders.get('src/ui').items).toEqual([{ path: 'src/ui/Hud.jsx', kind: 'file' }])
    expect(folders.get('src/model').items).toEqual([{ path: 'src/model/state.js', kind: 'file' }])
    expect(folders.get('tests').items).toEqual([{ path: 'tests/a.test.js', kind: 'file' }])
  })

  it('draws the root alone with its files and folders when nothing is focused or touched', () => {
    const plan = planFolderView({ files: ['src/model/state.js', 'README.md'] })

    expect(plan).toEqual([
      {
        path: '',
        state: 'files',
        folders: [],
        back: 0,
        hiddenFolders: 1,
        items: [
          { path: 'README.md', kind: 'file' },
          { path: 'src', kind: 'dir' },
        ],
        hiddenItems: 0,
      },
    ])
  })

  it('opens the root when the focus is the root', () => {
    const plan = planFolderView({ files: ['src/model/state.js', 'README.md'], focus: [''] })
    const folders = byPath(plan)

    expect(paths(plan)).toEqual(['', 'src'])
    expect(folders.get('').state).toBe('files')
    expect(folders.get('').items).toEqual([{ path: 'README.md', kind: 'file' }])
    expect(folders.get('src').items).toEqual([{ path: 'src/model', kind: 'dir' }])
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

  it('keeps a child folder on another focus path as a card, with the rest in rows', () => {
    const files = ['a/sub/c.js', 'a/b.js', ...Array.from({ length: 12 }, (_, i) => `a/f${String(i).padStart(2, '0')}.js`), 'a/aa/x.js', 'a/ab/x.js', 'a/ac/x.js']
    const plan = planFolderView({ files, focus: ['a/b.js', 'a/sub/c.js'] })
    const folders = new Map(plan.map((folder) => [folder.path, folder]))
    expect(folders.get('a').state).toBe('files')
    expect(folders.get('a').items.slice(0, 2)).toEqual([{ path: 'a/b.js', kind: 'file' }, { path: 'a/ac', kind: 'dir' }])
    expect(folders.get('a/sub').state).toBe('files')
    expect(folders.get('a/sub').items).toEqual([{ path: 'a/sub/c.js', kind: 'file' }])
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

  it('lists the files of every folder down to the depth, pinned', () => {
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
    const ownFiles = {
      1: {
        '': ['README.md'],
        docs: ['docs/notes.md'],
        src: [],
        tests: ['tests/a.test.js'],
      },
      2: {
        '': ['README.md'],
        docs: ['docs/notes.md'],
        src: [],
        'src/engine': ['src/engine/room.js'],
        'src/model': ['src/model/state.js'],
        tests: ['tests/a.test.js'],
      },
      3: {
        '': ['README.md'],
        docs: ['docs/notes.md'],
        src: [],
        'src/engine': ['src/engine/room.js'],
        'src/model': ['src/model/state.js'],
        'src/model/parsers': ['src/model/parsers/common.js'],
        tests: ['tests/a.test.js'],
      },
    }

    for (const depth of [1, 2, 3]) {
      const plan = planFolderView({ files, alwaysDepth: depth })
      expect(paths(plan)).toEqual(expected[depth])
      for (const view of plan) {
        expect(view.state).toBe('files')
        expect(view.pinned).toBe(true)
        expect(view.back).toBe(view.path === '' ? 0 : Math.min(3, view.hiddenFolders))
        expect(view.items.filter((item) => item.kind === 'file').map((item) => item.path)).toEqual(ownFiles[depth][view.path])
      }
    }
  })

  it('draws ten of 300 child folders at depth 2, the largest, and lists the rest', () => {
    const large = new Set()
    const files = []
    for (let i = 0; i < 300; i += 1) {
      const folder = `big/c${String(i).padStart(3, '0')}`
      files.push(`${folder}/a.js`)
      if (i % 30 === 0) {
        large.add(folder)
        files.push(`${folder}/b.js`)
      }
    }

    const plan = planFolderView({ files, alwaysDepth: 2, limitItems: false })
    const folders = byPath(plan)
    const drawn = paths(plan).filter((path) => path.startsWith('big/c'))

    expect(MAX_CHILD_CARDS).toBe(10)
    expect(drawn).toEqual([...large].sort())
    expect(drawn).toHaveLength(10)
    expect(folders.get('big').state).toBe('files')
    expect(folders.get('big').pinned).toBe(true)
    expect(folders.get('big').items).toHaveLength(290)
    expect(folders.get('big').hiddenFolders).toBe(290)
    expect(folders.get('big').back).toBe(3)
  })

  it('caps a clicked crowded folder at ten of its largest children', () => {
    const large = new Set()
    const files = []
    for (let i = 0; i < 300; i += 1) {
      const folder = `lib/c${String(i).padStart(3, '0')}`
      files.push(`${folder}/a.js`)
      if (i % 30 === 0) {
        large.add(folder)
        files.push(`${folder}/b.js`)
      }
    }

    const plan = planFolderView({ files, focus: ['lib'], expanded: ['lib'], alwaysDepth: 0, limitItems: false })
    const view = byPath(plan).get('lib')
    const drawn = paths(plan).filter((path) => path.startsWith('lib/c'))

    expect(drawn).toEqual([...large].sort())
    expect(drawn).toHaveLength(10)
    expect(view.items).toHaveLength(290)
    expect(view.hiddenFolders).toBe(290)
  })

  it("still draws a focus path inside a crowded folder's hidden children", () => {
    const files = Array.from({ length: 300 }, (_, i) => `big/c${String(i).padStart(3, '0')}/a.js`)

    const plan = planFolderView({ files, focus: ['big/c299/a.js'], alwaysDepth: 2, limitItems: false })
    const big = byPath(plan).get('big')

    expect(paths(plan)).toContain('big/c299')
    expect(big.items.some((item) => item.path === 'big/c299')).toBe(false)
    expect(big.items).toHaveLength(289)
    expect(big.hiddenFolders).toBe(289)
  })

  it('draws all 30 top-level folders at the root', () => {
    const files = Array.from({ length: 30 }, (_, i) => `top${String(i).padStart(2, '0')}/a.js`)
    const pinned = planFolderView({ files, alwaysDepth: 2 })
    const clicked = planFolderView({ files, focus: [''], expanded: [''], alwaysDepth: 0 })

    for (const plan of [pinned, clicked]) {
      const top = paths(plan).filter((path) => path !== '' && !path.includes('/'))
      expect(top).toHaveLength(30)
    }
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
    expect(folders.get('lib')).toMatchObject({ state: 'files', pinned: true, items: [{ path: 'lib/util', kind: 'dir' }] })
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
