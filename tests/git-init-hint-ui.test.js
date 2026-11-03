import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Launcher from '../src/ui/Launcher.jsx'
import Sidebar from '../src/ui/Sidebar.jsx'
import { NO_GIT_PROJECT_TEXT, GIT_INIT_COMMAND, copyGitInit } from '../src/ui/sidebar.js'
import { launcherRows } from '../src/ui/launcher.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

function withClipboard(run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const written = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (text) => written.push(text) } },
  })
  return Promise.resolve()
    .then(() => run(written))
    .finally(() => {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved)
      else delete globalThis.navigator
    })
}

function sidebarClient(projects) {
  return {
    projects: async () => projects,
    orchestratorSessions: async () => ({ sessions: [] }),
  }
}

async function mountSidebar(root, container, client) {
  await act(async () => {
    root.render(createElement(Sidebar, { client, live: true, project: 'C:\\work\\plain' }))
  })
  await settle()
  await click(root, buttonWithText(container, 'Projects'))
}

describe('the non-git project hint', () => {
  it('copies git init', async () => {
    await withClipboard(async (written) => {
      await expect(copyGitInit()).resolves.toBe(true)
      expect(written).toEqual([GIT_INIT_COMMAND])
    })
  })

  it('says the copy failed without a clipboard', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    try {
      await expect(copyGitInit()).resolves.toBe(false)
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved)
      else delete globalThis.navigator
    }
  })

  it('marks only a folder known not to be a git repository', () => {
    const rows = launcherRows({
      current: { path: 'C:\\work\\current', git: false },
      recent: [{ path: 'C:\\work\\plain' }, { path: 'C:\\work\\repo' }, { path: 'C:\\work\\sibling' }],
      folders: [
        { path: 'C:\\work\\plain', git: false },
        { path: 'C:\\work\\repo', git: true },
        { path: 'C:\\work\\sibling', git: false },
      ],
    })

    expect(Object.fromEntries(rows.map((row) => [row.name, row.noGit]))).toEqual({
      plain: true,
      repo: false,
      sibling: true,
    })
  })
})

describe('the Projects tab hint', () => {
  it('puts the hint under the open project and every recent folder with git false', async () => {
    const projects = {
      current: { path: 'C:\\work\\plain', name: 'plain', git: false },
      recent: [{ path: 'C:\\work\\old', name: 'old', git: false }],
    }
    await withClipboard(async () => {
      await withDom(async ({ container, root }) => {
        await mountSidebar(root, container, sidebarClient(projects))

        expect(container.textContent).toContain(NO_GIT_PROJECT_TEXT)
        expect(container.querySelectorAll('.mr-no-git-hint')).toHaveLength(2)
        expect(container.querySelectorAll('.mr-no-git-copy')).toHaveLength(2)
      })
    })
  })

  it('leaves a git row and a row with no git field alone', async () => {
    const projects = {
      current: { path: 'C:\\work\\repo', name: 'repo', git: true },
      recent: [{ path: 'C:\\work\\unknown', name: 'unknown' }],
    }
    await withClipboard(async () => {
      await withDom(async ({ container, root }) => {
        await mountSidebar(root, container, sidebarClient(projects))

        expect(container.textContent).not.toContain(NO_GIT_PROJECT_TEXT)
        expect(container.querySelectorAll('.mr-no-git-hint')).toHaveLength(0)
      })
    })
  })

  it('says Copied. when the Copy button runs', async () => {
    await withClipboard(async (written) => {
      await withDom(async ({ container, root }) => {
        await mountSidebar(root, container, sidebarClient({ current: { path: 'C:\\work\\plain', name: 'plain', git: false } }))

        const copy = container.querySelector('.mr-no-git-copy')
        expect(copy.textContent).toBe('Copy')
        await click(root, copy)

        expect(written).toEqual([GIT_INIT_COMMAND])
        expect(container.querySelector('.mr-no-git-copy').textContent).toBe('Copied.')
      })
    })
  })
})

describe('the folder picker hint', () => {
  it('puts the hint under the open project and a folder known not to be a git repository', async () => {
    const client = {
      projects: async () => ({
        current: { path: 'C:\\work\\plain', name: 'plain', git: false },
        recent: [{ path: 'C:\\work\\old', name: 'old', git: false }],
        folders: [
          { path: 'C:\\work\\repo', name: 'repo', git: true },
          { path: 'C:\\work\\sibling', name: 'sibling', git: false },
        ],
      }),
    }
    await withClipboard(async () => {
      await withDom(async ({ container, root }) => {
        await act(async () => {
          root.render(createElement(Launcher, { live: true, client }))
        })
        await settle()

        expect(container.querySelectorAll('.mr-launcher-row')).toHaveLength(4)
        expect(container.textContent).toContain(NO_GIT_PROJECT_TEXT)
        expect(container.querySelectorAll('.mr-no-git-hint')).toHaveLength(3)
      })
    })
  })

  it('says Copied. when the Copy button runs', async () => {
    const client = {
      projects: async () => ({ current: { path: 'C:\\work\\plain', name: 'plain', git: false } }),
    }
    await withClipboard(async (written) => {
      await withDom(async ({ container, root }) => {
        await act(async () => {
          root.render(createElement(Launcher, { live: true, client }))
        })
        await settle()

        const copy = container.querySelector('.mr-no-git-copy')
        await click(root, copy)

        expect(written).toEqual([GIT_INIT_COMMAND])
        expect(container.querySelector('.mr-no-git-copy').textContent).toBe('Copied.')
      })
    })
  })
})
