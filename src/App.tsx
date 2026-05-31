/**
 * AFS Advocates — Root App Component
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
  const { view, docketOpen, setView, activeCase } = useAppStore();

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
                {activeCase
                  ? <SanMode activeCase={activeCase} />
                  : (
                    <div style={{ padding: 32, textAlign: 'center' }}>
                      <p style={{ color: T.goldL, fontFamily: "'Cormorant Garamond', serif", fontSize: 24, marginBottom: 12 }}>
                        SAN Mode
                      </p>
                      <p style={{ color: T.mute, fontFamily: 'Inter, sans-serif', fontSize: 14, marginBottom: 24 }}>
                        SAN Mode works best with an active case. Open a case from the docket first, then access SAN Mode from inside the case.
                      </p>
                      <button
                        onClick={() => { setView('home'); setTimeout(() => useAppStore.getState().setDocketOpen(true), 100); }}
                        style={{
                          background: `linear-gradient(135deg,#c4a030,#a07820)`,
                          color: '#05050c', border: 'none', borderRadius: 6,
                          padding: '11px 22px', fontSize: 15,
                          fontFamily: "'Cormorant Garamond', serif",
                          cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        ⚖ Open Case Docket
                      </button>
                    </div>
                  )
                }
              </div>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>

      {docketOpen && <CaseDocket />}
    </>
  );
}
