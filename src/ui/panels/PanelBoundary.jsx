import { Component } from 'react'

const MESSAGE_LIMIT = 120

export function panelStoppedText(error) {
  const raw = error && typeof error === 'object' ? error.message : error
  const message = typeof raw === 'string' ? raw : ''
  const shown = message.length > 0 ? message.slice(0, MESSAGE_LIMIT) : 'no message'
  return `This panel stopped: ${shown}. Pick another tab, then come back.`
}

export default class PanelBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel-boundary-message" role="alert">
          {panelStoppedText(this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}
