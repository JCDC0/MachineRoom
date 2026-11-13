import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import Settings from '../src/ui/Settings.jsx'
import StorageSettings, { formatBytes } from '../src/ui/StorageSettings.jsx'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

describe('StorageSettings', () => {
  it('hides when the client has no storage methods', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(StorageSettings, { client: null }))
      })
      expect(container.textContent).toBe('')
    })
  })

  it('shows sizes by kind, clean worktrees and command without executing cleanup', async () => {
    await withDom(async ({ container, root }) => {
      const mock = createMockClient({ latencyMs: 0 })
      const storageSpy = vi.spyOn(mock, 'storage')
      const previewSpy = vi.spyOn(mock, 'previewStorageArchive')
      const archiveSpy = vi.spyOn(mock, 'archiveStorage')

      await act(async () => {
        root.render(createElement(StorageSettings, { client: mock }))
      })
      await settle()

      expect(storageSpy).toHaveBeenCalledTimes(1)
      expect(previewSpy).not.toHaveBeenCalled()
      expect(archiveSpy).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Run logs')
      expect(container.textContent).toContain('4 files')
      expect(container.textContent).toContain('6.5 KB')
      expect(container.textContent).toContain('Recordings')
      expect(container.textContent).toContain('18 KB')
      expect(container.textContent).toContain('Saved conversations')
      expect(container.textContent).toContain('Lane worktrees')
      expect(container.textContent).toContain('opencode-2')
      expect(container.textContent).toContain('feat/merged-sample')
      expect(container.textContent).toContain('npm run worktrees -- --project MachineRoom --clean')
      expect(formatBytes(0)).toBe('0 B')
      expect(formatBytes(1536)).toBe('1.5 KB')
    })
  })

  it('validates days and requires preview then confirm card naming count and size before archive', async () => {
    await withDom(async ({ container, root, window }) => {
      const mock = createMockClient({ latencyMs: 0 })
      const previewSpy = vi.spyOn(mock, 'previewStorageArchive')
      const archiveSpy = vi.spyOn(mock, 'archiveStorage')
      const onClose = vi.fn()

      await act(async () => {
        root.render(createElement(Settings, { open: true, onClose, client: mock }))
      })
      await settle()

      const daysInput = container.querySelector('#mr-storage-days')
      expect(daysInput.value).toBe('30')

      await type(root, daysInput, '0')
      await click(root, buttonWithText(container, 'Preview'))
      await settle()
      expect(previewSpy).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Choose 1 to 365 days.')

      await type(root, daysInput, '40')
      await click(root, buttonWithText(container, 'Preview'))
      await settle()

      expect(previewSpy).toHaveBeenCalledWith({ days: 40 })
      expect(archiveSpy).not.toHaveBeenCalled()
      expect(container.textContent).toContain('3 files (4.5 KB) ready to move into archive/.')
      expect(container.textContent).toContain('agy-20260925-100000-001.log')

      await click(root, buttonWithText(container, 'Archive'))
      await settle()

      const confirmCard = container.querySelector('#mr-storage-confirm')
      expect(confirmCard).not.toBeNull()
      expect(confirmCard.textContent).toContain('3 files (4.5 KB) older than 40 days')
      expect(archiveSpy).not.toHaveBeenCalled()

      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      await settle()
      expect(container.querySelector('#mr-storage-confirm')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect(archiveSpy).not.toHaveBeenCalled()

      await click(root, buttonWithText(container, 'Archive'))
      await settle()
      const reopenedCard = container.querySelector('#mr-storage-confirm')
      await click(root, buttonWithText(reopenedCard, 'Confirm archive'))
      await settle()

      expect(archiveSpy).toHaveBeenCalledWith({
        days: 40,
        files: [
          'agy-20260925-100000-001.log',
          'agy-20260925-100000-001.meta.json',
          'agy-20260925-100000-001.usage.json',
        ],
        confirmed: true,
      })
      expect(container.querySelector('#mr-storage-confirm')).toBeNull()
      expect(container.textContent).toContain('Moved 3 files (4.5 KB) to archive.')
      expect(container.textContent).toContain('1 file')
      expect(container.textContent).toContain('2 KB')

      await click(root, buttonWithText(container, 'Preview'))
      await settle()
      expect(container.textContent).toContain('No finished files older than 40 days to archive.')
      expect(buttonWithText(container, 'Archive')).toBeNull()
    })
  })

  it('sends only the previewed files and shows skipped files when eligibility changes before confirm', async () => {
    await withDom(async ({ container, root }) => {
      let currentLogs = [
        { name: 'agy-20260920-100000-001.log', bytes: 2048, archiveDir: 'archive/2026-09' },
        { name: 'agy-20260921-100000-001.log', bytes: 1024, archiveDir: 'archive/2026-09' },
      ]
      const archiveCalls = []
      const fakeClient = {
        storage: async () => ({
          runsFolder: 'MachineRoom/runs',
          projectRoot: 'MachineRoom',
          kinds: {
            logs: { count: currentLogs.length, bytes: currentLogs.reduce((sum, item) => sum + item.bytes, 0) },
            recordings: { count: 0, bytes: 0 },
            conversations: { count: 0, bytes: 0 },
            worktrees: { count: 0, bytes: 0 },
          },
          totalBytes: currentLogs.reduce((sum, item) => sum + item.bytes, 0),
          worktrees: { count: 0, bytes: 0, clean: [], command: '' },
        }),
        previewStorageArchive: async ({ days }) => ({
          days,
          cutoff: '2026-10-14T12:00:00.000Z',
          count: currentLogs.length,
          totalBytes: currentLogs.reduce((sum, item) => sum + item.bytes, 0),
          files: currentLogs.map((item) => ({ ...item, kind: 'logs', mtimeMs: 1 })),
        }),
        archiveStorage: async ({ days, files, confirmed }) => {
          archiveCalls.push({ days, files, confirmed })
          const freshEligible = new Map([
            ['agy-20260920-100000-001.log', { name: 'agy-20260920-100000-001.log', kind: 'logs', bytes: 2048, archiveDir: 'archive/2026-09' }],
            ['agy-20260922-100000-001.log', { name: 'agy-20260922-100000-001.log', kind: 'logs', bytes: 4096, archiveDir: 'archive/2026-09' }],
          ])
          const moved = []
          const skipped = []
          for (const name of files) {
            const match = freshEligible.get(name)
            if (match) moved.push(match)
            else skipped.push({ name, reason: 'The file is no longer eligible.' })
          }
          currentLogs = [
            { name: 'agy-20260921-100000-001.log', bytes: 1024, archiveDir: 'archive/2026-09' },
            { name: 'agy-20260922-100000-001.log', bytes: 4096, archiveDir: 'archive/2026-09' },
          ]
          return {
            ok: true,
            days,
            count: moved.length,
            totalBytes: moved.reduce((sum, item) => sum + item.bytes, 0),
            moved,
            skipped,
          }
        },
      }

      await act(async () => {
        root.render(createElement(StorageSettings, { client: fakeClient }))
      })
      await settle()

      await click(root, buttonWithText(container, 'Preview'))
      await settle()
      await click(root, buttonWithText(container, 'Archive'))
      await settle()
      const confirmCard = container.querySelector('#mr-storage-confirm')
      await click(root, buttonWithText(confirmCard, 'Confirm archive'))
      await settle()

      expect(archiveCalls).toEqual([
        {
          days: 30,
          files: ['agy-20260920-100000-001.log', 'agy-20260921-100000-001.log'],
          confirmed: true,
        },
      ])
      expect(container.textContent).toContain('Moved 1 file (2 KB) to archive. Skipped 1 file no longer eligible.')
    })
  })
})
