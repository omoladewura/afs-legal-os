/**
 * AFS Advocates — Root App Component
 *
 * Top-level view router. Renders the correct page based on app state.
 *
 * View flow:
 *   'gate'     → PasswordGate
 *   'home'     → HomePage (3 entry points: Docket, SAN, Billions)
 *   'engine'   → CaseDashboard (active case workspace)
 *   'resolver' → ResearchResolver (standalone tool)
 *   'san'      → SanMode (standalone)
 *   'settings' → SettingsPanel (library management, system info)
 *
 * BACK BUTTON (browser + phone):
 *   popstate listener restores view and dashTab from history.state.
 *   If the popped state is 'gate' or unauthenticated, we log out cleanly.
 *   Cases are loaded from IndexedDB by CaseDashboard when activeCase is null
 *   but view is 'engine' — handled by re-opening the docket in that scenario.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import type { NavHistoryState } from '@/state/appStore';
import { db } from '@/storage/db';
import { migrateFromLocalStorage } from '@/storage/migrate';
import { saveCase } from '@/storage/helpers';
import { applyLawOverrides } from '@/constants/periodRules';
import { SiteNav } from '@/components/layout/SiteNav';
import { CaseDocket } from '@/components/docket/CaseDocket';
import { PasswordGate } from '@/pages/PasswordGate';
import { HomePage } from '@/pages/HomePage';
import { CaseDashboard } from '@/pages/CaseDashboard';
import { ResearchResolver } from '@/engines/ResearchResolver';
import { SettingsPanel } from '@/pages/SettingsPanel';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ToastHost } from '@/components/common/ui';
import { FloatingEngines } from '@/components/FloatingEngines';
import { MatrimonialDashboard } from '@/matrimonial/MatrimonialDashboard';
import { T } from '@/constants/tokens';
import type { AppView, DashTabId } from '@/types';

const SanMode = lazy(() => import('@/engines/SanMode').then(m => ({ default: m.SanMode })));

/**
 * Phase 9D — Offline banner.
 *
 * Shown as a slim persistent strip at the top of the viewport whenever:
 *   a) `navigator.onLine` is false (device-level connectivity lost), OR
 *   b) a Worker call fails with a network error (emitted via 'afs:worker-offline').
 *
 * Either condition shows the banner; clearing requires both to be resolved —
 * the device coming back online AND a subsequent successful Worker call
 * ('afs:worker-online'). This avoids false-clearing when Wi-Fi reconnects
 * but the Worker is still unreachable.
 *
 * The banner is subtle, not alarming — a single line above the app chrome
 * so it's visible mid-session without obscuring the workspace.
 */
