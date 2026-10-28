import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Shows a recovery screen instead of a blank page if something unexpected breaks.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('Swipe Cover crashed.', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-[100svh] place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">Reloading usually fixes it. Your leaderboard times are saved.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-2xl bg-mint px-5 py-3 text-sm font-bold text-[#102019]"
          >
            Reload
          </button>
        </div>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
