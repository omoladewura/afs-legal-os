/**
 * AFS Advocates — App State Store (Zustand)
 *
 * Centralized state for UI navigation and the active case.
 * Does NOT store case data — that lives in IndexedDB via storage/helpers.
 *
 * WHAT LIVES HERE:
 *   - Authentication state (password gate)
 *   - Current view (gate | home | docket | engine)
 *   - Active case ID and loaded case object
 *   - Active dashboard tab
 *   - Global error/loading indicators
 *
 * WHAT DOES NOT LIVE HERE:
 *   - Case data (IndexedDB)
 *   - AI responses (component state)
 *   - Form fields (component state)
 */

import { create } from 'zustand';
import type { Case, AppView, DashTabId } from '@/types';

// ── Docket filter type ─────────────────────────────────────────────────────
export type DocketFilter = 'all' | 'frep' | 'matrimonial';

interface AppState {
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  authenticate:    () => void;

  // ── Navigation ────────────────────────────────────────────────────────────
  view:     AppView;
  setView:  (v: AppView) => void;

  // ── Active case ───────────────────────────────────────────────────────────
  activeCase:    Case | null;
  setActiveCase: (c: Case | null) => void;
  updateActiveCase: (patch: Partial<Case>) => void;

  // ── Dashboard tab ─────────────────────────────────────────────────────────
  dashTab:    DashTabId;
  setDashTab: (t: DashTabId) => void;

  // ── Global error (for auth failures etc) ─────────────────────────────────
  globalError:    string;
  setGlobalError: (msg: string) => void;
  clearError:     () => void;

  // ── Docket overlay ────────────────────────────────────────────────────────
  docketOpen:    boolean;
  setDocketOpen: (open: boolean) => void;

  // ── Docket filter ─────────────────────────────────────────────────────────
  docketFilter:    DocketFilter;
  setDocketFilter: (f: DocketFilter) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: (() => { try { return localStorage.getItem('afs_auth') === '1'; } catch { return false; } })(),
  authenticate: () => {
    try { localStorage.setItem('afs_auth', '1'); } catch { }
    set({ isAuthenticated: true, view: 'home' });
  },
  // ── Navigation — initialise from persisted auth so hard-refresh lands on home ──
  view: (() => { try { return localStorage.getItem('afs_auth') === '1' ? 'home' : 'gate'; } catch { return 'gate'; } })() as AppView,
  setView: (v) => set({ view: v }),

  // ── Active case ───────────────────────────────────────────────────────────
  activeCase:    null,
  setActiveCase: (c) => set({ activeCase: c, dashTab: 'overview' }),
  updateActiveCase: (patch) =>
    set((s) =>
      s.activeCase ? { activeCase: { ...s.activeCase, ...patch } } : {}
    ),

  // ── Dashboard tab ─────────────────────────────────────────────────────────
  dashTab:    'overview',
  setDashTab: (t) => set({ dashTab: t }),

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
