import { Component } from 'react'

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-bold text-slate-900">Something went wrong</p>
          <p className="max-w-md text-sm text-slate-500">{String(this.state.error?.message || this.state.error)}</p>
          <button className="btn-primary" onClick={() => window.location.reload()} type="button">
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
