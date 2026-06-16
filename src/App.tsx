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
 */

import { lazy, Suspense, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { migrateFromLocalStorage } from '@/storage/migrate';
import { db } from '@/storage/db';
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
import { FloatingEngines } from '@/components/FloatingEngines';
import { MatrimonialDashboard } from '@/matrimonial/MatrimonialDashboard';
import { T } from '@/constants/tokens';

const SanMode = lazy(() => import('@/engines/SanMode').then(m => ({ default: m.SanMode })));

export function App() {
  const { view, docketOpen, setView } = useAppStore();

  useEffect(() => {
    migrateFromLocalStorage().catch(console.error);
    applyLawOverrides().catch(console.error);

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
    </>
  );
}
