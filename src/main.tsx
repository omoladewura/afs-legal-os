/**
 * AFS Advocates — Application Entry Point
 * Mounts the React app into #root.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Phase 9B — register the service worker unconditionally at app boot,
// independent of notification permission. Phase 9A's install/fetch/activate
// handlers (shell caching, offline fallback, deploy-cache purging) need to
// run for every visitor, not just those who opt into push notifications via
// AlertsEngine — that flow now just reads this registration when it needs
// to show a notification, it doesn't create one.
//
// Registration is deferred to the window 'load' event so it never competes
// with the initial page's own critical-resource fetches.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — the app works fully online without offline support.
    });
  });
}
