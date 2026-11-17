import { Component } from 'react'

export default class RoomBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      const raw = this.state.error?.message
      const message = typeof raw === 'string' && raw ? raw.slice(0, 120) : 'no message'
      return (
        <div className="room-boundary" role="alert">
          <p>The room stopped: {message}.</p>
          <button type="button" onClick={() => location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
