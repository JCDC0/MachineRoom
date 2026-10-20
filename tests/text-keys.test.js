import { describe, expect, it } from 'vitest'
import { shapesFor } from '../src/engine/shapes.js'
import { parserFor, toAgents } from '../src/live/source.js'
import { backupNotice } from '../src/ui/panels/backup.js'
import { groupBriefsByOwner } from '../src/ui/panels/briefs.js'
import { approvalTypeLabel, statusLabel } from '../src/ui/panels/format.js'
import { openRank } from '../src/ui/panels/TasksPanel.jsx'

const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']

describe('lookups keyed by text from Paperclip or a brief', () => {
  it('label a status or approval type named like an object key as plain text', () => {
    for (const name of NAMES) {
      expect(statusLabel(name), name).toBe(name.replace(/_/g, ' '))
      expect(approvalTypeLabel(name), name).toBe(name.replace(/_/g, ' '))
    }
    expect(statusLabel('in_progress')).toBe('in progress')
  })

  it('rank such a task status last', () => {
    for (const name of NAMES) expect(openRank(name), name).toBe(99)
    expect(openRank('in_progress')).toBe(1)
  })

  it('show such a backup warning as its own text', () => {
    const notice = backupNotice({ enabled: true, latestAt: new Date().toISOString(), ageHours: 1, warnings: ['constructor', { code: 'toString' }] }, { now: Date.now() })
    const lines = notice?.lines ?? []
    expect(lines).toContain('constructor')
    expect(lines).toContain('toString')
    expect(lines.every((line) => typeof line === 'string')).toBe(true)
  })

  it('label such a brief owner with its own name', () => {
    const groups = groupBriefsByOwner([{ id: 'Z1', owner: 'constructor', title: 'x' }])
    expect(groups.map((group) => group.label)).toEqual(['constructor'])
  })

  it('give an agent with such an adapter type no parser and a text key', () => {
    for (const name of NAMES) {
      expect(parserFor({ adapterType: name, name: 'Bot' }), name).toBeNull()
      const [agent] = toAgents([{ id: 'a', name: 'Bot', adapterType: name }])
      expect(typeof agent.key, name).toBe('string')
      expect(agent.key).toBe('bot')
    }
  })

  it('pick a real shape for an agent whose key is such a name', () => {
    const shapes = shapesFor(NAMES.map((key) => ({ key, name: key })))
    expect(shapes.every((shape) => typeof shape === 'string')).toBe(true)
    expect(new Set(shapes).size).toBe(NAMES.length)
  })
})
