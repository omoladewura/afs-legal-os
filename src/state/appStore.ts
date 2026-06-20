/**
 * AFS Advocates — App State Store (Zustand)
 *
 * Centralized state for UI navigation and the active case.
 * Does NOT store case data — that lives in IndexedDB via storage/helpers.
 *
 * AUTH DESIGN (hard-refresh safe):
 *   Auth is stored in sessionStorage, BUT cleared on hard refresh via
 *   PerformanceNavigationTiming detection. Result:
 *     - In-session navigation (tab switches, view changes): stays logged in
 *     - Hard refresh (Ctrl+R / reload button): clears auth → password gate
 *     - New tab: sessionStorage is per-tab → password gate
 *     - Mobile: killing the app and reopening → password gate
 *
 * BACK BUTTON DESIGN:
 *   Every view + dashTab change pushes a history.pushState entry.
 *   App.tsx listens to popstate and restores view/tab from the popped state.
 *   This makes the browser back button and phone back button work at every
 *   navigation level: gate → home → engine → tab.
 */

import { create } from 'zustand';
import type { Case, AppView, DashTabId } from '@/types';

// ── Docket filter type ─────────────────────────────────────────────────────
export type DocketFilter = 'all' | 'frep' | 'matrimonial';

// ─────────────────────────────────────────────────────────────────────────────
// HARD-REFRESH DETECTION
// Runs before the store initialises so the initial auth read is correct.
// ─────────────────────────────────────────────────────────────────────────────

(function clearAuthOnHardRefresh() {
  try {
    const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entries.length > 0 && entries[0].type === 'reload') {
      sessionStorage.removeItem('afs_auth');
      return;
    }
  } catch { /* ignore */ }
  // Fallback for browsers without PerformanceNavigationTiming
  try {
    if ((performance as any).navigation?.type === 1) {
      sessionStorage.removeItem('afs_auth');
    }
  } catch { /* ignore */ }
})();

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export interface NavHistoryState {
  afsView:    AppView;
  afsDashTab: DashTabId;
  afsCaseId:  string | null;
}

export function pushNavState(view: AppView, dashTab: DashTabId, caseId: string | null) {
  const state: NavHistoryState = { afsView: view, afsDashTab: dashTab, afsCaseId: caseId };
  const hash = (view === 'engine' || view === 'matrimonial')
    ? `#${view}/${dashTab}`
    : `#${view}`;
  try { history.pushState(state, '', hash); } catch { /* ignore cross-origin/iframe */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

interface AppState {
  isAuthenticated: boolean;
  authenticate:    () => void;

  view:     AppView;
  setView:  (v: AppView) => void;

  activeCase:       Case | null;
  setActiveCase:    (c: Case | null) => void;
  updateActiveCase: (patch: Partial<Case>) => void;

  dashTab:    DashTabId;
  setDashTab: (t: DashTabId) => void;

  globalError:    string;
  setGlobalError: (msg: string) => void;
  clearError:     () => void;

  docketOpen:    boolean;
  setDocketOpen: (open: boolean) => void;

  docketFilter:    DocketFilter;
  setDocketFilter: (f: DocketFilter) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: (() => {
    try { return sessionStorage.getItem('afs_auth') === '1'; } catch { return false; }
  })(),

  authenticate: () => {
    try { sessionStorage.setItem('afs_auth', '1'); } catch { }
    const newView: AppView   = 'home';
    const newTab:  DashTabId = 'overview';
    pushNavState(newView, newTab, null);
    set({ isAuthenticated: true, view: newView, dashTab: newTab });
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  // After hard-refresh the IIFE above will have cleared sessionStorage, so
  // this correctly initialises to 'gate'. After authenticate() it's 'home'.
  view: (() => {
    try { return sessionStorage.getItem('afs_auth') === '1' ? 'home' : 'gate'; }
    catch { return 'gate'; }
  })() as AppView,

  setView: (v) => {
    const { dashTab, activeCase } = get();
    pushNavState(v, dashTab, activeCase?.id ?? null);
    set({ view: v });
  },

  // ── Active case ───────────────────────────────────────────────────────────
  activeCase:    null,
  setActiveCase: (c) => {
    const newTab: DashTabId = 'overview';
    const view = get().view;
    pushNavState(view, newTab, c?.id ?? null);
    set({ activeCase: c, dashTab: newTab });
  },
  updateActiveCase: (patch) =>
    set((s) =>
      s.activeCase ? { activeCase: { ...s.activeCase, ...patch } } : {}
    ),

  // ── Dashboard tab ─────────────────────────────────────────────────────────
  dashTab:    'overview',
  setDashTab: (t) => {
    const { view, activeCase } = get();
    pushNavState(view, t, activeCase?.id ?? null);
    set({ dashTab: t });
  },

  // ── Global error ──────────────────────────────────────────────────────────
  globalError:    '',
  setGlobalError: (msg) => set({ globalError: msg }),
  clearError:     () => set({ globalError: '' }),

  // ── Docket overlay ────────────────────────────────────────────────────────
  docketOpen:    false,
  setDocketOpen: (open) => set({ docketOpen: open }),

  // ── Docket filter ─────────────────────────────────────────────────────────
  docketFilter:    'all',
  setDocketFilter: (f) => set({ docketFilter: f }),
}));
