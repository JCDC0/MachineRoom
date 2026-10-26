export function healthNotice(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return null
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
