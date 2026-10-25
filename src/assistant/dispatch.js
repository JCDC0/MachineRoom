import { validateAction } from './actions.js'

const done = (message = '') => ({ ok: true, message })
const refused = (message) => ({ ok: false, message })

export function createDispatcher(host) {
  const nameOf = (key) => host.agentName?.(key) ?? key

  function openConfig({ agent, section }) {
    const name = nameOf(agent)
    if (section === 'budget') {
      host.openPanel('meters')
      return done('Budgets are in the Meters panel.')
    }
    host.focusAgent(agent, 'close')
    if (section === 'keys') return done(`The masked key form for ${name} is not built yet (task A6). Nothing was stored.`)
    if (typeof host.client?.hireAgent !== 'function') return done(`The ${section} settings for ${name} need the agent builder, which this connection does not offer.`)
    host.openPanel('agents')
    return done(`Opened the Agents tab. Pick ${name} in the list to change its ${section} settings.`)
  }

  function read(action) {
    switch (action.type) {
      case 'focus_agent':
        host.focusAgent(action.agent, action.view)
        return done()
      case 'focus_terminal':
        return host.focusTerminal(action.agent) ? done() : refused(`${nameOf(action.agent)} has no terminal in the room.`)
      case 'focus_path':
        return host.focusPath(action.path) ? done() : refused('That folder or file is not in the room yet.')
      case 'overview':
        host.overview()
        return done()
      case 'follow':
        host.setFollow(action.mode === 'off' ? false : action.mode)
        return done()
      case 'open_panel':
        host.openPanel(action.tab)
        return done()
      case 'open_issue':
        host.openPanel('tasks', action.identifier)
        return done()
      case 'open_config':
        return openConfig(action)
      case 'open_log':
        host.pressKey('l')
        return done()
      case 'open_help':
        host.pressKey('?')
        return done()
      case 'replay': {
        const result = host.replay(action.op, action.value)
        return result.ok ? done(result.message) : refused(result.message)
      }
      default:
        return refused('That request is not allowed.')
    }
  }

  async function run(action, { confirmed = false } = {}) {
    const checked = validateAction(action, host.context())
    if (!checked.ok) return refused('That request is not allowed.')
    if (checked.confirm && !confirmed) return refused('That needs your confirmation first.')
    try {
      return read(checked.action)
    } catch (error) {
      return refused(error?.message || 'The request failed.')
    }
  }

  return { run }
}

export function createAssistantRunner(dispatcher) {
  return (action, options) => dispatcher.run(action, { confirmed: options?.confirmed === true })
}
