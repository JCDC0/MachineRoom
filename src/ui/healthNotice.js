function withVersion(title, version) {
  if (typeof version === 'string' || typeof version === 'number') {
    const text = String(version).trim()
    if (text.length > 0) {
      return `${title} (Paperclip ${text})`
    }
  }
  return title
}

export function healthNotice(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return null
  }

  const version = health.paperclipVersion

  if (health.error === true) {
    return {
      tone: 'red',
      title: withVersion('The bridge is not answering', version),
      lines: [],
    }
  }

  if (health.lanes === true && health.paperclip !== true) {
    return null
  }

  if (health.paperclip === false) {
    return {
      tone: 'red',
      title: withVersion('Paperclip is not connected', version),
      lines: [],
    }
  }

  const surface = health.surface
  if (surface && typeof surface === 'object' && !Array.isArray(surface)) {
    if (surface.ok === false) {
      const missing = Array.isArray(surface.missing) ? surface.missing : []
      const changed = Array.isArray(surface.changed) ? surface.changed : []
      const count = missing.length + changed.length
      const noun = count === 1 ? 'route' : 'routes'
      const title = withVersion(`Paperclip changed: ${count} ${noun}`, version)
      const lines = []

      for (const item of missing) {
        if (item && item.method && item.path) {
          lines.push(`${item.method} ${item.path} is gone`)
        }
      }

      for (const item of changed) {
        if (item && item.method && item.path) {
          const seen = new Set()
          const fields = []
          for (const field of [...(item.bodyFields ?? []), ...(item.answerFields ?? [])]) {
            if (typeof field === 'string' && field && !seen.has(field)) {
              seen.add(field)
              fields.push(field)
            }
          }
          if (fields.length > 0) {
            lines.push(`${item.method} ${item.path}: no ${fields.join(', ')}`)
          } else {
            lines.push(`${item.method} ${item.path}: changed`)
          }
        }
      }

      return {
        tone: 'red',
        title,
        lines,
      }
    }

    if (surface.ok === null && surface.checkedAt != null && surface.checkedAt !== '') {
      return {
        tone: 'yellow',
        title: withVersion('Paperclip routes not checked', version),
        lines: surface.error != null && surface.error !== '' ? [String(surface.error)] : [],
      }
    }
  }

  return null
}

export default healthNotice
