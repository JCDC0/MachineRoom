import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { familyTopOptions } from '../src/Stage.jsx'

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
})
