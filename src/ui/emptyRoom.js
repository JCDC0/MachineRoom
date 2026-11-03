export const EMPTY_ROOM_TEXT =
  'This folder is empty. Open another project in Projects, or start a lane in Dispatch with C.'

export function emptyRoomLine({ live = false, simulated = false, status = '', files = 0, agents = [] } = {}) {
  if (!live || simulated) return ''
  if (status !== 'live') return ''
  if (Number(files) > 0) return ''
  const roster = Array.isArray(agents) ? agents : []
  if (roster.some((agent) => Number(agent?.runs) > 0)) return ''
  return EMPTY_ROOM_TEXT
}
