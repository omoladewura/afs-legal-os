/**
 * AFS Advocates — Site Navigation Bar
 * Fixed top bar with logo, version tag, and contextual back/docket buttons.
 */

import { useAppStore } from '@/state/appStore';

export function SiteNav() {
  const { view, setView, docketOpen, setDocketOpen, activeCase } = useAppStore();

  const showDocket = view === 'engine' && activeCase;
  const showBack   = view === 'engine' || view === 'home';

  function handleBack() {
    if (view === 'engine') {
      setView('home');
    }
  }

  return (
    <nav className="site-nav no-print">
      <span className="nav-logo">AFS | Advocates</span>
      <div className="nav-right">
        <span className="nav-tag">Full Litigation Suite · v11</span>
        {showDocket && (
          <button
            className="nav-back"
            onClick={() => setDocketOpen(!docketOpen)}
          >
            ⚖ Docket
          </button>
        )}
        {showBack && (
          <button className="nav-back" onClick={handleBack}>
            ← Back
          </button>
        )}
      </div>
    </nav>
  );
}
