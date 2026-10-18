import { describe, expect, it, vi } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { resolveIssue } from '../src/ui/panels/notices.js'

const fast = () => createMockClient({ latencyMs: 0, now: () => Date.parse('2026-10-19T00:00:00Z') })

describe('resolveIssue', () => {
  it('uses the list it has when the task is already in it', async () => {
    const client = fast()
    const issues = await client.issues()
    const reload = vi.fn(() => client.issues())
    const result = await resolveIssue('JC-19', issues, reload)
    expect(result.issue.identifier).toBe('JC-19')
    expect(result.issues).toBe(issues)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once for a task that was created after the list was read', async () => {
    const client = fast()
    const stale = await client.issues()
    const created = await client.createIssue({ title: 'Fresh task', assigneeAgentId: 'agent-opencode' })
    const reload = vi.fn(() => client.issues())
    const result = await resolveIssue(created.identifier, stale, reload)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.issue.id).toBe(created.id)
    expect(result.issues).toHaveLength(stale.length + 1)
  })

  it('returns no task and the fresh list when the task does not exist', async () => {
    const client = fast()
    const stale = await client.issues()
    const result = await resolveIssue('JC-999', stale, () => client.issues())
    expect(result.issue).toBeNull()
    expect(result.issues).toHaveLength(stale.length)
  })

  it('lets a failed reload reject, so the panel can say the task was not found', async () => {
    await expect(resolveIssue('JC-1', [], () => Promise.reject(new Error('down')))).rejects.toThrow('down')
  })
})
