import { Component, type ReactNode } from 'react';

/** Shows what broke instead of leaving a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="setup">
        <h1>El simulador ha fallado</h1>
        <pre className="notice">{error.stack ?? error.message}</pre>
        <button onClick={() => location.reload()}>Recargar</button>
      </div>
    );
  }
}
