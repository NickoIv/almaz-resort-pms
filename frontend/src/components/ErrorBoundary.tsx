import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Stops one broken component from blanking the whole app.
 *
 * Without this, a render error anywhere unmounts the entire React tree and the
 * user sees an empty page — which reads as "the button does nothing" rather
 * than as an error.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="content">
        <div className="panel glass" style={{ maxWidth: 620, margin: '48px auto' }}>
          <div className="panel-title">Что-то пошло не так</div>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>
            Страница не смогла отобразиться. Данные не потеряны — попробуйте обновить.
          </p>
          <pre className="digest-preview" style={{ marginTop: 14 }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Обновить страницу
            </button>
            <button className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
              Попробовать снова
            </button>
          </div>
        </div>
      </div>
    )
  }
}