/**
 * AFS Advocates — Matrimonial Dashboard
 *
 * First-class workspace for matrimonial causes matters.
 * Matrimonial cases NEVER touch CaseDashboard after Phase 1.
 *
 * Phase 1: Skeleton — renders placeholder, app compiles cleanly.
 * Phase 4: Built out with 16-tab bar, own header, own engine router.
 *
 * MCA = Matrimonial Causes Act, Cap M7, LFN 2004
 */

import { useAppStore } from '@/state/appStore';
import { T } from '@/constants/tokens';

export function MatrimonialDashboard() {
  const { activeCase, setView } = useAppStore();

  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      fontFamily: "'Times New Roman', Times, serif",
      padding: '40px 32px',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '2px solid #111111',
        paddingBottom: 16,
        marginBottom: 28,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
      }}>
        <div>
          <p style={{
            fontSize: 9, color: '#888888',
            letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 5,
          }}>
            AFS Advocates · Matrimonial Track
          </p>
          <h1 style={{
            fontSize: 26, color: '#111111',
            fontWeight: 700, fontStyle: 'italic', marginBottom: 6,
          }}>
            {activeCase?.caseName ?? 'Matrimonial Matter'}
          </h1>
          {activeCase && (
            <p style={{ fontSize: 12, color: '#888888' }}>
              {[activeCase.court, activeCase.suitNo].filter(Boolean).join(' · ')}
            </p>
          )}
          {/* MCA citation strip */}
          <p style={{
            fontSize: 10, color: '#4a1a7a', marginTop: 6,
            letterSpacing: '.04em',
          }}>
            Matrimonial Causes Act, Cap M7, LFN 2004 · Matrimonial Causes Rules 1983
          </p>
        </div>
        <button
          onClick={() => setView('home')}
          style={{
            background: 'transparent', border: '1px solid #cccccc',
            color: '#444444', borderRadius: 3, padding: '7px 16px',
            fontSize: 12, cursor: 'pointer', marginTop: 8,
          }}
        >
          ← Back
        </button>
      </div>

      {/* Phase 1 placeholder — replaced in Phase 4 */}
      <div style={{
        border: '1px dashed #cccccc',
        borderRadius: 4,
        padding: '48px 32px',
        textAlign: 'center',
        color: T.mute,
      }}>
        <p style={{ fontSize: 14, fontStyle: 'italic', marginBottom: 12 }}>
          Matrimonial Dashboard — Phase 4 build pending
        </p>
        <p style={{ fontSize: 12, color: '#888888' }}>
          16-tab workspace for matrimonial causes will load here.
          <br />
          Foundation types, routing, and storage are active.
        </p>
      </div>
    </div>
  );
}
