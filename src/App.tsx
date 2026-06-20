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

import { lazy, Suspense, useEffect } from 'react';
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

export function App() {
  const {
    view, docketOpen, setView, setDockOpen,
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
