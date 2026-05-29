/**
 * AFS Advocates — Root App Component
 *
 * Top-level view router. Renders the correct page based on app state.
 * Also handles the global docket overlay.
 *
 * View flow:
 *   'gate'   → PasswordGate  (first load)
 *   'home'   → HomePage      (mode selector)
 *   'engine'   → CaseDashboard (active case workspace)
 *   'resolver' → ResearchResolver (standalone tool)
 */

import { useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { migrateFromLocalStorage } from '@/storage/migrate';
import { SiteNav } from '@/components/layout/SiteNav';
import { CaseDocket } from '@/components/docket/CaseDocket';
import { PasswordGate } from '@/pages/PasswordGate';
import { HomePage } from '@/pages/HomePage';
import { CaseDashboard } from '@/pages/CaseDashboard';
import { ResearchResolver } from '@/engines/ResearchResolver';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

export function App() {
  const { view, docketOpen, setView } = useAppStore();

  // Run localStorage → IndexedDB migration on first load
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
        </ErrorBoundary>
      </div>

      {/* Global docket overlay */}
      {docketOpen && <CaseDocket />}
    </>
  );
}
