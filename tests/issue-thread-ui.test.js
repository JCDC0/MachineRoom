import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import IssueThread from '../src/ui/panels/IssueThread.jsx'
import TasksPanel from '../src/ui/panels/TasksPanel.jsx'
import { click, settle, withDom } from './helpers/uiDom.js'

const NOW = Date.now()

function issue(id, identifier, title = identifier) {
  return {
    id,
    identifier,
    title,
    status: 'todo',
    priority: 'medium',
    description: '',
    assigneeAgentId: null,
  }
}

function comment(id, body) {
  return { id, authorName: 'Owner', body, createdAt: NOW }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function mountThread(root, props) {
  await act(async () => {
    root.render(createElement(IssueThread, props))
  })
  await settle()
}

describe('the issue thread comments', () => {
  it('ignores an answer for an issue the owner has left', async () => {
    let answerAlpha = null
    const client = {
      subscribe: () => () => {},
      comments: (id) => {
        if (id === 'issue-a') {
          return new Promise((resolve) => {
            answerAlpha = () => resolve([comment('ca', 'Alpha comment')])
          })
        }
        return Promise.resolve([comment('cb', 'Beta comment')])
      },
    }

    await withDom(async ({ container, root }) => {
      await mountThread(root, { issue: issue('issue-a', 'JC-1', 'Alpha'), client })
      await act(async () => {
        root.render(createElement(IssueThread, { issue: issue('issue-b', 'JC-2', 'Beta'), client }))
      })
      await settle()

      expect(container.querySelector('.thread-title').textContent).toBe('Beta')
      expect(container.querySelectorAll('.comment-body').map((node) => node.textContent)).toEqual([
        'Beta comment',
      ])

      await act(async () => {
        answerAlpha()
      })
      await settle()

      expect(container.querySelector('.thread-title').textContent).toBe('Beta')
      expect(container.querySelectorAll('.comment-body').map((node) => node.textContent)).toEqual([
        'Beta comment',
      ])
    })
  })
})

describe('the task control target', () => {
  it('keeps the newest target when an older one answers later', async () => {
    const reads = []
    const client = {
      subscribe: () => () => {},
      issues: () => {
        const next = deferred()
        reads.push(next)
        return next.promise
      },
      liveRuns: async () => [],
      agents: async () => [],
      comments: async () => [],
    }
    const a = issue('issue-a', 'JC-1', 'Alpha')
    const b = issue('issue-b', 'JC-2', 'Beta')

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(TasksPanel, {
            client,
            initialIssues: [],
            initialAgents: [],
            initialLiveRuns: [],
            controlTarget: { nonce: 1, issueIdentifier: 'JC-1' },
          })
        )
      })
      await settle()
      expect(reads).toHaveLength(1)

      await act(async () => {
        root.render(
          createElement(TasksPanel, {
            client,
            initialIssues: [],
            initialAgents: [],
            initialLiveRuns: [],
            controlTarget: { nonce: 2, issueIdentifier: 'JC-2' },
          })
        )
      })
      await settle()
      expect(reads).toHaveLength(2)

      await act(async () => {
        reads[1].resolve([a, b])
      })
      await settle()
      expect(container.querySelector('.thread-id').textContent).toBe('JC-2')

      await act(async () => {
        reads[0].resolve([a, b])
      })
      await settle()
      expect(container.querySelector('.thread-id').textContent).toBe('JC-2')
    })
  })

  it('stays on the task the owner clicked while an older target is still reading', async () => {
    const read = deferred()
    const client = {
      subscribe: () => () => {},
      issues: () => read.promise,
      liveRuns: async () => [],
      agents: async () => [],
      comments: async () => [],
    }
    const a = issue('issue-a', 'JC-1', 'Alpha')
    const b = issue('issue-b', 'JC-2', 'Beta')
    const c = issue('issue-c', 'JC-3', 'Gamma')

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(TasksPanel, {
            client,
            initialIssues: [a, b],
            initialAgents: [],
            initialLiveRuns: [],
            controlTarget: { nonce: 1, issueIdentifier: 'JC-3' },
          })
        )
      })
      await settle()

      const beta = container
        .querySelectorAll('.task-row')
        .find((row) => row.querySelector('.task-identifier').textContent === 'JC-2')
      expect(beta).not.toBeNull()
      await click(root, beta)
      expect(container.querySelector('.thread-id').textContent).toBe('JC-2')

      await act(async () => {
        read.resolve([a, b, c])
      })
      await settle()
      expect(container.querySelector('.thread-id').textContent).toBe('JC-2')
    })
  })
})
