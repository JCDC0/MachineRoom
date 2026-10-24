export function healthNotice(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return null
  }

  if (health.error === true) {
    return {
      tone: 'red',
      title: 'The bridge is not answering',
      lines: [],
    }
  }

  if (health.ok === false) {
    const lines = []
    if (typeof health.error === 'string' && health.error.trim() !== '') {
      lines.push(health.error.trim())
    }
    return {
      tone: 'red',
      title: 'A source failed',
      lines,
    }
  }

  return null
}

export default healthNotice
