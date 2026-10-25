import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

// Global resilience handler: Catch and log unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.warn('[CrowdSense Global Error Boundary] Unhandled promise rejection caught:', {
    reason: event.reason,
    promise: event.promise,
  });
  // Prevent default termination if desired, preserving app state
  event.preventDefault();
});

// Global resilience handler: Catch unhandled runtime script errors
window.addEventListener('error', (event) => {
  console.warn('[CrowdSense Global Error Boundary] Unhandled script error caught:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    error: event.error,
  });
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
