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
 */

import { lazy, Suspense, useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { migrateFromLocalStorage } from '@/storage/migrate';
import { SiteNav } from '@/components/layout/SiteNav';
import { CaseDocket } from '@/components/docket/CaseDocket';
import { PasswordGate } from '@/pages/PasswordGate';
import { HomePage } from '@/pages/HomePage';
import { CaseDashboard } from '@/pages/CaseDashboard';
import { ResearchResolver } from '@/engines/ResearchResolver';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { T } from '@/constants/tokens';

const SanMode = lazy(() => import('@/engines/SanMode').then(m => ({ default: m.SanMode })));

export function App() {
  const { view, docketOpen, setView } = useAppStore();

  useEffect(() => {
    migrateFromLocalStorage().catch(console.error);
  }, []);

  return (
    <>
      <SiteNav />

      <div id="root-inner">
        <ErrorBoundary name="App">
          {view === 'gate'     && <PasswordGate />}
          {view === 'home'     && <HomePage />}
          {view === 'engine'   && <CaseDashboard />}
          {view === 'resolver' && <ResearchResolver onBack={() => setView('home')} />}
          {view === 'san'      && (
            <Suspense fallback={<p style={{ color: T.mute, fontFamily: 'Inter, sans-serif', fontSize: 13, padding: 32 }}>Loading SAN Mode…</p>}>
              <div style={{ animation: 'fadeUp .3s ease' }}>
                <button
                  onClick={() => setView('home')}
                  style={{
                    background: 'none', border: `1px solid ${T.bdr}`,
                    borderRadius: 5, color: T.mute, padding: '7px 16px',
                    fontSize: 12, fontFamily: 'Inter, sans-serif',
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
    </>
  );
}