function OfflineBanner() {
  const [deviceOffline,  setDeviceOffline]  = useState(!navigator.onLine);
  const [workerOffline,  setWorkerOffline]  = useState(false);

  useEffect(() => {
    const onOnline  = () => setDeviceOffline(false);
    const onOffline = () => setDeviceOffline(true);
    const onWOff    = () => setWorkerOffline(true);
    const onWOn     = () => setWorkerOffline(false);

    window.addEventListener('online',              onOnline);
    window.addEventListener('offline',             onOffline);
    window.addEventListener('afs:worker-offline',  onWOff);
    window.addEventListener('afs:worker-online',   onWOn);

    return () => {
      window.removeEventListener('online',              onOnline);
      window.removeEventListener('offline',             onOffline);
      window.removeEventListener('afs:worker-offline',  onWOff);
      window.removeEventListener('afs:worker-online',   onWOn);
    };
  }, []);

  if (!deviceOffline && !workerOffline) return null;

  const msg = deviceOffline
    ? 'No connection — working from local data'
    : 'AI services unreachable — connection interrupted';

  return (
    <div style={{
      position:       'fixed',
      top:            0,
      left:           0,
      right:          0,
      zIndex:         100000,
      background:     '#1a1200',
      borderBottom:   `1px solid ${T.warn}`,
      color:          T.warn,
      fontSize:       11,
      fontFamily:     "'Inter', sans-serif",
      letterSpacing:  '0.04em',
      padding:        '5px 16px',
      display:        'flex',
      alignItems:     'center',
      gap:            8,
    }}>
      <span style={{ opacity: 0.7 }}>◌</span>
      {msg}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2F — Home-screen install nudge
//
// iOS Safari does not fire `beforeinstallprompt` — the only path to reliable
// offline caching on iOS is installing to the home screen via the Share Sheet.
// Without that, Safari aggressively evicts cached assets under storage pressure,
// breaking offline mode silently. This nudge prompts once, after the user has
// authenticated and is actively using the app in browser (non-standalone) mode.
//
// Android Chrome: captures `beforeinstallprompt` and shows the native prompt
// on tap, which is more reliable than the manual share-sheet flow.
//
// Dismiss flag stored in localStorage (device-level UI preference — not case
// data, so localStorage is appropriate here and survives PWA reinstall exactly
// when it should: a reinstalled PWA is already standalone and won't show this).
// ─────────────────────────────────────────────────────────────────────────────

const INSTALL_DISMISSED_KEY = 'afs_install_nudge_dismissed_v1';

function InstallNudge() {
  const [show,       setShow]       = useState(false);
  const [deferredEvt, setDeferredEvt] = useState<Event | null>(null);
  const [installed,  setInstalled]  = useState(false);

  useEffect(() => {
    // Already standalone — running as installed PWA, never show.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Already dismissed by user.
    try {
      if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
    } catch { /**/ }

    // Show nudge — slight delay so it doesn't compete with app paint.
    const t = setTimeout(() => setShow(true), 3000);

    // Android: capture the native prompt event so we can trigger it on tap.
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredEvt(e);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Hide if app becomes standalone mid-session (Android install completes).
    function onAppInstalled() { setInstalled(true); setShow(false); }
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch { /**/ }
  }

  async function handleInstall() {
    if (deferredEvt) {
      // Android — trigger native prompt.
      (deferredEvt as any).prompt?.();
      const { outcome } = await (deferredEvt as any).userChoice ?? {};
      if (outcome === 'accepted') setInstalled(true);
    }
    dismiss();
  }

  if (!show || installed) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const SERIF = "'Times New Roman', Times, serif";

  return (
    <div style={{
      position:     'fixed',
      bottom:       24,
      left:         '50%',
      transform:    'translateX(-50%)',
      zIndex:       99999,
      width:        'min(92vw, 420px)',
      background:   '#0d0d1c',
      border:       `1px solid #3a3a5a`,
      borderRadius: 10,
      padding:      '18px 20px',
      boxShadow:    '0 8px 32px rgba(0,0,0,0.6)',
      animation:    'fadeUp .3s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📲</span>
          <span style={{ fontSize: 13, color: '#e8e8f8', fontFamily: SERIF, fontWeight: 600 }}>
            Add AFS Legal OS to your home screen
          </span>
        </div>
        <button
          onClick={dismiss}
          style={{ background: 'none', border: 'none', color: '#505068', fontSize: 16, cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1 }}
          aria-label="Dismiss"
        >×</button>
      </div>

      {/* Body */}
      <p style={{ fontSize: 12, color: '#8080a0', fontFamily: SERIF, lineHeight: 1.65, marginBottom: 14 }}>
        {isIOS
          ? 'Required for reliable offline access on iOS. Without installation, Safari may clear cached data and break offline mode.'
          : 'Install for reliable offline access and faster loading — works without a connection once installed.'}
      </p>

      {/* iOS instructions */}
      {isIOS && (
        <div style={{
          background: '#0a0a18', border: '1px solid #2a2a40', borderRadius: 6,
          padding: '10px 14px', marginBottom: 14,
        }}>
          <p style={{ fontSize: 11, color: '#c0c0d8', fontFamily: SERIF, lineHeight: 1.8, margin: 0 }}>
            1. Tap the <strong style={{ color: '#e8e8f8' }}>Share</strong> button (□↑) in Safari's toolbar<br />
            2. Scroll down and tap <strong style={{ color: '#e8e8f8' }}>Add to Home Screen</strong><br />
            3. Tap <strong style={{ color: '#e8e8f8' }}>Add</strong> — then open AFS from your home screen
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        {!isIOS && deferredEvt && (
          <button
            onClick={handleInstall}
            style={{
              flex: 1, background: '#3a3a6a', border: '1px solid #6060a0',
              color: '#e8e8f8', borderRadius: 6, padding: '9px 14px',
              fontSize: 12, fontFamily: SERIF, cursor: 'pointer', fontWeight: 600,
            }}
          >
            Install now
          </button>
        )}
        <button
          onClick={dismiss}
          style={{
            flex: isIOS || !deferredEvt ? 1 : 0,
            background: 'none', border: '1px solid #2a2a40',
            color: '#6060a0', borderRadius: 6, padding: '9px 14px',
            fontSize: 12, fontFamily: SERIF, cursor: 'pointer',
          }}
        >
          {isIOS ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const {
    view, docketOpen, setView,
    isAuthenticated, dashTab, setDashTab,
    activeCase, setActiveCase, setDocketOpen,
  } = useAppStore();

  // ── One-time startup tasks ──────────────────────────────────────────────
  useEffect(() => {
    migrateFromLocalStorage().catch(console.error);
    applyLawOverrides().catch(console.error);

    // Push initial history entry so the very first back-press has somewhere to go.
    // Only if there's no AFS state already in history (e.g. page just loaded).
    if (!history.state?.afsView) {
      const initialView = useAppStore.getState().view;
      const initialTab  = useAppStore.getState().dashTab;
      history.replaceState(
        { afsView: initialView, afsDashTab: initialTab, afsCaseId: null } satisfies NavHistoryState,
        '',
        `#${initialView}`,
      );
    }

    // One-time migration: push any existing IndexedDB cases up to D1
    const D1_MIGRATED_KEY = 'afs_d1_migrated_v1';
    if (!localStorage.getItem(D1_MIGRATED_KEY)) {
      db.cases.toArray().then(async (cases) => {
        if (cases.length === 0) return;
        await Promise.all(cases.map(c => saveCase(c)));
        localStorage.setItem(D1_MIGRATED_KEY, '1');
      }).catch(() => {});
    }
  }, []);

  // ── Back / forward button handler ───────────────────────────────────────
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as NavHistoryState | null;

      // No AFS state in history entry (e.g. browser navigated outside app).
      // Go to gate for safety.
      if (!state?.afsView) {
        useAppStore.setState({ isAuthenticated: false, view: 'gate', activeCase: null });
        try { sessionStorage.removeItem('afs_auth'); } catch { }
        return;
      }

      const { afsView, afsDashTab, afsCaseId } = state;

      // If back-navigating to gate, treat as logout.
      if (afsView === 'gate') {
        useAppStore.setState({ isAuthenticated: false, view: 'gate', activeCase: null });
        try { sessionStorage.removeItem('afs_auth'); } catch { }
        return;
      }

      // Not authenticated but history has a non-gate view — force gate.
      if (!useAppStore.getState().isAuthenticated) {
        useAppStore.setState({ view: 'gate' });
        return;
      }

      // Restore view and tab without pushing new history (we're popping).
      const currentCase = useAppStore.getState().activeCase;

      if (afsView === 'engine' || afsView === 'matrimonial') {
        // If the case we're navigating back to is already loaded, just restore the tab.
        if (currentCase && currentCase.id === afsCaseId) {
          useAppStore.setState({ view: afsView, dashTab: afsDashTab as DashTabId });
          return;
        }
        // Case not loaded — go home and open the docket so user can re-select.
        // (We can't restore the full case object from history state alone —
        // IndexedDB load is async and we don't want to block the popstate handler.)
        useAppStore.setState({ view: 'home', activeCase: null });
        return;
      }

      useAppStore.setState({ view: afsView as AppView, dashTab: afsDashTab as DashTabId });
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <>
      <OfflineBanner />
      {isAuthenticated && <InstallNudge />}
      <SiteNav />

      <div id="root-inner">
        <ErrorBoundary name="App">
          {view === 'gate'        && <PasswordGate />}
          {view === 'home'        && <HomePage />}
          {view === 'engine'      && <CaseDashboard />}
          {view === 'matrimonial' && <MatrimonialDashboard />}
          {view === 'resolver'    && <ResearchResolver onBack={() => setView('home')} />}
          {view === 'settings'    && <SettingsPanel />}
          {view === 'san'      && (
            <Suspense fallback={<p style={{ color: T.mute, fontFamily: "'Times New Roman', Times, serif", fontSize: 13, padding: 32 }}>Loading SAN Mode…</p>}>
              <div style={{ animation: 'fadeUp .3s ease' }}>
                <button
                  onClick={() => setView('home')}
                  style={{
                    background: 'none', border: `1px solid ${T.bdr}`,
                    borderRadius: 5, color: T.mute, padding: '7px 16px',
                    fontSize: 12, fontFamily: "'Times New Roman', Times, serif",
                    cursor: 'pointer', marginBottom: 24,
                  }}
                >
                  ← Back
                </button>
                <SanMode activeCase={null} />
              </div>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>

      {docketOpen && <CaseDocket />}

      {/* Floating AI Copilot + Applications Engine — case workspaces only */}
      {(view === 'engine' || view === 'matrimonial') && <FloatingEngines />}

      <ToastHost />
    </>
  );
}
