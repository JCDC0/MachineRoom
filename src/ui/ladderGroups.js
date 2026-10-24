const SUB_PREFIX = 'sub-'

function subEntries(ladder) {
  const subs = ladder && Array.isArray(ladder.subs) ? ladder.subs : []
  const entries = []
  const ids = new Set()
  for (const sub of subs) {
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) continue
    const id = typeof sub.id === 'string' ? sub.id.trim() : ''
    if (!id || id === 'orchestrator' || ids.has(id)) continue
    ids.add(id)
    entries.push({
      id,
      name: typeof sub.name === 'string' && sub.name.trim() ? sub.name.trim() : id,
      lanes: Array.isArray(sub.lanes)
        ? sub.lanes.filter((lane) => typeof lane === 'string' && lane)
        : [],
    })
  }
  return entries
}

function section(key, kind, header, indent) {
  return {
    key,
    kind,
    header,
    indent,
    rows: [],
    idleRows: [],
    idleCount: 0,
    idleOpen: false,
  }
}

export function ladderGroups(rows, ladder) {
  const subs = subEntries(ladder)
  if (subs.length === 0) return null

  const orchestrator = section('orchestrator', 'orchestrator', null, 0)
  const subSections = subs.map((sub) =>
    section(
      `sub-${sub.id}`,
      'sub',
      { name: sub.name, state: 'idle', laneCount: sub.lanes.length },
      16
    )
  )
  const main = section('main', 'main', { name: 'Main', state: null, laneCount: 0 }, 0)
  const sectionForSub = new Map(subs.map((sub, index) => [sub.id, subSections[index]]))
  const sectionForLane = new Map()
  subs.forEach((sub, index) => {
    for (const lane of sub.lanes) {
      if (!sectionForLane.has(lane)) sectionForLane.set(lane, subSections[index])
    }
  })

  let owner = null
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.agent) continue
    const depth = Number.isInteger(row.depth) ? row.depth : 0
    let listed = true
    if (depth === 0) {
      const key = String(row.agent.key ?? '')
      if (key.startsWith(SUB_PREFIX)) {
        owner = sectionForSub.get(key.slice(SUB_PREFIX.length)) ?? null
        listed = false
        if (owner) owner.header.state = row.agent.status ?? 'idle'
      } else if (row.group === 'orchestrator') {
        owner = orchestrator
      } else {
        owner = sectionForLane.get(key) ?? main
      }
    }
    if (!owner || !listed) continue
    const copy = { ...row, number: null }
    if (row.group === 'idle') {
      owner.idleRows.push(copy)
      if (depth === 0) owner.idleCount += 1
    } else {
      owner.rows.push(copy)
    }
  }

  main.header.laneCount =
    main.rows.filter((row) => row.depth === 0).length + main.idleCount

  const groups = []
  if (orchestrator.rows.length > 0 || orchestrator.idleRows.length > 0) {
    groups.push(orchestrator)
  }
  groups.push(...subSections)
  if (main.rows.length > 0 || main.idleRows.length > 0) groups.push(main)

  const top = []
  let number = 0
  for (const group of groups) {
    group.idleOpen = group.idleRows.some((row) => row.visible)
    for (const row of group.rows) {
      if (row.depth !== 0) continue
      number += 1
      row.number = number
      top.push(row.agent)
    }
    if (!group.idleOpen) continue
    for (const row of group.idleRows) {
      if (row.depth !== 0) continue
      number += 1
      row.number = number
      top.push(row.agent)
    }
  }

  return { groups, top }
}
