import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { familyTopOptions, refreshFamily } from '../src/Stage.jsx'

describe('the top options Stage hands the room from the family answer', () => {
  it('passes the pin and a saved main conversation only when the answer says so', () => {
    expect(familyTopOptions({ top: 'orchestrator', pinned: true, mainHasConversation: true })).toEqual({ pinned: true, mainHasConversation: true })
    expect(familyTopOptions({ top: 'orchestrator', pinned: 'yes', mainHasConversation: 1 })).toEqual({ pinned: false, mainHasConversation: false })
    expect(familyTopOptions(null)).toEqual({ pinned: false, mainHasConversation: false })
  })

  it('gives both setChosenTop calls the options', () => {
    const stage = readFileSync(new URL('../src/Stage.jsx', import.meta.url), 'utf8')
    expect(stage).toContain('room.setChosenTop?.(latestTopRef.current, latestTopOptionsRef.current)')
    expect(stage).toContain('roomRef.current?.setChosenTop?.(top, topOptions)')
    expect(stage).toContain('familyTopOptions(answer))')
  })

  it('keeps the last answer, the pin included, when a refresh fails', async () => {
    const answers = [Promise.resolve({ top: 'orchestrator', pinned: true }), Promise.reject(new Error('offline'))]
    const client = { family: () => answers.shift() }
    const seen = []
    expect(await refreshFamily(client, () => true, (answer) => seen.push(familyTopOptions(answer)))).toBe(true)
    expect(await refreshFamily(client, () => true, (answer) => seen.push(familyTopOptions(answer)))).toBe(false)
    expect(seen).toEqual([{ pinned: true, mainHasConversation: false }])
    const stage = readFileSync(new URL('../src/Stage.jsx', import.meta.url), 'utf8')
    expect(stage).toContain('await refreshFamily(client, () => active && isLatest(), (answer) => {')
  })

  it('drops an answer that arrives after a newer refresh', async () => {
    const seen = []
    expect(await refreshFamily({ family: async () => ({ top: 'claude-session' }) }, () => false, (answer) => seen.push(answer))).toBe(false)
    expect(seen).toEqual([])
  })
})
