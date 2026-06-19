import React from 'react';

// Captura errores de render para que un fallo en un panel no deje la
// pantalla en negro: muestra el mensaje real (útil para diagnosticar).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          margin: 18, padding: 16, border: '1px solid #4a2f28', borderRadius: 4,
          background: 'rgba(217,119,87,0.08)', color: '#d97757',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 13, lineHeight: 1.6
        }}>
          <strong>Error al renderizar esta vista.</strong>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8, color: '#e8b86a' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, background: 'transparent', border: '1px solid #d97757', color: '#d97757', padding: '4px 10px', borderRadius: 3, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
