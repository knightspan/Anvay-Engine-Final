// src/main.jsx
import { Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'leaflet/dist/leaflet.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{
        background: '#030508', color: '#EF4444',
        fontFamily: 'monospace', padding: 40,
        fontSize: 13, lineHeight: 1.8
      }}>
        <div style={{ color: '#00D4FF', fontSize: 16, marginBottom: 16 }}>
          ANVAY — Runtime Error
        </div>
        <div>{this.state.error.message}</div>
        <div style={{ color: '#334155', marginTop: 12, fontSize: 11 }}>
          Open F12 → Console for full details
        </div>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)