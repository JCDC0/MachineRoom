import { describe, expect, it } from 'vitest'
import { EMPTY_ROOM_TEXT, emptyRoomLine } from '../src/ui/emptyRoom.js'

const room = { live: true, status: 'live', files: 0, agents: [] }

describe('the empty room line', () => {
  it('says why a live room with no files and no run is empty', () => {
    expect(emptyRoomLine(room)).toBe(
      'This folder is empty. Open another project in Projects, or start a lane in Dispatch with C.'
    )
    expect(emptyRoomLine({ ...room, agents: [{ key: 'orchestrator', runs: 0 }] })).toBe(EMPTY_ROOM_TEXT)
    expect(emptyRoomLine({ ...room, agents: [{ key: 'orchestrator' }] })).toBe(EMPTY_ROOM_TEXT)
  })

  it('goes away when a file or a run arrives', () => {
    expect(emptyRoomLine({ ...room, files: 1 })).toBe('')
    expect(emptyRoomLine({ ...room, agents: [{ key: 'opencode', runs: 1 }] })).toBe('')
    expect(emptyRoomLine({ ...room, agents: [{ key: 'opencode', runs: '2' }] })).toBe('')
  })

  it('never shows in a replay or a demo', () => {
    expect(emptyRoomLine({ ...room, live: false })).toBe('')
    expect(emptyRoomLine({ ...room, simulated: true, files: 0 })).toBe('')
  })

  it('waits for a connected feed and the first answer', () => {
    expect(emptyRoomLine({ ...room, status: 'connecting' })).toBe('')
    expect(emptyRoomLine({ ...room, status: 'reconnecting' })).toBe('')
    expect(emptyRoomLine({ ...room, status: 'disconnected' })).toBe('')
    expect(emptyRoomLine()).toBe('')
  })
})
