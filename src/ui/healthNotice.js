function sourceLines(health) {
  if (!Array.isArray(health.problems)) {
    return []
  }

  const lines = []
  for (const problem of health.problems) {
    if (typeof problem !== 'string') {
      continue
    }
    const text = problem.trim()
    if (text.length > 0) {
      lines.push(text)
    }
  }
  return lines
}

export function healthNotice(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return null
  }

  if (health.ok !== false) {
    const lines = sourceLines(health)
    if (lines.length > 0) {
      return {
        tone: 'red',
        title: 'A source looks stopped',
        lines,
      }
    }
  }

  if (health.ok !== false && health.runner?.alive === false) {
    return {
      tone: 'red',
      title: 'The runner looks stopped',
      lines: [],
    }
  }

  return null
}

export default healthNotice
